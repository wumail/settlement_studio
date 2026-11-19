import type { Polyline, Vec2 } from '../schema/geometry.types';
import { buildCumulativeLengths } from '../core/math/spline';

export interface PolylineSample {
  readonly point: Vec2;
  readonly tangent: Vec2;
  readonly leftNormal: Vec2;
  readonly rightNormal: Vec2;
  readonly angleDeg: number;
  readonly totalLengthM: number;
}

export interface RiverLike {
  readonly points: Polyline;
  readonly centerline?: Polyline;
  readonly widthStartM: number;
  readonly widthEndM: number;
  readonly widthsM?: ReadonlyArray<number>;
  readonly widthAtU?: (u: number) => number;
}

export type RelativeShape = 'rect' | 'octagonal' | 'polygon_13' | 'organic';

export type GeoAnchor =
  | readonly [number, number]
  | { readonly riverId: string; readonly t: number; readonly bank?: 'left' | 'right' | 'center'; readonly offsetM?: number }
  | { readonly zoneId: string; readonly side?: 'center' | 'north' | 'south' | 'east' | 'west'; readonly offsetM?: number }
  | { readonly entityId: string }
  | { readonly edge: 'north' | 'south' | 'east' | 'west'; readonly ratio: number };

export const DEG = 180 / Math.PI;

export function normalizeDeg(deg: number): number {
  let value = deg % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

/** 按累计弧长归一化参数 t 采样折线（切线 + 左右法向） */
export function samplePolylineAtT(points: Polyline, t: number): PolylineSample {
  const { cum, total } = buildCumulativeLengths(points);
  const u = Math.max(0, Math.min(1, t)) * total;
  let index = 0;
  while (index < points.length - 2 && (cum[index + 1] ?? 0) < u) index += 1;
  const a = points[index] ?? [0, 0];
  const b = points[index + 1] ?? a;
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const local = segLen > 1e-9 ? Math.max(0, Math.min(1, (u - (cum[index] ?? 0)) / segLen)) : 0;
  const point: Vec2 = [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  const tx = segLen > 1e-9 ? (b[0] - a[0]) / segLen : 1;
  const ty = segLen > 1e-9 ? (b[1] - a[1]) / segLen : 0;
  return {
    point,
    tangent: [tx, ty],
    leftNormal: [-ty, tx],
    rightNormal: [ty, -tx],
    angleDeg: Math.atan2(ty, tx) * DEG,
    totalLengthM: total,
  };
}

/** 实测河宽表按 t 线性插值；无表时退回 widthStart → widthEnd */
export function sampleRiverWidthAtT(river: RiverLike, t: number): number {
  if (river.widthAtU) return Math.max(6, river.widthAtU(Math.max(0, Math.min(1, t))));
  const table = river.widthsM;
  if (table && table.length === river.points.length && table.length >= 2) {
    // 实测宽表与控制点一一对应：按弧长落到具体段，再在段内线性插值
    const { cum, total } = buildCumulativeLengths(river.points);
    const along = Math.max(0, Math.min(1, t)) * total;
    let i = 0;
    while (i < river.points.length - 2 && (cum[i + 1] ?? 0) < along) i += 1;
    const a = river.points[i];
    const b = river.points[i + 1];
    const segLen = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    const local = segLen > 1e-9 ? (along - (cum[i] ?? 0)) / segLen : 0;
    const wa = table[i] ?? river.widthStartM;
    const wb = table[i + 1] ?? river.widthEndM;
    return Math.max(6, wa + (wb - wa) * local);
  }
  const u = Math.max(0, Math.min(1, t));
  return Math.max(6, river.widthStartM + (river.widthEndM - river.widthStartM) * u);
}

/** 分水堰：沿河道法向左右各伸 0.5×河宽 + 外挑，严丝合缝横跨两岸 */
export function computeSnappedWeir(river: RiverLike, t: number, overhangM = 8): {
  pStart: Vec2;
  pEnd: Vec2;
  mid: Vec2;
  widthM: number;
  tangentDeg: number;
} {
  const sample = samplePolylineAtT(river.centerline ?? river.points, t);
  const width = sampleRiverWidthAtT(river, t);
  const half = width * 0.5 + Math.max(0, overhangM);
  const n = sample.leftNormal;
  return {
    pStart: [sample.point[0] + n[0] * half, sample.point[1] + n[1] * half],
    pEnd: [sample.point[0] - n[0] * half, sample.point[1] - n[1] * half],
    mid: sample.point,
    widthM: width,
    tangentDeg: sample.angleDeg,
  };
}

