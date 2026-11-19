/** 确定性平滑值噪声：2–3 八度，零 Math.random，同一 seed 逐字复现 */
const HASH_A = 374761393;
const HASH_B = 668265263;
const HASH_C = 1442695041;

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * HASH_A + iy * HASH_B + seed * HASH_C) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 单八度双线性平滑值噪声，返回 [0,1] */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

const OCTAVES: ReadonlyArray<readonly [number, number]> = [
  [1 / 210, 1.0],
  [1 / 88, 0.46],
  [1 / 33, 0.18],
];

/**
 * 微地形噪声求值器：世界坐标 -> 高程扰动（米）。
 * 振幅归一到 `ampM`，零振幅或非法参数直接返回零函数，保证纯解析地形可复现。
 */
export function createNoiseEvaluator(
  ampM: number,
  seed: number,
): (wx: number, wy: number) => number {
  const amp = Number.isFinite(ampM) ? Math.max(0, Math.min(12, ampM)) : 0;
  if (amp <= 1e-9) return () => 0;
  const s = Math.round(Number.isFinite(seed) ? seed : 7719) | 0;
  let norm = 0;
  for (const [, weight] of OCTAVES) norm += weight;
  return (wx: number, wy: number): number => {
    let sum = 0;
    for (let i = 0; i < OCTAVES.length; i += 1) {
      const octave = OCTAVES[i];
      if (!octave) continue;
      const [freq, weight] = octave;
      sum += (valueNoise(wx * freq, wy * freq, s + i * 101) - 0.5) * weight;
    }
    return (sum / Math.max(1e-9, norm)) * amp;
  };
}
