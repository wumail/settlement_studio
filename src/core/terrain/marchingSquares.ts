import { GRID_N, type Polyline, type Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import {
  type ElevationFieldData,
  buildElevationField,
  sampleGradient,
  sampleSlopeDeg,
  scanElevationRange,
} from './elevationField';

export interface ContourLine {
  readonly id: string;
  readonly elev: number;
  readonly isIndex: boolean;
  readonly closed: boolean;
  readonly points: Polyline;
}

export interface ScarpTickSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface TerrainPackage {
  readonly terrainData: ElevationFieldData;
  readonly contours: ReadonlyArray<ContourLine>;
  readonly scarpTicks: ReadonlyArray<ScarpTickSegment>;
  readonly minElev: number;
  readonly maxElev: number;
}

type EdgePair = readonly [number, number];

const CELLS = GRID_N - 1;
const TICK_SPACING_M = 22;
const TICK_LENGTH_M = 4.0;

/** 16 状态边对表（0 顶 / 1 右 / 2 底 / 3 左），鞍点 5 与 10 由中心均值现场消歧 */
const EDGE_PAIRS: ReadonlyArray<ReadonlyArray<EdgePair>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [],
  [[1, 2]],
  [[1, 3]],
  [[0, 1]],
  [[3, 0]],
  [],
];

interface RawSegment {
  readonly ka: string;
  readonly kb: string;
  readonly pa: Vec2;
  readonly pb: Vec2;
}

function buildCellRange(field: ElevationFieldData): { min: Float32Array; max: Float32Array } {
  const h = field.elevation;
  const min = new Float32Array(CELLS * CELLS);
  const max = new Float32Array(CELLS * CELLS);
  for (let gy = 0; gy < CELLS; gy += 1) {
    const row = gy * GRID_N;
    const nextRow = (gy + 1) * GRID_N;
    for (let gx = 0; gx < CELLS; gx += 1) {
      const v0 = h[row + gx] ?? 0;
      const v1 = h[row + gx + 1] ?? 0;
      const v2 = h[nextRow + gx + 1] ?? 0;
      const v3 = h[nextRow + gx] ?? 0;
      const ci = gy * CELLS + gx;
      min[ci] = Math.min(v0, v1, v2, v3);
      max[ci] = Math.max(v0, v1, v2, v3);
    }
  }
  return { min, max };
}

function lerpEdge(level: number, va: number, vb: number): number {
  const den = vb - va;
  if (Math.abs(den) < 1e-12) return 0.5;
  return Math.max(0, Math.min(1, (level - va) / den));
}

/** 单层水平集追踪：边键哈希拼接为连续长折线（闭合环或图幅边界开折线） */
function traceLevel(
  field: ElevationFieldData,
  level: number,
  cellMin: Float32Array,
  cellMax: Float32Array,
): Array<{ pts: Vec2[]; closed: boolean }> {
  const cell = field.cellSizeM;
  const h = field.elevation;
  const segs: RawSegment[] = [];

  for (let gy = 0; gy < CELLS; gy += 1) {
    const row = gy * GRID_N;
    const nextRow = (gy + 1) * GRID_N;
    for (let gx = 0; gx < CELLS; gx += 1) {
      const ci = gy * CELLS + gx;
      if ((cellMax[ci] ?? -Infinity) < level) continue;
      if ((cellMin[ci] ?? Infinity) >= level) continue;

      const v0 = h[row + gx] ?? 0;
      const v1 = h[row + gx + 1] ?? 0;
      const v2 = h[nextRow + gx + 1] ?? 0;
      const v3 = h[nextRow + gx] ?? 0;
      let mask = 0;
      if (v0 >= level) mask |= 1;
      if (v1 >= level) mask |= 2;
      if (v2 >= level) mask |= 4;
      if (v3 >= level) mask |= 8;
      if (mask === 0 || mask === 15) continue;

      const x0 = gx * cell;
      const y0 = gy * cell;
      const keys = [`H_${gx}_${gy}`, `V_${gx + 1}_${gy}`, `H_${gx}_${gy + 1}`, `V_${gx}_${gy}`];
      const pointAt = (e: number): Vec2 => {
        if (e === 0) return [x0 + cell * lerpEdge(level, v0, v1), y0];
        if (e === 1) return [x0 + cell, y0 + cell * lerpEdge(level, v1, v2)];
        if (e === 2) return [x0 + cell * lerpEdge(level, v3, v2), y0 + cell];
        return [x0, y0 + cell * lerpEdge(level, v0, v3)];
      };
      const emit = (ea: number, eb: number): void => {
        const ka = keys[ea];
        const kb = keys[eb];
        if (!ka || !kb) return;
        segs.push({ ka, kb, pa: pointAt(ea), pb: pointAt(eb) });
      };

      if (mask === 5 || mask === 10) {
        const high = 0.25 * (v0 + v1 + v2 + v3) >= level;
        if (mask === 5) {
          emit(3, high ? 2 : 0);
          emit(high ? 0 : 1, high ? 1 : 2);
        } else {
          emit(high ? 3 : 0, high ? 0 : 1);
          emit(high ? 1 : 3, high ? 2 : 2);
        }
      } else {
        for (const pair of EDGE_PAIRS[mask] ?? []) emit(pair[0], pair[1]);
      }
    }
  }

  const adj = new Map<string, number[]>();
  for (let s = 0; s < segs.length; s += 1) {
    const seg = segs[s];
    if (!seg) continue;
    for (const key of [seg.ka, seg.kb]) {
      const list = adj.get(key);
      if (list) list.push(s);
      else adj.set(key, [s]);
    }
  }

  const used = new Uint8Array(segs.length);
  const walk = (startKey: string, pts: Vec2[], prepend: boolean): string => {
    let key = startKey;
    for (;;) {
      const list = adj.get(key);
      if (!list) break;
      let next = -1;
      for (const cand of list) {
        if (used[cand] === 1) continue;
        next = cand;
        break;
      }
      if (next < 0) break;
      const seg = segs[next];
      if (!seg) break;
      used[next] = 1;
      const fromA = seg.ka === key;
      const pt = fromA ? seg.pb : seg.pa;
      if (prepend) pts.unshift([pt[0], pt[1]]);
      else pts.push([pt[0], pt[1]]);
      key = fromA ? seg.kb : seg.ka;
    }
    return key;
  };

  const chains: Array<{ pts: Vec2[]; closed: boolean }> = [];
  for (let s = 0; s < segs.length; s += 1) {
    if (used[s] === 1) continue;
    const seed = segs[s];
    if (!seed) continue;
    used[s] = 1;
    const pts: Vec2[] = [
      [seed.pa[0], seed.pa[1]],
      [seed.pb[0], seed.pb[1]],
    ];
    const tailKey = walk(seed.kb, pts, false);
    const headKey = walk(seed.ka, pts, true);
    const closed = headKey === tailKey;
    if (closed && pts.length > 1) pts.pop();
    chains.push({ pts, closed });
  }
  return chains;
}

function smoothChain(pts: Vec2[], closed: boolean): Vec2[] {
  let cur = pts;
  for (let round = 0; round < 2; round += 1) {
    const n = cur.length;
    if (n < 3) return cur;
    const next: Vec2[] = [];
    for (let i = 0; i < n; i += 1) {
      const p = cur[i];
      if (!p) continue;
      const a = cur[(i - 1 + n) % n];
      const b = cur[(i + 1) % n];
      if (!closed && (i === 0 || i === n - 1)) next.push([p[0], p[1]]);
      else if (!a || !b) next.push([p[0], p[1]]);
      else next.push([0.2 * a[0] + 0.6 * p[0] + 0.2 * b[0], 0.2 * a[1] + 0.6 * p[1] + 0.2 * b[1]]);
    }
    if (next.length !== n) return cur;
    cur = next;
  }
  return cur;
}

export function extractContours(
  field: ElevationFieldData,
  config: TownProject['terrain'],
): ContourLine[] {
  if (config.showContours === false) return [];
  const step = Math.max(1, Math.round(config.contourStep));
  const indexEvery = Math.max(1, Math.round(config.indexEvery));
  const range = scanElevationRange(field);
  const lo = Math.max(range.min, config.minContourElev);
  const hi = Math.min(range.max, config.maxContourElev);
  if (!(hi > lo)) return [];

  const { min, max } = buildCellRange(field);
  const out: ContourLine[] = [];
  let seq = 0;
  for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k += 1) {
    const level = k * step;
    if (level < lo || level > hi) continue;
    for (const chain of traceLevel(field, level, min, max)) {
      if (chain.closed ? chain.pts.length < 4 : chain.pts.length < 2) continue;
      const smoothed = smoothChain(chain.pts, chain.closed);
      if (chain.closed ? smoothed.length < 4 : smoothed.length < 2) continue;
      seq += 1;
      out.push({
        id: `ct_${k}_${seq}`,
        elev: Math.round(level * 1000) / 1000,
        isIndex: k % indexEvery === 0,
        closed: chain.closed,
        points: smoothed,
      });
    }
  }
  return out;
}

/** 陡坎短齿线：默认关闭零输出；开启时仅沿计曲线每 22m 生成长 4.0m 的下坡细短线 */
export function extractScarpTicks(
  contours: ReadonlyArray<ContourLine>,
  field: ElevationFieldData,
  config: TownProject['terrain'],
): ScarpTickSegment[] {
  if (config.showScarpTicks !== true) return [];
  const threshold = config.scarpSlopeThresholdDeg;
  const ticks: ScarpTickSegment[] = [];
  for (const contour of contours) {
    if (!contour.isIndex) continue;
    const pts = contour.points;
    let acc = 0;
    let nextAt = TICK_SPACING_M;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-9) continue;
      while (nextAt <= acc + segLen) {
        const t = (nextAt - acc) / segLen;
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        if (sampleSlopeDeg(field, px, py) >= threshold) {
          const g = sampleGradient(field, px, py);
          const gn = Math.hypot(g.dzdx, g.dzdy);
          if (gn > 1e-6) {
            ticks.push({
              x1: px,
              y1: py,
              x2: px + (TICK_LENGTH_M * -g.dzdx) / gn,
              y2: py + (TICK_LENGTH_M * -g.dzdy) / gn,
            });
          }
        }
        nextAt += TICK_SPACING_M;
      }
      acc += segLen;
    }
  }
  return ticks;
}

export function buildTerrainPackage(project: TownProject): TerrainPackage {
  const terrainData = buildElevationField(project);
  const contours = extractContours(terrainData, project.terrain);
  const scarpTicks = extractScarpTicks(contours, terrainData, project.terrain);
  return {
    terrainData,
    contours,
    scarpTicks,
    minElev: terrainData.minElev,
    maxElev: terrainData.maxElev,
  };
}
