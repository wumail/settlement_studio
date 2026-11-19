export type RngFn = () => number;

export function hashSeed(input: string | number | null | undefined): number {
  const str = String(input === undefined || input === null ? 1 : input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h === 0 ? 1 : h) >>> 0;
}

export function createRng(seed: number | string): RngFn {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (a === 0) a = 1;
  return function nextFloat(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uidSeq = 0;

export function createUid(prefix: string, rngOrIndex?: RngFn | number): string {
  const cleanPrefix = prefix.trim().length > 0 ? prefix.trim() : 'id';
  uidSeq += 1;
  if (typeof rngOrIndex === 'function') {
    const token = Math.floor(rngOrIndex() * 1679616).toString(36);
    return `${cleanPrefix}_${token}${uidSeq.toString(36)}`;
  }
  const n =
    typeof rngOrIndex === 'number' && Number.isFinite(rngOrIndex)
      ? Math.floor(rngOrIndex)
      : uidSeq;
  return `${cleanPrefix}_${n.toString(36)}`;
}

/** 在 [min, max) 区间内取确定性整数，绝不引入隐式全局随机源 */
export function rngInt(rng: RngFn, min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo));
}

/** 在 [min, max) 区间内取确定性浮点数 */
export function rngRange(rng: RngFn, min: number, max: number): number {
  return min + rng() * (max - min);
}
