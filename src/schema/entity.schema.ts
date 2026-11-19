import { z } from 'zod';
import { CUSTOM_GLYPH_TYPES } from './legend.schema';

/** 9 类选区内容枚举 */
export const ZONE_CONTENT_TYPES = [
  'walled_city',
  'town_blocks',
  'village',
  'citadel',
  'market',
  'farmland',
  'saltpan',
  'woodland',
  'exclusion',
] as const;
export type ZoneContentType = (typeof ZONE_CONTENT_TYPES)[number];

export const PointSchema = z.tuple([z.number(), z.number()]);

/** 5 类水渠样式：open 为 V1.2 遗留别名，按 stone_clean 渲染 */
export const CANAL_STYLES = [
  'open',
  'qanat',
  'stone_clean',
  'irrigation',
  'drainage_dashed',
  'foul_outfall',
] as const;
export type CanalStyle = (typeof CANAL_STYLES)[number];

export const ZoneMarketModes = ['stalls', 'timber_yard', 'port_apron'] as const;
export type ZoneMarketMode = (typeof ZoneMarketModes)[number];

export const ZoneExclusionStyles = ['plague_stones', 'meadow', 'marsh', 'plain'] as const;
export type ZoneExclusionStyle = (typeof ZoneExclusionStyles)[number];

export const MetaSchema = z.object({
  id: z.string().default('proj_untitled'),
  name: z.string().default('未命名聚落'),
  subtitle: z.string().default(''),
  worldSizeM: z.number().min(600).max(8000).default(2400),
  terraxAnchor: z
    .object({ lon: z.number(), lat: z.number(), elevM: z.number(), regionNote: z.string().optional() })
    .nullable()
    .default(null),
  updatedAt: z.string().default('1970-01-01T00:00:00.000Z'),
});
export type ProjectMeta = z.infer<typeof MetaSchema>;

const HillOrBasinShapeSchema = z.object({
  id: z.string(),
  type: z.enum(['hill', 'basin']),
  cx: z.number(),
  cy: z.number(),
  rx: z.number().min(25),
  ry: z.number().min(25),
  angleDeg: z.number().default(0),
  deltaElev: z.number(),
  focusX: z.number().default(0),
  focusY: z.number().default(0),
});
const LinearTerrainShapeSchema = z.object({
  id: z.string(),
  type: z.enum(['ridge', 'valley', 'scarp']),
  points: z.array(PointSchema).min(2),
  deltaElev: z.number(),
  widthLeft: z.number().min(20).default(60),
  widthRight: z.number().min(20).default(60),
});

export const TerrainShapeSchema = z.union([HillOrBasinShapeSchema, LinearTerrainShapeSchema]);
export type TerrainShape = z.infer<typeof TerrainShapeSchema>;

export const TerrainConfigSchema = z.object({
  baseElev: z.number().default(450),
  slopeMagM: z.number().default(18),
  slopeDirDeg: z.number().default(315),
  contourStep: z.number().min(1).default(5),
  indexEvery: z.number().min(1).default(5),
  minContourElev: z.number().default(-500),
  maxContourElev: z.number().default(6000),
  showContours: z.boolean().default(true),
  /** 等高线不透明度：默认低透明度，只作地形底纹，不压过聚落线稿 */
  contourOpacity: z.number().min(0.05).max(1).default(0.35),
  showScarpTicks: z.boolean().default(false),
  scarpSlopeThresholdDeg: z.number().default(26),
  showHypsometricTint: z.boolean().default(true),
  showHachures: z.boolean().default(true),
  hachureSlopeMinDeg: z.number().min(1.5).max(25).default(3.5),
  terrainNoiseAmpM: z.number().min(0).max(12).default(1.6),
  terrainSeed: z.number().int().default(7719),
  shapes: z.array(TerrainShapeSchema).default([]),
  sculptDeltaB64: z.string().default(''),
});
export type TerrainConfig = z.infer<typeof TerrainConfigSchema>;

const RiverSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default(''),
  points: z.array(PointSchema).min(2),
  widthStartM: z.number().min(6).max(600).default(28),
  widthEndM: z.number().min(6).max(600).default(46),
  /** 逐控制点实测河宽（V3：14 点蜿蜒变宽干流；缺省/长度不符时退回线性插值） */
  widthsM: z.array(z.number().min(6).max(600)).default([]),
  carveDepthM: z.number().min(0).max(120).default(6),
  rippleLines: z.number().min(0).max(3).default(3),
});
const WaterBodySchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default(''),
  kind: z.enum(['lake', 'sea']),
  points: z.array(PointSchema).min(3),
  rippleLines: z.number().min(0).max(3).default(3),
});
const CanalSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default(''),
  style: z.enum(CANAL_STYLES).default('stone_clean'),
  points: z.array(PointSchema).min(2),
  widthM: z.number().min(1.2).max(60).default(6),
});
const ReefSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  x: z.number(),
  y: z.number(),
  radiusM: z.number().min(4).max(120).default(14),
  angleDeg: z.number().default(0),
  seed: z.number().default(1),
  count: z.number().min(1).max(3).default(2),
});
const RoadSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default(''),
  tier: z.enum(['highway', 'street', 'lane']),
  points: z.array(PointSchema).min(2),
  widthM: z.number().min(2).max(60).default(9),
});
const FordSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  x: z.number(),
  y: z.number(),
  radiusM: z.number().min(6).max(120).default(24),
  name: z.string().default(''),
});
const ZoneSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  name: z.string().default(''),
  contentType: z.enum(ZONE_CONTENT_TYPES),
  points: z.array(PointSchema).min(3),
  seed: z.number().int().default(1),
  locked: z.boolean().default(false),
  density: z.number().min(0.2).max(1).default(0.72),
  maxSlopeDeg: z.number().min(4).max(60).default(24),
  streetWidthM: z.number().min(3).max(24).default(7.5),
  wallThicknessM: z.number().min(1.5).max(16).default(5.5),
  towerIntervalM: z.number().min(30).max(320).default(110),
  frayOuter: z.boolean().default(true),
  marketMode: z.enum(ZoneMarketModes).default('stalls'),
  exclusionStyle: z.enum(ZoneExclusionStyles).default('plague_stones'),
  ribbonSpine: z.array(PointSchema).default([]),
  corridorWidthM: z.number().min(24).max(260).default(110),
});
const LandmarkSchema = z.object({
  id: z.string(),
  zIndex: z.number().min(-500).max(500).default(0),
  legendKey: z.string().default(''),
  glyphType: z.enum(CUSTOM_GLYPH_TYPES).default('stele'),
  label: z.string().default('地标'),
  x: z.number(),
  y: z.number(),
  showLabel: z.boolean().default(true),
  sizePx: z.number().min(8).max(48).default(15),
  badgeNum: z.number().int().min(1).max(99).optional(),
  subtitle: z.string().default(''),
});

export {
  CanalSchema,
  FordSchema,
  LandmarkSchema,
  ReefSchema,
  RiverSchema,
  RoadSchema,
  WaterBodySchema,
  ZoneSchema,
};

export type ProjectZone = z.infer<typeof ZoneSchema>;
export type ProjectLandmark = z.infer<typeof LandmarkSchema>;
export type ProjectCanal = z.infer<typeof CanalSchema>;
