import { z } from 'zod';
import { PointSchema } from './entity.schema';

/** 水工结构件六类放置预设（stage 1 仅落盘与拾取，几何编译见阶段二 hydraulicWorks） */
export const HYDRAULIC_KINDS = [
  'weir',
  'dock_slipway',
  'dock_pier',
  'watermill',
  'reef',
  'ford',
] as const;
export type HydraulicKind = (typeof HYDRAULIC_KINDS)[number];

export const STRUCTURE_KINDS = ['rect', 'l_hall', 'u_court', 'round_altar'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const STRUCTURE_ROOF_KINDS = ['inner', 'town', 'citadel'] as const;
export type StructureRoofKind = (typeof STRUCTURE_ROOF_KINDS)[number];

/** 1. 分水堰 / 水闸（可吸附河道断面） */
export const WeirSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default('分水堰'),
  pStart: PointSchema,
  pEnd: PointSchema,
  sluices: z.number().int().min(1).max(8).default(3),
  widthM: z.number().min(3).max(24).default(8),
});

/** 2. 码头 / 浅船滑道坞 / 湖港栈桥（吸附岸线法向） */
export const DockSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default('河埠码头'),
  x: z.number(),
  y: z.number(),
  angleDeg: z.number().default(0),
  kind: z.enum(['slipway', 'wooden_pier']).default('slipway'),
  slips: z.number().int().min(1).max(8).default(4),
  spacingM: z.number().min(8).max(40).default(18),
  lengthM: z.number().min(12).max(120).default(42),
  widthM: z.number().min(4).max(120).default(9),
});

/** 3. 沿河水力工坊（水力锻锤 / 水磨坊） */
export const WatermillSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default('水力工坊'),
  x: z.number(),
  y: z.number(),
  angleDeg: z.number().default(0),
  wheelSide: z.enum(['left', 'right']).default('left'),
  widthM: z.number().min(8).max(40).default(18),
  depthM: z.number().min(6).max(30).default(12),
});

/** 4. 核心建筑群 / 礼制单体（议事厅 / 四公仓 / 官坛 / 客舍大院） */
export const CustomStructureSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default('核心建筑'),
  x: z.number(),
  y: z.number(),
  angleDeg: z.number().default(0),
  widthM: z.number().min(8).max(160).default(36),
  depthM: z.number().min(8).max(160).default(24),
  kind: z.enum(STRUCTURE_KINDS).default('rect'),
  roofKind: z.enum(STRUCTURE_ROOF_KINDS).default('citadel'),
  zoneId: z.string().optional(),
});

/** 5. 桥梁覆写（选中自动桥后调整样式或升级双桥头堡关隘） */
export const BridgeOverrideSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  x: z.number(),
  y: z.number(),
  style: z.enum(['stone_arch', 'timber', 'fortified_twin', 'ford']).default('stone_arch'),
  widthM: z.number().min(4).max(30).optional(),
  fortSizeM: z.number().min(14).max(48).default(26),
});

/** 6. 林木笔刷自由涂抹树（经守门校验，可按 Alt 局部擦除） */
export const PaintedTreeSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  r: z.number().min(2.5).max(16).default(5.5),
  kind: z.enum(['woodland', 'garden', 'plaza']).default('woodland'),
});

export type ProjectWeir = z.infer<typeof WeirSchema>;
export type ProjectDock = z.infer<typeof DockSchema>;
export type ProjectWatermill = z.infer<typeof WatermillSchema>;
export type ProjectStructure = z.infer<typeof CustomStructureSchema>;
export type ProjectBridgeOverride = z.infer<typeof BridgeOverrideSchema>;
export type PaintedTree = z.infer<typeof PaintedTreeSchema>;

/** 林木笔刷默认冠幅与疏密（store 与 UI 共用同一默认值） */
export const TREE_BRUSH_DEFAULTS = {
  radiusM: 46,
  spacingM: 0.75,
  minR: 3.6,
  maxR: 8.2,
} as const;
