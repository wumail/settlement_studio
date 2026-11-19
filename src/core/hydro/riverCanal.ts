import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonAreaSigned, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { buildCumulativeLengths, computeNodeTangents, sampleCatmullRom } from '../math/spline';
import { repairBank } from './riverBank';

export { buildRiverGeometry } from './riverBank';
export type { BuiltRiver } from './riverBank';
type WaterBodySource = TownProject['waterBodies'][number];
type CanalSource = TownProject['canals'][number];
export interface BuiltWaterBody {
  readonly id: string; readonly name: string; readonly kind: 'lake' | 'sea';
  readonly shorePoly: Polygon; readonly centroid: Vec2;
  readonly areaM2: number; readonly ripples: ReadonlyArray<Polygon>;
}
export interface QanatShaftPoint {
  readonly x: number; readonly y: number; readonly radiusM: number; readonly sAlong: number;
}
export interface BuiltCanal {
  readonly id: string; readonly name: string;
  readonly style: 'open' | 'qanat' | 'stone_clean' | 'irrigation' | 'drainage_dashed' | 'foul_outfall';
  readonly centerline: Polyline; readonly cumLen: Float64Array; readonly totalLen: number;
  readonly widthM: number; readonly halfWidths: Float64Array;
  readonly bankPolygon: Polygon; readonly shaftPoints: ReadonlyArray<QanatShaftPoint>;
}
function inwardNormals(shore: Polyline, centroid: Vec2): Vec2[] {
  const n = shore.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = shore[(i - 1 + n) % n];
    const next = shore[(i + 1) % n];
    if (!prev || !next) {
      out.push([0, 0]);
      continue;
    }
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      out.push([0, 0]);
      continue;
    }
    let nx = dy / len;
    let ny = -dx / len;
    const p = shore[i];
    if (p && nx * (centroid[0] - p[0]) + ny * (centroid[1] - p[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.push([nx, ny]);
  }
  return out;
}

/** 湖海闭合水体：沿平均内法向生成内缩水纹环，退化时回退向重心比例缩放 */
export function buildWaterBodyGeometry(wb: WaterBodySource): BuiltWaterBody {
  const shorePoly = sampleCatmullRom(wb.points, 10, true);
  const centroid = computePolygonCentroid(shorePoly);
  const areaM2 = Math.abs(computePolygonAreaSigned(shorePoly));
  const normals = inwardNormals(shorePoly, centroid);
  const approxRadius = Math.max(1, Math.sqrt(areaM2 / Math.PI));
  const ripples: Polygon[] = [];
  const lines = Math.max(0, Math.min(3, Math.floor(wb.rippleLines)));
  for (const off of [3.0, 7.0, 12.5].slice(0, lines)) {
    const ring: Vec2[] = [];
    let valid = off < approxRadius * 0.8;
    for (let i = 0; i < shorePoly.length && valid; i += 1) {
      const p = shorePoly[i];
      const nrm = normals[i];
      if (!p || !nrm) {
        valid = false;
        break;
      }
      const q: Vec2 = [p[0] + nrm[0] * off, p[1] + nrm[1] * off];
      if (!pointInPolygon(q[0], q[1], shorePoly)) valid = false;
      ring.push(q);
    }
    if (valid && ring.length >= 3 && computePolygonAreaSigned(ring) * computePolygonAreaSigned(shorePoly) > 0) {
      ripples.push(ring);
      continue;
    }
    const shrink = Math.max(0.08, 1 - off / approxRadius);
    ripples.push(
      shorePoly.map((p) => [
        centroid[0] + (p[0] - centroid[0]) * shrink,
        centroid[1] + (p[1] - centroid[1]) * shrink,
      ]),
    );
  }
  return {
    id: wb.id,
    name: wb.name,
    kind: wb.kind,
    shorePoly,
    centroid,
    areaM2,
    ripples,
  };
}

/** 明渠与坎儿井：显式 halfWidths 常量填充，与河道共用同一套双岸自交收缩 */
export function buildCanalGeometry(canal: CanalSource): BuiltCanal {
  const centerline = sampleCatmullRom(canal.points, 10, false);
  const { cum, total } = buildCumulativeLengths(centerline);
  const tangents = computeNodeTangents(centerline, false);
  const normals: Vec2[] = tangents.map((t) => [t[1], -t[0]]);
  const widthM = Math.max(1.2, canal.widthM);
  const halfWidths = new Float64Array(centerline.length).fill(0.5 * widthM);
  const bankPolygon = repairBank(centerline, halfWidths, normals, Math.min(2.0, Math.max(0.25, 0.5 * widthM * 0.35)));
  const shaftPoints: QanatShaftPoint[] = [];
  if (canal.style === 'qanat' && total > 45) {
    for (let s = 45; s <= total; s += 45) {
      let seg = 0;
      while (seg < centerline.length - 2 && (cum[seg + 1] ?? 0) < s) seg += 1;
      const a = centerline[seg];
      const b = centerline[seg + 1];
      if (!a || !b) continue;
      const segStart = cum[seg] ?? 0;
      const segLen = Math.max(1e-9, (cum[seg + 1] ?? 0) - segStart);
      const t = Math.max(0, Math.min(1, (s - segStart) / segLen));
      shaftPoints.push({
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        radiusM: 3.2,
        sAlong: s / total,
      });
    }
  }
  return {
    id: canal.id,
    name: canal.name,
    style: canal.style,
    centerline,
    cumLen: cum,
    totalLen: total,
    widthM,
    halfWidths,
    bankPolygon,
    shaftPoints,
  };
}
