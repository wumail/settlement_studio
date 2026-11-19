import { GRID_N } from '../../schema/geometry.types';
import type { SculptBrushMode } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import type { ElevationFieldData } from './elevationField';
import { brushFootprint, plateauWeight } from './brushKernel';

/** 单点落笔参数（七模式共用） */
export interface SculptBrushInput {
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly strength: number;
  readonly mode: SculptBrushMode;
  readonly flattenTargetElev: number;
  readonly hardness?: number;
  readonly terraceStepM?: number;
  readonly baseElev?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hardnessOf(v?: number): number {
  return clamp(v ?? 0.35, 0, 0.95);
}

interface BrushWindow {
  readonly gx0: number;
  readonly gy0: number;
  readonly cols: number;
  readonly rows: number;
  readonly snapshot: Float32Array;
}

function snapshotWindow(field: ElevationFieldData, x: number, y: number, radiusM: number): BrushWindow {
  const { gx0, gx1, gy0, gy1 } = brushFootprint(field, x, y, radiusM);
  const cols = gx1 - gx0 + 1;
  const rows = gy1 - gy0 + 1;
  const snapshot = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = (gy0 + gy) * GRID_N + (gx0 + gx);
      snapshot[gy * cols + gx] = field.elevation[idx] ?? 0;
    }
  }
  return { gx0, gy0, cols, rows, snapshot };
}

function snapshotAt(win: BrushWindow, lx: number, ly: number): number {
  const cx = Math.max(0, Math.min(win.cols - 1, lx));
  const cy = Math.max(0, Math.min(win.rows - 1, ly));
  return win.snapshot[cy * win.cols + cx] ?? 0;
}

const LAPLACIAN_KERNEL: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, 1], [0, -1, 2], [1, -1, 1],
  [-1, 0, 2], [0, 0, 4], [1, 0, 2],
  [-1, 1, 1], [0, 1, 2], [1, 1, 1],
];

function laplacianAverage(win: BrushWindow, lx: number, ly: number): number {
  let sum = 0;
  for (const [dx, dy, wgt] of LAPLACIAN_KERNEL) {
    sum += snapshotAt(win, lx + dx, ly + dy) * wgt;
  }
  return sum / 16;
}

/** 单点落笔：七种模式共用硬度平顶核，返回是否产生有效增量 */
export function applySculptDab(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  brush: SculptBrushInput,
): boolean {
  const mode = brush.mode;
  if (mode === 'ramp') return false;
  const radiusM = Math.max(4, brush.radiusM);
  const strength = clamp(brush.strength, 0, 4);
  const hardness = hardnessOf(brush.hardness);
  const contourStep = Math.max(1, terrainConfig.contourStep);
  const baseElev = brush.baseElev ?? terrainConfig.baseElev;
  const terraceStep = Math.max(1, brush.terraceStepM ?? 5);
  const cell = field.cellSizeM;
  const { gx0, gx1, gy0, gy1 } = brushFootprint(field, brush.x, brush.y, radiusM);
  const snap = mode === 'smooth' ? snapshotWindow(field, brush.x, brush.y, radiusM) : null;
  const r2Max = radiusM * radiusM;
  let touched = false;

  for (let gy = gy0; gy <= gy1; gy += 1) {
    const wy = gy * cell;
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const wx = gx * cell;
      const dx = wx - brush.x;
      const dy = wy - brush.y;
      const r2 = dx * dx + dy * dy;
      if (r2 > r2Max) continue;
      const w = plateauWeight(Math.sqrt(r2) / radiusM, hardness);
      if (!(w > 0)) continue;
      const idx = gy * GRID_N + gx;
      const current = field.elevation[idx] ?? 0;
      let delta = 0;
      if (mode === 'raise') {
        delta = contourStep * 0.65 * strength * w;
      } else if (mode === 'lower') {
        delta = -contourStep * 0.65 * strength * w;
      } else if (mode === 'flatten') {
        delta = (brush.flattenTargetElev - current) * (0.45 * strength * w);
      } else if (mode === 'terrace') {
        const target = Math.round((current - baseElev) / terraceStep) * terraceStep + baseElev;
        delta = (target - current) * (0.35 * strength * w);
      } else if (mode === 'erase') {
        const delta0 = field.sculptDelta[idx] ?? 0;
        delta = -delta0 * Math.min(1, 0.85 * strength * w);
      } else if (snap) {
        const lapAvg = laplacianAverage(snap, gx - snap.gx0, gy - snap.gy0);
        delta = (lapAvg - current) * (0.65 * strength * w);
      }
      if (!Number.isFinite(delta) || delta === 0) continue;
      field.sculptDelta[idx] = (field.sculptDelta[idx] ?? 0) + delta;
      field.elevation[idx] = current + delta;
      touched = true;
    }
  }
  return touched;
}

