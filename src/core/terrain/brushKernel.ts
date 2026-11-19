import { GRID_N } from '../../schema/geometry.types';
import type { ElevationFieldData } from './elevationField';

export interface BrushFootprint {
  readonly gx0: number;
  readonly gy0: number;
  readonly gx1: number;
  readonly gy1: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 硬度平顶衰减核：u = r / R，h = clamp(hardness, 0, 0.95) 内恒 1，其余 (1 - t²)² 平滑归零 */
export function plateauWeight(u: number, hardness: number): number {
  const h = Math.max(0, Math.min(0.95, Number.isFinite(hardness) ? hardness : 0));
  if (u <= h) return 1;
  if (u >= 1) return 0;
  const t = (u - h) / (1 - h);
  const s = 1 - t * t;
  return s * s;
}

/** 笔刷影响矩形（世界网格索引闭区间），越界自动夹紧到 257 网格 */
export function brushFootprint(
  field: ElevationFieldData,
  x: number,
  y: number,
  radiusM: number,
): BrushFootprint {
  const cell = field.cellSizeM;
  return {
    gx0: Math.max(0, Math.floor((x - radiusM) / cell)),
    gx1: Math.min(GRID_N - 1, Math.ceil((x + radiusM) / cell)),
    gy0: Math.max(0, Math.floor((y - radiusM) / cell)),
    gy1: Math.min(GRID_N - 1, Math.ceil((y + radiusM) / cell)),
  };
}

/** 足印内的径向权重（含硬度平顶），半径外严格 0 */
export function weightAt(
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  radiusM: number,
  hardness: number,
): number {
  const dx = wx - cx;
  const dy = wy - cy;
  const r2 = dx * dx + dy * dy;
  const r2Max = radiusM * radiusM;
  if (r2 > r2Max) return 0;
  return plateauWeight(Math.sqrt(r2) / radiusM, hardness);
}

/** 单次笔刷参数（七模式共用） */
export interface BrushParams {
  readonly radiusM: number;
  readonly strength: number;
  readonly hardness: number;
}
