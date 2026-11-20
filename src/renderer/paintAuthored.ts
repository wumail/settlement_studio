import type { PaintContext } from './paintContext';
import { PAINTED_TREE_ZONE } from '../core/obstacles/guardSafe';
import { Z_BASE, zOf } from './drawOrder';
import {
  paintAprons,
  paintExclusion,
  paintFarmland,
  paintLanes,
  paintRoads,
  paintSaltpan,
  paintTrees,
  paintWoodlandUnderstory,
} from './paintLand';
import { paintBridges, paintCanals, paintReefsFords, paintWater } from './paintHydro';
import { paintHydraulicWorks, paintStructures } from './paintStructures';
import { paintBuildings, paintWalls } from './paintBuildings';
import { paintHachures } from './paintTerrain';

interface AuthoredItem {
  readonly z: number;
  readonly seq: number;
  readonly draw: () => void;
}

/** 按叠层 z 分组道路，同层道路合并为一次两遍绘制（先全部边线再全部路面），避免十字路口黑叉 */
function pushGroupedRoads(
  ctx: PaintContext,
  push: (z: number, draw: () => void) => void,
): void {
  const byZ = new Map<number, Set<string>>();
  for (const road of ctx.project.roads) {
    const z = zOf(Z_BASE.road, road.zIndex);
    let ids = byZ.get(z);
    if (!ids) {
      ids = new Set<string>();
      byZ.set(z, ids);
    }
    ids.add(road.id);
  }
  if (byZ.size === 0) {
    push(Z_BASE.road, () => paintRoads(ctx, undefined));
    return;
  }
  // 次级巷网随最低 z 组同批两遍绘制：全路缘仍严格先于全路面
  const groups = [...byZ.entries()].sort((a, b) => a[0] - b[0]);
  groups.forEach(([z, ids], index) => push(z, () => paintRoads(ctx, ids, index === 0)));
}

/** 为自动生成的桥位匹配 35m 内的桥梁覆写，读取其自定义 zIndex */
function bridgeOverrideZ(ctx: PaintContext, x: number, y: number): number | undefined {
  let bestDist = 35;
  let bestZ: number | undefined;
  for (const ov of ctx.project.bridgeOverrides) {
    const d = Math.hypot(ov.x - x, ov.y - y);
    if (d <= bestDist) {
      bestDist = d;
      bestZ = ov.zIndex;
    }
  }
  return bestZ;
}

/**
 * 全部「可选物体」按叠放层级排序后统一绘制。
 * 默认 zIndex=0 时排序结果与 V3 既有画家顺序逐项一致；用户提高任一物体的 zIndex
 * 即可让它（含选区内的建筑、城垣与林木）整体压到其他要素之上，降低则沉到水体与田畴之下。
 */
export function paintAuthored(ctx: PaintContext, withLabels: boolean): void {
  const { project, scene } = ctx;
  const items: AuthoredItem[] = [];
  let seq = 0;
  const push = (z: number, draw: () => void): void => {
    items.push({ z, seq: seq++, draw });
  };

  if (!scene) {
    // 未编译时仍可画出工程侧的选区与道路（编辑器降级状态）
    for (const zone of project.zones) {
      const id = zone.id;
      push(zOf(Z_BASE.land, zone.zIndex), () => {
        paintWoodlandUnderstory(ctx, id);
        paintExclusion(ctx, id);
        paintFarmland(ctx, id);
        paintSaltpan(ctx, id);
        paintAprons(ctx, id);
      });
    }
    pushGroupedRoads(ctx, push);
    items.sort((a, b) => a.z - b.z || a.seq - b.seq).forEach((item) => item.draw());
    return;
  }

  // 晕滃是地形底纹，永远沉在全部可选物体之下（等高线本身另在最顶层）
  push(Z_BASE.land - 1, () => paintHachures(ctx));
  for (const zone of project.zones) {
    const id = zone.id;
    push(zOf(Z_BASE.land, zone.zIndex), () => {
      paintWoodlandUnderstory(ctx, id);
      paintExclusion(ctx, id);
      paintFarmland(ctx, id);
      paintSaltpan(ctx, id);
      paintAprons(ctx, id);
    });
  }
  for (const river of project.rivers) {
    const id = river.id;
    push(zOf(Z_BASE.water, river.zIndex), () => paintWater(ctx, id));
  }
  for (const body of project.waterBodies) {
    const id = body.id;
    push(zOf(Z_BASE.water, body.zIndex), () => paintWater(ctx, id));
  }
  for (const reef of project.reefs) {
    const id = reef.id;
    push(zOf(Z_BASE.reef, reef.zIndex), () => paintReefsFords(ctx, id));
  }
  for (const ford of project.fords) {
    const id = ford.id;
    push(zOf(Z_BASE.ford, ford.zIndex), () => paintReefsFords(ctx, id));
  }
  for (const canal of project.canals) {
    const id = canal.id;
    push(zOf(Z_BASE.canal, canal.zIndex), () => paintCanals(ctx, id));
  }
  // 村径与篱院属于生成物，作为整体夹在渠与官道之间
  push(Z_BASE.road - 1, () => paintLanes(ctx));
  pushGroupedRoads(ctx, push);
  for (const weir of project.weirs) {
    const id = weir.id;
    push(zOf(Z_BASE.hydraulic, weir.zIndex), () => paintHydraulicWorks(ctx, id));
  }
  for (const dock of project.docks) {
    const id = dock.id;
    push(zOf(Z_BASE.hydraulic, dock.zIndex), () => paintHydraulicWorks(ctx, id));
  }
  for (const mill of project.watermills) {
    const id = mill.id;
    push(zOf(Z_BASE.hydraulic, mill.zIndex), () => paintHydraulicWorks(ctx, id));
  }
  for (const bridge of scene.hydro.bridges) {
    const id = bridge.id;
    push(zOf(Z_BASE.bridge, bridgeOverrideZ(ctx, bridge.x, bridge.y)), () => paintBridges(ctx, id));
  }
  // 选区内的屋宇、城垣与区树随所属 zone.zIndex 同步升降
  for (const zone of project.zones) {
    const id = zone.id;
    push(zOf(Z_BASE.buildings, zone.zIndex), () => paintBuildings(ctx, id));
    push(zOf(Z_BASE.walls, zone.zIndex), () => paintWalls(ctx, id));
    push(zOf(Z_BASE.trees, zone.zIndex), () => paintTrees(ctx, id));
  }
  for (const item of project.structures) {
    const id = item.id;
    push(zOf(Z_BASE.structure, item.zIndex), () => paintStructures(ctx, false, id));
  }
  void withLabels;
  push(Z_BASE.trees, () => paintTrees(ctx, PAINTED_TREE_ZONE));

  items.sort((a, b) => a.z - b.z || a.seq - b.seq).forEach((item) => item.draw());
}
