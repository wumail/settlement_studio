import type { Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { type ElevationFieldData, sampleSlopeDeg, scanElevationRange } from './elevationField';
import {
  type ContourLine,
  buildCellRange,
  smoothChain,
  traceLevel,
} from './marchingSquares';

/** 裁切后的连续缓坡段：`closed` 仅在全环皆缓坡时保留为真 */
interface GentleRun {
  readonly points: Vec2[];
  readonly closed: boolean;
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/** 开折线顺序扫描：收集全部连续 gentle 子段 */
function runsOfOpen(points: ReadonlyArray<Vec2>, gentle: ReadonlyArray<boolean>): GentleRun[] {
  const out: GentleRun[] = [];
  let cur: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p) continue;
    if (gentle[i] === true) {
      cur.push([p[0], p[1]]);
    } else {
      if (cur.length >= 3) out.push({ points: cur, closed: false });
      cur = [];
    }
  }
  if (cur.length >= 3) out.push({ points: cur, closed: false });
  return out;
}

/**
 * 闭合环裁切：从首个陡坡点之后起按模长整圈扫描，
 * 彻底避免在起点/终点接缝处把同一条缓坡间曲线劈成两截。
 */
function runsOfClosed(points: ReadonlyArray<Vec2>, gentle: ReadonlyArray<boolean>): GentleRun[] {
  const n = points.length;
  const allGentle = gentle.every((flag) => flag);
  if (allGentle) return n >= 4 ? [{ points: points.map((p) => [p[0], p[1]] as Vec2), closed: true }] : [];
  let cut = 0;
  for (let i = 0; i < n; i += 1) {
    if (gentle[i] !== true) {
      cut = i;
      break;
    }
  }
  const out: GentleRun[] = [];
  let cur: Vec2[] = [];
  for (let step = 1; step <= n; step += 1) {
    const i = (cut + step) % n;
    const p = points[i];
    if (!p) continue;
    if (gentle[i] === true) {
      cur.push([p[0], p[1]]);
    } else {
      if (cur.length >= 3) out.push({ points: cur, closed: false });
      cur = [];
    }
  }
  if (cur.length >= 3) out.push({ points: cur, closed: false });
  return out;
}

/**
 * 缓坡半距间曲线提取：仅在 `level = k * step + 0.5 * step` 层追踪等值线，
 * 逐点按 `sampleSlopeDeg <= supplementaryMaxSlopeDeg` 裁切保留连续缓坡段。
 * 陡坡自动隐退，彻底避免陡山糊黑；输出恒标记 `isSupplementary: true` 且不打高程字。
 */
export function extractSupplementaryContours(
  field: ElevationFieldData,
  config: TownProject['terrain'],
): ContourLine[] {
  if (config.showContours === false || config.showSupplementaryContours === false) return [];
  const step = Math.max(1, Math.round(config.contourStep));
  const range = scanElevationRange(field);
  const lo = Math.max(range.min, config.minContourElev);
  const hi = Math.min(range.max, config.maxContourElev);
  if (!(hi > lo)) return [];
  const { min, max } = buildCellRange(field);
  const maxSlope = Math.max(1, Math.min(20, config.supplementaryMaxSlopeDeg));
  const minLength = Math.max(18, 2 * field.cellSizeM);
  const out: ContourLine[] = [];
  let seq = 0;
  for (let k = Math.floor(lo / step) - 1; k <= Math.ceil(hi / step); k += 1) {
    const level = k * step + 0.5 * step;
    if (level < lo || level > hi) continue;
    for (const chain of traceLevel(field, level, min, max)) {
      const smoothed = smoothChain(chain.pts, chain.closed);
      if (smoothed.length < 3) continue;
      const gentle = smoothed.map((p) => sampleSlopeDeg(field, p[0], p[1]) <= maxSlope);
      const runs = chain.closed ? runsOfClosed(smoothed, gentle) : runsOfOpen(smoothed, gentle);
      for (const run of runs) {
        if (polylineLength(run.points) < minLength) continue;
        seq += 1;
        out.push({
          id: `cts_${k}_${seq}`,
          elev: Math.round(level * 1000) / 1000,
          isIndex: false,
          isSupplementary: true,
          closed: run.closed,
          points: run.points,
        });
      }
    }
  }
  return out;
}
