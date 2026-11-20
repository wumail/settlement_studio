import type { BBox, Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import { clipPolygonHalfPlane, computePolygonAreaSigned, computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import type { RngFn } from '../math/rng';
import { isConvexPolygon } from '../math/voronoi';
import { clearsPolygon, clearsPolyline, polygonRadiusOf } from '../obstacles/collisionAudit';
import type { BuiltRoad } from '../hydro/reefRoadBridge';
import type { BuiltCanal } from '../hydro/riverCanal';
import { principalObb } from './lotSubdivision';

interface CorridorSeg {
  readonly a: Vec2; readonly b: Vec2; readonly nx: number; readonly ny: number;
  readonly c: number; readonly halfW: number; readonly box: BBox;
}

function bboxOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

function projectSpan(poly: Polygon, dx: number, dy: number): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of poly) {
    const v = p[0] * dx + p[1] * dy;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** 干道在选区内可见的段落（供 village 村寨骨架与次级巷道对齐） */
export function roadSkeletonLines(zonePoly: Polygon, roads: ReadonlyArray<BuiltRoad>): Polyline[] {
  const zbox = computePolygonBBox(zonePoly);
  const out: Polyline[] = [];
  for (const road of roads) {
    if (!bboxOverlap(zbox, computePolygonBBox(road.centerline))) continue;
    let run: Vec2[] = [];
    for (const p of road.centerline) {
      if (pointInPolygon(p[0], p[1], zonePoly)) run.push([p[0], p[1]]);
      else if (run.length >= 2) { out.push(run); run = []; }
      else run = [];
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

function simplifyRdp(pts: ReadonlyArray<Vec2>, eps: number): Vec2[] {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]] as Vec2);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let maxDist = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!;
    const d = len < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist <= eps) return [[a[0], a[1]], [b[0], b[1]]];
  return [...simplifyRdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplifyRdp(pts.slice(idx), eps)];
}

function makeSeg(a: Vec2, b: Vec2, halfW: number): CorridorSeg | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = -dy / len;
  const ny = dx / len;
  return {
    a, b, nx, ny, c: nx * a[0] + ny * a[1], halfW,
    box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

function prepCorridorSegs(roads: ReadonlyArray<BuiltRoad>, canals: ReadonlyArray<BuiltCanal>, regionBox: BBox): CorridorSeg[] {
  const segs: CorridorSeg[] = [];
  const addLine = (line: Polyline, halfW: number): void => {
    if (!bboxOverlap(regionBox, computePolygonBBox(line), halfW)) return;
    for (let i = 0; i < line.length - 1; i += 1) {
      const seg = makeSeg(line[i]!, line[i + 1]!, halfW);
      if (seg && bboxOverlap(regionBox, seg.box, halfW)) segs.push(seg);
    }
  };
  for (const r of roads) addLine(r.centerline, 0.5 * r.widthM + 2.55);
  for (const c of canals) addLine(c.centerline, 0.5 * c.widthM + 4.05);
  return segs;
}

/** 用真实道路与水渠对小块进行精确半平面双侧槽切（零 Voronoi/零扇三角化） */
export function splitBlockByRoads(block: Polygon, segs: ReadonlyArray<CorridorSeg>): Polygon[] {
  if (segs.length === 0) return [block];
  let parts: Polygon[] = [block];
  for (const seg of segs) {
    if (parts.length === 0 || parts.length > 10) break;
    const next: Polygon[] = [];
    for (const part of parts) {
      if (!bboxOverlap(computePolygonBBox(part), seg.box, seg.halfW)) { next.push(part); continue; }
      const pc = computePolygonCentroid(part);
      if (clearsPolyline(part, pc, polygonRadiusOf(part, pc), [seg.a, seg.b], seg.halfW)) { next.push(part); continue; }
      const near = clipPolygonHalfPlane(part, seg.nx, seg.ny, seg.c - seg.halfW);
      const off = clipPolygonHalfPlane(part, -seg.nx, -seg.ny, -(seg.c + seg.halfW));
      if (near.length >= 3 && Math.abs(computePolygonAreaSigned(near)) >= 280) next.push(near);
      if (off.length >= 3 && Math.abs(computePolygonAreaSigned(off)) >= 280) next.push(off);
    }
    parts = next;
  }
  return parts;
}

/** 凹角沿内角平分线切一刀（保留 alleyHalfW 巷缝），将 L/新月形选区安全剖凸 */
function splitConcaveOnce(poly: Polygon, alleyHalfW: number, depth = 0): Polygon[] {
  if (depth >= 3 || poly.length < 4 || isConvexPolygon(poly)) return [poly];
  const ccw = computePolygonAreaSigned(poly) >= 0;
  const n = poly.length;
  let bestIdx = -1;
  let bestCross = 0;
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i - 1 + n) % n]!;
    const cur = poly[i]!;
    const next = poly[(i + 1) % n]!;
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const signed = ccw ? -cross : cross;
    if (signed > bestCross) { bestCross = signed; bestIdx = i; }
  }
  if (bestIdx < 0) return [poly];
  const prev = poly[(bestIdx - 1 + n) % n]!;
  const cur = poly[bestIdx]!;
  const next = poly[(bestIdx + 1) % n]!;
  const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
  const l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
  if (l1 < 1e-6 || l2 < 1e-6) return [poly];
  const u1x = (cur[0] - prev[0]) / l1;
  const u1y = (cur[1] - prev[1]) / l1;
  const u2x = (next[0] - cur[0]) / l2;
  const u2y = (next[1] - cur[1]) / l2;
  for (const d of [[-u1y + u2y, u1x - u2x], [-u1y, u1x], [-u2y, u2x]] as const) {
    const len = Math.hypot(d[0], d[1]);
    if (len < 1e-6) continue;
    const nx = d[0] / len;
    const ny = d[1] / len;
    const c = nx * cur[0] + ny * cur[1];
    const left = clipPolygonHalfPlane(poly, nx, ny, c - alleyHalfW);
    const right = clipPolygonHalfPlane(poly, -nx, -ny, -(c + alleyHalfW));
    if (left.length >= 3 && right.length >= 3 && Math.abs(computePolygonAreaSigned(left)) >= 480 && Math.abs(computePolygonAreaSigned(right)) >= 480) {
      return [...splitConcaveOnce(left, alleyHalfW, depth + 1), ...splitConcaveOnce(right, alleyHalfW, depth + 1)];
    }
  }
  return [poly];
}

function splitAtBends(part: Polygon, line: Polyline, alleyHalfW: number): Polygon[] {
  let pieces: Polygon[] = [part];
  for (let i = 1; i < line.length - 1; i += 1) {
    const p0 = line[i - 1]!;
    const p1 = line[i]!;
    const p2 = line[i + 1]!;
    const l0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const l1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (l0 < 1e-6 || l1 < 1e-6) continue;
    const d0x = (p1[0] - p0[0]) / l0;
    const d0y = (p1[1] - p0[1]) / l0;
    const d1x = (p2[0] - p1[0]) / l1;
    const d1y = (p2[1] - p1[1]) / l1;
    if (d0x * d1x + d0y * d1y > 0.985) continue;
    const mlen = Math.hypot(d0x + d1x, d0y + d1y);
    if (mlen < 1e-6) continue;
    const mnx = (d0x + d1x) / mlen;
    const mny = (d0y + d1y) / mlen;
    const mc = mnx * p1[0] + mny * p1[1];
    const split: Polygon[] = [];
    for (const q of pieces) {
      if (!pointInPolygon(p1[0], p1[1], q)) { split.push(q); continue; }
      const a = clipPolygonHalfPlane(q, mnx, mny, mc - alleyHalfW);
      const b = clipPolygonHalfPlane(q, -mnx, -mny, -(mc + alleyHalfW));
      if (a.length >= 3 && Math.abs(computePolygonAreaSigned(a)) >= 400) split.push(a);
      if (b.length >= 3 && Math.abs(computePolygonAreaSigned(b)) >= 400) split.push(b);
    }
    if (split.length > 0) pieces = split;
  }
  return pieces;
}

/** 宏观干道/水渠切分：RDP 简折线 + 拐点斜接巷缝 + 槽切，杜绝无限直线误切 */
function sliceMacroCorridors(
  parts: Polygon[],
  roads: ReadonlyArray<BuiltRoad>,
  canals: ReadonlyArray<BuiltCanal>,
  alleyHalfW: number,
): Polygon[] {
  const items = [
    ...roads.map((r) => ({ line: simplifyRdp(r.centerline, 3.0), halfW: 0.5 * r.widthM + 2.55 })),
    ...canals.map((c) => ({ line: simplifyRdp(c.centerline, 3.0), halfW: 0.5 * c.widthM + 4.05 })),
  ];
  let cur = parts;
  for (const item of items) {
    if (item.line.length < 2) continue;
    const next: Polygon[] = [];
    for (const part of cur) {
      const pc = computePolygonCentroid(part);
      if (clearsPolyline(part, pc, polygonRadiusOf(part, pc), item.line, item.halfW)) { next.push(part); continue; }
      for (const piece of splitAtBends(part, item.line, alleyHalfW)) {
        const segs: CorridorSeg[] = [];
        for (let i = 0; i < item.line.length - 1; i += 1) {
          const seg = makeSeg(item.line[i]!, item.line[i + 1]!, item.halfW);
          if (!seg) continue;
          const span = projectSpan(piece, seg.ny, -seg.nx);
          const pa = seg.a[0] * seg.ny - seg.a[1] * seg.nx;
          const pb = seg.b[0] * seg.ny - seg.b[1] * seg.nx;
          if (Math.min(span.max, Math.max(pa, pb)) - Math.max(span.min, Math.min(pa, pb)) >= Math.max(12, (span.max - span.min) * 0.42)) {
            segs.push(seg);
          }
        }
        next.push(...splitBlockByRoads(piece, segs));
      }
    }
    cur = next;
  }
  return cur;
}

/** 凸内孔（堡寨/集市/禁建圈）纯半平面扣除，零扇形三角化 */
function subtractConvexHoles(parts: Polygon[], holes: ReadonlyArray<Polygon>, alleyHalfW: number): Polygon[] {
  let cur = parts;
  for (const hole of holes) {
    if (!isConvexPolygon(hole)) continue;
    const ccw = computePolygonAreaSigned(hole) >= 0;
    const next: Polygon[] = [];
    for (const part of cur) {
      const pc = computePolygonCentroid(part);
      if (clearsPolygon(part, pc, polygonRadiusOf(part, pc), hole, 3.5)) { next.push(part); continue; }
      let rem: Vec2[] = part.map((p) => [p[0], p[1]] as Vec2);
      for (let i = 0; i < hole.length && rem.length >= 3; i += 1) {
        const a = hole[i]!;
        const b = hole[(i + 1) % hole.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const nx = ccw ? (b[1] - a[1]) / len : -(b[1] - a[1]) / len;
        const ny = ccw ? -(b[0] - a[0]) / len : (b[0] - a[0]) / len;
        const d = nx * a[0] + ny * a[1] + 3.5;
        const outside = clipPolygonHalfPlane(rem, -nx, -ny, -d);
        if (outside.length >= 3 && Math.abs(computePolygonAreaSigned(outside)) >= 450) {
          const obb = principalObb(outside);
          if (Math.min(obb.spanU, obb.spanV) >= 14) next.push(outside);
        }
        rem = clipPolygonHalfPlane(rem, nx, ny, d - 2 * alleyHalfW);
      }
    }
    cur = next;
  }
  return cur;
}

/** Stage A — 扭转 OBB 街坊递归二分（实得块均 3,500–4,200 m²，短边 >= 28m，含 4.2–6.2m 巷缝） */
function bisectStreetBlocks(poly: Polygon, alleyHalfW: number, scale: number, rng: RngFn, depth = 0): Polygon[] {
  if (poly.length < 3) return [];
  const area = Math.abs(computePolygonAreaSigned(poly));
  const obb = principalObb(poly);
  const shortSpan = Math.min(obb.spanU, obb.spanV);
  const longSpan = Math.max(obb.spanU, obb.spanV);
  if (area < 420 || shortSpan < 11 * scale) return [];
  const scaleFactor = Math.max(0.65, Math.min(1.3, scale));
  const splitThr = (7600 + rng() * 2000) * scaleFactor;
  const minShort = 38 * Math.max(0.72, Math.min(1.15, scale));
  if (area <= splitThr || shortSpan < minShort * 0.9 || longSpan < minShort * 1.85 || depth >= 10) return [poly];
  const primary = obb.spanU >= obb.spanV ? obb.ux : obb.uy;
  const axis = longSpan / Math.max(1, shortSpan) < 1.38 && shortSpan >= minShort * 1.75 && rng() < 0.32
    ? (obb.spanU >= obb.spanV ? obb.uy : obb.ux)
    : primary;
  const twist = ((rng() < 0.5 ? -1 : 1) * (3 + rng() * 5) * Math.PI) / 180;
  for (const attempt of [{ ang: twist, t: 0.38 + rng() * 0.24 }, { ang: 0, t: 0.5 }]) {
    const ca = Math.cos(attempt.ang);
    const sa = Math.sin(attempt.ang);
    const nx = axis[0] * ca - axis[1] * sa;
    const ny = axis[0] * sa + axis[1] * ca;
    const span = projectSpan(poly, nx, ny);
    const cut = span.min + (span.max - span.min) * attempt.t;
    const left = clipPolygonHalfPlane(poly, nx, ny, cut - alleyHalfW);
    const right = clipPolygonHalfPlane(poly, -nx, -ny, -(cut + alleyHalfW));
    if (left.length < 3 || right.length < 3) continue;
    if (Math.abs(computePolygonAreaSigned(left)) < 900 * scaleFactor || Math.abs(computePolygonAreaSigned(right)) < 900 * scaleFactor) continue;
    const lo = principalObb(left);
    const ro = principalObb(right);
    const minHalf = Math.min(24 * Math.max(0.7, scale), shortSpan * 0.78);
    if (Math.min(lo.spanU, lo.spanV) < minHalf || Math.min(ro.spanU, ro.spanV) < minHalf) continue;
    return [...bisectStreetBlocks(left, alleyHalfW, scale, rng, depth + 1), ...bisectStreetBlocks(right, alleyHalfW, scale, rng, depth + 1)];
  }
  return [poly];
}

/** 选区 → 剖凹 → 干道水渠切分 → 扣孔 → Stage A OBB 街坊 → 精确路渠微修 */
export function buildStreetBlocks(
  innerPoly: Polygon,
  roads: ReadonlyArray<BuiltRoad>,
  canals: ReadonlyArray<BuiltCanal>,
  holes: ReadonlyArray<Polygon>,
  streetWidthM: number,
  scale: number,
  rng: RngFn,
): Polygon[] {
  const alleyHalfW = Math.max(2.1, Math.min(3.1, 0.32 * streetWidthM));
  const holed = subtractConvexHoles(sliceMacroCorridors(splitConcaveOnce(innerPoly, alleyHalfW), roads, canals, alleyHalfW), holes, alleyHalfW);
  const segs = prepCorridorSegs(roads, canals, computePolygonBBox(innerPoly));
  return holed.flatMap((part) => bisectStreetBlocks(part, alleyHalfW, scale, rng)).flatMap((block) => {
    const bBox = computePolygonBBox(block);
    const local = segs.filter((s) => bboxOverlap(bBox, s.box, s.halfW));
    return local.length === 0 ? [block] : splitBlockByRoads(block, local);
  });
}
