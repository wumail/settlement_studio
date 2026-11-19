import type { BBox, Polygon, Polyline, Vec2 } from '../../schema/geometry.types';

const EPS = 1e-9;

export function computePolygonAreaSigned(poly: Polygon): number {
  const n = poly.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (!a || !b) continue;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return 0.5 * sum;
}

export function computePolygonAreaHa(poly: Polygon): number {
  return Math.abs(computePolygonAreaSigned(poly)) / 10000;
}

export function computePolygonCentroid(poly: Polygon): Vec2 {
  const n = poly.length;
  if (n === 0) return [0, 0];
  const first = poly[0];
  if (!first) return [0, 0];
  if (n < 3) return [first[0], first[1]];
  const area = computePolygonAreaSigned(poly);
  if (Math.abs(area) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (!a || !b) continue;
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
  }
  const k = 1 / (6 * area);
  return [cx * k, cy * k];
}

export function computePolygonBBox(poly: Polyline): BBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

export function pointInPolygon(px: number, py: number, poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const yi = a[1];
    const yj = b[1];
    if (yi > py !== yj > py) {
      const xi = a[0];
      const xj = b[0];
      const xCross = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

/** 唯一精确线段交点求解器：返回真实参数 t/u，杜绝手写分子把 `sx` 误写为 `rx` */
export function intersectSegmentsExact(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { x: number; y: number; t: number; u: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a[0] + rx * t, y: a[1] + ry * t, t, u };
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return intersectSegmentsExact(a, b, c, d) !== null;
}

export function segmentToSegmentDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (intersectSegmentsExact(a, b, c, d) !== null) return 0;
  const p1 = closestOnSeg(a, c, d);
  const p2 = closestOnSeg(b, c, d);
  const p3 = closestOnSeg(c, a, b);
  const p4 = closestOnSeg(d, a, b);
  return Math.min(p1, p2, p3, p4);
}

function closestOnSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function edgesOf(poly: Polyline, closed: boolean): Array<readonly [Vec2, Vec2]> {
  const out: Array<readonly [Vec2, Vec2]> = [];
  const n = poly.length;
  for (let i = 0; i < n - 1; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    if (a && b) out.push([a, b]);
  }
  if (closed && n >= 3) {
    const a = poly[n - 1];
    const b = poly[0];
    if (a && b) out.push([a, b]);
  }
  return out;
}

export function minDistPolyToPoly(polyA: Polygon, polyB: Polygon, earlyOutDist?: number): number {
  const a0 = polyA[0];
  if (!a0) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(a0[0], a0[1], polyB)) return 0;
  const b0 = polyB[0];
  if (b0 && pointInPolygon(b0[0], b0[1], polyA)) return 0;
  const ea = edgesOf(polyA, true);
  const eb = edgesOf(polyB, true);
  let best = Number.POSITIVE_INFINITY;
  for (const segA of ea) {
    for (const segB of eb) {
      const d = segmentToSegmentDist(segA[0], segA[1], segB[0], segB[1]);
      if (d < best) best = d;
      if (earlyOutDist !== undefined && best <= earlyOutDist) return best;
    }
  }
  return best;
}

export function minDistPolyToPolyline(
  poly: Polygon,
  line: Polyline,
  earlyOutDist?: number,
): number {
  for (const p of line) {
    if (pointInPolygon(p[0], p[1], poly)) return 0;
  }
  const ea = edgesOf(poly, true);
  const eb = edgesOf(line, false);
  let best = Number.POSITIVE_INFINITY;
  for (const segA of ea) {
    for (const segB of eb) {
      const d = segmentToSegmentDist(segA[0], segA[1], segB[0], segB[1]);
      if (d < best) best = d;
      if (earlyOutDist !== undefined && best <= earlyOutDist) return best;
    }
  }
  return best;
}

/** Sutherland-Hodgman 单半平面裁剪：保留 `nx * x + ny * y <= offsetC + 1e-7` */
export function clipPolygonHalfPlane(
  poly: Polygon,
  nx: number,
  ny: number,
  offsetC: number,
): Vec2[] {
  const n = poly.length;
  if (n === 0) return [];
  const limit = offsetC + 1e-7;
  const inside = (p: Vec2): boolean => nx * p[0] + ny * p[1] <= limit;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const cur = poly[i];
    const prev = poly[(i - 1 + n) % n];
    if (!cur || !prev) continue;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const dp = nx * prev[0] + ny * prev[1] - offsetC;
      const dc = nx * cur[0] + ny * cur[1] - offsetC;
      const den = dp - dc;
      if (Math.abs(den) > 1e-12) {
        const t = dp / den;
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
    }
    if (curIn) out.push([cur[0], cur[1]]);
  }
  return out;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

/** 有界 O(n^2) 耳切三角剖分，guardMax = n*n+16 绝不死循环；输出统一 CCW */
export function triangulatePolygon(poly: Polygon): Array<readonly [Vec2, Vec2, Vec2]> {
  const n = poly.length;
  const tris: Array<readonly [Vec2, Vec2, Vec2]> = [];
  if (n < 3) return tris;
  const ccw = computePolygonAreaSigned(poly) >= 0;
  const idx: number[] = [];
  for (let i = 0; i < n; i += 1) idx.push(ccw ? i : n - 1 - i);
  let guard = n * n + 16;
  while (idx.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let k = 0; k < idx.length; k += 1) {
      const i0 = idx[(k - 1 + idx.length) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      if (i0 === undefined || i1 === undefined || i2 === undefined) continue;
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      if (!a || !b || !c) continue;
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) continue;
      let contains = false;
      for (const im of idx) {
        if (im === i0 || im === i1 || im === i2) continue;
        const p = poly[im];
        if (p && pointInTriangle(p, a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    const a = poly[idx[0] ?? -1];
    const b = poly[idx[1] ?? -1];
    const c = poly[idx[2] ?? -1];
    if (a && b && c) tris.push([a, b, c]);
  }
  return tris;
}

/** 凸片与任意凸/凹边界精确求交：按边界三角片逐一裁切，输出零重叠凸片集合 */
export function intersectConvexWithPolygon(convexPoly: Polygon, boundaryPoly: Polygon): Vec2[][] {
  const tris = triangulatePolygon(boundaryPoly);
  const pieces: Vec2[][] = [];
  for (const tri of tris) {
    let cur: Vec2[] = convexPoly.map((p) => [p[0], p[1]] as Vec2);
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;
      cur = clipPolygonHalfPlane(cur, dy / len, -dx / len, (dy / len) * a[0] - (dx / len) * a[1]);
      if (cur.length < 3) break;
    }
    if (cur.length >= 3 && Math.abs(computePolygonAreaSigned(cur)) > 1e-7) pieces.push(cur);
  }
  return pieces;
}
