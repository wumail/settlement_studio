import { GRID_N } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { encodeSculptDelta } from '../math/sculptCodecs';
import { type ElevationFieldData, sampleElevation, sampleGradient } from './elevationField';
import { type ContourLine, extractContours } from './marchingSquares';
import { brushFootprint, clamp01, plateauWeight } from './brushKernel';
import { applySculptDab, hardnessOf, type SculptBrushInput } from './sculptDab';

export type { SculptBrushInput } from './sculptDab';

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

export interface SculptApplyOptions {
  /** 拖拽期间为 true：绝不调用 encodeSculptDelta（零每帧 Base64 编码） */
  readonly skipEncode?: boolean;
  /** 拖拽期间为 false：跳过全图等高线提取，仅在 pointerup 统一重算 */
  readonly skipContours?: boolean;
}

export interface SculptBrushOutput {
  readonly sculptDeltaB64: string;
  readonly contours: ContourLine[];
}

export type ContourWarpOutput = SculptBrushOutput;

const MAX_SUB_STEPS = 24;

let encodeCount = 0;

/** 诊断计数器：单测据此断言 pointermove 阶段零次 Base64 编码 */
export function sculptEncodeCount(): number {
  return encodeCount;
}

function encodeOnce(field: ElevationFieldData): string {
  encodeCount += 1;
  return encodeSculptDelta(field.sculptDelta);
}

/** 松手唯一编码入口：pointerup / blur 时调用一次，其它阶段一律 skipEncode */
export function encodeSculptField(field: ElevationFieldData): string {
  return encodeOnce(field);
}

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
  const { gx0, gx1, gy0, gy1 } = brushFootprint(field, cx, cy, radiusM);
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
  options: SculptApplyOptions = {},
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
    sculptDeltaB64: options.skipEncode === true ? '' : encodeOnce(field),
    contours: options.skipContours === true ? [] : extractContours(field, terrainConfig),
  };
}

/** 单点微雕：七模式（ramp 为拉道模式，落笔无增量，仅拖拽预览） */
export function applySculptBrush(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  brushCtx: SculptBrushInput,
  options: SculptApplyOptions = {},
): SculptBrushOutput {
  applySculptDab(field, terrainConfig, brushCtx);
  return {
    sculptDeltaB64: options.skipEncode === true ? '' : encodeOnce(field),
    contours: options.skipContours === true ? [] : extractContours(field, terrainConfig),
  };
}

export interface RampStrokeInput {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly startElev: number;
  readonly endElev: number;
  readonly radiusM: number;
  readonly hardness?: number;
  readonly strength?: number;
}

/** 斜坡拉道：沿 A->B 一次拉出线性过渡带，法向按硬度平顶核衰减 */
export function applyRampStroke(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  ramp: RampStrokeInput,
  options: SculptApplyOptions = {},
): SculptBrushOutput {
  const radiusM = Math.max(4, ramp.radiusM);
  const hardness = hardnessOf(ramp.hardness);
  const strength = clamp(ramp.strength ?? 1, 0, 2);
  const ax = ramp.a[0];
  const ay = ramp.a[1];
  const bx = ramp.b[0];
  const by = ramp.b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const cell = field.cellSizeM;
  const gx0 = Math.max(0, Math.floor((Math.min(ax, bx) - radiusM) / cell));
  const gx1 = Math.min(GRID_N - 1, Math.ceil((Math.max(ax, bx) + radiusM) / cell));
  const gy0 = Math.max(0, Math.floor((Math.min(ay, by) - radiusM) / cell));
  const gy1 = Math.min(GRID_N - 1, Math.ceil((Math.max(ay, by) + radiusM) / cell));

  for (let gy = gy0; gy <= gy1; gy += 1) {
    const wy = gy * cell;
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const wx = gx * cell;
      let t = 0;
      if (len2 > 1e-12) {
        t = clamp01(((wx - ax) * dx + (wy - ay) * dy) / len2);
      }
      const px = ax + dx * t;
      const py = ay + dy * t;
      const dist = Math.hypot(wx - px, wy - py);
      if (dist > radiusM) continue;
      const w = plateauWeight(dist / radiusM, hardness);
      if (!(w > 0)) continue;
      const target = ramp.startElev + (ramp.endElev - ramp.startElev) * t;
      const idx = gy * GRID_N + gx;
      const current = field.elevation[idx] ?? 0;
      const delta = (target - current) * clamp01(w * strength);
      if (!Number.isFinite(delta) || delta === 0) continue;
      field.sculptDelta[idx] = (field.sculptDelta[idx] ?? 0) + delta;
      field.elevation[idx] = current + delta;
    }
  }

  return {
    sculptDeltaB64: options.skipEncode === true ? '' : encodeOnce(field),
    contours: options.skipContours === true ? [] : extractContours(field, terrainConfig),
  };
}

/** 等距弧长插值：spacing = max(3, 0.22R)，单步增量按步长比例归一化，杜绝断珠与叠爆 */
export function applySculptStrokeSegment(
  field: ElevationFieldData,
  terrainConfig: TownProject['terrain'],
  from: readonly [number, number],
  to: readonly [number, number],
  brushCtx: SculptBrushInput,
  options: SculptApplyOptions = {},
): SculptBrushOutput {
  const radiusM = Math.max(4, brushCtx.radiusM);
  const spacing = Math.max(3.0, radiusM * 0.22);
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (dist < 1e-6) {
    applySculptDab(field, terrainConfig, brushCtx);
  } else {
    const steps = Math.max(1, Math.round(dist / spacing));
    const stepLen = dist / steps;
    const gain = clamp(stepLen / spacing, 0.2, 1.0);
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      applySculptDab(field, terrainConfig, {
        ...brushCtx,
        x: from[0] + (to[0] - from[0]) * t,
        y: from[1] + (to[1] - from[1]) * t,
        strength: brushCtx.strength * gain,
      });
    }
  }
  return {
    sculptDeltaB64: options.skipEncode === true ? '' : encodeOnce(field),
    contours: options.skipContours === true ? [] : extractContours(field, terrainConfig),
  };
}
