import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { RngFn } from '../math/rng';
import type { BuiltCanal } from '../hydro/riverCanal';
import type { BuiltRoad } from '../hydro/reefRoadBridge';
import { type ElevationFieldData, sampleGradient } from '../terrain/elevationField';
import {
  clipPolygonHalfPlane,
  computePolygonAreaSigned,
  computePolygonCentroid,
} from '../math/polygon';
import { pointToPolylineDist } from '../obstacles/collisionAudit';

export interface FarmlandStripCandidate {
  readonly polygon: Polygon;
  readonly angleDeg: number;
  readonly furrowSpacingM: number;
  readonly toneShift: number;
  readonly isPerimeter: boolean;
}

export interface SharedBundSegment { readonly a: Vec2; readonly b: Vec2; }

export interface SubdivideFarmlandInput {
  readonly zonePolygon: Polygon;
  readonly frayOuter: boolean;
  readonly rng: RngFn;
  readonly elevationField: ElevationFieldData;
  readonly roads: ReadonlyArray<BuiltRoad>;
  readonly canals: ReadonlyArray<BuiltCanal>;
}

export interface SubdivideFarmlandOutput {
  readonly strips: ReadonlyArray<FarmlandStripCandidate>;
  readonly sharedBunds: ReadonlyArray<SharedBundSegment>;
}

const MAX_DEPTH = 9;
const MIN_AREA_M2 = 1600;
const MIN_WIDTH_M = 32;
const MAX_WIDTH_M = 75;
const MAX_ASPECT = 4.0;
const TARGET_MIN_M2 = 3600;
const TARGET_SPAN_M2 = 2900;
const PERIMETER_TOL_M = 4.0;

/** 最长边方向角，归一化到 [0, 180) */
function longestEdgeDeg(poly: ReadonlyArray<Vec2>): number {
  let best = -1;
  let deg = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= best) continue;
    best = len;
    const raw = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    deg = ((raw % 180) + 180) % 180;
  }
  return deg;
}

/** 优先级 1 临路/临渠切向；优先级 2 等高线切向；纯平地按最长主轴 + 确定性偏角 */
function resolveDominantAxis(input: SubdivideFarmlandInput): number {
  const c = computePolygonCentroid(input.zonePolygon);
  const lines: Polyline[] = [
    ...input.roads.filter((road) => road.tier !== 'lane').map((road) => road.centerline),
    ...input.canals.map((canal) => canal.centerline),
  ];
  let bestDist = Number.POSITIVE_INFINITY;
  let bestAngle = Number.NaN;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      const d = pointToPolylineDist(c[0], c[1], [a, b]);
      if (d >= bestDist) continue;
      bestDist = d;
      bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  if (bestDist <= 180 && Number.isFinite(bestAngle)) return bestAngle;
  const g = sampleGradient(input.elevationField, c[0], c[1]);
  const jitter = ((input.rng() - 0.5) * 14 * Math.PI) / 180;
  if (Math.hypot(g.dzdx, g.dzdy) > 1e-4) return Math.atan2(g.dzdx, -g.dzdy) + jitter;
  return (longestEdgeDeg(input.zonePolygon) * Math.PI) / 180 + jitter;
}

/** 切线与多边形交线段（取沿切线最远两点）记为共享田埂，供下游沿埂成簇树篱 */
function recordBund(
  poly: ReadonlyArray<Vec2>,
  nx: number,
  ny: number,
  offsetC: number,
  out: SharedBundSegment[],
): void {
  const tx = -ny;
  const ty = nx;
  let loT = Number.POSITIVE_INFINITY;
  let hiT = Number.NEGATIVE_INFINITY;
  let lo: Vec2 = [0, 0];
  let hi: Vec2 = [0, 0];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const da = nx * a[0] + ny * a[1] - offsetC;
    const db = nx * b[0] + ny * b[1] - offsetC;
    if (da * db >= 0 && Math.abs(da) > 1e-9) continue;
    const t = da * db < 0 ? da / (da - db) : 0;
    const px = a[0] + (b[0] - a[0]) * t;
    const py = a[1] + (b[1] - a[1]) * t;
    const proj = px * tx + py * ty;
    if (proj < loT) { loT = proj; lo = [px, py]; }
    if (proj > hiT) { hiT = proj; hi = [px, py]; }
  }
  if (hiT - loT >= 12) out.push({ a: lo, b: hi });
}

interface SplitState { readonly rng: RngFn; readonly bunds: SharedBundSegment[]; readonly leaves: Polygon[] }

/** OBB 递归条带切分：长宽比不足 1.45 时按非对称比例切狭长条带，每次切分附 ±4°–8° 微斜 */
function splitRecursive(poly: Polygon, depth: number, angRad: number, state: SplitState): void {
  const area = Math.abs(computePolygonAreaSigned(poly));
  if (poly.length < 3 || area < MIN_AREA_M2) {
    if (poly.length >= 3) state.leaves.push(poly);
    return;
  }
  const cosA = Math.cos(angRad);
  const sinA = Math.sin(angRad);
  const us = poly.map((p) => p[0] * cosA + p[1] * sinA);
  const vs = poly.map((p) => -p[0] * sinA + p[1] * cosA);
  const minU = Math.min(...us);
  const minV = Math.min(...vs);
  const spanU = Math.max(...us) - minU;
  const spanV = Math.max(...vs) - minV;
  const short = Math.min(spanU, spanV);
  const long = Math.max(spanU, spanV);
  const aspect = long / Math.max(1, short);
  const targetMax = TARGET_MIN_M2 + state.rng() * TARGET_SPAN_M2;
  const stripOk = aspect >= 1.55 || area < 3000;
  const settled = area <= targetMax && short <= MAX_WIDTH_M && aspect <= MAX_ASPECT && stripOk;
  if (settled || depth >= MAX_DEPTH || short < MIN_WIDTH_M) {
    state.leaves.push(poly);
    return;
  }
  const splitU = spanU >= spanV;
  const ratio = aspect < 1.45 && area > 4200 ? 0.36 + state.rng() * 0.28 : 0.4 + state.rng() * 0.2;
  const jitterDeg = (state.rng() < 0.5 ? -1 : 1) * (4 + state.rng() * 4);
  const baseAng = splitU ? angRad : angRad + Math.PI / 2;
  const cutAng = baseAng + (jitterDeg * Math.PI) / 180;
  const nx = Math.cos(cutAng);
  const ny = Math.sin(cutAng);
  const c = computePolygonCentroid(poly);
  const axisX = Math.cos(baseAng);
  const axisY = Math.sin(baseAng);
  const cutCoord = (splitU ? minU : minV) + ratio * (splitU ? spanU : spanV);
  const shift = cutCoord - (c[0] * axisX + c[1] * axisY);
  const offsetC = (c[0] + axisX * shift) * nx + (c[1] + axisY * shift) * ny;
  const left = clipPolygonHalfPlane(poly, nx, ny, offsetC);
  const right = clipPolygonHalfPlane(poly, -nx, -ny, -offsetC);
  const leftArea = left.length >= 3 ? Math.abs(computePolygonAreaSigned(left)) : 0;
  const rightArea = right.length >= 3 ? Math.abs(computePolygonAreaSigned(right)) : 0;
  if (leftArea < MIN_AREA_M2 * 0.55 || rightArea < MIN_AREA_M2 * 0.55) {
    state.leaves.push(poly);
    return;
  }
  recordBund(poly, nx, ny, offsetC, state.bunds);
  const childAng = state.rng() < 0.45 ? cutAng : angRad;
  splitRecursive(left, depth + 1, childAng, state);
  splitRecursive(right, depth + 1, childAng, state);
}

/** 朝外边界一侧退让：沿最近外框边内法向裁掉 4–14m，形成参差阶梯田垄 */
function retreatFromBoundary(poly: Polygon, zone: Polygon, retreatM: number): Vec2[] {
  const ring: Polyline = zone[0] ? [...zone, zone[0]] : zone;
  const c = computePolygonCentroid(poly);
  const cz = computePolygonCentroid(zone);
  let bestDist = Number.POSITIVE_INFINITY;
  let nx = 1;
  let ny = 0;
  let limit = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1];
    const b = ring[i];
    if (!a || !b) continue;
    const d = pointToPolylineDist(c[0], c[1], [a, b]);
    if (d >= bestDist) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const mx = (a[0] + b[0]) * 0.5 - cz[0];
    const my = (a[1] + b[1]) * 0.5 - cz[1];
    const flip = dx * my - dy * mx < 0 ? -1 : 1;
    bestDist = d;
    nx = (-dy / len) * flip;
    ny = (dx / len) * flip;
    limit = nx * a[0] + ny * a[1] - retreatM;
  }
  if (!Number.isFinite(bestDist)) return poly.map((p) => [p[0], p[1]] as Vec2);
  return clipPolygonHalfPlane(poly, nx, ny, limit);
}

function toCandidate(poly: Polygon, input: SubdivideFarmlandInput, zoneRing: Polyline): FarmlandStripCandidate | null {
  const perimeter = poly.some((p) => pointToPolylineDist(p[0], p[1], zoneRing) < PERIMETER_TOL_M);
  let finalPoly: Polygon = poly;
  if (input.frayOuter !== false && perimeter) {
    if (Math.abs(computePolygonAreaSigned(poly)) < 3500 && input.rng() < 0.28) return null;
    if (input.rng() < 0.42) {
      const cut = retreatFromBoundary(poly, input.zonePolygon, 4 + input.rng() * 10);
      if (cut.length >= 3 && Math.abs(computePolygonAreaSigned(cut)) >= MIN_AREA_M2) finalPoly = cut;
    }
  }
  const longDeg = longestEdgeDeg(finalPoly);
  const c = computePolygonCentroid(finalPoly);
  const tone = (input.rng() * 2 - 1) * 0.62 + 0.38 * Math.sin(c[0] * 0.011 + c[1] * 0.013);
  return {
    polygon: finalPoly,
    angleDeg: input.rng() < 0.8 ? longDeg : (longDeg + 90) % 180,
    furrowSpacingM: 5.5 + input.rng() * 2.0,
    toneShift: Math.max(-1, Math.min(1, tone)),
    isPerimeter: perimeter,
  };
}

/** 条田唯一入口：主轴求解 → OBB 递归切分 → 参差外缘 → 独立耕垄方向与四阶色调 */
export function subdivideFarmlandStrips(input: SubdivideFarmlandInput): SubdivideFarmlandOutput {
  const first = input.zonePolygon[0];
  const zoneRing: Polyline = first ? [...input.zonePolygon, first] : input.zonePolygon;
  const state: SplitState = { rng: input.rng, bunds: [], leaves: [] };
  splitRecursive(input.zonePolygon, 0, resolveDominantAxis(input), state);
  const strips: FarmlandStripCandidate[] = [];
  for (const leaf of state.leaves) {
    const candidate = toCandidate(leaf, input, zoneRing);
    if (candidate) strips.push(candidate);
  }
  return { strips, sharedBunds: state.bunds };
}
