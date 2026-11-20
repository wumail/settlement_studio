import { closestPointOnPolyline } from '../core/math/spline';
import { snapPointToWaterBank } from '../core/hydro/hydraulicWorks';
import { hashSeed } from '../core/math/rng';
import type { CompiledSceneBase, Vec2 } from '../schema/geometry.types';
import { CUSTOM_GLYPH_TYPES, type CustomGlyphType } from '../schema/legend.schema';
import type { TownProject } from '../schema/project.schema';
import type { HydraulicPreset, StructurePreset } from '../store/studioTypes';
import type { StructureKind } from '../schema/v3.entity.schema';
import { useStudioStore } from '../store/useStudioStore';
import { nextId } from './stageBrush';

/** 落位默认名：合院建筑群用于客舍/驿馆/衙署/会馆/大货栈 */
const STRUCTURE_DEFAULT_NAMES: Readonly<Partial<Record<StructureKind, string>>> = {
  round_altar: '官坛',
  u_court: '客舍合院',
  courtyard: '客舍大院',
  l_hall: '议事厅',
};

interface FlowHit {
  readonly point: Vec2;
  readonly tangent: Vec2;
  readonly dist: number;
}

/** 最近河道走向（世界坐标切向），供堰体横跨与水工贴岸定向 */
function nearestRiverFlow(scene: CompiledSceneBase | null, world: Vec2): FlowHit | null {
  if (!scene) return null;
  let best: FlowHit | null = null;
  for (const river of scene.hydro.rivers) {
    const hit = closestPointOnPolyline(world[0], world[1], river.centerline);
    if (!hit) continue;
    const a = river.centerline[hit.segIndex];
    const b = river.centerline[Math.min(river.centerline.length - 1, hit.segIndex + 1)];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    if (best && hit.dist >= best.dist) continue;
    best = { point: [hit.x, hit.y], tangent: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], dist: hit.dist };
  }
  return best;
}

function angleDegOf(dir: Vec2): number {
  return (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
}

/** 码头长度轴朝水：local +y 轴与世界方向的夹角 */
function dockAngleToWater(world: Vec2, flow: FlowHit | null): number {
  if (!flow) return 90;
  const dx = flow.point[0] - world[0];
  const dy = flow.point[1] - world[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 90;
  return (Math.atan2(-dx / len, dy / len) * 180) / Math.PI;
}

/** 水工结构件落盘：weir 横跨最近河道，dock/watermill 贴岸定向，reef/ford 保留原点放语义 */
export function placeHydraulic(world: Vec2, preset: HydraulicPreset): void {
  const state = useStudioStore.getState();
  const scene = state.compiledScene;
  const flow = nearestRiverFlow(scene, world);
  const bank = scene && preset.autoSnap
    ? snapPointToWaterBank(
        scene.hydro.rivers,
        scene.hydro.waterBodies,
        scene.hydro.canals,
        world[0],
        world[1],
      )
    : null;
  const anchor: Vec2 = bank ? [bank.x, bank.y] : world;
  const inland: Vec2 = bank
    ? [-Math.sin((bank.angleDeg * Math.PI) / 180), -Math.cos((bank.angleDeg * Math.PI) / 180)]
    : [0, 0];
  const kind = preset.kind;
  if (kind === 'reef' || kind === 'ford') {
    state.mutateProject((draft) => {
      if (kind === 'ford') {
        draft.fords.push({ zIndex: 0, id: nextId('frd'), name: '涉水渡口', x: world[0], y: world[1], radiusM: 24 });
      } else {
        draft.reefs.push({
          zIndex: 0,
          id: nextId('reef'), x: world[0], y: world[1], radiusM: 14, angleDeg: 0,
          seed: hashSeed(`${world[0]}|${world[1]}`), count: 2,
        });
      }
    });
    return;
  }
  if (kind === 'weir') {
    const spanAngle = bank ? bank.angleDeg + 90 : flow ? angleDegOf(flow.tangent) + 90 : 0;
    const rad = (spanAngle * Math.PI) / 180;
    const span = 26;
    state.mutateProject((draft) => {
      draft.weirs.push({
        zIndex: 0,
        id: nextId('weir'),
        name: '分水堰',
        pStart: [anchor[0] - Math.cos(rad) * span, anchor[1] - Math.sin(rad) * span],
        pEnd: [anchor[0] + Math.cos(rad) * span, anchor[1] + Math.sin(rad) * span],
        sluices: preset.sluices,
        widthM: 8,
      });
    });
    return;
  }
  if (kind === 'watermill') {
    state.mutateProject((draft) => {
      draft.watermills.push({
        zIndex: 0,
        id: nextId('mill'),
        name: '水力工坊',
        x: anchor[0] + inland[0] * 8,
        y: anchor[1] + inland[1] * 8,
        angleDeg: bank ? bank.angleDeg : flow ? angleDegOf(flow.tangent) : 0,
        wheelSide: 'left',
        widthM: 18,
        depthM: 12,
      });
    });
    return;
  }
  state.mutateProject((draft) => {
    draft.docks.push({
      zIndex: 0,
      id: nextId('dock'),
      name: kind === 'dock_pier' ? '湖港木栈桥' : '河埠滑道坞',
      x: anchor[0] + inland[0] * 4,
      y: anchor[1] + inland[1] * 4,
      angleDeg: bank ? bank.angleDeg : preset.autoSnap ? dockAngleToWater(world, flow) : 90,
      kind: kind === 'dock_pier' ? 'wooden_pier' : 'slipway',
      slips: preset.slips,
      spacingM: 18,
      lengthM: 42,
      widthM: 9,
    });
  });
}

export function placeStructure(world: Vec2, preset: StructurePreset): string {
  const id = nextId('str');
  useStudioStore.getState().mutateProject((draft) => {
    draft.structures.push({
      zIndex: 0,
      id,
      name: STRUCTURE_DEFAULT_NAMES[preset.kind] ?? '核心建筑',
      x: world[0],
      y: world[1],
      angleDeg: 0,
      widthM: preset.widthM,
      depthM: preset.depthM,
      kind: preset.kind,
      roofKind: preset.roofKind,
    });
  });
  return id;
}

const CROSSING_STYLES = ['stone_arch', 'timber', 'fortified_twin', 'ford'] as const;

/** 桥梁样式点选切换：命中 40m 内桥位后循环 stone_arch -> timber -> fortified_twin -> ford */
export function cycleBridgeCrossing(world: Vec2): string | null {
  const state = useStudioStore.getState();
  const scene = state.compiledScene;
  if (!scene) return null;
  let best: { x: number; y: number; dist: number } | null = null;
  for (const bridge of scene.hydro.bridges) {
    const dist = Math.hypot(world[0] - bridge.x, world[1] - bridge.y);
    if (best && dist >= best.dist) continue;
    best = { x: bridge.x, y: bridge.y, dist };
  }
  if (!best || best.dist > 40) return null;
  const anchor = best;
  const existing = state.project.bridgeOverrides.find(
    (item) => Math.hypot(item.x - anchor.x, item.y - anchor.y) <= 8,
  );
  const nextStyle = existing
    ? CROSSING_STYLES[(CROSSING_STYLES.indexOf(existing.style) + 1) % CROSSING_STYLES.length] ?? 'stone_arch'
    : 'stone_arch';
  const id = existing?.id ?? nextId('bo');
  state.mutateProject((draft) => {
    const target = draft.bridgeOverrides.find((item) => item.id === id);
    if (target) {
      target.style = nextStyle;
      return;
    }
    draft.bridgeOverrides.push({ zIndex: 0, id, x: anchor.x, y: anchor.y, style: nextStyle, fortSizeM: 26 });
  });
  return id;
}

/** 地标戳记：图例键反查字形，补齐 V3 subtitle 默认字段 */
export function placeLandmark(world: Vec2): void {
  const state = useStudioStore.getState();
  const legendItem = state.project.legend.items.find((item) => item.key === state.activeLandmarkKey);
  const rawGlyph = legendItem?.glyphType
    ?? (state.activeLandmarkKey.startsWith('custom_') ? state.activeLandmarkKey.slice(7) : 'stele');
  const glyphType: CustomGlyphType = (CUSTOM_GLYPH_TYPES as ReadonlyArray<string>).includes(rawGlyph)
    ? (rawGlyph as CustomGlyphType)
    : 'stele';
  const badge = state.project.landmarks.length + 1;
  state.mutateProject((draft) => {
    draft.landmarks.push({ zIndex: 0,
      id: nextId('lm'),
      legendKey: state.activeLandmarkKey,
      glyphType,
      label: state.activeLandmarkLabel,
      x: world[0],
      y: world[1],
      showLabel: true,
      sizePx: 15,
      badgeNum: badge <= 99 ? badge : undefined,
      subtitle: '',
    });
  });
}

export function rerollStampAt(world: Vec2, project: TownProject): void {
  const state = useStudioStore.getState();
  for (let i = project.zones.length - 1; i >= 0; i -= 1) {
    const zone = project.zones[i];
    if (!zone) continue;
    if (pointInside(world, zone.points)) {
      state.rerollZone(zone.id);
      return;
    }
  }
}

function pointInside(world: Vec2, poly: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const intersects =
      a[1] > world[1] !== b[1] > world[1] &&
      world[0] < ((b[0] - a[0]) * (world[1] - a[1])) / (b[1] - a[1] + 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}
