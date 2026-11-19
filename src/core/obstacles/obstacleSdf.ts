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
}

const N = OBSTACLE_GRID_N;
const CELLS = N * N;
const INF = 1e6;

function fillDisc(mask: Uint8Array, stepM: number, cx: number, cy: number, radiusM: number): void {
  if (!(radiusM > 0)) return;
  const gx0 = Math.max(0, Math.floor((cx - radiusM) / stepM));
  const gx1 = Math.min(N - 1, Math.ceil((cx + radiusM) / stepM));
  const gy0 = Math.max(0, Math.floor((cy - radiusM) / stepM));
  const gy1 = Math.min(N - 1, Math.ceil((cy + radiusM) / stepM));
  const r2 = radiusM * radiusM;
  for (let gy = gy0; gy <= gy1; gy += 1) {
    const dy = gy * stepM - cy;
    const row = gy * N;
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const dx = gx * stepM - cx;
      if (dx * dx + dy * dy <= r2) mask[row + gx] = 1;
    }
  }
}

function fillPolygon(mask: Uint8Array, stepM: number, poly: Polygon): void {
  const n = poly.length;
  if (n < 3) return;
  const xs: number[] = [];
  for (let gy = 0; gy < N; gy += 1) {
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
    xs.sort((p, q) => p - q);
    const row = gy * N;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] ?? 0) / stepM));
      const to = Math.min(N - 1, Math.floor((xs[k + 1] ?? 0) / stepM));
      for (let gx = from; gx <= to; gx += 1) mask[row + gx] = 1;
    }
  }
}

function strokeSegment(
  mask: Uint8Array,
  stepM: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radiusM: number,
): void {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / Math.max(1e-3, stepM * 0.6)));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    fillDisc(mask, stepM, ax + (bx - ax) * t, ay + (by - ay) * t, radiusM);
  }
}

function strokePolyline(
  mask: Uint8Array,
  stepM: number,
  poly: Polyline,
  radiusM: number,
): void {
  for (let i = 0; i < poly.length - 1; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    if (!a || !b) continue;
    strokeSegment(mask, stepM, a[0], a[1], b[0], b[1], radiusM);
  }
}

function buildSlopeLattice(field: ElevationFieldData): Float32Array {
  const out = new Float32Array(GRID_N * GRID_N);
  const h = field.elevation;
  const step = Math.max(1e-6, field.cellSizeM);
  for (let gy = 0; gy < GRID_N; gy += 1) {
    const y0 = Math.max(0, gy - 1);
    const y1 = Math.min(GRID_N - 1, gy + 1);
    for (let gx = 0; gx < GRID_N; gx += 1) {
      const x0 = Math.max(0, gx - 1);
      const x1 = Math.min(GRID_N - 1, gx + 1);
      const dx = ((h[gy * GRID_N + x1] ?? 0) - (h[gy * GRID_N + x0] ?? 0)) / (2 * step);
      const dy = ((h[y1 * GRID_N + gx] ?? 0) - (h[y0 * GRID_N + gx] ?? 0)) / (2 * step);
      out[gy * GRID_N + gx] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return out;
}

/**
 * 512×512 障碍掩码 + 双遍 Chamfer 欧氏近似距离场。
 * 河岸包络半径取 `max(halfWidths[i], halfWidths[i+1]) + 8.0`（halfWidths 已是半宽，严禁二次乘 0.5），
 * 并将 bankPolygon 内部整片填实，杜绝宽河中心空洞。
 */
export function buildObstacleGrid(input: ObstacleRasterInput): ObstacleGrid {
  const stepM = input.worldSizeM / (N - 1);
  const mask = new Uint8Array(CELLS);

  const slopeLattice = buildSlopeLattice(input.elevationField);
  const ratio = (GRID_N - 1) / (N - 1);
  for (let gy = 0; gy < N; gy += 1) {
    const sy = Math.min(GRID_N - 1, Math.round(gy * ratio));
    const row = gy * N;
    for (let gx = 0; gx < N; gx += 1) {
      const sx = Math.min(GRID_N - 1, Math.round(gx * ratio));
      if ((slopeLattice[sy * GRID_N + sx] ?? 0) > input.globalMaxSlope) mask[row + gx] = 1;
    }
  }

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
    strokePolyline(mask, stepM, [...wb.shorePoly, wb.shorePoly[0] ?? [0, 0]], 8.0);
  }

  for (const zone of input.exclusionPolys) {
    fillPolygon(mask, stepM, zone);
    strokePolyline(mask, stepM, [...zone, zone[0] ?? [0, 0]], 2.0);
  }

  for (const wall of input.walls) {
    strokePolyline(mask, stepM, wall.polyline, 0.5 * wall.thicknessM + 3.0);
  }
  for (const canal of input.canals) {
    strokePolyline(mask, stepM, canal.centerline, 0.5 * canal.widthM + 4.0);
  }
  for (const road of input.roads) {
    strokePolyline(mask, stepM, road.centerline, 0.5 * road.widthM + 2.5);
  }

  const distanceField = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i += 1) distanceField[i] = mask[i] === 1 ? 0 : INF;
  const D1 = 1.0;
  const D2 = 1.4142135;
  for (let gy = 0; gy < N; gy += 1) {
    for (let gx = 0; gx < N; gx += 1) {
      const i = gy * N + gx;
      let d = distanceField[i] ?? INF;
      if (gx > 0) d = Math.min(d, (distanceField[i - 1] ?? INF) + D1);
      if (gy > 0) {
        d = Math.min(d, (distanceField[i - N] ?? INF) + D1);
        if (gx > 0) d = Math.min(d, (distanceField[i - N - 1] ?? INF) + D2);
        if (gx < N - 1) d = Math.min(d, (distanceField[i - N + 1] ?? INF) + D2);
      }
      distanceField[i] = d;
    }
  }
  for (let gy = N - 1; gy >= 0; gy -= 1) {
    for (let gx = N - 1; gx >= 0; gx -= 1) {
      const i = gy * N + gx;
      let d = distanceField[i] ?? INF;
      if (gx < N - 1) d = Math.min(d, (distanceField[i + 1] ?? INF) + D1);
      if (gy < N - 1) {
        d = Math.min(d, (distanceField[i + N] ?? INF) + D1);
        if (gx < N - 1) d = Math.min(d, (distanceField[i + N + 1] ?? INF) + D2);
        if (gx > 0) d = Math.min(d, (distanceField[i + N - 1] ?? INF) + D2);
      }
      distanceField[i] = d;
    }
  }
  for (let i = 0; i < CELLS; i += 1) distanceField[i] = (distanceField[i] ?? INF) * stepM;

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
