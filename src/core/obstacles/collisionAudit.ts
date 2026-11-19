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
    const x0 = Math.max(0, Math.floor(minX / this.cellSize));
    const y0 = Math.max(0, Math.floor(minY / this.cellSize));
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    if (x0 === x1 && y0 === y1) return this.buckets.get(this.keyOf(x0, y0)) ?? [];
    const out = new Set<T>();
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
function pointToSegmentDistSq(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  const ex = px - (a[0] + dx * t);
  const ey = py - (a[1] + dy * t);
  return ex * ex + ey * ey;
}
export function pointToSegmentDist(px: number, py: number, a: Vec2, b: Vec2): number {
  return Math.sqrt(pointToSegmentDistSq(px, py, a, b));
}
export function pointToPolylineDist(px: number, py: number, line: Polyline): number {
  let best2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;
    const d2 = pointToSegmentDistSq(px, py, a, b);
    if (d2 < best2) best2 = d2;
  }
  return Math.sqrt(best2);
}

/** 多边形到折线最小距离是否 >= margin（重心半径三角形不等式平方距离预筛，零开方） */
export function clearsPolyline(
  poly: Polygon,
  centroid: Vec2,
  polyRadius: number,
  line: Polyline,
  margin: number,
  closed = false,
): boolean {
  const n = poly.length;
  const m = line.length;
  const segCount = closed ? m : m - 1;
  const thr = margin + polyRadius;
  const thr2 = thr > 0 ? thr * thr : 0;
  for (let i = 0; i < segCount; i += 1) {
    const a = line[i];
    const b = line[(i + 1) % m];
    if (!a || !b) continue;
    if (thr <= 0 || pointToSegmentDistSq(centroid[0], centroid[1], a, b) >= thr2) continue;
    for (let k = 0; k < n; k += 1) {
      const p = poly[k];
      const q = poly[(k + 1) % n];
      if (p && q && segmentToSegmentDist(p, q, a, b) < margin) return false;
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
  return clearsPolyline(poly, centroid, polyRadius, target, margin, true);
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

function boxDisjoint(a: BBox, b: BBox, pad: number): boolean {
  return a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1];
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
  let roadHits = 0, waterHits = 0, wallHits = 0, buildingHits = 0, exclusionHits = 0;

  const exItems = project.zones.filter((z) => z.contentType === 'exclusion').map((z) => ({ poly: z.points, box: computePolygonBBox(z.points) }));
  const roadItems = hydro.roads.map((r) => ({ line: r.centerline, hw: 0.5 * r.widthM, box: computePolygonBBox(r.centerline) }));
  const riverItems = hydro.rivers.map((r) => ({ poly: r.bankPolygon, box: computePolygonBBox(r.bankPolygon) }));
  const wbItems = hydro.waterBodies.map((w) => ({ poly: w.shorePoly, box: computePolygonBBox(w.shorePoly) }));
  const canalItems = hydro.canals.map((c) => ({ line: c.centerline, hw: 0.5 * c.widthM, box: computePolygonBBox(c.centerline) }));
  const wallItems: Array<{ line: Polyline; hw: number; box: BBox }> = [];
  for (const zone of zones) for (const w of zone.walls ?? []) wallItems.push({ line: w.polyline, hw: 0.5 * w.thicknessM, box: computePolygonBBox(w.polyline) });

  const record = (type: CollisionDetail['type'], buildingId: string, zoneId: string): void => {
    if (details.length < MAX_DETAILS) details.push({ type, buildingId, zoneId });
  };
  const checkOutdoorPoly = (poly: Polygon, id: string, zoneId: string): void => {
    const pBox = computePolygonBBox(poly);
    const centroid = computePolygonCentroid(poly);
    const radius = polygonRadiusOf(poly, centroid);
    for (const r of roadItems) {
      if (!boxDisjoint(pBox, r.box, r.hw) && !clearsPolyline(poly, centroid, radius, r.line, r.hw - 0.05)) { roadHits += 1; record('road', id, zoneId); }
    }
    for (const r of riverItems) {
      if (!boxDisjoint(pBox, r.box, 0) && !clearsPolygon(poly, centroid, radius, r.poly, -0.05)) { waterHits += 1; record('water', id, zoneId); }
    }
    for (const w of wbItems) {
      if (!boxDisjoint(pBox, w.box, 0) && !clearsPolygon(poly, centroid, radius, w.poly, -0.05)) { waterHits += 1; record('water', id, zoneId); }
    }
    for (const c of canalItems) {
      if (!boxDisjoint(pBox, c.box, c.hw) && !clearsPolyline(poly, centroid, radius, c.line, c.hw - 0.05)) { waterHits += 1; record('water', id, zoneId); }
    }
    for (const w of wallItems) {
      if (!boxDisjoint(pBox, w.box, w.hw) && !clearsPolyline(poly, centroid, radius, w.line, w.hw - 0.05)) { wallHits += 1; record('wall', id, zoneId); }
    }
    for (const ex of exItems) {
      if (!boxDisjoint(pBox, ex.box, 0) && overlapsPolygon(poly, ex.poly)) { exclusionHits += 1; record('exclusion', id, zoneId); }
    }
  };

  const hash = new SpatialHash<BuildingLike>(32);
  for (const zone of zones) for (const b of zone.buildings) hash.insert(b, computePolygonBBox(b.points));
  for (const zone of zones) {
    for (const b of zone.buildings) {
      checkOutdoorPoly(b.points, b.id, zone.id);
      for (const other of hash.queryPolygonBBox(b.points, 0)) {
        if (other.id > b.id && overlapsPolygon(b.points, other.points)) { buildingHits += 1; record('building', b.id, zone.id); }
      }
    }
    for (const fence of zone.gardenFences) {
      if (fence.points.length >= 4) checkOutdoorPoly(fence.points.slice(0, fence.points.length - 1), zone.id, zone.id);
    }
    for (const tree of zone.trees) {
      for (const r of roadItems) {
        if (tree.x + r.hw + tree.r < r.box[0] || tree.x - r.hw - tree.r > r.box[2] || tree.y + r.hw + tree.r < r.box[1] || tree.y - r.hw - tree.r > r.box[3]) continue;
        if (pointToPolylineDist(tree.x, tree.y, r.line) < r.hw + tree.r) { roadHits += 1; record('road', zone.id, zone.id); }
      }
      for (const r of riverItems) {
        if (tree.x < r.box[0] || tree.x > r.box[2] || tree.y < r.box[1] || tree.y > r.box[3]) continue;
        if (pointInPolygon(tree.x, tree.y, r.poly)) { waterHits += 1; record('water', zone.id, zone.id); }
      }
      for (const ex of exItems) {
        if (tree.x < ex.box[0] || tree.x > ex.box[2] || tree.y < ex.box[1] || tree.y > ex.box[3]) continue;
        if (pointInPolygon(tree.x, tree.y, ex.poly)) { exclusionHits += 1; record('exclusion', zone.id, zone.id); }
      }
    }
  }
  const totalHits = roadHits + waterHits + wallHits + buildingHits + exclusionHits;
  return {
    passed: totalHits === 0 && hydro.riverIslandCount === 0,
    totalHits, buildingRoadHits: roadHits, buildingWaterHits: waterHits,
    buildingWallHits: wallHits, buildingBuildingHits: buildingHits,
    buildingExclusionHits: exclusionHits, riverIslands: hydro.riverIslandCount, details,
  };
}
