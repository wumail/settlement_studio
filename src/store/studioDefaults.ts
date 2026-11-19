import type {
  HydraulicPreset,
  SculptBrushSettings,
  StructurePreset,
  TreeBrushSettings,
} from './studioTypes';
import { TREE_BRUSH_DEFAULTS } from '../schema/v3.entity.schema';
import type { ToolId } from '../schema/geometry.types';
import type { ToolGroupId } from '../ui/toolCatalog';

export const INITIAL_BRUSH: SculptBrushSettings = {
  mode: 'raise',
  radiusM: 72,
  strength: 0.65,
  flattenTargetElev: 480,
  hardness: 0.38,
  autoLockStartElev: true,
  terraceStepM: 8,
};

export const INITIAL_TREE_BRUSH: TreeBrushSettings = {
  radiusM: TREE_BRUSH_DEFAULTS.radiusM,
  spacingM: TREE_BRUSH_DEFAULTS.spacingM,
  minR: TREE_BRUSH_DEFAULTS.minR,
  maxR: TREE_BRUSH_DEFAULTS.maxR,
  eraseMode: false,
};

export const INITIAL_HYDRAULIC: HydraulicPreset = {
  kind: 'weir',
  sluices: 3,
  slips: 4,
  autoSnap: true,
};

export const INITIAL_STRUCTURE: StructurePreset = {
  kind: 'rect',
  widthM: 36,
  depthM: 24,
  roofKind: 'citadel',
};

export const INITIAL_LAST_TOOL_IN_GROUP: Record<ToolGroupId, ToolId> = {
  select_edit: 'select',
  terrain: 'sculpt_brush',
  hydro: 'draw_river',
  road: 'draw_road',
  urban: 'draw_zone',
  vegetation: 'tree_brush',
  annotate: 'place_landmark',
};

/** 笔刷半径与硬度的键盘/滚轮限幅 */
export const BRUSH_LIMITS = {
  minRadiusM: 8,
  maxRadiusM: 280,
  minHardness: 0,
  maxHardness: 0.95,
} as const;

export function clampRadius(radiusM: number): number {
  if (!Number.isFinite(radiusM)) return INITIAL_BRUSH.radiusM;
  return Math.max(BRUSH_LIMITS.minRadiusM, Math.min(BRUSH_LIMITS.maxRadiusM, radiusM));
}

export function clampHardness(hardness: number): number {
  if (!Number.isFinite(hardness)) return INITIAL_BRUSH.hardness;
  return Math.max(BRUSH_LIMITS.minHardness, Math.min(BRUSH_LIMITS.maxHardness, hardness));
}
