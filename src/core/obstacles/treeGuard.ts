import type { Polygon, Polyline } from '../../schema/geometry.types';
import { type ElevationFieldData, sampleSlopeDeg } from '../terrain/elevationField';
import { pointInPolygon } from '../math/polygon';
import { type SpatialHash, pointToPolylineDist, pointToSegmentDist } from './collisionAudit';

export type PaintedTreeKind = 'woodland' | 'garden' | 'plaza';

/** 林木守门视图：与 guardSafeTree 同一套净空规则，可来自编译场景（涂抹）或障碍上下文（生成） */
export interface TreeGuardView {
  readonly worldSizeM: number;
  readonly elevationField: ElevationFieldData | null;
  readonly rivers: ReadonlyArray<{ readonly bankPolygon: Polygon }>;
  readonly waterBodies: ReadonlyArray<{ readonly shorePoly: Polygon }>;
  readonly canals: ReadonlyArray<{ readonly centerline: Polyline; readonly widthM: number }>;
  readonly roads: ReadonlyArray<{ readonly centerline: Polyline; readonly widthM: number }>;
  readonly walls: ReadonlyArray<{ readonly polyline: Polyline; readonly thicknessM: number }>;
  readonly exclusionPolys: ReadonlyArray<Polygon>;
  readonly buildings: ReadonlyArray<{ readonly points: Polygon }>;
  /** 可选屋宇空间哈希：批量复核涂抹树时免去 O(trees × buildings) 全表扫描 */
  readonly buildingHash?: SpatialHash<{ readonly points: Polygon }>;
  /** 水工/建筑群/桥头堡刚性足印：树冠不得压占 */
  readonly rigidPolys?: ReadonlyArray<Polygon>;
}

const BOUNDS_MARGIN_M = 6;

/** 无临时数组拷贝 + AABB 预筛的多边形内外及近边检测 */
function insideOrNear(x: number, y: number, poly: Polygon, distM: number): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const p = poly[i];
    if (!p) continue;
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  if (x < minX - distM || x > maxX + distM || y < minY - distM || y > maxY + distM) return false;
  if (pointInPolygon(x, y, poly)) return true;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a && b && pointToSegmentDist(x, y, a, b) < distM) return true;
  }
  return false;
}

/**
 * 林木落点守门：图幅内缩 6m、禁建疫圈 1m、河湖 1m、水渠/道路/城垣按半宽 + 冠幅、
 * 既有屋宇屋面内禁止植树、坡度超限禁止植树。涂抹笔刷与生成器共用同一判据。
 */
export function isTreeSpotSafe(
  view: TreeGuardView,
  x: number,
  y: number,
  radiusM: number,
  kind: PaintedTreeKind,
  slopeLimitDeg: number,
): boolean {
  const limit = view.worldSizeM - BOUNDS_MARGIN_M;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < BOUNDS_MARGIN_M || y < BOUNDS_MARGIN_M || x > limit || y > limit) return false;
  const r = Math.max(2.5, Math.min(16, radiusM));
  for (const ex of view.exclusionPolys) {
    if (insideOrNear(x, y, ex, 1.0)) return false;
  }
  for (const river of view.rivers) {
    if (insideOrNear(x, y, river.bankPolygon, 1.0)) return false;
  }
  for (const wb of view.waterBodies) {
    if (insideOrNear(x, y, wb.shorePoly, 1.0)) return false;
  }
  for (const canal of view.canals) {
    if (pointToPolylineDist(x, y, canal.centerline) < 0.5 * canal.widthM + 1.0 + r) return false;
  }
  for (const road of view.roads) {
    if (pointToPolylineDist(x, y, road.centerline) < 0.5 * road.widthM + 1.2 + r) return false;
  }
  for (const wall of view.walls) {
    if (pointToPolylineDist(x, y, wall.polyline) < 0.5 * wall.thicknessM + 1.0 + r) return false;
  }
  if (view.elevationField) {
    const slope = sampleSlopeDeg(view.elevationField, x, y);
    const slopeLimit = kind === 'woodland' ? slopeLimitDeg : Math.max(slopeLimitDeg, 34);
    if (slope > slopeLimit) return false;
  }
  for (const rigid of view.rigidPolys ?? []) {
    if (insideOrNear(x, y, rigid, r * 0.6)) return false;
  }
  const candidates = view.buildingHash
    ? view.buildingHash.queryBox(x - r, y - r, x + r, y + r)
    : view.buildings;
  for (const building of candidates) {
    const pts = building.points;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    if (x < minX - r || y < minY - r || x > maxX + r || y > maxY + r) continue;
    if (pointInPolygon(x, y, pts)) return false;
  }
  return true;
}
