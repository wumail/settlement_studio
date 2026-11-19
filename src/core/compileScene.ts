import type {
  CompiledSceneBase,
  CompiledZoneResultBase,
  Polygon,
} from '../schema/geometry.types';
import type { LegendConfig } from '../schema/legend.schema';
import { type TownProject } from '../schema/project.schema';
import { buildLegend, terrainSignature } from './compileSupport';
import {
  type CompileExtras,
  compileExtras,
  extractSceneContours,
  makeInput,
  prepareTwoPhase,
} from './compilePipeline';
import type { HydroRoadPackage } from './hydro/reefRoadBridge';
import type { HydraulicWorks } from './hydro/hydraulicWorks';
import type { BuiltStructure } from './generators/customStructures';
import { hashSeed } from './math/rng';
import { computePolygonAreaSigned, computePolygonBBox } from './math/polygon';
import {
  countCrossZoneBuildingHits,
  verifyZeroCollisions,
} from './obstacles/collisionAudit';
import {
  type SafeBuilding,
  type SafeFence,
  type SafeTree,
  type ZoneBuildTarget,
  type ZoneGeneratorInput,
  createEmptyZoneTarget,
} from './obstacles/guardSafe';
import { type ElevationFieldData, buildElevationField } from './terrain/elevationField';
import {
  type ContourLine,
  type ScarpTickSegment,
  extractScarpTicks,
} from './terrain/marchingSquares';
import { type TerrainShadingData, buildTerrainShading } from './terrain/terrainShading';
import { compileCitadelZone } from './generators/citadel';
import { compileFarmlandZone } from './generators/farmland';
import { compileMarketZone } from './generators/market';
import { compileSaltpanZone } from './generators/saltpan';
import { compileTownBlocksZone } from './generators/townBlocks';
import { compileVillageZone } from './generators/village';
import { compileWalledCityZone } from './generators/walledCity';
import { compileExclusionZone, compileWoodlandZone } from './generators/woodland';

export type CompiledZoneResult = CompiledZoneResultBase<SafeBuilding, SafeFence, SafeTree>;
export type CompiledScene = CompiledSceneBase<SafeBuilding, SafeFence, SafeTree> & {
  readonly terrain: CompiledSceneBase['terrain'] & { readonly terrainData: ElevationFieldData };
  readonly hydro: HydroRoadPackage;
  readonly legend: LegendConfig;
  readonly terrainSignature: string;
  readonly hydraulic: HydraulicWorks;
  readonly structures: ReadonlyArray<BuiltStructure>;
  readonly shading: TerrainShadingData;
  readonly paintedTreeRejects: ReadonlyArray<string>;
};
export interface RerollResult {
  readonly scene: CompiledScene;
  readonly updatedSeed: number;
}


function dispatchZone(input: ZoneGeneratorInput): void {
  switch (input.zone.contentType) {
    case 'walled_city': compileWalledCityZone(input); break;
    case 'town_blocks': compileTownBlocksZone(input); break;
    case 'village': compileVillageZone(input); break;
    case 'citadel': compileCitadelZone(input); break;
    case 'market': compileMarketZone(input); break;
    case 'farmland': compileFarmlandZone(input); break;
    case 'saltpan': compileSaltpanZone(input); break;
    case 'woodland': compileWoodlandZone(input); break;
    case 'exclusion': compileExclusionZone(input); break;
    default: break;
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

function assembleScene(
  project: TownProject,
  terrainData: ElevationFieldData,
  contours: ReadonlyArray<ContourLine>,
  baseContours: ReadonlyArray<ContourLine>,
  scarpTicks: ReadonlyArray<ScarpTickSegment>,
  hydro: HydroRoadPackage,
  zones: ReadonlyArray<CompiledZoneResult>,
  extras: CompileExtras,
  startedAt: number,
  reportOverride?: CompiledScene['collisionReport'],
  shadingOverride?: TerrainShadingData,
): CompiledScene {
  const buildings = zones.flatMap((z) => z.buildings);
  const walls = zones.flatMap((z) => z.walls);
  const trees = [...zones.flatMap((z) => z.trees), ...extras.painting];
  const report = reportOverride ?? verifyZeroCollisions(project, terrainData, hydro, zones);
  const shading = shadingOverride ?? buildTerrainShading(terrainData, project, baseContours);
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
    exclusionPolys: zones.map((z) => z.exclusionPoly).filter((poly): poly is Polygon => poly !== null),
    collisionReport: report,
    hydraulic: extras.hydraulic,
    structures: extras.structures,
    shading,
    paintedTreeRejects: extras.rejectedTreeIds,
    stats: {
      compileMs: performance.now() - startedAt,
      zoneCount: zones.length, buildingCount: buildings.length, wallCount: walls.length,
      treeCount: trees.length,
      bridgeCount: hydro.bridges.length,
      contourCount: contours.length,
      collisionHits: report.totalHits,
    },
    legend: {
      visible: true, title: '图例 · LEGEND', position: 'bottom-right', columns: 2,
      displayMode: 'standard', furnitureOpacity: project.legend.furnitureOpacity,
      labelOpacity: project.legend.labelOpacity, items: [],
    },
  };
  return { ...base, legend: buildLegend(project, base) };
}

/**
 * 两阶段全局编译铁律：阶段一先跑全部 walled_city/citadel 城垣（含明渠水门）并注册 wallsBuilt，
 * 再把水工件/建筑群/桥头堡/水门足印并入刚性障碍场；阶段二才分发 9 类选区生成器。
 */
export function compileSettlementScene(project: TownProject): CompiledScene {
  const started = performance.now();
  const { terrainData, hydro, hydraulic, structures, ctx, wallSystems, rigidPolys } =
    prepareTwoPhase(project);
  const { baseContours, contours } = extractSceneContours(terrainData, project.terrain);
  const scarpTicks = extractScarpTicks(baseContours, terrainData, project.terrain);
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
  const walls = results.flatMap((z) => z.walls);
  const extras = compileExtras(
    project, terrainData, hydro, hydraulic, structures, walls, rigidPolys,
    results.flatMap((z) => z.buildings),
  );
  return assembleScene(
    project, terrainData, contours, baseContours, scarpTicks, hydro, results, extras, started,
  );
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
  const terrainData = reuseTerrain ? prevScene.terrain.terrainData : buildElevationField(nextProject);
  const { hydro, hydraulic, structures, ctx, wallSystems, rigidPolys } =
    prepareTwoPhase(nextProject, terrainData);
  // 与全量编译严格同序：只有排在目标区之前的选区已生成，后序选区此刻尚不存在；
  // 若把后序邻屋也预注入，边界处候选会被多拒一批，重抽与全量重编布局将无法逐字复现。
  const order = nextProject.zones.findIndex((z) => z.id === zoneId);
  for (let i = 0; i < order; i += 1) {
    const prior = prevScene.zones.find((z) => z.id === nextProject.zones[i]?.id);
    if (!prior) continue;
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
  const reuseScene = reuseTerrain ? prevScene : null;
  const sceneContours = reuseScene
    ? { baseContours: reuseScene.terrain.contours, contours: reuseScene.terrain.contours }
    : extractSceneContours(terrainData, nextProject.terrain);
  const scarpTicks = reuseScene
    ? reuseScene.terrain.scarpTicks
    : extractScarpTicks(sceneContours.baseContours, terrainData, nextProject.terrain);
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
  const extras = compileExtras(
    nextProject, terrainData, hydro, hydraulic, structures,
    merged.flatMap((z) => z.walls), rigidPolys, merged.flatMap((z) => z.buildings),
  );
  const scene = assembleScene(
    nextProject, terrainData, sceneContours.contours, sceneContours.baseContours, scarpTicks,
    hydro, merged, extras, started, report, reuseScene ? reuseScene.shading : undefined,
  );
  return { scene, updatedSeed };
}
