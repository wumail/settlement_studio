import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import {
  clipPolygonHalfPlane,
  computePolygonAreaSigned,
  computePolygonBBox,
  pointInPolygon,
} from '../math/polygon';
import type { BuiltRoad } from '../hydro/reefRoadBridge';

const MIN_PART_AREA_M2 = 420;

function bboxOverlap(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/** 干道在选区内可见的段落（用于带状生长骨架与内部街巷对齐） */
export function roadSkeletonLines(
  zonePoly: Polygon,
  roads: ReadonlyArray<BuiltRoad>,
): Polyline[] {
  const zbox = computePolygonBBox(zonePoly);
  const out: Polyline[] = [];
  for (const road of roads) {
    const rbox = computePolygonBBox(road.centerline);
    if (!bboxOverlap(zbox, rbox)) continue;
    let run: Vec2[] = [];
    for (const p of road.centerline) {
      if (pointInPolygon(p[0], p[1], zonePoly)) {
        run.push([p[0], p[1]]);
      } else {
        if (run.length >= 2) out.push(run);
        run = [];
      }
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

interface Cut {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly widthM: number;
}

function pickCut(poly: Polygon, roads: ReadonlyArray<BuiltRoad>, used: ReadonlySet<string>): Cut | null {
  const zbox = computePolygonBBox(poly);
  for (const road of roads) {
    if (used.has(road.id)) continue;
    const rbox = computePolygonBBox(road.centerline);
    if (!bboxOverlap(zbox, rbox)) continue;
    for (let i = 0; i < road.centerline.length - 1; i += 1) {
      const a = road.centerline[i];
      const b = road.centerline[i + 1];
      if (!a || !b) continue;
      const mid: Vec2 = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
      if (!pointInPolygon(mid[0], mid[1], poly)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      return {
        id: road.id,
        x: mid[0],
        y: mid[1],
        dx: (b[0] - a[0]) / len,
        dy: (b[1] - a[1]) / len,
        widthM: road.widthM,
      };
    }
  }
  return null;
}

/**
 * 道路骨架切割：以穿区干道走向把选区逐级半平面切分（深度 2、单块 ≥ 420m²），
 * 得到沿路对齐的街坊基块；无路可切时原样返回，后续仍走有界 Voronoi 次级巷道。
 */
export function splitByRoadSkeleton(
  poly: Polygon,
  roads: ReadonlyArray<BuiltRoad>,
  depth = 2,
  used: ReadonlySet<string> = new Set<string>(),
): Polygon[] {
  if (depth <= 0) return [poly];
  const cut = pickCut(poly, roads, used);
  if (!cut) return [poly];
  const c = cut.dx * cut.x + cut.dy * cut.y;
  const left = clipPolygonHalfPlane(poly, cut.dx, cut.dy, c);
  const right = clipPolygonHalfPlane(poly, -cut.dx, -cut.dy, -c);
  const nextUsed = new Set(used);
  nextUsed.add(cut.id);
  const out: Polygon[] = [];
  for (const part of [left, right]) {
    if (part.length < 3) continue;
    if (Math.abs(computePolygonAreaSigned(part)) < MIN_PART_AREA_M2) continue;
    out.push(...splitByRoadSkeleton(part, roads, depth - 1, nextUsed));
  }
  return out.length >= 2 ? out : [poly];
}
