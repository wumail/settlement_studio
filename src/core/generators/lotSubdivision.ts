import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import { clipPolygonHalfPlane, computePolygonAreaSigned, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import type { RngFn } from '../math/rng';
import { pointToPolylineDist } from '../obstacles/collisionAudit';

const INF = Number.POSITIVE_INFINITY;
export interface Obb { readonly ux: Vec2; readonly uy: Vec2; readonly spanU: number; readonly spanV: number; }
export interface LotFront { readonly a: Vec2; readonly b: Vec2; readonly len: number; readonly ux: number; readonly uy: number; }
export interface LotPlan { readonly footprint: Polygon; readonly tier: 'S' | 'M' | 'L'; }
export interface BlockLotPlan { readonly buildings: ReadonlyArray<LotPlan>; readonly courtyards: ReadonlyArray<Polygon>; }
export interface BlockLotContext {
  readonly block: Polygon; readonly scale: number; readonly frayZoneRing: Polyline | null;
  readonly corridors: ReadonlyArray<Polyline>; readonly rng: RngFn;
}

function edgeDirections(poly: Polygon, maxEdges: number): Vec2[] {
  const edges: Array<{ readonly len: number; readonly dir: Vec2 }> = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 1e-6) edges.push({ len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
  }
  edges.sort((p, q) => q.len - p.len);
  const out: Vec2[] = [];
  for (const e of edges) {
    if (out.length >= maxEdges) break;
    if (!out.some((d) => Math.abs(d[0] * e.dir[0] + d[1] * e.dir[1]) > 0.9994)) out.push(e.dir);
  }
  return out;
}

function projectRange(poly: Polygon, nx: number, ny: number): { min: number; max: number } {
  let min = INF;
  let max = -INF;
  for (const p of poly) {
    const v = p[0] * nx + p[1] * ny;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** 主轴最小包围盒：4 顶点内零分配直算，多边枚举 ≤12 条长边方向 */
export function principalObb(poly: Polygon): Obb {
  let best: Obb = { ux: [1, 0], uy: [0, 1], spanU: 0, spanV: 0 };
  let bestArea = INF;
  const check = (ux0: number, ux1: number): void => {
    const pu = projectRange(poly, ux0, ux1);
    const pv = projectRange(poly, -ux1, ux0);
    const area = (pu.max - pu.min) * (pv.max - pv.min);
    if (area < bestArea) {
      bestArea = area;
      best = { ux: [ux0, ux1], uy: [-ux1, ux0], spanU: pu.max - pu.min, spanV: pv.max - pv.min };
    }
  };
  if (poly.length <= 4) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len >= 1e-6) check((b[0] - a[0]) / len, (b[1] - a[1]) / len);
    }
    return best;
  }
  for (const ux of edgeDirections(poly, 12)) check(ux[0], ux[1]);
  return best;
}

function halfObb(poly: Polygon, minShort: number, minArea: number): Obb | null {
  if (poly.length < 3 || Math.abs(computePolygonAreaSigned(poly)) < minArea) return null;
  const obb = principalObb(poly);
  return Math.min(obb.spanU, obb.spanV) >= minShort ? obb : null;
}

/** 宅基地递归二分：垂直主轴 t∈[0.36,0.64]、微扭转 ±2°..5°，收至紧致 4–5 边小块 */
export function subdivideBlockIntoLots(
  block: Polygon,
  maxLotArea: number,
  scale: number,
  rng: RngFn,
  depth = 0,
  cachedObb?: Obb,
): Polygon[] {
  if (block.length < 3) return [];
  const area = Math.abs(computePolygonAreaSigned(block));
  const minShort = 12.6 * scale;
  const minArea = 135 * scale * scale;
  const obb = cachedObb ?? principalObb(block);
  if (area <= maxLotArea || Math.min(obb.spanU, obb.spanV) < minShort * 1.1 || Math.max(obb.spanU, obb.spanV) < minShort * 1.85 || depth >= 7) {
    return [block];
  }
  const axis = obb.spanU >= obb.spanV ? obb.ux : obb.uy;
  const twist = ((rng() < 0.5 ? -1 : 1) * (2 + rng() * 3) * Math.PI) / 180;
  for (const attempt of [{ ang: twist, t: 0.36 + rng() * 0.28 }, { ang: 0, t: 0.5 }]) {
    const ca = Math.cos(attempt.ang);
    const sa = Math.sin(attempt.ang);
    const nx = axis[0] * ca - axis[1] * sa;
    const ny = axis[0] * sa + axis[1] * ca;
    const range = projectRange(block, nx, ny);
    const cut = range.min + (range.max - range.min) * attempt.t;
    const left = clipPolygonHalfPlane(block, nx, ny, cut);
    const right = clipPolygonHalfPlane(block, -nx, -ny, -cut);
    const lObb = halfObb(left, minShort, minArea);
    const rObb = lObb ? halfObb(right, minShort, minArea) : null;
    if (lObb && rObb) {
      return [
        ...subdivideBlockIntoLots(left, maxLotArea, scale, rng, depth + 1, lObb),
        ...subdivideBlockIntoLots(right, maxLotArea, scale, rng, depth + 1, rObb),
      ];
    }
  }
  return [block];
}

/** 临街边识别：边长 ≥ minFrontM 且中点距街坊外环 < 1.2m，按长度降序 */
export function lotFrontEdges(lot: Polygon, blockRing: Polyline, minFrontM: number): LotFront[] {
  const out: LotFront[] = [];
  for (let i = 0; i < lot.length; i += 1) {
    const a = lot[i];
    const b = lot[(i + 1) % lot.length];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < minFrontM) continue;
    if (pointToPolylineDist((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, blockRing) >= 1.2) continue;
    out.push({ a, b, len, ux: dx / len, uy: dy / len });
  }
  out.sort((p, q) => q.len - p.len);
  return out;
}

/** 临街内法向：以宅基地重心判向 */
export function inwardOf(a: Vec2, b: Vec2, lot: Polygon): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 1];
  let nx = -dy / len;
  let ny = dx / len;
  const c = computePolygonCentroid(lot);
  if ((c[0] - a[0]) * nx + (c[1] - a[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

/** 平行于临街边的半平面切片：保留 fromM ≤ (x-A)·n ≤ toM 的进深带 */
export function clipFrontBand(lot: Polygon, a: Vec2, nx: number, ny: number, fromM: number, toM: number): Vec2[] {
  const base = nx * a[0] + ny * a[1];
  let poly = clipPolygonHalfPlane(lot, nx, ny, base + toM);
  if (poly.length < 3) return [];
  poly = clipPolygonHalfPlane(poly, -nx, -ny, -(base + fromM));
  return poly.length >= 3 ? poly : [];
}

/** 山墙与后墙滴水缝：临街外沿保持齐街不退缩，其余内部分户边统一微缩 gapM */
function shrinkInteriorWalls(poly: Polygon, blockRing: Polyline, gapM: number): Vec2[] {
  let out: Vec2[] = poly.map((p) => [p[0], p[1]] as Vec2);
  if (!(gapM > 0)) return out;
  const ccw = computePolygonAreaSigned(poly) >= 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    if (pointToPolylineDist((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, blockRing) < 1.2) continue;
    const ex = ccw ? -(b[1] - a[1]) / len : (b[1] - a[1]) / len;
    const ey = ccw ? (b[0] - a[0]) / len : -(b[0] - a[0]) / len;
    out = clipPolygonHalfPlane(out, -ex, -ey, -(ex * a[0] + ey * a[1] + gapM));
    if (out.length < 3) return [];
  }
  return out;
}

/** 过长临街宅地垂直街边再切，根治火柴棍长条屋（街角大宅允许 <= 21m 转角抱街） */
function splitLongFrontageLots(
  lot: Polygon, blockRing: Polyline, scale: number, rng: RngFn, depth = 0,
): Array<{ readonly lot: Polygon; readonly fronts: LotFront[] }> {
  const fronts = lotFrontEdges(lot, blockRing, 4.8 * scale);
  const f = fronts[0];
  const limit = fronts.length >= 2 ? 21.0 * scale : 16.5 * scale;
  if (depth >= 2 || !f || f.len <= limit) return [{ lot, fronts }];
  const range = projectRange(lot, f.ux, f.uy);
  const cut = range.min + (range.max - range.min) * (0.42 + rng() * 0.16);
  const left = clipPolygonHalfPlane(lot, f.ux, f.uy, cut);
  const right = clipPolygonHalfPlane(lot, -f.ux, -f.uy, -cut);
  if (!halfObb(left, 5.5 * scale, 42 * scale * scale) || !halfObb(right, 5.5 * scale, 42 * scale * scale)) {
    return [{ lot, fronts }];
  }
  return [...splitLongFrontageLots(left, blockRing, scale, rng, depth + 1), ...splitLongFrontageLots(right, blockRing, scale, rng, depth + 1)];
}

function intersectPlaneSeg(a: Vec2, b: Vec2, nx: number, ny: number, c: number): Vec2 | null {
  const da = nx * a[0] + ny * a[1] - c;
  const db = nx * b[0] + ny * b[1] - c;
  if ((da > 1e-7 && db > 1e-7) || (da < -1e-7 && db < -1e-7)) return null;
  const den = da - db;
  if (Math.abs(den) < 1e-9) return null;
  const t = da / den;
  return t >= -1e-6 && t <= 1 + 1e-6 ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : null;
}

/** 较大/街角屋宇后角削出 6 顶点 L 形内院翼楼（翼宽 5.5–9.5m×scale） */
function carveRearLNotch(
  quad: Polygon, front: LotFront, inward: Vec2, fronts: ReadonlyArray<LotFront>, scale: number, rng: RngFn,
): Polygon {
  if (quad.length !== 4) return quad;
  const ux: Vec2 = [front.ux, front.uy];
  const ny: Vec2 = [inward[0], inward[1]];
  const pu = projectRange(quad, ux[0], ux[1]);
  const pv = projectRange(quad, ny[0], ny[1]);
  const wingW = Math.min(pu.max - pu.min - 4.2 * scale, (5.5 + rng() * 4.0) * scale);
  const frontD = Math.min(pv.max - pv.min - 4.2 * scale, (5.5 + rng() * 3.5) * scale);
  if (wingW < 5.0 * scale || frontD < 5.0 * scale) return quad;
  let keepMin = rng() < 0.5;
  const sideFront = fronts[1];
  if (sideFront) {
    const su = (sideFront.a[0] + sideFront.b[0]) * 0.5 * ux[0] + (sideFront.a[1] + sideFront.b[1]) * 0.5 * ux[1];
    keepMin = Math.abs(su - pu.min) < Math.abs(su - pu.max);
  }
  const uCut = keepMin ? pu.min + wingW : pu.max - wingW;
  const vCut = pv.min + frontD;
  const pIn: Vec2 = [uCut * ux[0] + vCut * ny[0], uCut * ux[1] + vCut * ny[1]];
  if (!pointInPolygon(pIn[0], pIn[1], quad)) return quad;
  const hits = quad
    .map((p, i) => ((keepMin ? p[0] * ux[0] + p[1] * ux[1] > uCut : p[0] * ux[0] + p[1] * ux[1] < uCut) && p[0] * ny[0] + p[1] * ny[1] > vCut ? i : -1))
    .filter((i) => i >= 0);
  if (hits.length !== 1) return quad;
  const k = hits[0]!;
  const hitA = intersectPlaneSeg(quad[(k + 3) % 4]!, quad[k]!, ux[0], ux[1], uCut) ?? intersectPlaneSeg(quad[(k + 3) % 4]!, quad[k]!, ny[0], ny[1], vCut);
  const hitB = intersectPlaneSeg(quad[k]!, quad[(k + 1) % 4]!, ux[0], ux[1], uCut) ?? intersectPlaneSeg(quad[k]!, quad[(k + 1) % 4]!, ny[0], ny[1], vCut);
  if (!hitA || !hitB) return quad;
  if (Math.hypot(hitA[0] - pIn[0], hitA[1] - pIn[1]) < 3.2 * scale || Math.hypot(hitB[0] - pIn[0], hitB[1] - pIn[1]) < 3.2 * scale) return quad;
  const out = quad.flatMap((pt, i) => (i === k ? [hitA, pIn, hitB] : [pt]));
  return Math.abs(computePolygonAreaSigned(out)) >= 85 * scale * scale ? out : quad;
}

function pickDepthClass(rng: RngFn, corner: boolean): { depth: number; tier: 'S' | 'M' | 'L' } {
  const r = rng();
  if (!corner && r < 0.28) return { depth: 6.6 + rng() * 2.4, tier: 'S' };
  if (r < (corner ? 0.54 : 0.76)) return { depth: 11.4 + rng() * 3.5, tier: 'M' };
  return { depth: 15.0 + rng() * 3.4, tier: 'L' };
}

function shapeLotFootprint(
  leaf: Polygon, front: LotFront, fronts: ReadonlyArray<LotFront>, ring: Polyline,
  depth: number, setbackM: number, scale: number, rng: RngFn,
): Polygon | null {
  const inward = inwardOf(front.a, front.b, leaf);
  const band = clipFrontBand(leaf, front.a, inward[0], inward[1], setbackM, setbackM + depth * scale);
  if (band.length < 3) return null;
  const shrunk = shrinkInteriorWalls(band, ring, (0.30 + rng() * 0.20) * scale);
  if (shrunk.length < 4) return null;
  const obb = principalObb(shrunk);
  const shortSide = Math.min(obb.spanU, obb.spanV);
  const longSide = Math.max(obb.spanU, obb.spanV);
  const area = Math.abs(computePolygonAreaSigned(shrunk));
  if (shortSide < 4.8 * scale || longSide / Math.max(1e-6, shortSide) > 2.35 || area < 28 * scale * scale) return null;
  return area >= 135 * scale * scale && shortSide >= 9.5 * scale && rng() < (fronts.length >= 2 ? 0.34 : 0.20)
    ? carveRearLNotch(shrunk, front, inward, fronts, scale, rng)
    : shrunk;
}

function isRealFront(f: LotFront, frayZoneRing: Polyline, corridors: ReadonlyArray<Polyline>): boolean {
  const mx = (f.a[0] + f.b[0]) * 0.5;
  const my = (f.a[1] + f.b[1]) * 0.5;
  if (pointToPolylineDist(mx, my, frayZoneRing) > 2.6) return true;
  return corridors.some((line) => pointToPolylineDist(mx, my, line) <= 22);
}

/** 街块 → 宅基地 → 临街面进深裁剪 + 紧致山墙 + 约24%街角L院屋面 */
export function planBlockLots(ctx: BlockLotContext): BlockLotPlan {
  const { block, scale, frayZoneRing, corridors, rng } = ctx;
  const ring: Polyline = block[0] ? [...block, block[0]] : [];
  const maxLotArea = (390 + rng() * 140) * scale * scale;
  const leaves = subdivideBlockIntoLots(block, maxLotArea, scale, rng)
    .flatMap((leaf) => splitLongFrontageLots(leaf, ring, scale, rng));
  const buildings: LotPlan[] = [];
  const courtyards: Polygon[] = [];
  for (const { lot: leaf, fronts } of leaves) {
    if (fronts.length === 0) {
      if (Math.abs(computePolygonAreaSigned(leaf)) >= 42 * scale * scale) courtyards.push(leaf);
      continue;
    }
    let useFronts = fronts;
    let setbackM = (0.04 + rng() * 0.18) * scale;
    if (frayZoneRing) {
      const realFronts = fronts.filter((f) => isRealFront(f, frayZoneRing, corridors));
      if (realFronts.length > 0) useFronts = realFronts;
      else if (rng() < 0.72) continue;
      else setbackM = (1.8 + rng() * 5.2) * scale;
    }
    if (useFronts.length === 1 && rng() < 0.16) {
      if (Math.abs(computePolygonAreaSigned(leaf)) >= 100 * scale * scale) courtyards.push(leaf);
      continue;
    }
    const front = useFronts[0]!;
    const corner = useFronts.some((item) => Math.abs(item.ux * front.ux + item.uy * front.uy) < 0.86);
    const { depth, tier } = pickDepthClass(rng, corner);
    const fp = shapeLotFootprint(leaf, front, useFronts, ring, depth, setbackM, scale, rng);
    if (fp) buildings.push({ footprint: fp, tier });
  }
  return { buildings, courtyards };
}
