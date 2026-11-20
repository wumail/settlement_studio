import type { MergedCircleItem } from './RenderBackend';

/** 单棵树的世界坐标与冠幅半径（米） */
export interface CanopySeed {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** 展开后的叶瓣圆（世界坐标，米） */
export interface CanopyLobe {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const TWO_PI = Math.PI * 2;

/** 确定性整数哈希（xorshift 混合）：同一棵树在任何视角/轮次展开完全一致，零 Math.random */
export function hash2d(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 由哈希派生第 salt 个 [0,1) 均匀数（彼此独立，避免同棵树的多瓣同相） */
function unit(hash: number, salt: number): number {
  let v = Math.imul(hash ^ Math.imul(salt + 1, 2654435761), 2246822519);
  v = Math.imul(v ^ (v >>> 15), 3266489917);
  return ((v ^ (v >>> 13)) >>> 0) / 4294967296;
}

/**
 * 单棵树 → 非对称扇贝云冠：
 * - r < 3.0m：1 个微偏心核（0.58r）+ 3 片非对称微瓣（off 0.32–0.48r、lobeR 0.34–0.48r，确保 off + lobeR ≤ 0.98r）；
 * - r ≥ 3.0m：1 个微偏心核（0.56r）+ 5 或 6 片非均匀角距叶瓣（形成深凹湾与错落鼓包，杜绝圆球或四叶草），
 *   off = 0.42–0.62r，lobeR = 0.30–0.52r，且严格截断 off + lobeR ≤ 1.04r，叠加 0.72m 描边仍不越安全净空。
 */
export function canopyLobes(seed: CanopySeed): CanopyLobe[] {
  const { x, y, r } = seed;
  const hash = hash2d(Math.round(x * 10), Math.round(y * 10));
  const coreAng = unit(hash, 0) * TWO_PI;
  const coreOff = (r < 3.0 ? 0.06 + unit(hash, 1) * 0.08 : 0.03 + unit(hash, 2) * 0.07) * r;
  const coreR = r * (r < 3.0 ? 0.58 : 0.56);
  const out: CanopyLobe[] = [
    {
      x: x + Math.cos(coreAng) * coreOff,
      y: y + Math.sin(coreAng) * coreOff,
      r: coreR,
    },
  ];
  if (r < 3.0) {
    const baseAng = unit(hash, 3) * TWO_PI;
    const weights = [0, 1, 2].map((k) => 0.55 + unit(hash, 10 + k) * 0.9);
    const totalW = weights[0]! + weights[1]! + weights[2]!;
    let accAng = baseAng;
    for (let k = 0; k < 3; k += 1) {
      const off = (0.32 + unit(hash, 20 + k) * 0.16) * r;
      const rawR = (0.34 + unit(hash, 30 + k) * 0.14) * r;
      const lobeR = Math.min(rawR, 0.98 * r - off);
      out.push({
        x: x + Math.cos(accAng) * off,
        y: y + Math.sin(accAng) * off,
        r: lobeR,
      });
      accAng += (weights[k]! / totalW) * TWO_PI;
    }
    return out;
  }
  const count = unit(hash, 1) < 0.55 ? 5 : 6;
  const baseAng = unit(hash, 3) * TWO_PI;
  const weights: number[] = [];
  let totalW = 0;
  for (let k = 0; k < count; k += 1) {
    const w = 0.42 + unit(hash, 10 + k) * 1.25;
    weights.push(w);
    totalW += w;
  }
  let accAng = baseAng;
  for (let k = 0; k < count; k += 1) {
    const off = (0.42 + unit(hash, 20 + k) * 0.2) * r;
    const rawR = (0.3 + unit(hash, 30 + k) * 0.22) * r;
    const lobeR = Math.min(rawR, 1.04 * r - off);
    out.push({
      x: x + Math.cos(accAng) * off,
      y: y + Math.sin(accAng) * off,
      r: lobeR,
    });
    accAng += (weights[k]! / totalW) * TWO_PI;
  }
  return out;
}

/** 整层树冠 → 单遍圆批次：padM 为该遍的外扩米数（阴影 +0.35 / 轮廓 +0.72 / 绿心 0） */
export function canopyPass(
  lobes: ReadonlyArray<CanopyLobe>,
  padM: number,
  toScreen: (x: number, y: number) => readonly [number, number],
  toPx: (m: number) => number,
  dxM = 0,
  dyM = 0,
): MergedCircleItem[] {
  return lobes.map((lobe) => {
    const c = toScreen(lobe.x + dxM, lobe.y + dyM);
    return { cx: c[0], cy: c[1], r: toPx(lobe.r + padM) };
  });
}
