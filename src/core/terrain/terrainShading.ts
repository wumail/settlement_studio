import { GRID_N, type Polygon, type Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { type ElevationFieldData, sampleGradient } from './elevationField';

/** 分层设色带数（0 低漫滩 → 6 高处砂褐） */
export const TINT_BAND_COUNT = 7;
/** 淡彩网格边长（世界格数）：按等值线斜插边界生成梯形带，彻底消除锯齿方块感 */
const TINT_LATTICE = 96;

/** 在水平线段 (gx0 -> gx1) 上线性插值等高线交点，使淡彩左右端缘贴合等高线斜率 */
function interpCrossingX(
  elevation: Float32Array,
  gx0: number,
  gx1: number,
  gy: number,
  threshold: number,
  cellSizeM: number,
): number {
  const v0 = elevation[gy * GRID_N + gx0] ?? threshold;
  const v1 = elevation[gy * GRID_N + gx1] ?? threshold;
  const denom = v1 - v0;
  const t = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, (threshold - v0) / denom)) : 0.5;
  return (gx0 + (gx1 - gx0) * t) * cellSizeM;
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
 * 高程分层淡彩带：沿每行水平 Run-Length 合并并在色带切换处按等值线线性插值左右斜边，
 * 生成顺等高线贴合的平滑梯形带（无随机方块毛刺），低饱和半透明叠加绝不压死等高线。
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
  const growY = cell * 0.08;
  const growX = cell * 0.06;
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
  const edgeThreshold = (b1: number, b2: number): number =>
    field.minElev + (Math.max(b1, b2) / TINT_BAND_COUNT) * span;
  const flush = (
    band: number,
    prevBand: number,
    nextBand: number,
    gx0: number,
    gx1: number,
    gy: number,
  ): void => {
    const bucket = buckets[band];
    if (!bucket) return;
    const y0 = gy * field.cellSizeM - growY;
    const y1 = (gy + stride) * field.cellSizeM + growY;
    let xLT = gx0 * field.cellSizeM;
    let xLB = xLT;
    if (prevBand >= 0 && gx0 >= stride) {
      const th = edgeThreshold(prevBand, band);
      xLT = interpCrossingX(field.elevation, gx0 - stride, gx0 + stride, gy, th, field.cellSizeM);
      xLB = interpCrossingX(
        field.elevation,
        gx0 - stride,
        gx0 + stride,
        gy + stride,
        th,
        field.cellSizeM,
      );
    }
    let xRT = (gx1 + stride) * field.cellSizeM;
    let xRB = xRT;
    if (nextBand >= 0 && gx1 + stride * 2 <= steps) {
      const th = edgeThreshold(band, nextBand);
      xRT = interpCrossingX(field.elevation, gx1, gx1 + stride * 2, gy, th, field.cellSizeM);
      xRB = interpCrossingX(
        field.elevation,
        gx1,
        gx1 + stride * 2,
        gy + stride,
        th,
        field.cellSizeM,
      );
    }
    bucket.push([
      [xLT - growX, y0],
      [xRT + growX, y0],
      [xRB + growX, y1],
      [xLB - growX, y1],
    ]);
  };
  for (let gy = 0; gy + stride <= steps; gy += stride) {
    let runBand = -1;
    let prevBand = -1;
    let runStart = 0;
    for (let gx = 0; gx + stride <= steps; gx += stride) {
      const band = bandAt(gx, gy);
      if (runBand < 0) {
        runBand = band;
        runStart = gx;
        continue;
      }
      if (band !== runBand) {
        flush(runBand, prevBand, band, runStart, gx - stride, gy);
        prevBand = runBand;
        runBand = band;
        runStart = gx;
      }
    }
    if (runBand >= 0) flush(runBand, prevBand, -1, runStart, steps - stride, gy);
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
