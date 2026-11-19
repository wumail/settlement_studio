import { z } from 'zod';
import type { PaletteSlotKey, ResolvedPalette } from './palette.schema';

/** 14 类内置图例图形 */
export const BUILTIN_GLYPH_TYPES = [
  'building_inner',
  'building_town',
  'city_wall',
  'road_main',
  'bridge',
  'river',
  'water_body',
  'canal',
  'contour',
  'scarp_tick',
  'farmland',
  'saltpan',
  'tree_cluster',
  'reef',
] as const;
export type BuiltinGlyphType = (typeof BUILTIN_GLYPH_TYPES)[number];

/** 8 类自定义地标徽记 */
export const CUSTOM_GLYPH_TYPES = [
  'star_fort',
  'tower',
  'well_shrine',
  'ferry_anchor',
  'gate_arch',
  'market_tent',
  'mine_hammer',
  'stele',
] as const;
export type CustomGlyphType = (typeof CUSTOM_GLYPH_TYPES)[number];

/** 22 类图例图形联合 */
export type LegendGlyphType = BuiltinGlyphType | CustomGlyphType;

export const LEGEND_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
export type LegendPosition = (typeof LEGEND_POSITIONS)[number];

export const LegendPositionSchema = z.enum(LEGEND_POSITIONS);

export const LegendItemSchema = z.object({
  key: z.string().min(1),
  isCustom: z.boolean().default(false),
  glyphType: z.string().default('building_town'),
  label: z.string().default('图例项'),
  color: z.string().default(''),
  colorLocked: z.boolean().default(false),
  strokeColor: z.string().default('#2b2520'),
  visible: z.boolean().default(true),
  autoPresent: z.boolean().default(true),
  order: z.number().default(100),
});

export const LEGEND_DISPLAY_MODES = ['standard', 'guided', 'pure'] as const;
export type LegendDisplayMode = (typeof LEGEND_DISPLAY_MODES)[number];

export const LegendConfigSchema = z.object({
  visible: z.boolean().default(true),
  title: z.string().default('图例 · LEGEND'),
  position: LegendPositionSchema.default('bottom-right'),
  columns: z.union([z.literal(1), z.literal(2)]).default(2),
  displayMode: z.enum(LEGEND_DISPLAY_MODES).default('standard'),
  /** 图饰（图例框/标题牌/指北针/比例尺/导览目录）统一半透明度，绝不遮死底图 */
  furnitureOpacity: z.number().min(0.15).max(1).default(0.72),
  /** 图面文字（选区名/地标名/河名/建筑名/等高线读数）统一透明度，0 为隐去 */
  labelOpacity: z.number().min(0).max(1).default(0.78),
  items: z.array(LegendItemSchema).default([]),
});

export type LegendItem = z.infer<typeof LegendItemSchema>;
export type LegendConfig = z.infer<typeof LegendConfigSchema>;

export type LegendCatalogKey =
  | 'roof_inner'
  | 'roof_town'
  | 'city_wall'
  | 'road_highway'
  | 'bridge_ortho'
  | 'river_pure'
  | 'water_lake_sea'
  | 'canal_water'
  | 'contour_line'
  | 'scarp_tick'
  | 'farmland_plot'
  | 'saltpan_plot'
  | 'woodland_tree'
  | 'rock_reef';

export interface BuiltinLegendCatalogEntry {
  readonly key: LegendCatalogKey;
  readonly label: string;
  readonly glyphType: BuiltinGlyphType;
  readonly strokeColor: string;
  readonly paletteSlot: PaletteSlotKey;
  readonly order: number;
}

/** 14 内置图例目录，order 10..140 固化 */
export const BUILTIN_LEGEND_CATALOG: ReadonlyArray<BuiltinLegendCatalogEntry> = [
  { key: 'roof_inner', label: '内城夯土屋宇', glyphType: 'building_inner', strokeColor: '#2b2520', paletteSlot: 'roofInner', order: 10 },
  { key: 'roof_town', label: '关厢市镇屋宇', glyphType: 'building_town', strokeColor: '#2b2520', paletteSlot: 'roofTown', order: 20 },
  { key: 'city_wall', label: '城垣与敌台', glyphType: 'city_wall', strokeColor: '#2b2520', paletteSlot: 'inkDark', order: 30 },
  { key: 'road_highway', label: '主次干道', glyphType: 'road_main', strokeColor: '#5b4a38', paletteSlot: 'roadFill', order: 40 },
  { key: 'bridge_ortho', label: '正交跨水桥', glyphType: 'bridge', strokeColor: '#2b2520', paletteSlot: 'roadFill', order: 50 },
  { key: 'river_pure', label: '纯净河道', glyphType: 'river', strokeColor: '#4f6b74', paletteSlot: 'waterFill', order: 60 },
  { key: 'water_lake_sea', label: '湖湾与海面', glyphType: 'water_body', strokeColor: '#4f6b74', paletteSlot: 'waterFill', order: 70 },
  { key: 'canal_water', label: '明渠与暗渠', glyphType: 'canal', strokeColor: '#55707a', paletteSlot: 'waterRipple', order: 80 },
  { key: 'contour_line', label: '等高线与计曲线', glyphType: 'contour', strokeColor: '#9e8c72', paletteSlot: 'contourLine', order: 90 },
  { key: 'scarp_tick', label: '陡坎短齿线', glyphType: 'scarp_tick', strokeColor: '#9e8c72', paletteSlot: 'contourLine', order: 100 },
  { key: 'farmland_plot', label: '条田耕垄', glyphType: 'farmland', strokeColor: '#7d7350', paletteSlot: 'farmlandFill', order: 110 },
  { key: 'saltpan_plot', label: '分级盐畦', glyphType: 'saltpan', strokeColor: '#5f7c80', paletteSlot: 'saltpanFill', order: 120 },
  { key: 'woodland_tree', label: '成片疏林', glyphType: 'tree_cluster', strokeColor: '#2c4024', paletteSlot: 'treeFill', order: 130 },
  { key: 'rock_reef', label: '水中底礁', glyphType: 'reef', strokeColor: '#2b2520', paletteSlot: 'inkDark', order: 140 },
];

/** 编译后场景真实存在要素集合，驱动 14 内置图例自动感知 */
export type ScenePresenceFlags = Readonly<Partial<Record<LegendCatalogKey, boolean>>>;

/** 图例同步所需最小工程视图（结构兼容 TownProject，规避 L1 内部循环依赖） */
export interface LegendSyncProjectView {
  readonly landmarks: ReadonlyArray<{
    readonly legendKey: string;
    readonly glyphType: string;
    readonly label: string;
  }>;
  readonly legend?: {
    readonly visible: boolean;
    readonly title: string;
    readonly position: LegendPosition;
    readonly columns: 1 | 2;
    readonly displayMode?: LegendDisplayMode;
    readonly furnitureOpacity?: number;
    readonly labelOpacity?: number;
    readonly items: ReadonlyArray<LegendItem>;
  };
}

const CATALOG_KEYS: ReadonlySet<string> = new Set(BUILTIN_LEGEND_CATALOG.map((e) => e.key));

function buildBuiltinItem(
  entry: BuiltinLegendCatalogEntry,
  existing: LegendItem | undefined,
  present: boolean,
): LegendItem {
  if (!existing) {
    return {
      key: entry.key,
      isCustom: false,
      glyphType: entry.glyphType,
      label: entry.label,
      color: '',
      colorLocked: false,
      strokeColor: entry.strokeColor,
      visible: true,
      autoPresent: present,
      order: entry.order,
    };
  }
  const locked = existing.colorLocked === true && existing.color.trim().length > 0;
  return {
    key: entry.key,
    isCustom: false,
    glyphType: existing.glyphType,
    label: existing.label,
    color: locked ? existing.color.trim().toLowerCase() : '',
    colorLocked: locked,
    strokeColor: existing.strokeColor,
    visible: existing.visible,
    autoPresent: present,
    order: existing.order,
  };
}

/** 自定义图例统一出口：无条件强制 autoPresent = true（未盖章徽记持久显示铁律） */
function normalizeCustomItem(item: LegendItem): LegendItem {
  return {
    key: item.key,
    isCustom: true,
    glyphType: item.glyphType,
    label: item.label,
    color: item.color,
    colorLocked: item.colorLocked,
    strokeColor: item.strokeColor,
    visible: item.visible,
    autoPresent: true,
    order: item.order,
  };
}

/**
 * 图例自动感知同步器。
 * 内置项按场景要素增删切换 autoPresent 并保留用户改名/显隐/排序/锁色；
 * 自定义项（含反向补齐的地标徽记）`autoPresent` 恒为 `true`。
 */
export function syncLegendWithProject(
  project: LegendSyncProjectView,
  scenePresence: ScenePresenceFlags,
  activePalette: ResolvedPalette,
): LegendConfig {
  const existingByKey = new Map<string, LegendItem>();
  for (const item of project.legend?.items ?? []) {
    existingByKey.set(item.key, item);
  }

  const builtins: LegendItem[] = BUILTIN_LEGEND_CATALOG.map((entry) =>
    buildBuiltinItem(entry, existingByKey.get(entry.key), scenePresence[entry.key] === true),
  );

  const customs = new Map<string, LegendItem>();
  let maxOrder = 0;
  for (const item of existingByKey.values()) {
    maxOrder = Math.max(maxOrder, item.order);
    if (CATALOG_KEYS.has(item.key)) continue;
    customs.set(item.key, normalizeCustomItem(item));
  }

  for (const landmark of project.landmarks) {
    if (!landmark.legendKey.startsWith('custom_')) continue;
    const prior = customs.get(landmark.legendKey);
    if (prior) {
      customs.set(landmark.legendKey, normalizeCustomItem(prior));
      continue;
    }
    maxOrder += 10;
    customs.set(landmark.legendKey, {
      key: landmark.legendKey,
      isCustom: true,
      glyphType: landmark.glyphType,
      label: landmark.label,
      color: activePalette.treeFill,
      colorLocked: false,
      strokeColor: activePalette.inkDark,
      visible: true,
      autoPresent: true,
      order: maxOrder,
    });
  }

  const customList = [...customs.values()].sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key),
  );

  const base = project.legend;
  return {
    visible: base?.visible ?? true,
    title: base?.title ?? '图例 · LEGEND',
    position: base?.position ?? 'bottom-right',
    columns: base?.columns ?? 2,
    displayMode: base?.displayMode ?? 'standard',
    furnitureOpacity: base?.furnitureOpacity ?? 0.72,
    labelOpacity: base?.labelOpacity ?? 0.78,
    items: [...builtins, ...customList],
  };
}


/**
 * 图例合成纯函数：visible/title/position/columns 永远取最新工程配置（关闭立即生效）；
 * items 以场景同步结果为底、按 key 叠加工程侧用户字段（改名/改色/显隐/排序/自定义项），
 * 既不丢失场景新同步出的内置项，也不丢弃未落盘的自定义徽记。
 */
export function resolveEffectiveLegend(
  projectLegend: LegendConfig,
  sceneLegend?: LegendConfig | null,
): LegendConfig {
  const merged = new Map<string, LegendItem>();
  const sceneItems = sceneLegend?.items ?? [];
  // 用户已在工程侧接管图例后，场景侧仅补充内置项，避免复活被删除的自定义徽记
  for (const item of projectLegend.items.length > 0 ? sceneItems.filter((it) => !it.isCustom) : sceneItems) {
    merged.set(item.key, item);
  }
  for (const item of projectLegend.items) {
    const sceneItem = merged.get(item.key);
    if (!sceneItem) {
      merged.set(item.key, { ...item });
      continue;
    }
    merged.set(item.key, {
      key: item.key,
      isCustom: sceneItem.isCustom || item.isCustom,
      glyphType: sceneItem.glyphType,
      label: item.label,
      color: item.color,
      colorLocked: item.colorLocked,
      strokeColor: item.strokeColor,
      visible: item.visible,
      autoPresent: item.isCustom ? true : sceneItem.autoPresent,
      order: item.order,
    });
  }
  const items = [...merged.values()].sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key),
  );
  return {
    visible: projectLegend.visible,
    title: projectLegend.title,
    position: projectLegend.position,
    columns: projectLegend.columns,
    displayMode: projectLegend.displayMode,
    furnitureOpacity: projectLegend.furnitureOpacity,
    labelOpacity: projectLegend.labelOpacity,
    items,
  };
}
