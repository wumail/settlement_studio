import type { ToolId } from '../schema/geometry.types';

/** 7 个 PS 风格工具组（组键 = 组内首个工具的单键直达别名） */
export const TOOL_GROUP_IDS = [
  'select_edit',
  'terrain',
  'hydro',
  'road',
  'urban',
  'vegetation',
  'annotate',
] as const;
export type ToolGroupId = (typeof TOOL_GROUP_IDS)[number];

export interface ToolGroup {
  readonly id: ToolGroupId;
  readonly label: string;
  readonly hotkey: string;
  readonly tools: ReadonlyArray<ToolId>;
  readonly defaultTool: ToolId;
}

export const TOOL_GROUPS: ReadonlyArray<ToolGroup> = [
  { id: 'select_edit', label: '选择与编辑', hotkey: 'V', tools: ['select', 'reroll_stamp'], defaultTool: 'select' },
  { id: 'terrain', label: '地形塑造', hotkey: 'B', tools: ['sculpt_brush', 'contour_drag', 'add_hill', 'add_ridge'], defaultTool: 'sculpt_brush' },
  { id: 'hydro', label: '水系与水工', hotkey: 'W', tools: ['draw_river', 'draw_water_area', 'place_hydraulic'], defaultTool: 'draw_river' },
  { id: 'road', label: '道路与城防', hotkey: 'D', tools: ['draw_road', 'edit_crossing'], defaultTool: 'draw_road' },
  { id: 'urban', label: '城坊与建筑群', hotkey: 'Z', tools: ['draw_zone', 'place_structure'], defaultTool: 'draw_zone' },
  { id: 'vegetation', label: '植被与地被', hotkey: 'T', tools: ['tree_brush'], defaultTool: 'tree_brush' },
  { id: 'annotate', label: '标注与测绘', hotkey: 'M', tools: ['place_landmark', 'measure'], defaultTool: 'place_landmark' },
];

export const TOOL_LABELS: Readonly<Record<ToolId, string>> = {
  select: '选择与变换手柄',
  reroll_stamp: '单区点击重抽戳',
  sculpt_brush: '地形微雕笔刷',
  contour_drag: '等高线直接推拉',
  add_hill: '山包 / 盆地',
  add_ridge: '山脊 / 冲沟 / 陡坎',
  draw_river: '变宽河流',
  draw_water_area: '湖海 / 多形态水渠',
  place_hydraulic: '水工结构件',
  draw_road: '三级道路与土径',
  edit_crossing: '桥梁样式 / 渡口',
  draw_zone: '聚落选区 / 带状村寨',
  place_structure: '核心建筑群单体',
  tree_brush: '林木涂抹 / 擦除笔刷',
  place_landmark: '地标与导览角标',
  measure: '测距与高程剖面',
};

/** 组内子工具的单键直达别名（无别名的工具经组内轮换或浮层进入） */
export const TOOL_HOTKEYS: Readonly<Record<ToolId, string>> = {
  select: 'V',
  reroll_stamp: '',
  sculpt_brush: 'B',
  contour_drag: 'C',
  add_hill: 'H',
  add_ridge: 'G',
  draw_river: 'W',
  draw_water_area: 'L',
  place_hydraulic: 'K',
  draw_road: 'D',
  edit_crossing: '',
  draw_zone: 'Z',
  place_structure: 'X',
  tree_brush: 'T',
  place_landmark: 'M',
  measure: 'U',
};

export const TOOL_GROUP_OF: Readonly<Record<ToolId, ToolGroupId>> = TOOL_GROUPS.reduce(
  (acc, group) => {
    for (const tool of group.tools) acc[tool] = group.id;
    return acc;
  },
  {} as Record<ToolId, ToolGroupId>,
);

export function groupById(id: ToolGroupId): ToolGroup {
  const found = TOOL_GROUPS.find((group) => group.id === id);
  if (found) return found;
  const fallback = TOOL_GROUPS[0];
  if (!fallback) throw new Error('TOOL_GROUPS is empty');
  return fallback;
}

export function groupOf(tool: ToolId): ToolGroup {
  return groupById(TOOL_GROUP_OF[tool]);
}

/** 组内轮切：当前工具在组内则取下一个，否则回到组记忆工具 */
export function cycleToolInGroup(group: ToolGroup, activeTool: ToolId): ToolId {
  const index = group.tools.indexOf(activeTool);
  if (index < 0) return group.defaultTool;
  const next = group.tools[(index + 1) % group.tools.length];
  return next ?? group.defaultTool;
}

export interface HotkeyContext {
  readonly activeTool: ToolId;
  readonly lastToolInGroup: Readonly<Record<ToolGroupId, ToolId>>;
  readonly shift: boolean;
}

/**
 * 键盘解析：组键在组内轮换（或 Shift 强制轮换），单键别名直达。
 * 返回 null 表示该按键不属于工具系统。
 */
export function resolveToolHotkey(key: string, ctx: HotkeyContext): ToolId | null {
  const upper = key.length === 1 ? key.toUpperCase() : '';
  if (upper.length === 0) return null;
  const group = TOOL_GROUPS.find((item) => item.hotkey === upper);
  if (group) {
    if (ctx.shift || group.tools.includes(ctx.activeTool)) {
      return cycleToolInGroup(group, ctx.activeTool);
    }
    return ctx.lastToolInGroup[group.id] ?? group.defaultTool;
  }
  const direct = (Object.keys(TOOL_HOTKEYS) as ToolId[]).find(
    (tool) => TOOL_HOTKEYS[tool] !== '' && TOOL_HOTKEYS[tool] === upper,
  );
  return direct ?? null;
}
