import type { Polygon, WallSegment } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import { buildHydroRoadPackage, type HydroRoadPackage } from './hydro/reefRoadBridge';
import { type HydraulicWorks, buildHydraulicWorks } from './hydro/hydraulicWorks';
import { type BuiltStructure, buildCustomStructures } from './generators/customStructures';
import { createRng, hashSeed } from './math/rng';
import { SpatialHash } from './obstacles/collisionAudit';
import { brandRigidBuilding, rigidBuildingBox } from './obstacles/safeTypes';
import {
  type ObstacleContext,
  type SafeBuilding,
  type SafeTree,
  type ZoneBuildTarget,
  type ZoneGeneratorInput,
  createEmptyZoneTarget,
} from './obstacles/guardSafe';
import { guardedPaintedTrees } from './obstacles/paintedTrees';
import { buildObstacleGrid } from './obstacles/obstacleSdf';
import { type ElevationFieldData, buildElevationField } from './terrain/elevationField';
import { type WallSystem, buildZoneWallSystem } from './generators/wallBuilder';

export interface CompileExtras {
  readonly hydraulic: HydraulicWorks;
  readonly structures: ReadonlyArray<BuiltStructure>;
  readonly painting: ReadonlyArray<SafeTree>;
  /** 复核剔除的涂抹树 id：渲染层据此隐藏，避免非法树在底图上残留 */
  readonly rejectedTreeIds: ReadonlyArray<string>;
}

export interface TwoPhaseResult {
  readonly terrainData: ElevationFieldData;
  readonly hydro: HydroRoadPackage;
  readonly hydraulic: HydraulicWorks;
  readonly structures: ReadonlyArray<BuiltStructure>;
  readonly ctx: ObstacleContext;
  readonly wallSystems: Map<string, WallSystem>;
  readonly rigidPolys: Polygon[];
}

export function createObstacleContext(
  project: TownProject,
  field: ElevationFieldData,
  hydro: HydroRoadPackage,
): ObstacleContext {
  let maxSlopeDeg = 24;
  for (const zone of project.zones) maxSlopeDeg = Math.max(maxSlopeDeg, zone.maxSlopeDeg);
  return {
    worldSizeM: project.meta.worldSizeM, elevationField: field, maxSlopeDeg,
    riversBuilt: hydro.rivers, waterBodiesBuilt: hydro.waterBodies, canalsBuilt: hydro.canals,
    roadsBuilt: hydro.roads, wallsBuilt: [], rigidPolys: [],
    exclusionPolys: project.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
    spatialHash: new SpatialHash<SafeBuilding>(32), grid: null, buildingSeq: 0, treeSeq: 0,
  };
}

/** 刚性足印：水工件 + 核心建筑群 + 双桥头堡 + 水门门洞，先于民房注入障碍场 */
export function collectRigidPolys(
  hydraulic: HydraulicWorks,
  structures: ReadonlyArray<BuiltStructure>,
  hydro: HydroRoadPackage,
  walls: ReadonlyArray<WallSegment>,
): Polygon[] {
  const out: Polygon[] = [...hydraulic.footprints];
  for (const item of structures) out.push(item.polygon);
  for (const bridge of hydro.bridges) {
    for (const fort of bridge.forts ?? []) out.push(fort.polygon);
  }
  for (const wall of walls) for (const gate of wall.waterGates) out.push(gate.polygon);
  return out;
}

export function makeInput(
  project: TownProject,
  zone: TownProject['zones'][number],
  field: ElevationFieldData,
  ctx: ObstacleContext,
  target: ZoneBuildTarget,
): ZoneGeneratorInput {
  return {
    zone,
    project,
    elevationField: field,
    obstacleCtx: ctx,
    rng: createRng(hashSeed(`${zone.id}|${zone.seed}`)),
    targetResult: target,
  };
}

export function compileExtras(
  project: TownProject,
  terrainData: ElevationFieldData,
  hydro: HydroRoadPackage,
  hydraulic: HydraulicWorks,
  structures: ReadonlyArray<BuiltStructure>,
  walls: ReadonlyArray<WallSegment>,
  rigidPolys: ReadonlyArray<Polygon>,
  buildings: ReadonlyArray<SafeBuilding>,
): CompileExtras {
  const audit = guardedPaintedTrees({
    project,
    elevationField: terrainData,
    rivers: hydro.rivers,
    waterBodies: hydro.waterBodies,
    canals: hydro.canals,
    roads: hydro.roads,
    walls,
    exclusionPolys: project.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
    rigidPolys,
    buildings,
  });
  return {
    hydraulic,
    structures,
    painting: audit.valid,
    rejectedTreeIds: audit.rejectedIds,
  };
}

/** 阶段一 + 全局 SDF：刚性足印先于任何民房生成注入 512² 障碍场 */
export function prepareTwoPhase(
  project: TownProject,
  terrainOverride?: ElevationFieldData,
): TwoPhaseResult {
  const terrainData = terrainOverride ?? buildElevationField(project);
  const hydro = buildHydroRoadPackage(project);
  const hydraulic = buildHydraulicWorks(project);
  const structures = buildCustomStructures(project);
  const ctx = createObstacleContext(project, terrainData, hydro);
  const wallSystems = new Map<string, WallSystem>();
  for (const zone of project.zones) {
    if (zone.contentType !== 'walled_city' && zone.contentType !== 'citadel') continue;
    const input = makeInput(project, zone, terrainData, ctx, createEmptyZoneTarget());
    wallSystems.set(zone.id, buildZoneWallSystem(input));
  }
  const allWalls = [...wallSystems.values()].flatMap((system) => system.walls);
  const rigidPolys = collectRigidPolys(hydraulic, structures, hydro, allWalls);
  ctx.rigidPolys.push(...rigidPolys);
  rigidPolys.forEach((poly, index) => {
    const rigid = brandRigidBuilding(poly, `rigid_${index}`, '刚性足印');
    ctx.spatialHash.insert(rigid, rigidBuildingBox(poly));
  });
  let globalMaxSlope = 30;
  for (const zone of project.zones) globalMaxSlope = Math.max(globalMaxSlope, zone.maxSlopeDeg + 6);
  ctx.grid = buildObstacleGrid({
    worldSizeM: project.meta.worldSizeM,
    elevationField: terrainData,
    globalMaxSlope,
    rivers: hydro.rivers,
    waterBodies: hydro.waterBodies,
    canals: hydro.canals,
    roads: hydro.roads,
    walls: ctx.wallsBuilt,
    exclusionPolys: ctx.exclusionPolys,
    rigidPolys,
  });
  return { terrainData, hydro, hydraulic, structures, ctx, wallSystems, rigidPolys };
}

