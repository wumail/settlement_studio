import { GRID_N, GRID_POINT_COUNT } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { decodeSculptDelta } from '../math/sculptCodecs';
import {
  createMacroReliefEvaluator,
  createNoiseEvaluator,
  resolveMacroReliefAmp,
  resolveOrganicStrength,
  resolveValleyCarveRatio,
} from './terrainNoise';
import {
  createLinearEvaluator,
  createRiverValleyCarver,
  evalBaseSlope,
  evalHillOrBasin,
  type RiverValleyCarver,
  type RiverValleySample,
  type ShapeEvaluator,
} from './terrainPrimitives';

export interface ElevationFieldData {
  readonly gridN: 257;
  readonly worldSizeM: number;
  readonly cellSizeM: number;
  readonly elevation: Float32Array;
  readonly sculptDelta: Float32Array;
  readonly minElev: number;
  readonly maxElev: number;
}

export function buildElevationField(project: TownProject): ElevationFieldData {
  const terrain = project.terrain;
  const worldSizeM = project.meta.worldSizeM;
  const cellSizeM = worldSizeM / (GRID_N - 1);
  const elevation = new Float32Array(GRID_POINT_COUNT);
  const sculptDelta = decodeSculptDelta(terrain.sculptDeltaB64, GRID_POINT_COUNT);
  const organic = resolveOrganicStrength(terrain.terrainNoiseAmpM);
  const shapeEvals: ShapeEvaluator[] = terrain.shapes.map((shape) =>
    shape.type === 'hill' || shape.type === 'basin'
      ? (wx: number, wy: number) => evalHillOrBasin(shape, wx, wy, organic, terrain.terrainSeed)
      : createLinearEvaluator(shape, organic, terrain.terrainSeed),
  );
  const macroAmp = resolveMacroReliefAmp(terrain);
  const valleyRatio = resolveValleyCarveRatio(terrain);
  const carvers: RiverValleyCarver[] = project.rivers.map((river) =>
    createRiverValleyCarver(river, valleyRatio),
  );
  const macro = createMacroReliefEvaluator(macroAmp, worldSizeM, terrain.terrainSeed);
  const noise = createNoiseEvaluator(terrain.terrainNoiseAmpM, terrain.terrainSeed);
  const riverSample: RiverValleySample = { carve: 0, flatten: 0 };

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  for (let gy = 0; gy < GRID_N; gy += 1) {
    const wy = gy * cellSizeM;
    const rowBase = gy * GRID_N;
    for (let gx = 0; gx < GRID_N; gx += 1) {
      const wx = gx * cellSizeM;
      let h =
        terrain.baseElev +
        evalBaseSlope(wx, wy, worldSizeM, terrain.slopeMagM, terrain.slopeDirDeg);
      let shapeH = 0;
      for (const ev of shapeEvals) shapeH += ev(wx, wy);
      let carve = 0;
      let flatten = 0;
      for (const carver of carvers) {
        carver(wx, wy, riverSample);
        if (riverSample.carve > carve) carve = riverSample.carve;
        if (riverSample.flatten > flatten) flatten = riverSample.flatten;
      }
      if (flatten > 0 && shapeH > 0) shapeH *= 1 - flatten;
      h += shapeH + macro(wx, wy) + noise(wx, wy);
      const idx = rowBase + gx;
      h += (sculptDelta[idx] ?? 0) - carve;
      elevation[idx] = h;
      if (h < minElev) minElev = h;
      if (h > maxElev) maxElev = h;
    }
  }
  return {
    gridN: GRID_N,
    worldSizeM,
    cellSizeM,
    elevation,
    sculptDelta,
    minElev: Number.isFinite(minElev) ? minElev : terrain.baseElev,
    maxElev: Number.isFinite(maxElev) ? maxElev : terrain.baseElev,
  };
}

function elevAt(field: ElevationFieldData, gx: number, gy: number): number {
  return field.elevation[gy * GRID_N + gx] ?? 0;
}

export function sampleElevation(field: ElevationFieldData, wx: number, wy: number): number {
  const maxIdx = GRID_N - 1;
  const gx = Math.max(0, Math.min(maxIdx, wx / field.cellSizeM));
  const gy = Math.max(0, Math.min(maxIdx, wy / field.cellSizeM));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v00 = elevAt(field, x0, y0);
  const v10 = elevAt(field, Math.min(maxIdx, x0 + 1), y0);
  const v01 = elevAt(field, x0, Math.min(maxIdx, y0 + 1));
  const v11 = elevAt(field, Math.min(maxIdx, x0 + 1), Math.min(maxIdx, y0 + 1));
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

export function sampleGradient(
  field: ElevationFieldData,
  wx: number,
  wy: number,
): { dzdx: number; dzdy: number } {
  const h = field.cellSizeM;
  return {
    dzdx: (sampleElevation(field, wx + h, wy) - sampleElevation(field, wx - h, wy)) / (2 * h),
    dzdy: (sampleElevation(field, wx, wy + h) - sampleElevation(field, wx, wy - h)) / (2 * h),
  };
}

export function sampleSlopeDeg(field: ElevationFieldData, wx: number, wy: number): number {
  const g = sampleGradient(field, wx, wy);
  return Math.atan(Math.hypot(g.dzdx, g.dzdy)) * (180 / Math.PI);
}

/** 场数组实时极值（微雕后 min/max 会漂移，提取等高线前应以本函数为准） */
export function scanElevationRange(field: ElevationFieldData): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const data = field.elevation;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    min: Number.isFinite(min) ? min : field.minElev,
    max: Number.isFinite(max) ? max : field.maxElev,
  };
}
