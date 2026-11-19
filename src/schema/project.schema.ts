import { z } from 'zod';
import { encodeSculptDeltaFromUnknown } from '../core/math/sculptCodecs';
import { SCHEMA_VERSION, type Vec2 } from './geometry.types';
import { CUSTOM_GLYPH_TYPES, LegendConfigSchema } from './legend.schema';
import { PaletteConfigSchema } from './palette.schema';

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

const PointSchema = z.tuple([z.number(), z.number()]);

const MetaSchema = z.object({
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
  showScarpTicks: z.boolean().default(false),
  scarpSlopeThresholdDeg: z.number().default(26),
  shapes: z.array(TerrainShapeSchema).default([]),
  sculptDeltaB64: z.string().default(''),
});
export type TerrainConfig = z.infer<typeof TerrainConfigSchema>;
const RiverSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  points: z.array(PointSchema).min(2),
  widthStartM: z.number().min(6).max(600).default(28),
  widthEndM: z.number().min(6).max(600).default(46),
  carveDepthM: z.number().min(0).max(120).default(6),
  rippleLines: z.number().min(0).max(3).default(3),
});
const WaterBodySchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  kind: z.enum(['lake', 'sea']),
  points: z.array(PointSchema).min(3),
  rippleLines: z.number().min(0).max(3).default(3),
});
const CanalSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  style: z.enum(['open', 'qanat']),
  points: z.array(PointSchema).min(2),
  widthM: z.number().min(1.2).max(60).default(6),
});
const ReefSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  radiusM: z.number().min(4).max(120).default(14),
  angleDeg: z.number().default(0),
  seed: z.number().default(1),
  count: z.number().min(1).max(3).default(2),
});
const RoadSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  tier: z.enum(['highway', 'street', 'lane']),
  points: z.array(PointSchema).min(2),
  widthM: z.number().min(2).max(60).default(9),
});
const FordSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  radiusM: z.number().min(6).max(120).default(24),
  name: z.string().default(''),
});
const ZoneSchema = z.object({
  id: z.string(),
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
});
const LandmarkSchema = z.object({
  id: z.string(),
  legendKey: z.string().default(''),
  glyphType: z.enum(CUSTOM_GLYPH_TYPES).default('stele'),
  label: z.string().default('地标'),
  x: z.number(),
  y: z.number(),
  showLabel: z.boolean().default(true),
  sizePx: z.number().min(8).max(48).default(15),
});

/** 13 大顶层主键完整契约 */
export const TownProjectSchema = z.object({
  schemaVersion: z.string().default(SCHEMA_VERSION),
  meta: MetaSchema.default({}),
  palette: PaletteConfigSchema.default({}),
  terrain: TerrainConfigSchema.default({}),
  rivers: z.array(RiverSchema).default([]),
  waterBodies: z.array(WaterBodySchema).default([]),
  canals: z.array(CanalSchema).default([]),
  reefs: z.array(ReefSchema).default([]),
  roads: z.array(RoadSchema).default([]),
  fords: z.array(FordSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  landmarks: z.array(LandmarkSchema).default([]),
  legend: LegendConfigSchema.default({}),
});

export type TownProject = z.infer<typeof TownProjectSchema>;
export type ProjectRiver = TownProject['rivers'][number];
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 相邻 < 1e-7 m 重复顶点剔除；闭合环首尾重合自动弹出末点；低于阈值返 null */
function cleanPointList(raw: unknown, minLen: number, closed: boolean): Vec2[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Vec2[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = p[0];
    const y = p[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x)) continue;
    if (!Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-7 && Math.abs(last[1] - y) < 1e-7) continue;
    out.push([x, y]);
  }
  if (closed && out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) {
      out.pop();
    }
  }
  return out.length >= minLen ? out : null;
}
function prepHillOrBasin(el: Record<string, unknown>): unknown {
  const type = el.type === 'basin' ? 'basin' : 'hill';
  const delta = Math.abs(finiteOr(el.deltaElev, 10));
  let fx = finiteOr(el.focusX, 0);
  let fy = finiteOr(el.focusY, 0);
  const focusLen = Math.hypot(fx, fy);
  if (focusLen > 0.72) {
    fx = (fx / focusLen) * 0.72;
    fy = (fy / focusLen) * 0.72;
  }
  return {
    ...el,
    type,
    rx: Math.max(25, Math.abs(finiteOr(el.rx, 25))),
    ry: Math.max(25, Math.abs(finiteOr(el.ry, 25))),
    deltaElev: type === 'basin' ? -delta : delta,
    focusX: fx,
    focusY: fy,
  };
}
function prepLinearShape(el: Record<string, unknown>): unknown | null {
  const type = el.type === 'valley' ? 'valley' : el.type === 'scarp' ? 'scarp' : 'ridge';
  const points = cleanPointList(el.points, 2, false);
  if (!points) return null;
  const delta = Math.abs(finiteOr(el.deltaElev, 10));
  return {
    ...el,
    type,
    points,
    deltaElev: type === 'valley' ? -delta : delta,
    widthLeft: Math.max(20, Math.abs(finiteOr(el.widthLeft, 60))),
    widthRight: Math.max(20, Math.abs(finiteOr(el.widthRight, 60))),
  };
}
function prepShapes(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const el of raw) {
    if (!isRecord(el)) continue;
    if (el.type === 'hill' || el.type === 'basin') out.push(prepHillOrBasin(el));
    else if (el.type === 'ridge' || el.type === 'valley' || el.type === 'scarp') {
      const made = prepLinearShape(el);
      if (made) out.push(made);
    }
  }
  return out;
}

/** 微雕增量三合一兼容：sculptDeltaB64 > sculptDeltaBase64 > sculptDelta(字符串/数组) */
function extractSculptB64(t: Record<string, unknown>): string {
  const primary = t.sculptDeltaB64;
  if (typeof primary === 'string' && primary.length > 0) return primary;
  const alias = t.sculptDeltaBase64;
  if (typeof alias === 'string' && alias.length > 0) return alias;
  const legacy = t.sculptDelta;
  if (typeof legacy === 'string') return legacy;
  if (legacy instanceof Float32Array) return encodeSculptDeltaFromUnknown(legacy);
  if (Array.isArray(legacy)) {
    const nums = legacy.filter((v): v is number => typeof v === 'number');
    if (nums.length > 0) return encodeSculptDeltaFromUnknown(nums);
  }
  return typeof primary === 'string' ? primary : '';
}
function prepTerrain(raw: unknown): unknown {
  const t = isRecord(raw) ? raw : {};
  return { ...t, shapes: prepShapes(t.shapes), sculptDeltaB64: extractSculptB64(t) };
}
function prepMeta(raw: unknown): unknown {
  const m = isRecord(raw) ? raw : {};
  return { ...m, worldSizeM: Math.max(600, Math.min(8000, finiteOr(m.worldSizeM, 2400))) };
}
function prepRoads(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const el of raw) {
    if (!isRecord(el)) continue;
    const points = cleanPointList(el.points, 2, false);
    if (!points) continue;
    const tier = el.tier === 'highway' ? 'highway' : el.tier === 'lane' ? 'lane' : 'street';
    const fallback = tier === 'highway' ? 14 : tier === 'lane' ? 5 : 9;
    out.push({ ...el, tier, points, widthM: finiteOr(el.widthM, fallback) });
  }
  return out;
}
function prepPointedArray(raw: unknown, minLen: number, closed: boolean): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const el of raw) {
    if (!isRecord(el)) continue;
    const points = cleanPointList(el.points, minLen, closed);
    if (!points) continue;
    out.push({ ...el, points });
  }
  return out;
}

/** 运行期归一化：补齐缺省、清洗点列、约束地形符号与偏心模长、统一微雕字段名 */
export function normalizeProject(rawInput: unknown): TownProject {
  const raw = isRecord(rawInput) ? rawInput : {};
  const prepared: Record<string, unknown> = { ...raw };
  prepared.meta = prepMeta(raw.meta);
  prepared.terrain = prepTerrain(raw.terrain);
  prepared.rivers = prepPointedArray(raw.rivers, 2, false);
  prepared.waterBodies = prepPointedArray(raw.waterBodies, 3, true);
  prepared.canals = prepPointedArray(raw.canals, 2, false);
  prepared.roads = prepRoads(raw.roads);
  prepared.zones = prepPointedArray(raw.zones, 3, true);
  prepared.reefs = Array.isArray(raw.reefs) ? raw.reefs : [];
  prepared.fords = Array.isArray(raw.fords) ? raw.fords : [];
  prepared.landmarks = Array.isArray(raw.landmarks) ? raw.landmarks : [];
  prepared.palette = isRecord(raw.palette) ? raw.palette : {};
  prepared.legend = isRecord(raw.legend) ? raw.legend : {};
  return TownProjectSchema.parse(prepared);
}

export function serializeProject(project: TownProject): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(jsonText: string): TownProject {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = null;
  }
  return normalizeProject(parsed);
}
