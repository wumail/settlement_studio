import type {
  BBox,
  FarmlandPlot,
  MarketApron,
  Polygon,
  Polyline,
  SaltpanCell,
  Vec2,
  WallSegment,
  WallTowerPoint,
  WellPoint,
} from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';

type ProjectZone = TownProject['zones'][number];
import type { BuiltCanal, BuiltRiver, BuiltWaterBody } from '../hydro/riverCanal';
import type { BuiltRoad } from '../hydro/reefRoadBridge';
import type { RngFn } from '../math/rng';
import {
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import { type ElevationFieldData, sampleSlopeDeg } from '../terrain/elevationField';
import {
  SpatialHash,
  clearsPolygon,
  clearsPolyline,
  pointToPolylineDist,
  polygonRadiusOf,
} from './collisionAudit';
import { type ObstacleGrid, sampleObstacleClearance } from './obstacleSdf';
import type { BuildingArchetype, BuildingRoofKind, SafeBuilding, SafeFence, SafeTree, TreeArchetype } from './safeTypes';
import { SafeBuildingBrand, SafeFenceBrand, SafeTreeBrand } from './safeTypes';

export type { BuildingArchetype, BuildingRoofKind, SafeBuilding, SafeFence, SafeTree, TreeArchetype } from './safeTypes';
export { PAINTED_TREE_ZONE, brandPaintedTree } from './safeTypes';
export interface WallObstacleRef { readonly id: string; readonly thicknessM: number; readonly polyline: Polyline; }
export interface ObstacleContext {
  readonly worldSizeM: number;
  readonly elevationField: ElevationFieldData;
  maxSlopeDeg: number;
  readonly riversBuilt: ReadonlyArray<BuiltRiver>;
  readonly waterBodiesBuilt: ReadonlyArray<BuiltWaterBody>;
  readonly canalsBuilt: ReadonlyArray<BuiltCanal>;
  readonly roadsBuilt: ReadonlyArray<BuiltRoad>;
  readonly wallsBuilt: WallObstacleRef[];
  readonly exclusionPolys: Polygon[];
  readonly rigidPolys: Polygon[];
  readonly spatialHash: SpatialHash<SafeBuilding>;
  grid: ObstacleGrid | null;
  buildingSeq: number;
  treeSeq: number;
}
export interface ZoneBuildTarget {
  buildings: SafeBuilding[];
  walls: WallSegment[];
  towers: WallTowerPoint[];
  internalStreets: Polyline[];
  lanes: Polyline[];
  gardenFences: SafeFence[];
  trees: SafeTree[];
  farmlandPlots: FarmlandPlot[];
  saltpanCells: SaltpanCell[];
  marketAprons: MarketApron[];
  wells: WellPoint[];
  exclusionPoly: Polygon | null;
}
export interface ZoneGeneratorInput {
  readonly zone: ProjectZone;
  readonly project: TownProject;
  readonly elevationField: ElevationFieldData;
  readonly obstacleCtx: ObstacleContext;
  readonly rng: RngFn;
  readonly targetResult: ZoneBuildTarget;
}
export function createEmptyZoneTarget(): ZoneBuildTarget {
  return {
    buildings: [],
    walls: [],
    towers: [],
    internalStreets: [],
    lanes: [],
    gardenFences: [],
    trees: [],
    farmlandPlots: [],
    saltpanCells: [],
    marketAprons: [],
    wells: [],
    exclusionPoly: null,
  };
}
function scalePolygon(poly: Polygon, factor: number): Vec2[] {
  const c = computePolygonCentroid(poly);
  return poly.map((p) => [c[0] + (p[0] - c[0]) * factor, c[1] + (p[1] - c[1]) * factor]);
}
function minEdgeLength(poly: Polygon): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a && b) min = Math.min(min, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return Number.isFinite(min) ? min : 0;
}
function ridgeOf(poly: Polygon, centroid: Vec2): readonly [Vec2, Vec2] | null {
  let bestLen = 0;
  let dir: Vec2 = [1, 0];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= bestLen) continue;
    bestLen = len;
    dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  }
  if (bestLen < 1e-6) return null;
  const half = bestLen * 0.3;
  return [
    [centroid[0] - dir[0] * half, centroid[1] - dir[1] * half],
    [centroid[0] + dir[0] * half, centroid[1] + dir[1] * half],
  ];
}

const boxCache = new WeakMap<Polyline, BBox>();
function boxOf(pts: Polyline): BBox {
  let b = boxCache.get(pts);
  if (!b) { b = computePolygonBBox(pts); boxCache.set(pts, b); }
  return b;
}
function disjoint(a: BBox, b: BBox, pad: number): boolean {
  return a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1];
}

/**
 * 底层通用解析复核：图幅内缩 6m、全测试点坡度、SDF 阻塞预筛、
 * 河湖 8m、禁建圈 2m 零侵入、水渠 0.5w+4m、干道 0.5w+2.5m、城垣 0.5t+3m、邻屋 0.3m/0.8m 全边段精确复检。
 */
export function isPolygonSafeAnalytic(
  poly: Polygon,
  ctx: ObstacleContext,
  extraMarginM = 0,
  slopeLimitDeg = ctx.maxSlopeDeg,
  sameZoneId?: string,
): boolean {
  if (poly.length < 3) return false;
  const centroid = computePolygonCentroid(poly);
  const clearance = ctx.grid
    ? sampleObstacleClearance(ctx.grid, ctx.worldSizeM, centroid[0], centroid[1])
    : -1;
  if (ctx.grid && clearance <= 0.02) return false;
  const radius = polygonRadiusOf(poly, centroid);
  const limit = ctx.worldSizeM - 6.0;
  for (const p of poly) {
    if (p[0] < 6.0 || p[1] < 6.0 || p[0] > limit || p[1] > limit) return false;
    if (sampleSlopeDeg(ctx.elevationField, p[0], p[1]) > slopeLimitDeg) return false;
  }
  if (sampleSlopeDeg(ctx.elevationField, centroid[0], centroid[1]) > slopeLimitDeg) return false;
  const pBox = computePolygonBBox(poly);
  const qPad = (sameZoneId !== undefined ? 0.35 : 0.85) + extraMarginM;
  for (const other of ctx.spatialHash.queryBox(pBox[0] - qPad, pBox[1] - qPad, pBox[2] + qPad, pBox[3] + qPad)) {
    if (sameZoneId !== undefined && other.zoneId !== sameZoneId) continue;
    const minClear = sameZoneId !== undefined && other.zoneId === sameZoneId ? 0.30 : 0.8;
    if (!clearsPolygon(poly, centroid, radius, other.points, minClear + extraMarginM)) return false;
  }
  if (ctx.grid && clearance > radius + 2.0 * ctx.grid.stepM + 10.0) return true;
  const rPad = 8.0 + extraMarginM;
  for (const river of ctx.riversBuilt) {
    if (!disjoint(pBox, boxOf(river.bankPolygon), rPad) && !clearsPolygon(poly, centroid, radius, river.bankPolygon, rPad)) return false;
  }
  for (const wb of ctx.waterBodiesBuilt) {
    if (!disjoint(pBox, boxOf(wb.shorePoly), rPad) && !clearsPolygon(poly, centroid, radius, wb.shorePoly, rPad)) return false;
  }
  const exPad = 2.0 + extraMarginM;
  for (const ex of ctx.exclusionPolys) {
    if (!disjoint(pBox, boxOf(ex), exPad) && !clearsPolygon(poly, centroid, radius, ex, exPad)) return false;
  }
  for (const canal of ctx.canalsBuilt) {
    const m = 0.5 * canal.widthM + 4.0 + extraMarginM;
    if (!disjoint(pBox, boxOf(canal.centerline), m) && !clearsPolyline(poly, centroid, radius, canal.centerline, m)) return false;
  }
  for (const road of ctx.roadsBuilt) {
    const m = 0.5 * road.widthM + 2.5 + extraMarginM;
    if (!disjoint(pBox, boxOf(road.centerline), m) && !clearsPolyline(poly, centroid, radius, road.centerline, m)) return false;
  }
  for (const wall of ctx.wallsBuilt) {
    const m = 0.5 * wall.thicknessM + 3.0 + extraMarginM;
    if (!disjoint(pBox, boxOf(wall.polyline), m) && !clearsPolyline(poly, centroid, radius, wall.polyline, m)) return false;
  }
  for (const rigid of ctx.rigidPolys) {
    if (!disjoint(pBox, boxOf(rigid), exPad) && !clearsPolygon(poly, centroid, radius, rigid, exPad)) return false;
  }
  return true;
}

/** 唯一屋宇守门构造器：area>=18 且全顶点在选区内，初检失败则 0.82 向心收缩挽救 */
export function guardSafeBuilding(
  candidatePoly: Polygon,
  zone: ProjectZone,
  meta: { roofKind: BuildingRoofKind; kind: BuildingArchetype; label?: string },
  ctx: ObstacleContext,
): SafeBuilding | null {
  const area = Math.abs(computePolygonAreaSigned(candidatePoly));
  if (area < 18) return null;
  for (const p of candidatePoly) {
    if (!pointInPolygon(p[0], p[1], zone.points)) return null;
  }
  let usePoly: Polygon = candidatePoly;
  let useArea = area;
  if (!isPolygonSafeAnalytic(candidatePoly, ctx, 0, zone.maxSlopeDeg, zone.id)) {
    const scaled = scalePolygon(candidatePoly, 0.82);
    const scaledArea = Math.abs(computePolygonAreaSigned(scaled));
    if (minEdgeLength(scaled) < 4.8 || scaledArea < 14) return null;
    for (const p of scaled) {
      if (!pointInPolygon(p[0], p[1], zone.points)) return null;
    }
    if (!isPolygonSafeAnalytic(scaled, ctx, 0, zone.maxSlopeDeg, zone.id)) return null;
    usePoly = scaled;
    useArea = scaledArea;
  }
  const centroid = computePolygonCentroid(usePoly);
  ctx.buildingSeq += 1;
  const building: SafeBuilding = {
    [SafeBuildingBrand]: true,
    id: `bld_${zone.id}_${ctx.buildingSeq}`,
    zoneId: zone.id,
    zoneName: zone.name,
    contentType: zone.contentType,
    roofKind: meta.roofKind,
    kind: meta.kind,
    label: meta.label ?? zone.name,
    points: usePoly,
    centroid,
    areaM2: useArea,
    ridge: useArea > 120 ? ridgeOf(usePoly, centroid) : null,
  };
  ctx.spatialHash.insert(building, computePolygonBBox(usePoly));
  return building;
}

/** 唯一菜畦篱院守门构造器：四角在选区内且完整通过解析复核，闭合首尾 */
export function guardSafeFence(
  fenceRectPoly: Polygon,
  zone: ProjectZone,
  ctx: ObstacleContext,
): SafeFence | null {
  if (fenceRectPoly.length < 4) return null;
  for (const p of fenceRectPoly) {
    if (!pointInPolygon(p[0], p[1], zone.points)) return null;
  }
  if (!isPolygonSafeAnalytic(fenceRectPoly, ctx, 0, zone.maxSlopeDeg, zone.id)) return null;
  const first = fenceRectPoly[0];
  if (!first) return null;
  return {
    [SafeFenceBrand]: true,
    zoneId: zone.id,
    points: [...fenceRectPoly, [first[0], first[1]]],
  };
}

/** 唯一植树守门构造器：禁建疫圈无条件清零、坡度与净空双检、不得落在已入库屋面内 */
export function guardSafeTree(
  x: number,
  y: number,
  radiusM: number,
  kind: TreeArchetype,
  zone: ProjectZone,
  ctx: ObstacleContext,
): SafeTree | null {
  if (!pointInPolygon(x, y, zone.points)) return null;
  const r = Math.max(2.5, Math.min(14, radiusM));
  for (const ex of ctx.exclusionPolys) {
    const ring = ex[0] ? [...ex, ex[0]] : [...ex];
    if (pointInPolygon(x, y, ex)) return null;
    if (pointToPolylineDist(x, y, ring) < 1.0) return null;
  }
  const slope = sampleSlopeDeg(ctx.elevationField, x, y);
  const slopeLimit = kind === 'woodland' ? zone.maxSlopeDeg : Math.max(zone.maxSlopeDeg, 34);
  if (slope > slopeLimit) return null;
  // SDF 存在时作快速预筛；缺失时（单元测试/局部重算）仍必须走解析净空检测
  let nearObstacle = true;
  if (ctx.grid) {
    const clearance = sampleObstacleClearance(ctx.grid, ctx.worldSizeM, x, y);
    if (clearance < 2.0) return null;
    nearObstacle = clearance <= r + 10.0;
  }
  if (nearObstacle) {
    for (const river of ctx.riversBuilt) {
      if (pointInPolygon(x, y, river.bankPolygon)) return null;
      const ring = river.bankPolygon[0] ? [...river.bankPolygon, river.bankPolygon[0]] : [];
      if (pointToPolylineDist(x, y, ring) < 1.0) return null;
    }
    for (const wb of ctx.waterBodiesBuilt) {
      if (pointInPolygon(x, y, wb.shorePoly)) return null;
      const ring = wb.shorePoly[0] ? [...wb.shorePoly, wb.shorePoly[0]] : [];
      if (pointToPolylineDist(x, y, ring) < 1.0) return null;
    }
    for (const canal of ctx.canalsBuilt) {
      if (pointToPolylineDist(x, y, canal.centerline) < 0.5 * canal.widthM + 1.0 + r) return null;
    }
    for (const road of ctx.roadsBuilt) {
      if (pointToPolylineDist(x, y, road.centerline) < 0.5 * road.widthM + 1.2 + r) return null;
    }
    for (const wall of ctx.wallsBuilt) {
      if (pointToPolylineDist(x, y, wall.polyline) < 0.5 * wall.thicknessM + 1.0 + r) return null;
    }
  }
  for (const b of ctx.spatialHash.queryBox(x - r, y - r, x + r, y + r)) {
    if (b.zoneId !== zone.id) continue;
    if (pointInPolygon(x, y, b.points)) return null;
  }
  ctx.treeSeq += 1;
  return { [SafeTreeBrand]: true, zoneId: zone.id, x, y, r, kind };
}
