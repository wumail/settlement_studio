import type { Polyline, Vec2 } from '../../schema/geometry.types';

export interface ClosestPointResult {
  readonly x: number;
  readonly y: number;
  readonly dist: number;
  readonly segIndex: number;
  readonly t: number;
  readonly sAlong: number;
}

export interface CumulativeLengths {
  readonly cum: Float64Array;
  readonly total: number;
}

function catmullRomAt(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const y =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, y];
}

/**
 * 张力 0.5 三次 Catmull-Rom 加密。开折线首尾用外推镜像幻影控制点，
 * 严格经过全部原始控制点；闭合环首尾环绕且不重复存首点。
 */
export function sampleCatmullRom(
  points: Polyline,
  samplesPerSeg = 12,
  closed = false,
): Vec2[] {
  const n = points.length;
  const perSeg = Math.max(1, Math.floor(samplesPerSeg));
  if (n === 0) return [];
  if (n === 1) {
    const only = points[0];
    return only ? [[only[0], only[1]]] : [];
  }
  const out: Vec2[] = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i += 1) {
    const p1 = points[i];
    const p2 = closed ? points[(i + 1) % n] : points[i + 1];
    if (!p1 || !p2) continue;
    const p0 = closed
      ? (points[(i - 1 + n) % n] ?? p1)
      : i === 0
        ? ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] as Vec2)
        : (points[i - 1] ?? p1);
    const p3 = closed
      ? (points[(i + 2) % n] ?? p2)
      : i + 2 < n
        ? (points[i + 2] ?? p2)
        : ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] as Vec2);
    out.push([p1[0], p1[1]]);
    for (let s = 1; s < perSeg; s += 1) {
      out.push(catmullRomAt(p0, p1, p2, p3, s / perSeg));
    }
  }
  if (!closed) {
    const tail = points[n - 1];
    if (tail) out.push([tail[0], tail[1]]);
  }
  return out;
}

export function buildCumulativeLengths(poly: Polyline): CumulativeLengths {
  const n = poly.length;
  const cum = new Float64Array(n);
  let total = 0;
  for (let i = 1; i < n; i += 1) {
    const a = poly[i - 1];
    const b = poly[i];
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum[i] = total;
  }
  return { cum, total };
}

export function computeNodeTangents(poly: Polyline, closed: boolean): Vec2[] {
  const n = poly.length;
  const out: Vec2[] = [];
  if (n === 0) return out;
  if (n === 1) {
    out.push([1, 0]);
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    const prevIdx = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const nextIdx = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const a = poly[prevIdx];
    const b = poly[nextIdx];
    if (!a || !b) {
      out.push([1, 0]);
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    out.push(len < 1e-12 ? [1, 0] : [dx / len, dy / len]);
  }
  return out;
}

export function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

/** 到折线最近点投影（含所在段号、段内参数与纵向归一化弧长 sAlong） */
export function closestPointOnPolyline(
  px: number,
  py: number,
  poly: Polyline,
): ClosestPointResult | null {
  const n = poly.length;
  if (n === 0) return null;
  if (n === 1) {
    const only = poly[0];
    if (!only) return null;
    return {
      x: only[0],
      y: only[1],
      dist: Math.hypot(px - only[0], py - only[1]),
      segIndex: 0,
      t: 0,
      sAlong: 0,
    };
  }
  const { cum, total } = buildCumulativeLengths(poly);
  let best: ClosestPointResult | null = null;
  for (let i = 0; i < n - 1; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    if (!a || !b) continue;
    const hit = closestPointOnSegment(px, py, a[0], a[1], b[0], b[1]);
    if (best !== null && hit.dist >= best.dist) continue;
    const segLen = (cum[i + 1] ?? 0) - (cum[i] ?? 0);
    const sAbs = (cum[i] ?? 0) + segLen * hit.t;
    best = {
      x: hit.x,
      y: hit.y,
      dist: hit.dist,
      segIndex: i,
      t: hit.t,
      sAlong: total > 1e-9 ? sAbs / total : 0,
    };
  }
  return best;
}
