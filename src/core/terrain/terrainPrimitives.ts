import type { BBox, Polyline } from '../../schema/geometry.types';
import type { ProjectRiver, TerrainShape } from '../../schema/project.schema';
import { buildCumulativeLengths, sampleCatmullRom } from '../math/spline';

export type ShapeEvaluator = (wx: number, wy: number) => number;
export type RiverCarver = (wx: number, wy: number) => number;
export interface RiverValleySample {
  carve: number;
  flatten: number;
}
export type RiverValleyCarver = (wx: number, wy: number, out: RiverValleySample) => void;

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

/** 确定性相位哈希：让每个山体图元拥有独立不重复的山嘴/冲沟朝向 */
function shapePhase(id: string, seed: number): number {
  let h = (seed * 2654435761) | 0;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 2246822519);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** 偏心椭圆二次正根有效半径核：峰值严格保留在偏心焦点且一阶导数为 0；organic > 0 时山麓生长放射山嘴与冲沟 */
export function evalHillOrBasin(
  shape: TerrainShape,
  wx: number,
  wy: number,
  organic = 0,
  seed = 7719,
): number {
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
  const maxR2 = organic > 1e-9 ? 1.65 : 1;
  if (u * u + v * v >= maxR2) return 0;

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
  let rEff = -b + Math.sqrt(Math.max(1e-9, b * b + c));
  if (organic > 1e-9) {
    const q0 = Math.min(1, d / Math.max(rEff, 1e-6));
    const flankFade = q0 * q0 * (3 - 2 * q0);
    const theta = Math.atan2(dirV, dirU);
    const p = shapePhase(shape.id, seed);
    // 多谐波放射山嘴 + 冲沟调制 rEff：峰顶按 flankFade 平滑归零保 C2 穹顶，山腰至山麓生长自然星脊与沟壑
    const spur =
      0.16 * Math.sin(3 * theta + p) +
      0.11 * Math.sin(5 * theta - p * 1.37) +
      0.065 * Math.cos(7 * theta + p * 2.13);
    rEff *= 1 + spur * organic * flankFade;
  }
  const q = Math.min(1, d / Math.max(rEff, 1e-6));
  const w = (1 - q * q) * (1 - q * q);
  return shape.deltaElev * w;
}

export function createLinearEvaluator(
  shape: TerrainShape,
  organic = 0,
  seed = 7719,
): ShapeEvaluator {
  if (shape.type !== 'ridge' && shape.type !== 'valley' && shape.type !== 'scarp') return () => 0;
  const type = shape.type;
  const sampled = sampleCatmullRom(shape.points, SAMPLE_PER_SEG, false);
  const { cum, total } = buildCumulativeLengths(sampled);
  const box = bboxOf(sampled);
  const widthLeft = Math.max(20, shape.widthLeft);
  const widthRight = Math.max(20, shape.widthRight);
  const org = organic > 1e-9 ? Math.min(1, organic) : 0;
  const phase = org > 0 ? shapePhase(shape.id, seed) : 0;
  const margin = Math.max(widthLeft, widthRight) * (1 + 0.35 * org) + 1;
  const delta = shape.deltaElev;

  return (wx: number, wy: number): number => {
    if (!inExpandedBox(box, margin, wx, wy)) return 0;
    const nr = nearestOnSampled(wx, wy, sampled, cum, total);
    if (!Number.isFinite(nr.dist)) return 0;
    const edgeS = Math.min(nr.sAlong, 1 - nr.sAlong);
    const taperT = Math.max(0, Math.min(1, edgeS / 0.12));
    const endTaper = edgeS < 0.12 ? taperT * taperT * (3 - 2 * taperT) : 1;
    const s = nr.sAlong;
    const sideShift = nr.side >= 0 ? 0 : 1.9;
    const isRidgeLike = type === 'ridge' || type === 'valley';
    const widthMod =
      org > 0 && isRidgeLike
        ? 1 +
          org *
            (0.11 * Math.sin(s * 12.6 + phase + sideShift) +
              0.07 * Math.sin(s * 27.4 - phase * 1.4 + sideShift))
        : 1;
    const crestMod =
      org > 0 && isRidgeLike
        ? 1 + org * (0.04 + 0.08 * Math.sin(s * 11.0 + phase * 1.3) + 0.04 * Math.cos(s * 23.5 - phase))
        : 1;
    if (isRidgeLike) {
      const wSide = (nr.side >= 0 ? widthLeft : widthRight) * widthMod;
      if (nr.dist >= wSide) return 0;
      const q = nr.dist / wSide;
      const om = 1 - q * q;
      return delta * crestMod * endTaper * om * om;
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

/**
 * 河床下切器：窄河床 `2.2 * halfW` 内深 `carveDepthM`；
 * `valleyRatio > 0` 时再叠加宽 `max(carveRadius * 2.5, ratio * 2 * halfW)`、
 * 深 `min(10, 0.55 * carveDepthM)` 的 C1 光滑河谷汇水微凹，使等高线跨河自然折向上游。
 * 默认 `valleyRatio = 0` 与旧版逐字节一致（纯解析单测零漂移）。
 */
export function createRiverCarver(river: ProjectRiver, valleyRatio = 0): RiverCarver {
  const valley = createRiverValleyCarver(river, valleyRatio);
  const sample: RiverValleySample = { carve: 0, flatten: 0 };
  return (wx: number, wy: number): number => {
    valley(wx, wy, sample);
    return sample.carve;
  };
}

/**
 * 水文河谷下切器：同时输出下切深度 `carve` 与正山体谷底削平系数 `flatten ∈ [0, 1]`。
 * `valleyRatio > 0` 时，河谷廊道内的正海拔山体图元按 `flatten` 平滑向河谷基准面收敛，
 * 从根本上杜绝「河流横穿凸起山脊」的伪地形，确保两岸等高线跨河呈经典上游 V 字形折弯。
 * 默认 `valleyRatio = 0` 时 `flatten` 恒为 `0`，与旧版纯解析行为逐字节一致。
 */
export function createRiverValleyCarver(river: ProjectRiver, valleyRatio = 0): RiverValleyCarver {
  const sampled = sampleCatmullRom(river.points, 14, false);
  const { cum, total } = buildCumulativeLengths(sampled);
  const box = bboxOf(sampled);
  const ratio = Number.isFinite(valleyRatio) ? Math.max(0, Math.min(12, valleyRatio)) : 0;
  const wide = ratio > 1e-9;
  const maxHalfW = 0.5 * Math.max(river.widthStartM, river.widthEndM);
  const wideMargin = Math.max(2.2 * 2.5 * maxHalfW, ratio * 2 * maxHalfW);
  const margin = Math.max(2.2 * maxHalfW, wide ? wideMargin : 0) + 1;
  const depth = river.carveDepthM;
  const valleyDepth = wide && depth > 1e-9 ? Math.min(10, 0.55 * depth) : 0;
  return (wx: number, wy: number, out: RiverValleySample): void => {
    out.carve = 0;
    out.flatten = 0;
    if (!inExpandedBox(box, margin, wx, wy)) return;
    const nr = nearestOnSampled(wx, wy, sampled, cum, total);
    if (!Number.isFinite(nr.dist)) return;
    const halfW = 0.5 * (river.widthStartM + (river.widthEndM - river.widthStartM) * nr.sAlong);
    const carveRadius = 2.2 * halfW;
    if (!wide) {
      if (carveRadius <= 1e-9 || nr.dist >= carveRadius) return;
      const q = nr.dist / carveRadius;
      const om = 1 - q * q;
      out.carve = depth * om * om;
      return;
    }
    const valleyRadius = Math.max(carveRadius * 2.5, ratio * 2 * halfW);
    if (valleyRadius <= 1e-9 || nr.dist >= valleyRadius) return;
    const qv = nr.dist / valleyRadius;
    const omv = 1 - qv * qv;
    const valleyEnv = omv * omv;
    const valleyCarve = valleyDepth * valleyEnv;
    const bedNorm =
      carveRadius > 1e-9 && nr.dist < carveRadius ? (1 - (nr.dist / carveRadius) ** 2) ** 2 : 0;
    out.carve = valleyCarve + (depth - valleyDepth) * bedNorm;
    // 峡谷谷底削平聚焦在 2.05×halfW 河道与岸缘内：河心 100% 切穿正山体形成上游 V 字峡口，同时保留紧邻岸边的崖壁陡坡
    const gorgeRadius = Math.max(halfW * 2.05, 18);
    if (gorgeRadius > 1e-9 && nr.dist < gorgeRadius) {
      const qg = nr.dist / gorgeRadius;
      const omg = 1 - qg * qg;
      out.flatten = omg * omg;
    }
  };
}

/** 河床下切单项求值（多河交汇取最大值）：默认 valleyRatio = 0 保持旧行为 */
export function evalRiverCarve(
  rivers: ReadonlyArray<ProjectRiver>,
  wx: number,
  wy: number,
  valleyRatio = 0,
): number {
  let carve = 0;
  for (const river of rivers) {
    const v = createRiverCarver(river, valleyRatio)(wx, wy);
    if (v > carve) carve = v;
  }
  return carve;
}

