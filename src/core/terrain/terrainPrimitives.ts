import type { BBox, Polyline } from '../../schema/geometry.types';
import type { ProjectRiver, TerrainShape } from '../../schema/project.schema';
import { buildCumulativeLengths, sampleCatmullRom } from '../math/spline';

export type ShapeEvaluator = (wx: number, wy: number) => number;
export type RiverCarver = (wx: number, wy: number) => number;

interface NearestScratch {
  dist: number;
  tx: number;
  ty: number;
  sAlong: number;
  side: number;
}

const SCRATCH: NearestScratch = { dist: 0, tx: 1, ty: 0, sAlong: 0, side: 0 };
const SAMPLE_PER_SEG = 8;

function bboxOf(points: Polyline): BBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

function inExpandedBox(box: BBox, margin: number, x: number, y: number): boolean {
  return x >= box[0] - margin && x <= box[2] + margin && y >= box[1] - margin && y <= box[3] + margin;
}

/** 最近投影：填充模块级 SCRATCH，避免 66049 次逐点堆分配 */
function nearestOnSampled(
  px: number,
  py: number,
  pts: Polyline,
  cum: Float64Array,
  total: number,
): NearestScratch {
  let bestD2 = Number.POSITIVE_INFINITY;
  let bestI = 0;
  let bestT = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-18) t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
    const qx = a[0] + dx * t;
    const qy = a[1] + dy * t;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
      bestT = t;
    }
  }
  const a = pts[bestI];
  const b = pts[bestI + 1];
  if (!a || !b) {
    Object.assign(SCRATCH, { dist: Number.POSITIVE_INFINITY, tx: 1, ty: 0, sAlong: 0, side: 0 });
    return SCRATCH;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const segLen = Math.hypot(dx, dy);
  SCRATCH.tx = segLen > 1e-9 ? dx / segLen : 1;
  SCRATCH.ty = segLen > 1e-9 ? dy / segLen : 0;
  SCRATCH.dist = Math.sqrt(bestD2);
  SCRATCH.sAlong = total > 1e-9 ? ((cum[bestI] ?? 0) + segLen * bestT) / total : 0;
  SCRATCH.side = (px - (a[0] + dx * bestT)) * SCRATCH.ty - (py - (a[1] + dy * bestT)) * SCRATCH.tx;
  return SCRATCH;
}
/** 背景斜坡项：沿 slopeDirDeg 下坡方向海拔递减 */
export function evalBaseSlope(
  wx: number,
  wy: number,
  worldSizeM: number,
  slopeMagM: number,
  slopeDirDeg: number,
): number {
  const half = 0.5 * worldSizeM;
  const rad = (slopeDirDeg * Math.PI) / 180;
  const proj =
    ((wx - half) * Math.cos(rad) + (wy - half) * Math.sin(rad)) / Math.max(worldSizeM, 1);
  return -slopeMagM * proj;
}

/** 偏心椭圆二次正根有效半径核：峰值一阶导数为 0，偏心侧陡、背侧缓 */
export function evalHillOrBasin(shape: TerrainShape, wx: number, wy: number): number {
  if (shape.type !== 'hill' && shape.type !== 'basin') return 0;
  const rx = Math.max(25, shape.rx);
  const ry = Math.max(25, shape.ry);
  const rad = (shape.angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const dx = wx - shape.cx;
  const dy = wy - shape.cy;
  const u = (dx * cosA + dy * sinA) / rx;
  const v = (-dx * sinA + dy * cosA) / ry;
  if (u * u + v * v >= 1) return 0;

  let fu = shape.focusX;
  let fv = shape.focusY;
  const fNorm = Math.hypot(fu, fv);
  if (fNorm > 0.72) {
    fu = (fu * 0.72) / fNorm;
    fv = (fv * 0.72) / fNorm;
  }
  const du = u - fu;
  const dv = v - fv;
  const d = Math.hypot(du, dv);
  if (d < 1e-8) return shape.deltaElev;
  const dirU = du / d;
  const dirV = dv / d;
  const b = fu * dirU + fv * dirV;
  const c = 1 - (fu * fu + fv * fv);
  const rEff = -b + Math.sqrt(Math.max(1e-9, b * b + c));
  const q = Math.min(1, d / Math.max(rEff, 1e-6));
  const w = (1 - q * q) * (1 - q * q);
  return shape.deltaElev * w;
}

export function createLinearEvaluator(shape: TerrainShape): ShapeEvaluator {
  if (shape.type !== 'ridge' && shape.type !== 'valley' && shape.type !== 'scarp') return () => 0;
  const type = shape.type;
  const sampled = sampleCatmullRom(shape.points, SAMPLE_PER_SEG, false);
  const { cum, total } = buildCumulativeLengths(sampled);
  const box = bboxOf(sampled);
  const widthLeft = Math.max(20, shape.widthLeft);
  const widthRight = Math.max(20, shape.widthRight);
  const margin = Math.max(widthLeft, widthRight) + 1;
  const delta = shape.deltaElev;

  return (wx: number, wy: number): number => {
    if (!inExpandedBox(box, margin, wx, wy)) return 0;
    const nr = nearestOnSampled(wx, wy, sampled, cum, total);
    if (!Number.isFinite(nr.dist)) return 0;
    const edgeS = Math.min(nr.sAlong, 1 - nr.sAlong);
    const taperT = Math.max(0, Math.min(1, edgeS / 0.12));
    const endTaper = edgeS < 0.12 ? taperT * taperT * (3 - 2 * taperT) : 1;
    if (type === 'ridge' || type === 'valley') {
      const wSide = nr.side >= 0 ? widthLeft : widthRight;
      if (nr.dist >= wSide) return 0;
      const q = nr.dist / wSide;
      const om = 1 - q * q;
      return delta * endTaper * om * om;
    }
    if (nr.side < 0) {
      if (nr.dist >= widthRight) return 0;
      const u = 1 - nr.dist / widthRight;
      return delta * endTaper * (u * u * (3 - 2 * u));
    }
    if (nr.dist <= 0.7 * widthLeft) return delta * endTaper;
    if (nr.dist >= widthLeft) return 0;
    const qb = (nr.dist - 0.7 * widthLeft) / Math.max(1e-6, 0.3 * widthLeft);
    const om = 1 - qb * qb;
    return delta * endTaper * om * om;
  };
}

/** 单点地形图元求值（一次性构建采样缓存，批量求值请走 buildElevationField） */
export function evalTerrainShape(shape: TerrainShape, wx: number, wy: number): number {
  if (shape.type === 'hill' || shape.type === 'basin') return evalHillOrBasin(shape, wx, wy);
  return createLinearEvaluator(shape)(wx, wy);
}

export function createRiverCarver(river: ProjectRiver): RiverCarver {
  const sampled = sampleCatmullRom(river.points, 14, false);
  const { cum, total } = buildCumulativeLengths(sampled);
  const box = bboxOf(sampled);
  const margin = 2.2 * 0.5 * Math.max(river.widthStartM, river.widthEndM) + 1;
  const depth = river.carveDepthM;
  return (wx: number, wy: number): number => {
    if (!inExpandedBox(box, margin, wx, wy)) return 0;
    const nr = nearestOnSampled(wx, wy, sampled, cum, total);
    if (!Number.isFinite(nr.dist)) return 0;
    const halfW = 0.5 * (river.widthStartM + (river.widthEndM - river.widthStartM) * nr.sAlong);
    const carveRadius = 2.2 * halfW;
    if (carveRadius <= 1e-9 || nr.dist >= carveRadius) return 0;
    const q = nr.dist / carveRadius;
    const om = 1 - q * q;
    return depth * om * om;
  };
}

/** 河床下切单项求值（多河交汇取最大值） */
export function evalRiverCarve(
  rivers: ReadonlyArray<ProjectRiver>,
  wx: number,
  wy: number,
): number {
  let carve = 0;
  for (const river of rivers) {
    const v = createRiverCarver(river)(wx, wy);
    if (v > carve) carve = v;
  }
  return carve;
}

