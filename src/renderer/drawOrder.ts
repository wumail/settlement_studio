/**
 * 内容叠放层级：每个可选物体带 `zIndex` 偏移，叠加到所属类别的基准层号上。
 * 基准层号复刻 V3 既有画家顺序，`zIndex = 0` 时画面与旧版逐像素等价。
 */
export const Z_BASE = {
  land: 10,
  water: 20,
  reef: 22,
  ford: 23,
  canal: 24,
  road: 30,
  hydraulic: 40,
  bridge: 45,
  buildings: 60,
  walls: 62,
  structure: 65,
  trees: 70,
} as const;

/** 用户可调层级的实体（用于 UI 与 store 的统一寻址） */
export const Z_ENTITY_KEYS = [
  'zones',
  'rivers',
  'waterBodies',
  'canals',
  'reefs',
  'fords',
  'roads',
  'weirs',
  'docks',
  'watermills',
  'structures',
  'bridgeOverrides',
  'landmarks',
] as const;

export type ZEntityKey = (typeof Z_ENTITY_KEYS)[number];

export function zOf(base: number, zIndex?: number): number {
  return base + (typeof zIndex === 'number' && Number.isFinite(zIndex) ? zIndex : 0);
}

/** 置顶/置底：在 -480..480 之间留出足够跨度，避免反复点击后撞上限 */
export const Z_LIMIT = 480;

/**
 * 是否启用了自定义叠放：任一可选物体 `zIndex !== 0` 即切换到排序绘制。
 * 全默认时仍走 17 层画家序列，保证既有导出分层与视觉逐项不变。
 */
export function hasCustomOrder(project: {
  readonly zones: ReadonlyArray<{ zIndex?: number }>;
  readonly rivers: ReadonlyArray<{ zIndex?: number }>;
  readonly waterBodies: ReadonlyArray<{ zIndex?: number }>;
  readonly canals: ReadonlyArray<{ zIndex?: number }>;
  readonly reefs: ReadonlyArray<{ zIndex?: number }>;
  readonly fords: ReadonlyArray<{ zIndex?: number }>;
  readonly roads: ReadonlyArray<{ zIndex?: number }>;
  readonly weirs: ReadonlyArray<{ zIndex?: number }>;
  readonly docks: ReadonlyArray<{ zIndex?: number }>;
  readonly watermills: ReadonlyArray<{ zIndex?: number }>;
  readonly structures: ReadonlyArray<{ zIndex?: number }>;
  readonly bridgeOverrides: ReadonlyArray<{ zIndex?: number }>;
  readonly landmarks: ReadonlyArray<{ zIndex?: number }>;
}): boolean {
  const groups = [
    project.zones, project.rivers, project.waterBodies, project.canals, project.reefs,
    project.fords, project.roads, project.weirs, project.docks, project.watermills,
    project.structures, project.bridgeOverrides, project.landmarks,
  ] as ReadonlyArray<ReadonlyArray<{ zIndex?: number }>>;
  return groups.some((list) => list.some((item) => (item.zIndex ?? 0) !== 0));
}
