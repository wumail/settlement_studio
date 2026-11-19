import type {
  BBox,
  CollisionDetail,
  CollisionReport,
  Polygon,
  Polyline,
  Vec2,
} from '../../schema/geometry.types';
import type { HydroRoadPackage } from '../hydro/reefRoadBridge';
import {
  computePolygonBBox,
  computePolygonCentroid,
  intersectSegmentsExact,
  pointInPolygon,
  segmentToSegmentDist,
} from '../math/polygon';
import type { ElevationFieldData } from '../terrain/elevationField';
export interface WallLike {
  readonly thicknessM: number;
  readonly polyline: Polyline;
}
export interface BuildingLike {
  readonly id: string;
  readonly zoneId: string;
  readonly points: Polygon;
  readonly centroid: Vec2;
}
export interface ZoneLike {
  readonly id: string;
  readonly buildings: ReadonlyArray<BuildingLike>;
  readonly walls?: ReadonlyArray<WallLike>;
  readonly gardenFences: ReadonlyArray<{ readonly points: Polyline }>;
  readonly trees: ReadonlyArray<{ readonly x: number; readonly y: number; readonly r: number }>;
}
export interface TownProjectLike {
  readonly zones: ReadonlyArray<{
    readonly id: string;
    readonly contentType: string;
    readonly points: Polygon;
  }>;
}

/** 均匀网格空间哈希：桶键 `cx * 100000 + cy`，世界坐标非负故零碰撞 */
export class SpatialHash<T> {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, T[]>();
  private count = 0;

  constructor(cellSizeM = 32) {
    this.cellSize = Math.max(4, cellSizeM);
  }

  private keyOf(cx: number, cy: number): number {
    return cx * 100000 + cy;
  }

  insert(item: T, bbox: BBox): void {
    const x0 = Math.max(0, Math.floor(bbox[0] / this.cellSize));
    const y0 = Math.max(0, Math.floor(bbox[1] / this.cellSize));
    const x1 = Math.floor(bbox[2] / this.cellSize);
    const y1 = Math.floor(bbox[3] / this.cellSize);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const key = this.keyOf(cx, cy);
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(item);
        else this.buckets.set(key, [item]);
      }
    }
    this.count += 1;
  }

  queryBox(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const out = new Set<T>();
    const x0 = Math.max(0, Math.floor(minX / this.cellSize));
    const y0 = Math.max(0, Math.floor(minY / this.cellSize));
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const bucket = this.buckets.get(this.keyOf(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) out.add(item);
      }
    }
    return [...out];
  }

  queryPolygonBBox(poly: Polygon, pad: number): T[] {
    const box = computePolygonBBox(poly);
    return this.queryBox(box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad);
  }

  clear(): void {
    this.buckets.clear();
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
export function polygonRadiusOf(poly: Polygon, centroid: Vec2): number {
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p[0] - centroid[0], p[1] - centroid[1]));
  return r;
}
export function pointToSegmentDist(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}
export function pointToPolylineDist(px: number, py: number, line: Polyline): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;
    const d = pointToSegmentDist(px, py, a, b);
    if (d < best) best = d;
  }
  return best;
}

/** 多边形到折线最小距离是否 >= margin（重心半径三角形不等式保守跳过，非候选段零精确计算） */
export function clearsPolyline(
  poly: Polygon,
  centroid: Vec2,
  polyRadius: number,
  line: Polyline,
  margin: number,
): boolean {
  const n = poly.length;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;
    if (pointToSegmentDist(centroid[0], centroid[1], a, b) - polyRadius >= margin) continue;
    for (let k = 0; k < n; k += 1) {
      const p = poly[k];
      const q = poly[(k + 1) % n];
      if (!p || !q) continue;
      if (segmentToSegmentDist(p, q, a, b) < margin) return false;
    }
  }
  return true;
}

/** 多边形与闭合目标多边形最小距离是否 >= margin（含双向包含零侵入判定） */
export function clearsPolygon(
  poly: Polygon,
  centroid: Vec2,
  polyRadius: number,
  target: Polygon,
  margin: number,
): boolean {
  const a = computePolygonBBox(poly);
  const b = computePolygonBBox(target);
  if (a[2] + margin < b[0] || b[2] + margin < a[0]) return true;
  if (a[3] + margin < b[1] || b[3] + margin < a[1]) return true;
  for (const p of poly) if (pointInPolygon(p[0], p[1], target)) return false;
  for (const q of target) if (pointInPolygon(q[0], q[1], poly)) return false;
  const closing = target[0];
  return clearsPolyline(poly, centroid, polyRadius, closing ? [...target, closing] : [...target], margin);
}
function overlapsPolygon(poly: Polygon, target: Polygon): boolean {
  const a = computePolygonBBox(poly);
  const b = computePolygonBBox(target);
  if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) return false;
  for (const p of poly) if (pointInPolygon(p[0], p[1], target)) return true;
  for (const q of target) if (pointInPolygon(q[0], q[1], poly)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    if (!p1 || !p2) continue;
    for (let j = 0; j < target.length; j += 1) {
      const q1 = target[j];
      const q2 = target[(j + 1) % target.length];
      if (!q1 || !q2) continue;
      if (intersectSegmentsExact(p1, p2, q1, q2)) return true;
    }
  }
  return false;
}
const MAX_DETAILS = 200;
/** 增量重抽：仅统计新屋与邻区旧屋跨区重叠，避免重扫数千栋未动建筑 */
export function countCrossZoneBuildingHits(
  freshBuildings: ReadonlyArray<BuildingLike>,
  neighborBuildings: ReadonlyArray<BuildingLike>,
): number {
  if (freshBuildings.length === 0 || neighborBuildings.length === 0) return 0;
  const hash = new SpatialHash<BuildingLike>(32);
  for (const b of neighborBuildings) hash.insert(b, computePolygonBBox(b.points));
  let hits = 0;
  for (const b of freshBuildings) {
    for (const other of hash.queryPolygonBBox(b.points, 0)) {
      if (other.id !== b.id && overlapsPolygon(b.points, other.points)) hits += 1;
    }
  }
  return hits;
}

/** 独立于生成器缓存的全量零穿模审计器：全屋/篱/树对路、水、渠、墙、邻屋、禁建圈与河心岛复核 */
export function verifyZeroCollisions(
  project: TownProjectLike,
  elevationField: ElevationFieldData,
  hydro: HydroRoadPackage,
  zones: ReadonlyArray<ZoneLike>,
): CollisionReport {
  void elevationField;
  const details: CollisionDetail[] = [];
  let roadHits = 0;
  let waterHits = 0;
  let wallHits = 0;
  let buildingHits = 0;
  let exclusionHits = 0;

  const exclusionPolys = project.zones
    .filter((z) => z.contentType === 'exclusion')
    .map((z) => z.points);
  const walls: WallLike[] = [];
  for (const zone of zones) for (const w of zone.walls ?? []) walls.push(w);

  const record = (type: CollisionDetail['type'], buildingId: string, zoneId: string): void => {
    if (details.length < MAX_DETAILS) details.push({ type, buildingId, zoneId });
  };
  const checkOutdoorPoly = (poly: Polygon, id: string, zoneId: string): void => {
    const centroid = computePolygonCentroid(poly);
    const radius = polygonRadiusOf(poly, centroid);
    for (const road of hydro.roads) {
      if (!clearsPolyline(poly, centroid, radius, road.centerline, 0.5 * road.widthM - 0.05)) {
        roadHits += 1;
        record('road', id, zoneId);
      }
    }
    for (const river of hydro.rivers) {
      if (!clearsPolygon(poly, centroid, radius, river.bankPolygon, -0.05)) {
        waterHits += 1;
        record('water', id, zoneId);
      }
    }
    for (const wb of hydro.waterBodies) {
      if (!clearsPolygon(poly, centroid, radius, wb.shorePoly, -0.05)) {
        waterHits += 1;
        record('water', id, zoneId);
      }
    }
    for (const canal of hydro.canals) {
      if (!clearsPolyline(poly, centroid, radius, canal.centerline, 0.5 * canal.widthM - 0.05)) {
        waterHits += 1;
        record('water', id, zoneId);
      }
    }
    for (const wall of walls) {
      if (!clearsPolyline(poly, centroid, radius, wall.polyline, 0.5 * wall.thicknessM - 0.05)) {
        wallHits += 1;
        record('wall', id, zoneId);
      }
    }
    for (const ex of exclusionPolys) {
      if (!overlapsPolygon(poly, ex)) continue;
      exclusionHits += 1;
      record('exclusion', id, zoneId);
    }
  };

  const hash = new SpatialHash<BuildingLike>(32);
  for (const zone of zones) for (const b of zone.buildings) hash.insert(b, computePolygonBBox(b.points));
  for (const zone of zones) {
    for (const b of zone.buildings) {
      checkOutdoorPoly(b.points, b.id, zone.id);
      const near = hash.queryPolygonBBox(b.points, 0);
      for (const other of near) {
        if (other.id <= b.id) continue;
        if (!overlapsPolygon(b.points, other.points)) continue;
        buildingHits += 1;
        record('building', b.id, zone.id);
      }
    }
    for (const fence of zone.gardenFences) {
      const pts = fence.points;
      if (pts.length < 4) continue;
      checkOutdoorPoly(pts.slice(0, pts.length - 1), zone.id, zone.id);
    }

    for (const tree of zone.trees) {
      for (const road of hydro.roads) {
        if (pointToPolylineDist(tree.x, tree.y, road.centerline) >= 0.5 * road.widthM + tree.r) continue;
        roadHits += 1;
        record('road', zone.id, zone.id);
      }
      for (const river of hydro.rivers) {
        if (!pointInPolygon(tree.x, tree.y, river.bankPolygon)) continue;
        waterHits += 1;
        record('water', zone.id, zone.id);
      }
      for (const ex of exclusionPolys) {
        if (!pointInPolygon(tree.x, tree.y, ex)) continue;
        exclusionHits += 1;
        record('exclusion', zone.id, zone.id);
      }
    }
  }
  const totalHits = roadHits + waterHits + wallHits + buildingHits + exclusionHits;
  return {
    passed: totalHits === 0 && hydro.riverIslandCount === 0,
    totalHits,
    buildingRoadHits: roadHits,
    buildingWaterHits: waterHits,
    buildingWallHits: wallHits,
    buildingBuildingHits: buildingHits,
    buildingExclusionHits: exclusionHits,
    riverIslands: hydro.riverIslandCount,
    details,
  };
}
