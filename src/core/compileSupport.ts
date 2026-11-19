import type { LegendConfig, ScenePresenceFlags } from '../schema/legend.schema';
import { syncLegendWithProject } from '../schema/legend.schema';
import { getActivePalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from './compileScene';

/** 地形签名：任一会影响高程场的输入变化即触发全量重算 */
export function terrainSignature(project: TownProject): string {
  const rivers = project.rivers.map((r) => ({
    id: r.id,
    carveDepthM: r.carveDepthM,
    widthStartM: r.widthStartM,
    widthEndM: r.widthEndM,
    points: r.points,
  }));
  return JSON.stringify({
    worldSizeM: project.meta.worldSizeM,
    terrain: project.terrain,
    rivers,
  });
}

/** 图例自动感知：按编译产物真实要素切换 14 类内置项的 autoPresent */
export function buildLegend(project: TownProject, scene: CompiledScene): LegendConfig {
  const presence: ScenePresenceFlags = {
    roof_inner: scene.buildings.some((b) => b.roofKind === 'inner'),
    roof_town: scene.buildings.some((b) => b.roofKind === 'town'),
    city_wall: scene.walls.length > 0,
    road_highway: scene.hydro.roads.length > 0,
    bridge_ortho: scene.hydro.bridges.length > 0,
    river_pure: scene.hydro.rivers.length > 0,
    water_lake_sea: scene.hydro.waterBodies.length > 0,
    canal_water: scene.hydro.canals.length > 0,
    contour_line: scene.terrain.contours.length > 0,
    scarp_tick: scene.terrain.scarpTicks.length > 0,
    farmland_plot: scene.farmlandPlots.length > 0,
    saltpan_plot: scene.saltpanCells.length > 0,
    woodland_tree: scene.trees.some((t) => t.kind === 'woodland'),
    rock_reef: scene.hydro.reefs.length > 0,
  };
  return syncLegendWithProject(project, presence, getActivePalette(project.palette));
}
