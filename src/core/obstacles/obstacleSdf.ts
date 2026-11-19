import { GRID_N, OBSTACLE_GRID_N, type Polygon, type Polyline } from '../../schema/geometry.types';
import type { BuiltCanal, BuiltRiver, BuiltWaterBody } from '../hydro/riverCanal';
import type { BuiltRoad } from '../hydro/reefRoadBridge';
import type { ElevationFieldData } from '../terrain/elevationField';

export interface ObstacleGrid {
  readonly gridN: number;
  readonly worldSizeM: number;
  readonly stepM: number;
  readonly blockedMask: Uint8Array;
  readonly distanceField: Float32Array;
}

export interface WallRasterInput {
  readonly thicknessM: number;
  readonly polyline: Polyline;
}

export interface ObstacleRasterInput {
  readonly worldSizeM: number;
  readonly elevationField: ElevationFieldData;
  readonly globalMaxSlope: number;
  readonly rivers: ReadonlyArray<BuiltRiver>;
  readonly waterBodies: ReadonlyArray<BuiltWaterBody>;
  readonly canals: ReadonlyArray<BuiltCanal>;
  readonly roads: ReadonlyArray<BuiltRoad>;
  readonly walls: ReadonlyArray<WallRasterInput>;
  readonly exclusionPolys: ReadonlyArray<Polygon>;
  /** V3 刚性足印：分水堰、码头岸坪、水力工坊、核心建筑、双桥头堡、水门门洞 */
  readonly rigidPolys?: ReadonlyArray<Polygon>;
}

const N = OBSTACLE_GRID_N;
const CELLS = N * N;
const INF = 1e6;
const SX_LUT = (() => {
  const lut = new Int32Array(N);
  const ratio = (GRID_N - 1) / (N - 1);
  for (let gx = 0; gx < N; gx += 1) lut[gx] = Math.min(GRID_N - 1, Math.round(gx * ratio));
  return lut;
})();

function fillDisc(mask: Uint8Array, stepM: number, cx: number, cy: number, radiusM: number): void {
  if (!(radiusM > 0)) return;
  const invStep = 1 / stepM;
  const gy0 = Math.max(0, Math.ceil((cy - radiusM) * invStep));
  const gy1 = Math.min(N - 1, Math.floor((cy + radiusM) * invStep));
  const r2 = radiusM * radiusM;
  for (let gy = gy0; gy <= gy1; gy += 1) {
    const dy = gy * stepM - cy;
    const rem = r2 - dy * dy;
    if (rem < 0) continue;
    const span = Math.sqrt(rem);
    const gx0 = Math.max(0, Math.ceil((cx - span) * invStep));
    const gx1 = Math.min(N - 1, Math.floor((cx + span) * invStep));
    if (gx0 <= gx1) mask.fill(1, gy * N + gx0, gy * N + gx1 + 1);
  }
}

function fillPolygon(mask: Uint8Array, stepM: number, poly: Polygon): void {
  const n = poly.length;
  if (n < 3) return;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const py = poly[i]?.[1];
    if (py === undefined) continue;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minY)) return;
  const invStep = 1 / stepM;
  const gy0 = Math.max(0, Math.floor(minY * invStep));
  const gy1 = Math.min(N - 1, Math.ceil(maxY * invStep));
  const xs: number[] = [];
  for (let gy = gy0; gy <= gy1; gy += 1) {
    const y = gy * stepM;
    xs.length = 0;
    for (let i = 0; i < n; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (!a || !b) continue;
      if ((a[1] <= y) === (b[1] <= y)) continue;
      const den = b[1] - a[1];
      if (Math.abs(den) < 1e-12) continue;
      xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / den);
    }
    if (xs.length < 2) continue;
    if (xs.length > 2) xs.sort((p, q) => p - q);
    else if ((xs[0] as number) > (xs[1] as number)) {
      const tmp = xs[0] as number;
      xs[0] = xs[1] as number;
      xs[1] = tmp;
    }
    const row = gy * N;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] as number) * invStep));
      const to = Math.min(N - 1, Math.floor((xs[k + 1] as number) * invStep));
      if (from <= to) mask.fill(1, row + from, row + to + 1);
    }
  }
}

function strokePolyline(mask: Uint8Array, stepM: number, poly: Polyline, radiusM: number, closed = false): void {
  const n = poly.length;
  const count = closed ? n : n - 1;
  const stride = Math.max(1e-3, Math.max(stepM * 0.6, radiusM * 0.45));
  for (let i = 0; i < count; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stride));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      fillDisc(mask, stepM, a[0] + dx * t, a[1] + dy * t, radiusM);
    }
  }
}

/** 以 tan²(maxSlope) 阈值直接判陡，免去 66049 次 atan + hypot 昂贵三角调用；无陡格时直接跳过上采样 */
function fillSteepIntoMask(
  mask: Uint8Array,
  field: ElevationFieldData,
  maxSlopeDeg: number,
): void {
  const h = field.elevation;
  const inv2Step = 0.5 / Math.max(1e-6, field.cellSizeM);
  const tanMax = Math.tan((Math.min(89, Math.max(0, maxSlopeDeg)) * Math.PI) / 180);
  const limit2 = tanMax * tanMax;
  const steep = new Uint8Array(GRID_N * GRID_N);
  let anySteep = false;
  for (let gy = 0; gy < GRID_N; gy += 1) {
    const y0 = gy > 0 ? gy - 1 : 0;
    const y1 = gy < GRID_N - 1 ? gy + 1 : GRID_N - 1;
    const row = gy * GRID_N;
    const row0 = y0 * GRID_N;
    const row1 = y1 * GRID_N;
    for (let gx = 0; gx < GRID_N; gx += 1) {
      const x0 = gx > 0 ? gx - 1 : 0;
      const x1 = gx < GRID_N - 1 ? gx + 1 : GRID_N - 1;
      const dx = ((h[row + x1] as number) - (h[row + x0] as number)) * inv2Step;
      const dy = ((h[row1 + gx] as number) - (h[row0 + gx] as number)) * inv2Step;
      if (dx * dx + dy * dy > limit2) {
        steep[row + gx] = 1;
        anySteep = true;
      }
    }
  }
  if (!anySteep) return;
  for (let gy = 0; gy < N; gy += 1) {
    const sy = (SX_LUT[gy] as number) * GRID_N;
    const row = gy * N;
    for (let gx = 0; gx < N; gx += 1) {
      if (steep[sy + (SX_LUT[gx] as number)] === 1) mask[row + gx] = 1;
    }
  }
}

/** 拆边双遍 Chamfer 距离变换（直接以米制步长递推，内圈零边界分支，免去第三遍乘法） */
function computeChamferDistance(mask: Uint8Array, stepM: number): Float32Array {
  const df = new Float32Array(CELLS);
  df.fill(INF * stepM);
  for (let i = 0; i < CELLS; i += 1) if (mask[i] === 1) df[i] = 0;
  const d1 = stepM;
  const d2 = stepM * 1.4142135;
  const last = N - 1;
  for (let gx = 1; gx < N; gx += 1) {
    const v = (df[gx - 1] as number) + d1;
    if (v < (df[gx] as number)) df[gx] = v;
  }
  for (let gy = 1; gy < N; gy += 1) {
    const row = gy * N;
    const prev = row - N;
    let d = df[row] as number;
    if (d > 0) {
      d = Math.min(d, (df[prev] as number) + d1, (df[prev + 1] as number) + d2);
      df[row] = d;
    }
    for (let gx = 1; gx < last; gx += 1) {
      const i = row + gx;
      d = df[i] as number;
      if (d === 0) continue;
      let v = (df[i - 1] as number) + d1;
      if (v < d) d = v;
      v = (df[prev + gx] as number) + d1;
      if (v < d) d = v;
      v = (df[prev + gx - 1] as number) + d2;
      if (v < d) d = v;
      v = (df[prev + gx + 1] as number) + d2;
      if (v < d) d = v;
      df[i] = d;
    }
    const iEnd = row + last;
    d = df[iEnd] as number;
    if (d > 0) {
      df[iEnd] = Math.min(d, (df[iEnd - 1] as number) + d1, (df[prev + last] as number) + d1, (df[prev + last - 1] as number) + d2);
    }
  }
  const lastRow = last * N;
  for (let gx = last - 1; gx >= 0; gx -= 1) {
    const v = (df[lastRow + gx + 1] as number) + d1;
    if (v < (df[lastRow + gx] as number)) df[lastRow + gx] = v;
  }
  for (let gy = last - 1; gy >= 0; gy -= 1) {
    const row = gy * N;
    const next = row + N;
    const iEnd = row + last;
    let d = df[iEnd] as number;
    if (d > 0) {
      df[iEnd] = Math.min(d, (df[next + last] as number) + d1, (df[next + last - 1] as number) + d2);
    }
    for (let gx = last - 1; gx >= 1; gx -= 1) {
      const i = row + gx;
      d = df[i] as number;
      if (d === 0) continue;
      let v = (df[i + 1] as number) + d1;
      if (v < d) d = v;
      v = (df[next + gx] as number) + d1;
      if (v < d) d = v;
      v = (df[next + gx + 1] as number) + d2;
      if (v < d) d = v;
      v = (df[next + gx - 1] as number) + d2;
      if (v < d) d = v;
      df[i] = d;
    }
    d = df[row] as number;
    if (d > 0) {
      df[row] = Math.min(d, (df[row + 1] as number) + d1, (df[next] as number) + d1, (df[next + 1] as number) + d2);
    }
  }
  return df;
}

/**
 * 512×512 障碍掩码 + 双遍 Chamfer 欧氏近似距离场。
 * 河岸包络半径取 `max(halfWidths[i], halfWidths[i+1]) + 8.0`（halfWidths 已是半宽，严禁二次乘 0.5），
 * 并将 bankPolygon 内部整片填实，杜绝宽河中心空洞。
 */
export function buildObstacleGrid(input: ObstacleRasterInput): ObstacleGrid {
  const stepM = input.worldSizeM / (N - 1);
  const mask = new Uint8Array(CELLS);

  fillSteepIntoMask(mask, input.elevationField, input.globalMaxSlope);

  for (const river of input.rivers) {
    fillPolygon(mask, stepM, river.bankPolygon);
    const hw = river.halfWidths;
    for (let i = 0; i < river.centerline.length; i += 1) {
      const p = river.centerline[i];
      if (!p) continue;
      const r = Math.max(hw[i] ?? 0, hw[i + 1] ?? hw[i] ?? 0) + 8.0;
      fillDisc(mask, stepM, p[0], p[1], r);
    }
  }

  for (const wb of input.waterBodies) {
    fillPolygon(mask, stepM, wb.shorePoly);
    strokePolyline(mask, stepM, wb.shorePoly, 8.0, true);
  }
  for (const zone of input.exclusionPolys) {
    fillPolygon(mask, stepM, zone);
    strokePolyline(mask, stepM, zone, 2.0, true);
  }
  for (const wall of input.walls) {
    strokePolyline(mask, stepM, wall.polyline, 0.5 * wall.thicknessM + 3.0);
  }
  for (const rigid of input.rigidPolys ?? []) {
    fillPolygon(mask, stepM, rigid);
    strokePolyline(mask, stepM, rigid, 1.5, true);
  }
  for (const canal of input.canals) {
    strokePolyline(mask, stepM, canal.centerline, 0.5 * canal.widthM + 4.0);
  }
  for (const road of input.roads) {
    strokePolyline(mask, stepM, road.centerline, 0.5 * road.widthM + 2.5);
  }

  const distanceField = computeChamferDistance(mask, stepM);

  return { gridN: N, worldSizeM: input.worldSizeM, stepM, blockedMask: mask, distanceField };
}

export function sampleObstacleClearance(
  grid: ObstacleGrid,
  worldSizeM: number,
  wx: number,
  wy: number,
): number {
  const stepM = worldSizeM / (grid.gridN - 1);
  const maxIdx = grid.gridN - 1;
  const gx = Math.max(0, Math.min(maxIdx, wx / stepM));
  const gy = Math.max(0, Math.min(maxIdx, wy / stepM));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(maxIdx, x0 + 1);
  const y1 = Math.min(maxIdx, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const g = grid.gridN;
  const v00 = grid.distanceField[y0 * g + x0] ?? 0;
  const v10 = grid.distanceField[y0 * g + x1] ?? 0;
  const v01 = grid.distanceField[y1 * g + x0] ?? 0;
  const v11 = grid.distanceField[y1 * g + x1] ?? 0;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** 障碍栅格内是否被完全封堵（供守卫快速判定中心点落入河湖/干道/禁建圈） */
export function isBlockedAt(grid: ObstacleGrid, worldSizeM: number, wx: number, wy: number): boolean {
  const stepM = worldSizeM / (grid.gridN - 1);
  const gx = Math.max(0, Math.min(grid.gridN - 1, Math.round(wx / stepM)));
  const gy = Math.max(0, Math.min(grid.gridN - 1, Math.round(wy / stepM)));
  return grid.blockedMask[gy * grid.gridN + gx] === 1;
}
