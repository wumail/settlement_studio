import { GRID_N } from '../../schema/geometry.types';
import type { SculptBrushMode } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { encodeSculptDelta } from '../math/sculptCodecs';
import {
  type ElevationFieldData,
  sampleElevation,
  sampleGradient,
} from './elevationField';
import { type ContourLine, extractContours } from './marchingSquares';

export interface ContourHit {
  readonly contourId: string;
  readonly elev: number;
  readonly x: number;
  readonly y: number;
  readonly dist: number;
}

export interface ContourDragInput {
  readonly prevX: number;
  readonly prevY: number;
  readonly currX: number;
  readonly currY: number;
  readonly lockedElev: number;
  readonly radiusM: number;
  readonly strength: number;
}

export interface SculptBrushInput {
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly strength: number;
  readonly mode: SculptBrushMode;
  readonly flattenTargetElev: number;
}

export interface ContourWarpOutput {
  readonly sculptDeltaB64: string;
  readonly contours: ContourLine[];
}

export type SculptBrushOutput = ContourWarpOutput;

const MAX_SUB_STEPS = 24;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hitTestContourLine(
  contours: ReadonlyArray<ContourLine>,
  wx: number,
  wy: number,
  toleranceM: number,
): ContourHit | null {
  let best: ContourHit | null = null;
  for (const contour of contours) {
    const pts = contour.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 1e-18) {
        t = clamp(((wx - a[0]) * dx + (wy - a[1]) * dy) / len2, 0, 1);
      }
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const dist = Math.hypot(wx - px, wy - py);
      if (dist > toleranceM) continue;
      if (best !== null && dist >= best.dist) continue;
      best = { contourId: contour.id, elev: contour.elev, x: px, y: py, dist };
    }
  }
  return best;
}

interface KernelSpec {
  readonly cx: number;
  readonly cy: number;
  readonly radiusM: number;
  readonly sigma: number;
}

/** 余弦归零高斯核：边界一阶连续归零，半径外严格零增量 */
function applyRadialKernel(
  field: ElevationFieldData,
  spec: KernelSpec,
  deltaCenter: number,
): void {
  const { cx, cy, radiusM, sigma } = spec;
  if (!(radiusM > 0) || !Number.isFinite(deltaCenter) || deltaCenter === 0) return;
  const cell = field.cellSizeM;
  const gx0 = Math.max(0, Math.floor((cx - radiusM) / cell));
  const gx1 = Math.min(GRID_N - 1, Math.ceil((cx + radiusM) / cell));
  const gy0 = Math.max(0, Math.floor((cy - radiusM) / cell));
  const gy1 = Math.min(GRID_N - 1, Math.ceil((cy + radiusM) / cell));
  const twoSigma2 = 2 * sigma * sigma;
  const edgeBase = Math.exp(-(radiusM * radiusM) / twoSigma2);
  const invDen = 1 / Math.max(1e-9, 1 - edgeBase);
  const r2Max = radiusM * radiusM;

  for (let gy = gy0; gy <= gy1; gy += 1) {
    const wy = gy * cell;
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const wx = gx * cell;
      const dx = wx - cx;
      const dy = wy - cy;
      const r2 = dx * dx + dy * dy;
      if (r2 > r2Max) continue;
      const r = Math.sqrt(r2);
      const gaussian = (Math.exp(-r2 / twoSigma2) - edgeBase) * invDen;
      const cosine = 0.5 * (1 + Math.cos((Math.PI * r) / radiusM));
      const w = gaussian * cosine;
      if (!(w > 0)) continue;
      const idx = gy * GRID_N + gx;
      const delta = deltaCenter * w;
      field.sculptDelta[idx] = (field.sculptDelta[idx] ?? 0) + delta;
      field.elevation[idx] = (field.elevation[idx] ?? 0) + delta;
    }
  }
}

/**
 * 等高线跟手推拉：路径子步 <= 24 + 梯度自适应限幅 + 余弦归零高斯核。
 * 始终作用于单值标量场再重新提取水平集，数学上零 8 字打结自交、零跨高程相交。
 */
export function applyContourWarpDrag(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  dragCtx: ContourDragInput,
): ContourWarpOutput {
  const radiusM = Math.max(6, dragCtx.radiusM);
  const sigma = radiusM / 2.2;
  const subStepLen = Math.max(4.0, sigma * 0.28);
  const moveDist = Math.hypot(dragCtx.currX - dragCtx.prevX, dragCtx.currY - dragCtx.prevY);
  const rawSteps = Math.ceil(moveDist / subStepLen);
  const steps = clamp(Number.isFinite(rawSteps) ? rawSteps : 1, 1, MAX_SUB_STEPS);
  const contourStep = Math.max(1, terrainConfig.contourStep);
  const strength = clamp(dragCtx.strength, 0, 4);

  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const px = dragCtx.prevX + (dragCtx.currX - dragCtx.prevX) * t;
    const py = dragCtx.prevY + (dragCtx.currY - dragCtx.prevY) * t;
    const currentH = sampleElevation(field, px, py);
    const g = sampleGradient(field, px, py);
    const gradMag = Math.hypot(g.dzdx, g.dzdy);
    const rawDiff = (dragCtx.lockedElev - currentH) * strength;
    const maxStep = Math.max(
      contourStep * 0.45,
      Math.min(contourStep * 2.0, 0.45 * sigma * Math.max(gradMag, 0.05)),
    );
    const deltaCenter = clamp(rawDiff, -maxStep, maxStep);
    applyRadialKernel(field, { cx: px, cy: py, radiusM, sigma }, deltaCenter);
  }

  return {
    sculptDeltaB64: encodeSculptDelta(field.sculptDelta),
    contours: extractContours(field, terrainConfig),
  };
}

interface BrushWindow {
  readonly gx0: number;
  readonly gy0: number;
  readonly cols: number;
  readonly rows: number;
  readonly snapshot: Float32Array;
}

function snapshotWindow(field: ElevationFieldData, x: number, y: number, radiusM: number): BrushWindow {
  const cell = field.cellSizeM;
  const gx0 = Math.max(0, Math.floor((x - radiusM) / cell));
  const gx1 = Math.min(GRID_N - 1, Math.ceil((x + radiusM) / cell));
  const gy0 = Math.max(0, Math.floor((y - radiusM) / cell));
  const gy1 = Math.min(GRID_N - 1, Math.ceil((y + radiusM) / cell));
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
  [-1, -1, 1],
  [0, -1, 2],
  [1, -1, 1],
  [-1, 0, 2],
  [0, 0, 4],
  [1, 0, 2],
  [-1, 1, 1],
  [0, 1, 2],
  [1, 1, 1],
];

function laplacianAverage(win: BrushWindow, lx: number, ly: number): number {
  let sum = 0;
  for (const [dx, dy, wgt] of LAPLACIAN_KERNEL) {
    sum += snapshotAt(win, lx + dx, ly + dy) * wgt;
  }
  return sum / 16;
}

/** 四模式微雕笔刷：raise / lower / smooth / flatten，径向 `(1 - r^2/R^2)^2` 平滑核 */
export function applySculptBrush(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  brushCtx: SculptBrushInput,
): SculptBrushOutput {
  const radiusM = Math.max(4, brushCtx.radiusM);
  const strength = clamp(brushCtx.strength, 0, 4);
  const contourStep = Math.max(1, terrainConfig.contourStep);
  const cell = field.cellSizeM;
  const gx0 = Math.max(0, Math.floor((brushCtx.x - radiusM) / cell));
  const gx1 = Math.min(GRID_N - 1, Math.ceil((brushCtx.x + radiusM) / cell));
  const gy0 = Math.max(0, Math.floor((brushCtx.y - radiusM) / cell));
  const gy1 = Math.min(GRID_N - 1, Math.ceil((brushCtx.y + radiusM) / cell));
  const snap = brushCtx.mode === 'smooth' ? snapshotWindow(field, brushCtx.x, brushCtx.y, radiusM) : null;
  const r2Max = radiusM * radiusM;

  for (let gy = gy0; gy <= gy1; gy += 1) {
    const wy = gy * cell;
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const wx = gx * cell;
      const dx = wx - brushCtx.x;
      const dy = wy - brushCtx.y;
      const r2 = dx * dx + dy * dy;
      if (r2 > r2Max) continue;
      const u = 1 - r2 / r2Max;
      const w = u * u;
      if (!(w > 0)) continue;
      const idx = gy * GRID_N + gx;
      const current = field.elevation[idx] ?? 0;
      let delta = 0;
      if (brushCtx.mode === 'raise') {
        delta = contourStep * 0.65 * strength * w;
      } else if (brushCtx.mode === 'lower') {
        delta = -contourStep * 0.65 * strength * w;
      } else if (brushCtx.mode === 'flatten') {
        delta = (brushCtx.flattenTargetElev - current) * (0.45 * strength * w);
      } else if (snap) {
        const lx = gx - snap.gx0;
        const ly = gy - snap.gy0;
        const lapAvg = laplacianAverage(snap, lx, ly);
        delta = (lapAvg - current) * (0.65 * strength * w);
      }
      if (!Number.isFinite(delta) || delta === 0) continue;
      field.sculptDelta[idx] = (field.sculptDelta[idx] ?? 0) + delta;
      field.elevation[idx] = current + delta;
    }
  }

  return {
    sculptDeltaB64: encodeSculptDelta(field.sculptDelta),
    contours: extractContours(field, terrainConfig),
  };
}
