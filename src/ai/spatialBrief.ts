import type { Vec2 } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import type { HydroRoadPackage } from '../core/hydro/reefRoadBridge';
import type { BuiltRiver } from '../core/hydro/riverCanal';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../core/math/polygon';
import { sampleElevation, sampleSlopeDeg } from '../core/terrain/elevationField';
import { samplePolylineAtT } from './geometrySnap';
import {
  buildTerrainGrid,
  collectWarnings,
  diagnoseZones,
  nearestOnPolyline,
  pointInWater,
  waterPolygons,
} from './spatialAnalyze';
import type { RiverSampleAnchor, SpatialBrief, SpatialPointQuery } from './spatialTypes';

function riverAnchors(river: BuiltRiver): RiverSampleAnchor[] {
  const ts = river.totalLen > 1800
    ? Array.from({ length: 9 }, (_, i) => i / 8)
    : [0, 0.25, 0.5, 0.75, 1];
  return ts.map((t) => {
    const sample = samplePolylineAtT(river.centerline, t);
    return {
      t,
      point: sample.point,
      widthM: river.widthAtU(t),
      tangentDeg: sample.angleDeg,
      leftNormal: sample.leftNormal,
      rightNormal: sample.rightNormal,
    };
  });
}

/** 大模型可读的高信噪比空间摘要（不含建筑多边形数组） */
export function buildSpatialRadar(project: TownProject, scene: CompiledScene): SpatialBrief {
  const waterPolys = waterPolygons(scene);
  const hydro = scene.hydro as HydroRoadPackage;
  const zones = diagnoseZones(project, scene, waterPolys);
  return {
    meta: {
      id: project.meta.id,
      name: project.meta.name,
      subtitle: project.meta.subtitle,
      worldSizeM: project.meta.worldSizeM,
    },
    terrain: {
      minElevM: scene.terrain.minElev,
      maxElevM: scene.terrain.maxElev,
      contourStepM: project.terrain.contourStep,
      grid8x8: buildTerrainGrid(project, scene, waterPolys),
    },
    rivers: hydro.rivers.map((river) => ({
      id: river.id,
      name: river.name,
      lengthM: river.totalLen,
      anchors: riverAnchors(river),
    })),
    waterBodies: hydro.waterBodies.map((body) => ({
      id: body.id,
      name: body.name,
      kind: body.kind,
      centroid: body.centroid,
      bbox: computePolygonBBox(body.shorePoly),
    })),
    canals: project.canals.map((canal) => {
      const start = samplePolylineAtT(canal.points, 0);
      return {
        id: canal.id,
        name: canal.name,
        style: canal.style,
        widthM: canal.widthM,
        start: start.point,
        mid: samplePolylineAtT(canal.points, 0.5).point,
        end: samplePolylineAtT(canal.points, 1).point,
      };
    }),
    zones,
    structures: project.structures.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      x: item.x,
      y: item.y,
    })),
    hydraulic: {
      weirs: project.weirs.map((item) => ({
        id: item.id,
        name: item.name,
        mid: [(item.pStart[0] + item.pEnd[0]) * 0.5, (item.pStart[1] + item.pEnd[1]) * 0.5],
      })),
      docks: project.docks.map((item) => ({ id: item.id, name: item.name, x: item.x, y: item.y, angleDeg: item.angleDeg })),
      watermills: project.watermills.map((item) => ({ id: item.id, name: item.name, x: item.x, y: item.y, angleDeg: item.angleDeg })),
    },
    bridges: hydro.bridges.map((item) => ({ id: item.id, x: item.x, y: item.y, style: item.style ?? 'stone_arch' })),
    landmarks: project.landmarks.map((item) => ({
      id: item.id,
      label: item.label,
      x: item.x,
      y: item.y,
      ...(item.badgeNum !== undefined ? { badgeNum: item.badgeNum } : {}),
    })),
    stats: {
      buildingCount: scene.stats.buildingCount,
      treeCount: scene.stats.treeCount,
      wallCount: scene.stats.wallCount,
      bridgeCount: scene.stats.bridgeCount,
      collisionPassed: scene.collisionReport.passed,
      collisionHits: scene.collisionReport.totalHits,
    },
    warnings: collectWarnings(project, scene, zones),
  };
}

function nearestRiverInfo(
  scene: CompiledScene,
  x: number,
  y: number,
): SpatialPointQuery['nearestRiver'] {
  let best: SpatialPointQuery['nearestRiver'] = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const hydro = scene.hydro as HydroRoadPackage;
  for (const river of hydro.rivers) {
    const hit = nearestOnPolyline(river.centerline, river.totalLen, river.cumLen, x, y);
    if (hit.distM >= bestDist) continue;
    bestDist = hit.distM;
    const rad = (hit.tangentDeg * Math.PI) / 180;
    const left: Vec2 = [-Math.sin(rad), Math.cos(rad)];
    const side = (x - hit.point[0]) * left[0] + (y - hit.point[1]) * left[1] >= 0 ? 'left' : 'right';
    const width = river.widthAtU(hit.t);
    const normal: Vec2 = side === 'left' ? left : [Math.sin(rad), -Math.cos(rad)];
    best = {
      riverId: river.id,
      t: hit.t,
      distM: hit.distM,
      bank: side,
      centerPoint: hit.point,
      bankPoint: [hit.point[0] + normal[0] * width * 0.5, hit.point[1] + normal[1] * width * 0.5],
      tangentDeg: hit.tangentDeg,
    };
  }
  return best;
}

function nearestCanalInfo(scene: CompiledScene, x: number, y: number): SpatialPointQuery['nearestCanal'] {
  let best: SpatialPointQuery['nearestCanal'] = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const hydro = scene.hydro as HydroRoadPackage;
  for (const canal of hydro.canals) {
    const hit = nearestOnPolyline(canal.centerline, canal.totalLen, canal.cumLen, x, y);
    if (hit.distM >= bestDist) continue;
    bestDist = hit.distM;
    best = {
      canalId: canal.id,
      t: hit.t,
      distM: hit.distM,
      widthM: canal.widthM,
      centerPoint: hit.point,
      tangentDeg: hit.tangentDeg,
    };
  }
  return best;
}

/** 精确点位查询：海拔/坡度/是否落水与禁区/最近河渠投影 */
export function querySpatialPoint(
  project: TownProject,
  scene: CompiledScene,
  x: number,
  y: number,
): SpatialPointQuery {
  const field = scene.terrain.terrainData;
  return {
    x,
    y,
    elevM: sampleElevation(field, x, y),
    slopeDeg: sampleSlopeDeg(field, x, y),
    inWater: pointInWater(x, y, waterPolygons(scene)),
    inExclusion: project.zones.some(
      (zone) => zone.contentType === 'exclusion' && pointInPolygon(x, y, zone.points),
    ),
    nearestRiver: nearestRiverInfo(scene, x, y),
    nearestCanal: nearestCanalInfo(scene, x, y),
  };
}

/** 选区质心（供语义操作按 id 找 zone 时复用） */
export function zoneCentroid(project: TownProject, zoneId: string): Vec2 | null {
  const zone = project.zones.find((item) => item.id === zoneId);
  return zone ? computePolygonCentroid(zone.points) : null;
}
