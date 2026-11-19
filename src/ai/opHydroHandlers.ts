import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import type { AiOp } from './opSchemas';
import type { MutableProject } from './opHelpers';
import { removeById, upsertWith } from './opHelpers';
import { computeSnappedDock, computeSnappedWatermill, computeSnappedWeir } from './geometrySnap';

type Op<K extends AiOp['op']> = Extract<AiOp, { op: K }>;

function viewOf(draft: MutableProject): TownProject {
  return draft as unknown as TownProject;
}

export function applyHydroOp(draft: MutableProject, op: AiOp, scene: CompiledScene | null = null): string {
  switch (op.op) {
    case 'snap_weir': return snapWeir(draft, op);
    case 'snap_dock': return snapDock(draft, op);
    case 'snap_watermill': return snapWatermill(draft, op);
    case 'upsert_bridge_override': return upsertBridge(draft, op, scene);
    case 'remove_entity': return removeEntity(draft, op);
    case 'reroll_zone': return rerollZone(draft, op);
    case 'set_palette': return setPalette(draft, op);
    case 'set_legend': return setLegend(draft, op);
    default: return op.op;
  }
}

function snapWeir(draft: MutableProject, op: Op<'snap_weir'>): string {
  const river = draft.rivers.find((item) => item.id === op.riverId);
  if (!river) throw new Error(`snap_weir:${op.id} 找不到河道 ${op.riverId}`);
  const snap = computeSnappedWeir(river, op.t, op.overhangM ?? 8);
  upsertWith(draft.weirs, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '分水堰',
    pStart: snap.pStart,
    pEnd: snap.pEnd,
    sluices: op.sluices ?? 3,
    widthM: op.widthM ?? 8,
  }), (target) => {
    target.pStart = snap.pStart;
    target.pEnd = snap.pEnd;
    if (op.name !== undefined) target.name = op.name;
    if (op.sluices !== undefined) target.sluices = op.sluices;
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `snap_weir:${op.id}`;
}

function snapDock(draft: MutableProject, op: Op<'snap_dock'>): string {
  const targetKind = op.targetKind
    ?? (draft.rivers.some((item) => item.id === op.targetId) ? 'river' : 'waterBody');
  const snap = computeSnappedDock(viewOf(draft), null, {
    targetId: op.targetId,
    targetKind,
    t: op.t,
    bank: op.bank,
    insetM: op.insetM,
  });
  upsertWith(draft.docks, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? (op.kind === 'wooden_pier' ? '湖港栈桥' : '河埠码头'),
    x: snap.x,
    y: snap.y,
    angleDeg: snap.angleDeg,
    kind: op.kind ?? 'slipway',
    slips: op.slips ?? 4,
    spacingM: op.spacingM ?? 18,
    lengthM: op.lengthM ?? 42,
    widthM: op.widthM ?? 9,
  }), (target) => {
    target.x = snap.x;
    target.y = snap.y;
    target.angleDeg = snap.angleDeg;
    if (op.name !== undefined) target.name = op.name;
    if (op.kind !== undefined) target.kind = op.kind;
    if (op.slips !== undefined) target.slips = op.slips;
    if (op.spacingM !== undefined) target.spacingM = op.spacingM;
    if (op.lengthM !== undefined) target.lengthM = op.lengthM;
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `snap_dock:${op.id}`;
}

function snapWatermill(draft: MutableProject, op: Op<'snap_watermill'>): string {
  const targetKind = op.targetKind
    ?? (draft.rivers.some((item) => item.id === op.targetId) ? 'river' : 'canal');
  const snap = computeSnappedWatermill(viewOf(draft), {
    targetId: op.targetId,
    targetKind,
    t: op.t,
    bank: op.bank,
    wheelSide: op.wheelSide,
    widthM: op.widthM,
    depthM: op.depthM,
    bankOffsetM: op.bankOffsetM,
  });
  upsertWith(draft.watermills, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '水力工坊',
    x: snap.x,
    y: snap.y,
    angleDeg: snap.angleDeg,
    wheelSide: snap.wheelSide,
    widthM: op.widthM ?? 18,
    depthM: op.depthM ?? 12,
  }), (target) => {
    target.x = snap.x;
    target.y = snap.y;
    target.angleDeg = snap.angleDeg;
    if (op.wheelSide === undefined) target.wheelSide = snap.wheelSide;
    else target.wheelSide = op.wheelSide;
    if (op.name !== undefined) target.name = op.name;
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.depthM !== undefined) target.depthM = op.depthM;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `snap_watermill:${op.id}`;
}

function upsertBridge(draft: MutableProject, op: Op<'upsert_bridge_override'>, scene: CompiledScene | null): string {
  let x = op.x;
  let y = op.y;
  if ((x === undefined || y === undefined) && op.bridgeId) {
    const bridge = scene?.hydro.bridges.find((item) => item.id === op.bridgeId);
    if (!bridge) throw new Error(`upsert_bridge_override:${op.id} 找不到桥位 ${op.bridgeId}`);
    x = bridge.x;
    y = bridge.y;
  }
  if (x === undefined || y === undefined) {
    throw new Error(`upsert_bridge_override:${op.id} 缺少 x/y 或 bridgeId`);
  }
  upsertWith(draft.bridgeOverrides, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    x,
    y,
    style: op.style,
    ...(op.widthM !== undefined ? { widthM: op.widthM } : {}),
    fortSizeM: op.fortSizeM ?? 26,
  }), (target) => {
    target.x = x;
    target.y = y;
    target.style = op.style;
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.fortSizeM !== undefined) target.fortSizeM = op.fortSizeM;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `upsert_bridge_override:${op.id}`;
}

function removeEntity(draft: MutableProject, op: Op<'remove_entity'>): string {
  const removed = removeById(draft, op.collection, op.id);
  if (!removed) throw new Error(`remove_entity:${op.collection}/${op.id} 不存在`);
  return `remove_entity:${op.collection}/${op.id}`;
}

function rerollZone(draft: MutableProject, op: Op<'reroll_zone'>): string {
  const zone = draft.zones.find((item) => item.id === op.zoneId);
  if (!zone) throw new Error(`reroll_zone: 找不到选区 ${op.zoneId}`);
  zone.seed = op.seed ?? zone.seed + 1;
  return `reroll_zone:${op.zoneId}`;
}

function setPalette(draft: MutableProject, op: Op<'set_palette'>): string {
  if (op.themeId !== undefined) draft.palette.themeId = op.themeId;
  if (op.overrides !== undefined) Object.assign(draft.palette.overrides, op.overrides);
  return 'set_palette';
}

function setLegend(draft: MutableProject, op: Op<'set_legend'>): string {
  if (op.visible !== undefined) draft.legend.visible = op.visible;
  if (op.title !== undefined) draft.legend.title = op.title;
  if (op.position !== undefined) draft.legend.position = op.position;
  if (op.columns !== undefined) draft.legend.columns = op.columns;
  if (op.displayMode !== undefined) draft.legend.displayMode = op.displayMode;
  if (op.furnitureOpacity !== undefined) draft.legend.furnitureOpacity = op.furnitureOpacity;
  if (op.labelOpacity !== undefined) draft.legend.labelOpacity = op.labelOpacity;
  return 'set_legend';
}

