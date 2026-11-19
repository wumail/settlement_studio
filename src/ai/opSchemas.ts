import { z } from 'zod';
import {
  CANAL_STYLES,
  PointSchema,
  TerrainConfigSchema,
  TerrainShapeSchema,
  ZONE_CONTENT_TYPES,
  ZoneExclusionStyles,
  ZoneMarketModes,
} from '../schema/entity.schema';
import { CUSTOM_GLYPH_TYPES, LEGEND_DISPLAY_MODES, LEGEND_POSITIONS } from '../schema/legend.schema';
import { STRUCTURE_KINDS, STRUCTURE_ROOF_KINDS } from '../schema/v3.entity.schema';
import { GeoBootstrapPayloadSchema } from './geoContracts';

export { GeoBootstrapPayloadSchema } from './geoContracts';

const Z_INDEX = z.number().min(-500).max(500);
const OPT_Z = Z_INDEX.optional();

/** 统一锚点：坐标 / 河岸 / 选区边 / 实体 / 图幅边界 */
export const GeoAnchorSchema = z.union([
  z.tuple([z.number(), z.number()]),
  z.object({
    riverId: z.string(),
    t: z.number().min(0).max(1),
    bank: z.enum(['left', 'right', 'center']).optional(),
    offsetM: z.number().optional(),
  }).strict(),
  z.object({
    zoneId: z.string(),
    side: z.enum(['center', 'north', 'south', 'east', 'west']).optional(),
    offsetM: z.number().optional(),
  }).strict(),
  z.object({ entityId: z.string() }).strict(),
  z.object({ edge: z.enum(['north', 'south', 'east', 'west']), ratio: z.number().min(0.05).max(0.95) }).strict(),
]);

export const RelativeZoneSchema = z.object({
  anchor: GeoAnchorSchema,
  shape: z.enum(['rect', 'octagonal', 'polygon_13', 'organic']),
  areaHa: z.number().min(0.05).max(400),
  aspectRatio: z.number().min(0.25).max(4).default(1),
  rotationDeg: z.number().default(0),
}).strict();

const base = { zIndex: OPT_Z };

const SetMeta = z.object({
  op: z.literal('set_meta'),
  id: z.string().optional(),
  name: z.string().optional(),
  subtitle: z.string().optional(),
  worldSizeM: z.number().min(600).max(8000).optional(),
  geoAnchor: z.object({
    lon: z.number(), lat: z.number(), elevM: z.number(), regionNote: z.string().optional(),
  }).nullable().optional(),
}).strict();

const SetTerrain = TerrainConfigSchema.omit({ shapes: true, sculptDeltaB64: true })
  .partial()
  .extend({ op: z.literal('set_terrain') })
  .strict();

const TerrainShapeOp = z.intersection(
  TerrainShapeSchema,
  z.object({ op: z.literal('upsert_terrain_shape'), zIndex: OPT_Z }),
);

const ApplyGeoBootstrap = z.object({
  op: z.literal('apply_geo_bootstrap'),
  payload: GeoBootstrapPayloadSchema,
  importRivers: z.boolean().default(true),
  clearExistingRivers: z.boolean().default(false),
}).strict();

const UpsertRiver = z.object({
  op: z.literal('upsert_river'),
  id: z.string(),
  name: z.string().optional(),
  points: z.array(PointSchema).min(2),
  widthStartM: z.number().min(6).max(600).optional(),
  widthEndM: z.number().min(6).max(600).optional(),
  widthsM: z.array(z.number().min(6).max(600)).optional(),
  carveDepthM: z.number().min(0).max(120).optional(),
  rippleLines: z.number().min(0).max(3).optional(),
  ...base,
}).strict();

const UpsertWaterBody = z.object({
  op: z.literal('upsert_water_body'),
  id: z.string(),
  name: z.string().optional(),
  kind: z.enum(['lake', 'sea']),
  points: z.array(PointSchema).min(3),
  rippleLines: z.number().min(0).max(3).optional(),
  ...base,
}).strict();

const UpsertCanal = z.object({
  op: z.literal('upsert_canal'),
  id: z.string(),
  name: z.string().optional(),
  style: z.enum(CANAL_STYLES).optional(),
  points: z.array(PointSchema).min(2),
  widthM: z.number().min(1.2).max(60).optional(),
  ...base,
}).strict();

const SnapWeir = z.object({
  op: z.literal('snap_weir'),
  id: z.string(),
  name: z.string().optional(),
  riverId: z.string(),
  t: z.number().min(0).max(1),
  sluices: z.number().int().min(1).max(8).optional(),
  widthM: z.number().min(3).max(24).optional(),
  overhangM: z.number().min(0).max(40).optional(),
  ...base,
}).strict();

const SnapDock = z.object({
  op: z.literal('snap_dock'),
  id: z.string(),
  name: z.string().optional(),
  targetId: z.string(),
  targetKind: z.enum(['river', 'waterBody']).optional(),
  t: z.number().min(0).max(1),
  bank: z.enum(['left', 'right']).optional(),
  kind: z.enum(['slipway', 'wooden_pier']).optional(),
  slips: z.number().int().min(1).max(8).optional(),
  spacingM: z.number().min(8).max(40).optional(),
  lengthM: z.number().min(12).max(120).optional(),
  widthM: z.number().min(4).max(120).optional(),
  insetM: z.number().min(0).max(30).optional(),
  ...base,
}).strict();

const SnapWatermill = z.object({
  op: z.literal('snap_watermill'),
  id: z.string(),
  name: z.string().optional(),
  targetId: z.string(),
  targetKind: z.enum(['river', 'canal']).optional(),
  t: z.number().min(0).max(1),
  bank: z.enum(['left', 'right']).optional(),
  wheelSide: z.enum(['left', 'right']).optional(),
  widthM: z.number().min(8).max(40).optional(),
  depthM: z.number().min(6).max(30).optional(),
  bankOffsetM: z.number().min(0).max(40).optional(),
  ...base,
}).strict();

const PlaceZone = z.object({
  op: z.literal('place_zone'),
  id: z.string(),
  name: z.string().optional(),
  contentType: z.enum(ZONE_CONTENT_TYPES),
  points: z.array(PointSchema).min(3).optional(),
  relative: RelativeZoneSchema.optional(),
  seed: z.number().int().optional(),
  density: z.number().min(0.2).max(1).optional(),
  maxSlopeDeg: z.number().min(4).max(60).optional(),
  streetWidthM: z.number().min(3).max(24).optional(),
  wallThicknessM: z.number().min(1.5).max(16).optional(),
  towerIntervalM: z.number().min(30).max(320).optional(),
  frayOuter: z.boolean().optional(),
  marketMode: z.enum(ZoneMarketModes).optional(),
  exclusionStyle: z.enum(ZoneExclusionStyles).optional(),
  buildingScale: z.number().min(0.45).max(1.6).optional(),
  ...base,
}).strict().refine((value) => Boolean(value.points) !== Boolean(value.relative), {
  message: 'place_zone 必须且只能提供 points 或 relative 之一',
});

const ConnectRoad = z.object({
  op: z.literal('connect_road'),
  id: z.string(),
  name: z.string().optional(),
  tier: z.enum(['highway', 'street', 'lane']).optional(),
  widthM: z.number().min(2).max(60).optional(),
  from: GeoAnchorSchema,
  to: GeoAnchorSchema,
  via: z.array(GeoAnchorSchema).default([]),
  curveOffsetM: z.number().min(-600).max(600).optional(),
  ...base,
}).strict();

const UpsertRoad = z.object({
  op: z.literal('upsert_road'),
  id: z.string(),
  name: z.string().optional(),
  tier: z.enum(['highway', 'street', 'lane']).optional(),
  widthM: z.number().min(2).max(60).optional(),
  points: z.array(PointSchema).min(2),
  ...base,
}).strict();

const UpsertStructure = z.object({
  op: z.literal('upsert_structure'),
  id: z.string(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  anchor: GeoAnchorSchema.optional(),
  angleDeg: z.number().optional(),
  widthM: z.number().min(8).max(160).optional(),
  depthM: z.number().min(8).max(160).optional(),
  kind: z.enum(STRUCTURE_KINDS).optional(),
  roofKind: z.enum(STRUCTURE_ROOF_KINDS).optional(),
  zoneId: z.string().optional(),
  ...base,
}).strict();

const UpsertBridgeOverride = z.object({
  op: z.literal('upsert_bridge_override'),
  id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  bridgeId: z.string().optional(),
  style: z.enum(['stone_arch', 'timber', 'fortified_twin', 'ford']),
  widthM: z.number().min(4).max(30).optional(),
  fortSizeM: z.number().min(14).max(48).optional(),
  ...base,
}).strict();

const UpsertLandmark = z.object({
  op: z.literal('upsert_landmark'),
  id: z.string(),
  label: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  anchor: GeoAnchorSchema.optional(),
  glyphType: z.enum(CUSTOM_GLYPH_TYPES).optional(),
  showLabel: z.boolean().optional(),
  sizePx: z.number().min(8).max(48).optional(),
  badgeNum: z.number().int().min(1).max(99).optional(),
  subtitle: z.string().optional(),
  ...base,
}).strict();

const ScatterTrees = z.object({
  op: z.literal('scatter_trees'),
  anchor: GeoAnchorSchema,
  radiusM: z.number().min(6).max(600),
  count: z.number().int().min(1).max(600),
  minR: z.number().min(2.5).max(16).optional(),
  maxR: z.number().min(2.5).max(16).optional(),
  kind: z.enum(['woodland', 'garden', 'plaza']).optional(),
  seed: z.number().int().optional(),
}).strict();

const RemoveEntity = z.object({
  op: z.literal('remove_entity'),
  collection: z.enum([
    'rivers', 'waterBodies', 'canals', 'reefs', 'roads', 'fords', 'zones', 'landmarks',
    'weirs', 'docks', 'watermills', 'structures', 'bridgeOverrides', 'paintedTrees', 'terrainShapes',
  ]),
  id: z.string(),
}).strict();

const RerollZone = z.object({
  op: z.literal('reroll_zone'),
  zoneId: z.string(),
  seed: z.number().int().optional(),
}).strict();

const SetPalette = z.object({
  op: z.literal('set_palette'),
  themeId: z.string().optional(),
  overrides: z.record(z.string(), z.string()).optional(),
}).strict();

const SetLegend = z.object({
  op: z.literal('set_legend'),
  visible: z.boolean().optional(),
  title: z.string().optional(),
  position: z.enum(LEGEND_POSITIONS).optional(),
  columns: z.union([z.literal(1), z.literal(2)]).optional(),
  displayMode: z.enum(LEGEND_DISPLAY_MODES).optional(),
  furnitureOpacity: z.number().min(0.15).max(1).optional(),
  labelOpacity: z.number().min(0).max(1).optional(),
}).strict();

/** 21 种语义操作全集（Zod 严格校验，未知字段直接报错） */
export const AiOpSchema = z.union([
  SetMeta,
  SetTerrain,
  TerrainShapeOp,
  ApplyGeoBootstrap,
  UpsertRiver,
  UpsertWaterBody,
  UpsertCanal,
  SnapWeir,
  SnapDock,
  SnapWatermill,
  PlaceZone,
  ConnectRoad,
  UpsertRoad,
  UpsertStructure,
  UpsertBridgeOverride,
  UpsertLandmark,
  ScatterTrees,
  RemoveEntity,
  RerollZone,
  SetPalette,
  SetLegend,
]);

export type AiOp = z.infer<typeof AiOpSchema>;
