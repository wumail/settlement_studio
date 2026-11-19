import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonAreaSigned, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { buildCumulativeLengths, computeNodeTangents, sampleCatmullRom } from '../math/spline';
type RiverSource = TownProject['rivers'][number];
type WaterBodySource = TownProject['waterBodies'][number];
type CanalSource = TownProject['canals'][number];
export interface BuiltRiver {
  readonly id: string; readonly name: string; readonly points: Polyline;
  readonly centerline: Polyline; readonly cumLen: Float64Array; readonly totalLen: number;
  readonly widthStartM: number; readonly widthEndM: number; readonly halfWidths: Float64Array;
  readonly bankPolygon: Polygon; readonly ripples: ReadonlyArray<Polyline>;
  readonly islands: readonly never[]; readonly carveDepthM: number;
  widthAtU: (u: number) => number;
}
export interface BuiltWaterBody {
  readonly id: string; readonly name: string; readonly kind: 'lake' | 'sea';
  readonly shorePoly: Polygon; readonly centroid: Vec2;
  readonly areaM2: number; readonly ripples: ReadonlyArray<Polygon>;
}
export interface QanatShaftPoint {
  readonly x: number; readonly y: number; readonly radiusM: number; readonly sAlong: number;
}
export interface BuiltCanal {
  readonly id: string; readonly name: string; readonly style: 'open' | 'qanat';
  readonly centerline: Polyline; readonly cumLen: Float64Array; readonly totalLen: number;
  readonly widthM: number; readonly halfWidths: Float64Array;
  readonly bankPolygon: Polygon; readonly shaftPoints: ReadonlyArray<QanatShaftPoint>;
}
const RIPPLE_OFFSETS = [2.2, 5.0, 8.5] as const;
const MAX_REPAIR_ROUNDS = 24;
function bankPolygonOf(
  centerline: Polyline,
  halfWidths: Float64Array,
  normals: ReadonlyArray<Vec2>,
): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < centerline.length; i += 1) {
    const p = centerline[i];
    const nrm = normals[i];
    if (!p || !nrm) continue;
    const hw = halfWidths[i] ?? 0;
    left.push([p[0] + nrm[0] * hw, p[1] + nrm[1] * hw]);
    right.push([p[0] - nrm[0] * hw, p[1] - nrm[1] * hw]);
  }
  right.reverse();
  return [...left, ...right];
}
function firstSelfIntersection(poly: Polyline): readonly [number, number] | null {
  const n = poly.length;
  if (n < 8) return null;
  const boxes: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (!a || !b) {
      boxes.push([0, 0, 0, 0]);
      continue;
    }
    boxes.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  }
  for (let i = 0; i < n; i += 1) {
    const bi = boxes[i];
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    if (!bi || !a1 || !a2) continue;
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const bj = boxes[j];
      if (!bj || bi[2] < bj[0] || bj[2] < bi[0] || bi[3] < bj[1] || bj[3] < bi[1]) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (!b1 || !b2) continue;
      const d1x = a2[0] - a1[0];
      const d1y = a2[1] - a1[1];
      const d2x = b2[0] - b1[0];
      const d2y = b2[1] - b1[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
      const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
      if (t > 1e-7 && t < 1 - 1e-7 && u > 1e-7 && u < 1 - 1e-7) return [i, j];
    }
  }
  return null;
}
function mapBankIndexToCenter(index: number, centerLen: number): number {
  return index < centerLen ? index : 2 * centerLen - 1 - index;
}

/** 最多 6 轮双岸非邻边自交扫描：命中即向中心线索引邻域按 0.72 收缩，杜绝蝴蝶结翻转 */
function repairBank(
  centerline: Polyline,
  halfWidths: Float64Array,
  normals: ReadonlyArray<Vec2>,
  minFloor: number,
): Vec2[] {
  let bank = bankPolygonOf(centerline, halfWidths, normals);
  const centerLen = centerline.length;
  for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
    const hit = firstSelfIntersection(bank);
    if (!hit) break;
    // 首尾反向索引必须先各自映射再分别收缩；先求平均会落到对岸错误索引，双急弯无法收敛
    const kA = mapBankIndexToCenter(hit[0], centerLen);
    const kB = mapBankIndexToCenter(hit[1], centerLen);
    for (const kCenter of [kA, kB]) {
      for (let k = kCenter - 3; k <= kCenter + 3; k += 1) {
        if (k < 0 || k >= centerLen) continue;
        halfWidths[k] = Math.max(minFloor, (halfWidths[k] ?? minFloor) * 0.72);
      }
    }
    bank = bankPolygonOf(centerline, halfWidths, normals);
  }
  return bank;
}
function bankRipples(
  centerline: Polyline,
  halfWidths: Float64Array,
  normals: ReadonlyArray<Vec2>,
  lines: number,
  side: 1 | -1,
): Polyline[] {
  const out: Polyline[] = [];
  const active = RIPPLE_OFFSETS.slice(0, Math.max(0, Math.min(3, Math.floor(lines))));
  for (const off of active) {
    let run: Vec2[] = [];
    for (let i = 0; i < centerline.length; i += 1) {
      const p = centerline[i];
      const nrm = normals[i];
      if (!p || !nrm) continue;
      const hw = halfWidths[i] ?? 0;
      if (hw > off + 1.8) {
        run.push([p[0] + nrm[0] * (hw - off) * side, p[1] + nrm[1] * (hw - off) * side]);
      } else {
        if (run.length >= 2) out.push(run);
        run = [];
      }
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** 变宽河道：显式 Float64Array halfWidths + 曲率预夹紧 + 双岸自交修复 + 扁平贴岸水纹 */
export function buildRiverGeometry(river: RiverSource): BuiltRiver {
  const centerline = sampleCatmullRom(river.points, 14, false);
  const { cum, total } = buildCumulativeLengths(centerline);
  const tangents = computeNodeTangents(centerline, false);
  const normals: Vec2[] = tangents.map((t) => [t[1], -t[0]]);
  const halfWidths = new Float64Array(centerline.length);
  const widthStartM = Math.max(6, river.widthStartM);
  const widthEndM = Math.max(6, river.widthEndM);
  for (let k = 0; k < centerline.length; k += 1) {
    const p = centerline[k];
    if (!p) continue;
    const u = total > 1e-9 ? (cum[k] ?? 0) / total : 0;
    let halfW = 0.5 * Math.max(6, widthStartM + (widthEndM - widthStartM) * u);
    if (k > 0 && k < centerline.length - 1) {
      const prev = centerline[k - 1];
      const next = centerline[k + 1];
      const t0 = tangents[k - 1];
      const t1 = tangents[k + 1];
      if (prev && next && t0 && t1) {
        const dot = Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1]));
        const theta = Math.acos(dot);
        if (theta > 1e-6) {
          const ds = 0.5 * Math.hypot(next[0] - prev[0], next[1] - prev[1]);
          halfW = Math.min(halfW, Math.max(2.0, (ds / theta) * 0.55));
        }
      }
    }
    halfWidths[k] = Math.max(2.0, halfW);
  }
  const initMin = halfWidths.length > 0 ? Math.min(...halfWidths) : 2.0;
  const bankPolygon = repairBank(centerline, halfWidths, normals, Math.min(2.0, Math.max(0.25, initMin * 0.35)));
  const ripples: Polyline[] = [];
  const lines = Math.max(0, Math.min(3, Math.floor(river.rippleLines)));
  ripples.push(...bankRipples(centerline, halfWidths, normals, lines, 1));
  ripples.push(...bankRipples(centerline, halfWidths, normals, lines, -1));
  const built: BuiltRiver = {
    id: river.id,
    name: river.name,
    points: river.points,
    centerline,
    cumLen: cum,
    totalLen: total,
    widthStartM,
    widthEndM,
    halfWidths,
    bankPolygon,
    ripples,
    islands: [],
    carveDepthM: river.carveDepthM,
    widthAtU: (u: number): number => {
      const uu = Math.max(0, Math.min(1, u));
      return Math.max(6, widthStartM + (widthEndM - widthStartM) * uu);
    },
  };
  // 函数不可结构化克隆：置为非枚举，postMessage 自动跳过而主线程仍可直接调用
  Object.defineProperty(built, 'widthAtU', { enumerable: false });
  return built;
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
