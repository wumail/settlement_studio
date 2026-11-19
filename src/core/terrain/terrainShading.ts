import { GRID_N, type Polygon, type Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { type ElevationFieldData, sampleGradient } from './elevationField';

/** 分层设色带数（0 低漫滩 → 6 高处砂褐） */
export const TINT_BAND_COUNT = 7;
/** 淡彩网格边长（世界格数）：88 格把色块压到 ~18m 级，肉眼读作水彩晕染而非马赛克 */
const TINT_LATTICE = 88;

/** 角点确定性抖动哈希：同一工程逐帧同值，打散轴对齐方块感 */
function cornerJitter(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix * 374761393 + iy * 668265263 + salt * 1442695041, 1274126177);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296 - 0.5) * 2;
}

export interface TerrainTintBand {
  readonly band: number;
  readonly polygons: ReadonlyArray<Polygon>;
}

export interface TerrainShadingData {
  readonly bands: ReadonlyArray<TerrainTintBand>;
  readonly hachures: ReadonlyArray<readonly [Vec2, Vec2]>;
  readonly minElev: number;
  readonly maxElev: number;
}

const EMPTY: TerrainShadingData = { bands: [], hachures: [], minElev: 0, maxElev: 0 };

/** 西北光照方向（屏幕坐标系 y 向下，指向西北） */
const LIGHT: Vec2 = [-0.7071, -0.7071];

/**
 * 高程分层淡彩带：56×56 网格按均值海拔归入 7 段，同段合并为单批多边形；
 * 每格外扩 4% 消除 Canvas 抗锯齿接缝，低饱和半透明叠加绝不压死等高线。
 */
export function buildHypsometricTint(
  field: ElevationFieldData,
  project: TownProject,
): ReadonlyArray<TerrainTintBand> {
  if (project.terrain.showHypsometricTint === false) return [];
  const span = Math.max(1e-6, field.maxElev - field.minElev);
  const steps = GRID_N - 1;
  const stride = Math.max(1, Math.round(steps / TINT_LATTICE));
  const cell = field.cellSizeM * stride;
  const grow = cell * 0.12;
  const buckets: Polygon[][] = Array.from({ length: TINT_BAND_COUNT }, () => []);
  const bandAt = (gx: number, gy: number): number => {
    const i00 = gy * GRID_N + gx;
    const i10 = gy * GRID_N + gx + stride;
    const i01 = (gy + stride) * GRID_N + gx;
    const i11 = (gy + stride) * GRID_N + gx + stride;
    const avg =
      ((field.elevation[i00] ?? 0) +
        (field.elevation[i10] ?? 0) +
        (field.elevation[i01] ?? 0) +
        (field.elevation[i11] ?? 0)) /
      4;
    const t = Math.max(0, Math.min(0.9999, (avg - field.minElev) / span));
    return Math.floor(t * TINT_BAND_COUNT);
  };
  const amp = cell * 0.16;
  let runSeq = 0;
  const flush = (band: number, gx0: number, gx1: number, gy: number): void => {
    const bucket = buckets[band];
    if (!bucket) return;
    runSeq += 1;
    const jx = (k: number): number => cornerJitter(runSeq, gy, k) * amp;
    const x0 = gx0 * field.cellSizeM - grow;
    const y0 = gy * field.cellSizeM - grow;
    const x1 = gx1 * field.cellSizeM + cell + grow;
    const y1 = y0 + cell + grow * 2;
    bucket.push([
      [x0 + jx(1), y0 + jx(2)],
      [x1 + jx(3), y0 + jx(4)],
      [x1 + jx(5), y1 + jx(6)],
      [x0 + jx(7), y1 + jx(8)],
    ]);
  };
  // 水平 Run-Length 合并：同一行连续同 band 的格并成一条长多边形，
  // 7744 个碎方块压到 ~600 条，SVG/Canvas 指令量与视觉噪点同时骤降。
  for (let gy = 0; gy + stride <= steps; gy += stride) {
    let runBand = -1;
    let runStart = 0;
    for (let gx = 0; gx + stride <= steps; gx += stride) {
      const band = bandAt(gx, gy);
      if (runBand < 0) {
        runBand = band;
        runStart = gx;
        continue;
      }
      if (band !== runBand) {
        flush(runBand, runStart, gx - stride, gy);
        runBand = band;
        runStart = gx;
      }
    }
    if (runBand >= 0) flush(runBand, runStart, steps - stride, gy);
  }
  const out: TerrainTintBand[] = [];
  for (let band = 0; band < TINT_BAND_COUNT; band += 1) {
    const polygons = buckets[band];
    if (polygons && polygons.length > 0) out.push({ band, polygons });
  }
  return out;
}

/**
 * 顺坡晕滃短线：沿等高线采样，仅保留坡度 >= hachureSlopeMinDeg 的点，
 * 沿线法向（-grad 下坡）生成 2.2–4.8m 细短线，西北光照使东南背光坡更密更长。
 */
export function buildHachures(
  field: ElevationFieldData,
  project: TownProject,
  contours: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2> }>,
): ReadonlyArray<readonly [Vec2, Vec2]> {
  const terrain = project.terrain;
  if (terrain.showHachures === false) return [];
  const minDeg = Math.max(1.5, terrain.hachureSlopeMinDeg);
  const out: Array<readonly [Vec2, Vec2]> = [];
  const maxTicks = 6000;
  let total = 0;
  for (const contour of contours) total += contour.points.length;
  const stride = Math.max(1, Math.ceil(total / maxTicks));
  let cursor = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 1) {
      cursor += 1;
      if (cursor % stride !== 0) continue;
      const p = contour.points[i];
      if (!p) continue;
      const g = sampleGradient(field, p[0], p[1]);
      const mag = Math.hypot(g.dzdx, g.dzdy);
      if (mag < 1e-9) continue;
      const slopeDeg = (Math.atan(mag) * 180) / Math.PI;
      if (slopeDeg < minDeg) continue;
      const dx = -g.dzdx / mag;
      const dy = -g.dzdy / mag;
      const facing = dx * LIGHT[0] + dy * LIGHT[1];
      const shade = Math.max(0, Math.min(1, 0.55 - facing * 0.45));
      const len = Math.min(10.5, 4.5 + Math.min(6, (slopeDeg / 26) * 6) * (0.7 + shade * 0.5));
      out.push([
        [p[0], p[1]],
        [p[0] + dx * len, p[1] + dy * len],
      ]);
    }
  }
  return out;
}

export function buildTerrainShading(
  field: ElevationFieldData,
  project: TownProject,
  contours: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2> }>,
): TerrainShadingData {
  if (project.terrain.showHypsometricTint === false && project.terrain.showHachures === false) {
    return EMPTY;
  }
  return {
    bands: buildHypsometricTint(field, project),
    hachures: buildHachures(field, project, contours),
    minElev: field.minElev,
    maxElev: field.maxElev,
  };
}
