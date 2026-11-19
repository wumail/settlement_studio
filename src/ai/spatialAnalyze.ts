import type { Polygon, Vec2 } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../core/math/polygon';
import { sampleElevation, sampleSlopeDeg } from '../core/terrain/elevationField';
import type { TerrainGridCell, ZoneDiagnostic } from './spatialTypes';

/** 河、湖、渠的可见水面多边形合集（网格与点查询共用） */
export function waterPolygons(scene: CompiledScene): ReadonlyArray<Polygon> {
  return [
    ...scene.hydro.rivers.map((river) => river.bankPolygon),
    ...scene.hydro.waterBodies.map((body) => body.shorePoly),
    ...scene.hydro.canals.map((canal) => canal.bankPolygon),
  ];
}

export function pointInWater(px: number, py: number, polys: ReadonlyArray<Polygon>): boolean {
  for (const poly of polys) if (pointInPolygon(px, py, poly)) return true;
  return false;
}

const SUB: ReadonlyArray<number> = [0.25, 0.5, 0.75];

/** 8×8 选址雷达：每格 3×3 子点取平均海拔、最大坡度与水面占比 */
export function buildTerrainGrid(
  project: TownProject,
  scene: CompiledScene,
  waterPolys: ReadonlyArray<Polygon>,
): TerrainGridCell[] {
  const world = project.meta.worldSizeM;
  const cell = world / 8;
  const field = scene.terrain.terrainData;
  const cells: TerrainGridCell[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      let sumElev = 0;
      let maxSlope = 0;
      let water = 0;
      for (const fy of SUB) {
        for (const fx of SUB) {
          const x = (col + fx) * cell;
          const y = (row + fy) * cell;
          sumElev += sampleElevation(field, x, y);
          maxSlope = Math.max(maxSlope, sampleSlopeDeg(field, x, y));
          if (pointInWater(x, y, waterPolys)) water += 1;
        }
      }
      const waterFraction = water / (SUB.length * SUB.length);
      const buildability: TerrainGridCell['buildability'] =
        waterFraction >= 0.45 ? 'water'
          : maxSlope > 24 ? 'steep'
            : maxSlope <= 14 && waterFraction < 0.1 ? 'prime'
              : 'marginal';
      cells.push({
        col,
        row,
        center: [(col + 0.5) * cell, (row + 0.5) * cell],
        meanElevM: sumElev / 9,
        maxSlopeDeg: maxSlope,
        waterFraction,
        buildability,
      });
    }
  }
  return cells;
}

interface ZoneStats {
  readonly meanSlopeDeg: number;
  readonly maxSlopeDeg: number;
  readonly waterFraction: number;
}

/** 选区 5×5 采样：平均/最大坡度与水面占比（点全部落在选区内才计入） */
function sampleZone(zone: TownProject['zones'][number], scene: CompiledScene, waterPolys: ReadonlyArray<Polygon>): ZoneStats {
  const [minX, minY, maxX, maxY] = computePolygonBBox(zone.points);
  const field = scene.terrain.terrainData;
  let slopeSum = 0;
  let maxSlope = 0;
  let count = 0;
  let water = 0;
  for (let iy = 0; iy < 5; iy += 1) {
    for (let ix = 0; ix < 5; ix += 1) {
      const x = minX + ((ix + 0.5) / 5) * (maxX - minX);
      const y = minY + ((iy + 0.5) / 5) * (maxY - minY);
      if (!pointInPolygon(x, y, zone.points)) continue;
      const slope = sampleSlopeDeg(field, x, y);
      slopeSum += slope;
      if (slope > maxSlope) maxSlope = slope;
      if (pointInWater(x, y, waterPolys)) water += 1;
      count += 1;
    }
  }
  return {
    meanSlopeDeg: count > 0 ? slopeSum / count : 0,
    maxSlopeDeg: maxSlope,
    waterFraction: count > 0 ? water / count : 0,
  };
}

/** 21 区诊断：空区归因严格按 面积 → 落水 → 坡度 → 障碍 的优先级 */
export function diagnoseZones(
  project: TownProject,
  scene: CompiledScene,
  waterPolys: ReadonlyArray<Polygon>,
): ZoneDiagnostic[] {
  const out: ZoneDiagnostic[] = [];
  for (const zone of project.zones) {
    const result = scene.zones.find((item) => item.id === zone.id);
    const buildingCount = result?.buildings.length ?? 0;
    const treeCount = result?.trees.length ?? 0;
    const plotCount = (result?.farmlandPlots.length ?? 0) + (result?.saltpanCells.length ?? 0);
    const stats = sampleZone(zone, scene, waterPolys);
    const areaHa = Math.abs(areaOf(zone.points)) / 10000;
    const structureInside = project.structures.some((item) => pointInPolygon(item.x, item.y, zone.points));
    const hasContent = buildingCount + treeCount + plotCount > 0 || structureInside;
    let status: ZoneDiagnostic['status'] = 'ok';
    let emptyReason: ZoneDiagnostic['emptyReason'];
    if (zone.contentType !== 'exclusion' && !hasContent) {
      status = 'empty_warning';
      emptyReason = areaHa < 0.08
        ? 'too_small'
        : stats.waterFraction > 0.5
          ? 'water_overlap'
          : stats.meanSlopeDeg > zone.maxSlopeDeg
            ? 'steep_slope'
            : 'blocked_by_obstacles';
    }
    out.push({
      id: zone.id,
      name: zone.name,
      contentType: zone.contentType,
      areaHa,
      centroid: computePolygonCentroid(zone.points),
      bbox: computePolygonBBox(zone.points),
      buildingCount,
      treeCount,
      plotCount,
      meanSlopeDeg: stats.meanSlopeDeg,
      maxSlopeDeg: stats.maxSlopeDeg,
      status,
      ...(emptyReason ? { emptyReason } : {}),
    });
  }
  return out;
}

function areaOf(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  return 0.5 * sum;
}

const EMPTY_REASON_LABEL: Readonly<Record<NonNullable<ZoneDiagnostic['emptyReason']>, string>> = {
  too_small: '面积过小',
  water_overlap: '过半落水',
  steep_slope: '平均坡度过陡',
  blocked_by_obstacles: '被障碍物占满',
};

const NEST_INNER = new Set(['citadel', 'market', 'exclusion']);
const NEST_OUTER = new Set(['walled_city', 'town_blocks']);

function legalNesting(a: TownProject['zones'][number], b: TownProject['zones'][number]): boolean {
  return (NEST_INNER.has(a.contentType) && NEST_OUTER.has(b.contentType))
    || (NEST_INNER.has(b.contentType) && NEST_OUTER.has(a.contentType));
}

/** 空区、非嵌套重叠、地标过近、碰撞计数四类可执行告警 */
export function collectWarnings(
  project: TownProject,
  scene: CompiledScene,
  zones: ReadonlyArray<ZoneDiagnostic>,
): string[] {
  const warnings: string[] = [];
  for (const zone of zones) {
    if (zone.status !== 'empty_warning') continue;
    warnings.push(`选区「${zone.name}」(${zone.id}) 无产出：${EMPTY_REASON_LABEL[zone.emptyReason ?? 'blocked_by_obstacles']}`);
  }
  for (let i = 0; i < project.zones.length; i += 1) {
    const a = project.zones[i];
    if (!a) continue;
    for (let j = i + 1; j < project.zones.length; j += 1) {
      const b = project.zones[j];
      if (!b || legalNesting(a, b)) continue;
      const ca = computePolygonCentroid(a.points);
      const cb = computePolygonCentroid(b.points);
      if (pointInPolygon(ca[0], ca[1], b.points) && pointInPolygon(cb[0], cb[1], a.points)) {
        warnings.push(`选区「${a.name}」与「${b.name}」质心互落对方范围，存在非嵌套重叠`);
      }
    }
  }
  const labeled = project.landmarks.filter((item) => item.showLabel);
  for (let i = 0; i < labeled.length; i += 1) {
    const a = labeled[i];
    if (!a) continue;
    for (let j = i + 1; j < labeled.length; j += 1) {
      const b = labeled[j];
      if (!b) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 65) warnings.push(`地标「${a.label}」与「${b.label}」相距 ${dist.toFixed(0)}m，标注拥挤`);
    }
  }
  const report = scene.collisionReport;
  if (!report.passed) {
    const parts = [
      ['屋压路', report.buildingRoadHits],
      ['屋压水', report.buildingWaterHits],
      ['屋压墙', report.buildingWallHits],
      ['屋压屋', report.buildingBuildingHits],
      ['屋压禁区', report.buildingExclusionHits],
      ['河心岛', report.riverIslands],
    ].filter(([, n]) => Number(n) > 0);
    warnings.push(`零穿模未通过：${parts.map(([k, n]) => `${k} ${n}`).join(' / ')}`);
  }
  return warnings;
}

/** 点到折线最近投影（返回弧长归一化 t 与切向） */
export function nearestOnPolyline(
  points: ReadonlyArray<Vec2>,
  totalLen: number,
  cumLen: ArrayLike<number>,
  px: number,
  py: number,
): { t: number; distM: number; point: Vec2; tangentDeg: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestPoint: Vec2 = points[0] ? [points[0][0], points[0][1]] : [0, 0];
  let bestT = 0;
  let bestTangent = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    const u = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
    const qx = a[0] + dx * u;
    const qy = a[1] + dy * u;
    const dist = Math.hypot(px - qx, py - qy);
    if (dist < best) {
      best = dist;
      bestPoint = [qx, qy];
      const along = (cumLen[i] ?? 0) + Math.hypot(dx, dy) * u;
      bestT = totalLen > 1e-9 ? along / totalLen : 0;
      bestTangent = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
  return { t: bestT, distM: best, point: bestPoint, tangentDeg: bestTangent };
}
