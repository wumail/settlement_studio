import { z } from 'zod';
import { encodeSculptDeltaFromUnknown } from '../core/math/sculptCodecs';
import { SCHEMA_VERSION, type Vec2 } from './geometry.types';
import {
  CanalSchema,
  FordSchema,
  LandmarkSchema,
  MetaSchema,
  ReefSchema,
  RiverSchema,
  RoadSchema,
  TerrainConfigSchema,
  WaterBodySchema,
  ZoneSchema,
} from './entity.schema';
import { LegendConfigSchema } from './legend.schema';
import { PaletteConfigSchema } from './palette.schema';
import {
  BridgeOverrideSchema,
  CustomStructureSchema,
  DockSchema,
  PaintedTreeSchema,
  WatermillSchema,
  WeirSchema,
} from './v3.entity.schema';

/** 19 大顶层主键完整契约（V1.2 / V2.0 旧文件经 .default() 补齐 V3 六类实体） */
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
  weirs: z.array(WeirSchema).default([]),
  docks: z.array(DockSchema).default([]),
  watermills: z.array(WatermillSchema).default([]),
  structures: z.array(CustomStructureSchema).default([]),
  bridgeOverrides: z.array(BridgeOverrideSchema).default([]),
  paintedTrees: z.array(PaintedTreeSchema).default([]),
});

export type TownProject = z.infer<typeof TownProjectSchema>;
export type ProjectRiver = TownProject['rivers'][number];
export type { ProjectZone, TerrainConfig, TerrainShape } from './entity.schema';
export { TerrainConfigSchema, TerrainShapeSchema, ZONE_CONTENT_TYPES } from './entity.schema';
export type { ZoneContentType } from './entity.schema';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function isPoint(v: unknown): v is Vec2 {
  return (
    Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
  );
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
function prepZones(raw: unknown): unknown[] {
  return prepPointedArray(raw, 3, true).map((item) => {
    const zone = item as Record<string, unknown>;
    const spine = cleanPointList(zone.ribbonSpine, 2, false);
    return { ...zone, ribbonSpine: spine ?? [] };
  });
}
function prepWeirs(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((el): el is Record<string, unknown> => isRecord(el) && isPoint(el.pStart) && isPoint(el.pEnd));
}
function prepPlaced(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((el): el is Record<string, unknown> => isRecord(el) && isPoint([el.x, el.y]));
}
function prepPaintedTrees(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const el of raw) {
    if (!isRecord(el) || !isPoint([el.x, el.y])) continue;
    out.push({ ...el, r: Math.max(2.5, Math.min(16, finiteOr(el.r, 5.5))) });
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
  prepared.zones = prepZones(raw.zones);
  prepared.reefs = Array.isArray(raw.reefs) ? raw.reefs : [];
  prepared.fords = Array.isArray(raw.fords) ? raw.fords : [];
  prepared.landmarks = Array.isArray(raw.landmarks) ? raw.landmarks : [];
  prepared.palette = isRecord(raw.palette) ? raw.palette : {};
  prepared.legend = isRecord(raw.legend) ? raw.legend : {};
  prepared.weirs = prepWeirs(raw.weirs);
  prepared.docks = prepPlaced(raw.docks);
  prepared.watermills = prepPlaced(raw.watermills);
  prepared.structures = prepPlaced(raw.structures);
  prepared.bridgeOverrides = prepPlaced(raw.bridgeOverrides);
  prepared.paintedTrees = prepPaintedTrees(raw.paintedTrees);
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
