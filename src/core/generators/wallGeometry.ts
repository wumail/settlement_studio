import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';

export interface RingLattice {
  readonly ring: Vec2[];
  readonly arc: number[];
  readonly total: number;
}

export interface Opening {
  readonly id: string;
  readonly kind: 'gate' | 'water';
  readonly arc: number;
  readonly halfGap: number;
}

export interface OpeningInterval {
  start: number;
  end: number;
  readonly ids: string[];
}

/** 以 step 米加密闭合选区环，输出顶点与累计弧长 */
export function densifyRing(points: Polyline, step: number): RingLattice {
  const ring: Vec2[] = [];
  const arc: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      ring.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      arc.push(acc + len * t);
    }
    acc += len;
  }
  return { ring, arc, total: acc };
}

export function pointAtArc(
  ring: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  s: number,
): Vec2 {
  if (ring.length === 0) return [0, 0];
  const safeTotal = total > 1e-9 ? total : 1;
  const target = ((s % safeTotal) + safeTotal) % safeTotal;
  for (let i = 0; i < ring.length; i += 1) {
    const a = arc[i] ?? 0;
    const b = i + 1 < ring.length ? (arc[i + 1] ?? safeTotal) : safeTotal;
    if (target >= a && target <= b) {
      const p = ring[i];
      const q = i + 1 < ring.length ? ring[i + 1] : ring[0];
      if (!p || !q) return [0, 0];
      const span = b - a;
      const t = span > 1e-9 ? (target - a) / span : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    }
  }
  const first = ring[0];
  return first ? [first[0], first[1]] : [0, 0];
}

export function sliceRing(
  ring: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  fromS: number,
  toS: number,
): Polyline {
  const span = ((toS - fromS) % total + total) % total;
  if (span < 1e-6) return [];
  const items: Array<{ rel: number; p: Vec2 }> = [];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    if (!p) continue;
    const rel = (((arc[i] ?? 0) - fromS) % total + total) % total;
    if (rel > 1e-6 && rel < span - 1e-6) items.push({ rel, p });
  }
  items.sort((a, b) => a.rel - b.rel);
  return [
    pointAtArc(ring, arc, total, fromS),
    ...items.map((it) => it.p),
    pointAtArc(ring, arc, total, toS),
  ];
}

/** 城门矩形门楼：沿墙切向 halfLen、沿法向 halfDepth 的真实厚度二维多边形 */
export function gatePolygon(center: Vec2, tangent: Vec2, halfLen: number, halfDepth: number): Polygon {
  const nx = -tangent[1];
  const ny = tangent[0];
  return [
    [center[0] - tangent[0] * halfLen - nx * halfDepth, center[1] - tangent[1] * halfLen - ny * halfDepth],
    [center[0] + tangent[0] * halfLen - nx * halfDepth, center[1] + tangent[1] * halfLen - ny * halfDepth],
    [center[0] + tangent[0] * halfLen + nx * halfDepth, center[1] + tangent[1] * halfLen + ny * halfDepth],
    [center[0] - tangent[0] * halfLen + nx * halfDepth, center[1] - tangent[1] * halfLen + ny * halfDepth],
  ];
}

/** 拱形水门门洞：体育场形（两端半圆拱 + 直侧墙），沿墙切向 halfGap、法向 halfDepth */
export function waterGatePolygon(
  center: Vec2,
  tangent: Vec2,
  halfGap: number,
  halfDepth: number,
): Polygon {
  const nx = -tangent[1];
  const ny = tangent[0];
  const pts: Vec2[] = [];
  const caps = 7;
  for (let i = 0; i <= caps; i += 1) {
    const ang = -Math.PI / 2 + (i / caps) * Math.PI;
    const u = Math.cos(ang) * halfGap;
    const v = Math.sin(ang) * halfDepth;
    pts.push([center[0] + tangent[0] * u + nx * v, center[1] + tangent[1] * u + ny * v]);
  }
  for (let i = 1; i < caps; i += 1) {
    const ang = Math.PI / 2 + (i / caps) * Math.PI;
    const u = Math.cos(ang) * halfGap;
    const v = Math.sin(ang) * halfDepth;
    pts.push([center[0] + tangent[0] * u + nx * v, center[1] + tangent[1] * u + ny * v]);
  }
  return pts;
}

/** 按弧长合并全部城门/水门豁口（含首尾环绕），冲突区间共享 ids */
export function mergeOpenings(openings: ReadonlyArray<Opening>, total: number): OpeningInterval[] {
  const spans: Array<{ start: number; end: number; id: string }> = [];
  for (const opening of openings) {
    const start = opening.arc - opening.halfGap;
    const end = opening.arc + opening.halfGap;
    if (start < 0) {
      spans.push({ start: start + total, end: total, id: opening.id });
      spans.push({ start: 0, end, id: opening.id });
      continue;
    }
    if (end > total) {
      spans.push({ start, end: total, id: opening.id });
      spans.push({ start: 0, end: end - total, id: opening.id });
      continue;
    }
    spans.push({ start, end, id: opening.id });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: OpeningInterval[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 0.5) {
      last.end = Math.max(last.end, span.end);
      if (!last.ids.includes(span.id)) last.ids.push(span.id);
    } else {
      merged.push({ start: span.start, end: span.end, ids: [span.id] });
    }
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first && last && first.start <= 0.5 && last.end >= total - 0.5) {
      first.start = last.start - total;
      for (const id of last.ids) if (!first.ids.includes(id)) first.ids.push(id);
      merged.pop();
    }
  }
  return merged;
}
