import type {
  CompiledSceneBase,
  CompiledZoneResultBase,
  Polygon,
} from '../schema/geometry.types';
import { getActivePalette } from '../schema/palette.schema';
import {
  type LegendConfig,
  type ScenePresenceFlags,
  syncLegendWithProject,
} from '../schema/legend.schema';
import { type TownProject } from '../schema/project.schema';
import { buildHydroRoadPackage, type HydroRoadPackage } from './hydro/reefRoadBridge';
import { hashSeed, createRng } from './math/rng';
import { computePolygonAreaSigned, computePolygonBBox } from './math/polygon';
import { SpatialHash, countCrossZoneBuildingHits, verifyZeroCollisions } from './obstacles/collisionAudit';
import {
  type ObstacleContext,
  type SafeBuilding,
  type SafeFence,
  type SafeTree,
  type ZoneBuildTarget,
  type ZoneGeneratorInput,
  createEmptyZoneTarget,
} from './obstacles/guardSafe';
import { buildObstacleGrid } from './obstacles/obstacleSdf';
import { buildElevationField, type ElevationFieldData } from './terrain/elevationField';
import { type ContourLine, type ScarpTickSegment, extractContours, extractScarpTicks } from './terrain/marchingSquares';
import { compileCitadelZone } from './generators/citadel';
import { compileFarmlandZone } from './generators/farmland';
import { compileMarketZone } from './generators/market';
import { compileSaltpanZone } from './generators/saltpan';
import { compileTownBlocksZone } from './generators/townBlocks';
import { compileVillageZone } from './generators/village';
import { compileWalledCityZone } from './generators/walledCity';
import { type WallSystem, buildZoneWallSystem } from './generators/wallBuilder';
import { compileExclusionZone, compileWoodlandZone } from './generators/woodland';
export type CompiledZoneResult = CompiledZoneResultBase<SafeBuilding, SafeFence, SafeTree>;
export type CompiledScene = CompiledSceneBase<SafeBuilding, SafeFence, SafeTree> & {
  readonly terrain: CompiledSceneBase['terrain'] & { readonly terrainData: ElevationFieldData };
  readonly hydro: HydroRoadPackage;
  readonly legend: LegendConfig;
  readonly terrainSignature: string;
};
export interface RerollResult {
  readonly scene: CompiledScene;
  readonly updatedSeed: number;
}
function terrainSignature(project: TownProject): string {
  const rivers = project.rivers.map((r) => ({
    id: r.id, carveDepthM: r.carveDepthM,
    widthStartM: r.widthStartM, widthEndM: r.widthEndM, points: r.points,
  }));
  return JSON.stringify({ worldSizeM: project.meta.worldSizeM, terrain: project.terrain, rivers });
}
function createObstacleContext(
  project: TownProject,
  field: ElevationFieldData,
  hydro: HydroRoadPackage,
): ObstacleContext {
  let maxSlopeDeg = 24;
  for (const zone of project.zones) maxSlopeDeg = Math.max(maxSlopeDeg, zone.maxSlopeDeg);
  return {
    worldSizeM: project.meta.worldSizeM, elevationField: field, maxSlopeDeg,
    riversBuilt: hydro.rivers, waterBodiesBuilt: hydro.waterBodies, canalsBuilt: hydro.canals,
    roadsBuilt: hydro.roads, wallsBuilt: [],
    exclusionPolys: project.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
    spatialHash: new SpatialHash<SafeBuilding>(32), grid: null, buildingSeq: 0, treeSeq: 0,
  };
}
function makeInput(
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
function dispatchZone(input: ZoneGeneratorInput): void {
  switch (input.zone.contentType) {
    case 'walled_city':
      compileWalledCityZone(input);
      break;
    case 'town_blocks':
      compileTownBlocksZone(input);
      break;
    case 'village':
      compileVillageZone(input);
      break;
    case 'citadel':
      compileCitadelZone(input);
      break;
    case 'market':
      compileMarketZone(input);
      break;
    case 'farmland':
      compileFarmlandZone(input);
      break;
    case 'saltpan':
      compileSaltpanZone(input);
      break;
    case 'woodland':
      compileWoodlandZone(input);
      break;
    case 'exclusion':
      compileExclusionZone(input);
      break;
    default:
      break;
  }
}
function toZoneResult(
  zone: TownProject['zones'][number],
  target: ZoneBuildTarget,
): CompiledZoneResult {
  return {
    id: zone.id, name: zone.name, contentType: zone.contentType, seed: zone.seed,
    points: zone.points, areaHa: Math.abs(computePolygonAreaSigned(zone.points)) / 10000,
    buildings: target.buildings, walls: target.walls, towers: target.towers,
    internalStreets: target.internalStreets, lanes: target.lanes, gardenFences: target.gardenFences,
    trees: target.trees, farmlandPlots: target.farmlandPlots, saltpanCells: target.saltpanCells,
    marketAprons: target.marketAprons, wells: target.wells, exclusionPoly: target.exclusionPoly,
  };
}
function buildLegend(project: TownProject, scene: CompiledScene): LegendConfig {
  const presence: ScenePresenceFlags = {
    roof_inner: scene.buildings.some((b) => b.roofKind === 'inner'),
    roof_town: scene.buildings.some((b) => b.roofKind === 'town'),
    city_wall: scene.walls.length > 0,
    road_highway: scene.hydro.roads.length > 0,
    bridge_ortho: scene.hydro.bridges.length > 0,
    river_pure: scene.hydro.rivers.length > 0,
    water_lake_sea: scene.hydro.waterBodies.length > 0,
    canal_water: scene.hydro.canals.length > 0,
    contour_line: scene.terrain.contours.length > 0, scarp_tick: scene.terrain.scarpTicks.length > 0,
    farmland_plot: scene.farmlandPlots.length > 0, saltpan_plot: scene.saltpanCells.length > 0,
    woodland_tree: scene.trees.some((t) => t.kind === 'woodland'),
    rock_reef: scene.hydro.reefs.length > 0,
  };
  return syncLegendWithProject(project, presence, getActivePalette(project.palette));
}
function assembleScene(
  project: TownProject,
  terrainData: ElevationFieldData,
  contours: ReadonlyArray<ContourLine>,
  scarpTicks: ReadonlyArray<ScarpTickSegment>,
  hydro: HydroRoadPackage,
  zones: ReadonlyArray<CompiledZoneResult>,
  startedAt: number,
  reportOverride?: CompiledScene['collisionReport'],
): CompiledScene {
  const buildings = zones.flatMap((z) => z.buildings);
  const walls = zones.flatMap((z) => z.walls);
  const trees = zones.flatMap((z) => z.trees);
  const report = reportOverride ?? verifyZeroCollisions(project, terrainData, hydro, zones);
  const base: CompiledScene = {
    schemaVersion: project.schemaVersion, worldSizeM: project.meta.worldSizeM,
    terrainSignature: terrainSignature(project),
    terrain: { contours, scarpTicks, minElev: terrainData.minElev, maxElev: terrainData.maxElev, terrainData },
    hydro, zones, buildings, walls, trees,
    farmlandPlots: zones.flatMap((z) => z.farmlandPlots),
    saltpanCells: zones.flatMap((z) => z.saltpanCells),
    marketAprons: zones.flatMap((z) => z.marketAprons),
    lanes: zones.flatMap((z) => z.lanes),
    gardenFences: zones.flatMap((z) => z.gardenFences),
    internalStreets: zones.flatMap((z) => z.internalStreets),
    wells: zones.flatMap((z) => z.wells),
    exclusionPolys: zones
      .map((z) => z.exclusionPoly)
      .filter((poly): poly is Polygon => poly !== null),
    collisionReport: report,
    stats: {
      compileMs: performance.now() - startedAt,
      zoneCount: zones.length, buildingCount: buildings.length, wallCount: walls.length,
      treeCount: trees.length,
      bridgeCount: hydro.bridges.length,
      contourCount: contours.length,
      collisionHits: report.totalHits,
    },
    legend: {
      visible: true,
      title: '图例 · LEGEND',
      position: 'bottom-right',
      columns: 2,
      items: [],
    },
  };
  return { ...base, legend: buildLegend(project, base) };
}
/** 阶段一 + 全局 SDF：任何调用方（全量编译或单区重抽）都从最新 project 重建，杜绝脏缓存 */
function prepareTwoPhase(project: TownProject, terrainOverride?: ElevationFieldData): {
  terrainData: ElevationFieldData;
  hydro: HydroRoadPackage;
  ctx: ObstacleContext;
  wallSystems: Map<string, WallSystem>;
} {
  const terrainData = terrainOverride ?? buildElevationField(project);
  const hydro = buildHydroRoadPackage(project);
  const ctx = createObstacleContext(project, terrainData, hydro);
  const wallSystems = new Map<string, WallSystem>();
  for (const zone of project.zones) {
    if (zone.contentType !== 'walled_city' && zone.contentType !== 'citadel') continue;
    const input = makeInput(project, zone, terrainData, ctx, createEmptyZoneTarget());
    wallSystems.set(zone.id, buildZoneWallSystem(input));
  }
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
  });
  return { terrainData, hydro, ctx, wallSystems };
}
/**
 * 两阶段全局编译铁律：阶段一先跑全部 walled_city/citadel 城垣并注册 wallsBuilt，
 * 再统一生成含全图城墙的 512×512 障碍场；阶段二才分发 9 类选区生成器。
 * 无论 zones 顺序如何调换，buildingWallHits 恒为 0。
 */
export function compileSettlementScene(project: TownProject): CompiledScene {
  const started = performance.now();
  const { terrainData, hydro, ctx, wallSystems } = prepareTwoPhase(project);
  const contours = extractContours(terrainData, project.terrain);
  const scarpTicks = extractScarpTicks(contours, terrainData, project.terrain);
  const results: CompiledZoneResult[] = [];
  for (const zone of project.zones) {
    const target = createEmptyZoneTarget();
    const wall = wallSystems.get(zone.id);
    if (wall) {
      target.walls.push(...wall.walls);
      target.towers.push(...wall.towers);
    }
    dispatchZone(makeInput(project, zone, terrainData, ctx, target));
    results.push(toZoneResult(zone, target));
  }
  return assembleScene(project, terrainData, contours, scarpTicks, hydro, results, started);
}
/**
 * 单区秒级重抽：先按当前最新 project 重建地形、水路与全图城垣，再生成新鲜障碍场与
 * 其余选区既有屋宇空间哈希，最后只重编目标选区，杜绝改路后复用过期缓存穿模。
 */
export function rerollZoneScene(
  project: TownProject,
  zoneId: string,
  prevScene?: CompiledScene,
  explicitSeed?: number,
): RerollResult {
  const target = project.zones.find((z) => z.id === zoneId);
  if (!target) throw new Error(`Zone not found: ${zoneId}`);
  let updatedSeed = explicitSeed ?? hashSeed(`${target.id}|${target.seed}|reroll`);
  if (explicitSeed === undefined && updatedSeed === target.seed) updatedSeed = (updatedSeed + 1) >>> 0;
  const nextProject: TownProject = {
    ...project,
    zones: project.zones.map((z) => (z.id === zoneId ? { ...z, seed: updatedSeed } : z)),
  };
  if (!prevScene) {
    return { scene: compileSettlementScene(nextProject), updatedSeed };
  }
  const started = performance.now();
  const updatedZone = nextProject.zones.find((z) => z.id === zoneId);
  if (!updatedZone) throw new Error(`Zone not found after reroll: ${zoneId}`);
  const reuseTerrain = Boolean(prevScene && prevScene.terrainSignature === terrainSignature(nextProject));
  const terrainData = reuseTerrain && prevScene ? prevScene.terrain.terrainData : buildElevationField(nextProject);
  const { hydro, ctx, wallSystems } = prepareTwoPhase(nextProject, terrainData);
  for (const prior of prevScene.zones) {
    if (prior.id === zoneId) continue;
    for (const b of prior.buildings) {
      ctx.spatialHash.insert(b, computePolygonBBox(b.points));
    }
  }
  const targetBuild = createEmptyZoneTarget();
  const wall = wallSystems.get(zoneId);
  if (wall) {
    targetBuild.walls.push(...wall.walls);
    targetBuild.towers.push(...wall.towers);
  }
  dispatchZone(makeInput(nextProject, updatedZone, terrainData, ctx, targetBuild));
  const rebuilt = toZoneResult(updatedZone, targetBuild);
  const merged = nextProject.zones.map((z) => {
    if (z.id === zoneId) return rebuilt;
    const prior = prevScene.zones.find((p) => p.id === z.id);
    return prior ?? toZoneResult(z, createEmptyZoneTarget());
  });
  const reuseScene = reuseTerrain && prevScene ? prevScene : null;
  const contours = reuseScene ? reuseScene.terrain.contours : extractContours(terrainData, nextProject.terrain);
  const scarpTicks = reuseScene ? reuseScene.terrain.scarpTicks : extractScarpTicks(contours, terrainData, nextProject.terrain);
  const targetReport = verifyZeroCollisions(nextProject, terrainData, hydro, [rebuilt]);
  const neighborBuildings = prevScene.zones.filter((z) => z.id !== zoneId).flatMap((z) => z.buildings);
  const crossHits = countCrossZoneBuildingHits(rebuilt.buildings, neighborBuildings);
  const hits = targetReport.totalHits + crossHits;
  const report = {
    ...targetReport,
    buildingBuildingHits: targetReport.buildingBuildingHits + crossHits,
    totalHits: hits,
    passed: hits === 0 && hydro.riverIslandCount === 0,
  };
  const scene = assembleScene(nextProject, terrainData, contours, scarpTicks, hydro, merged, started, report);
  return { scene, updatedSeed };
}
