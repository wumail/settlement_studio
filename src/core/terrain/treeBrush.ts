import type { Vec2 } from '../../schema/geometry.types';
import { createRng, hashSeed } from '../math/rng';
import type { PaintedTreeKind, TreeGuardView } from '../obstacles/treeGuard';
import { isTreeSpotSafe } from '../obstacles/treeGuard';

export interface TreeScatterOptions {
  readonly radiusM: number;
  /** 撒点间距系数（× 半径），0.75 为方志林盘密度 */
  readonly spacingFactor: number;
  readonly minR: number;
  readonly maxR: number;
  readonly kind: PaintedTreeKind;
  readonly seed: number;
  readonly slopeLimitDeg?: number;
}

export interface ScatteredTree {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly kind: PaintedTreeKind;
}

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * 笔刷圆内确定性撒点（无 Math.random）：沿笔迹等距取样，每点用黄金角螺旋铺冠幅，
 * 冠幅由 seed 派生抖动，逐一过林木守门；已撒树间距不足者自动剔除。
 */
export function scatterTreesAlongStroke(
  from: Vec2,
  to: Vec2,
  view: TreeGuardView,
  options: TreeScatterOptions,
  existing: ReadonlyArray<{ readonly x: number; readonly y: number; readonly r: number }> = [],
): ScatteredTree[] {
  const radiusM = Math.max(6, options.radiusM);
  const spacing = Math.max(4, radiusM * Math.max(0.2, options.spacingFactor));
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.round(dist / spacing));
  const rng = createRng(hashSeed(`tree-brush|${options.seed}`));
  const out: ScatteredTree[] = [];
  const minR = Math.max(2.5, Math.min(options.minR, options.maxR));
  const maxR = Math.max(minR, Math.min(16, options.maxR));
  const slopeLimit = options.slopeLimitDeg ?? 30;

  for (let s = 0; s <= steps; s += 1) {
    const t = steps === 0 ? 0 : s / steps;
    const cx = from[0] + (to[0] - from[0]) * t;
    const cy = from[1] + (to[1] - from[1]) * t;
    const count = Math.max(1, Math.min(14, Math.round((radiusM * radiusM) / (maxR * maxR * 2.6))));
    for (let k = 0; k < count; k += 1) {
      const rr = radiusM * 0.94 * Math.sqrt((k + 0.5) / count);
      const ang = k * GOLDEN_ANGLE + rng() * 0.7;
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const r = minR + (maxR - minR) * rng();
      if (!isTreeSpotSafe(view, x, y, r, options.kind, slopeLimit)) continue;
      let crowded = false;
      for (const prior of existing) {
        if (Math.hypot(prior.x - x, prior.y - y) < (prior.r + r) * 0.55) {
          crowded = true;
          break;
        }
      }
      if (!crowded) {
        for (const made of out) {
          if (Math.hypot(made.x - x, made.y - y) < (made.r + r) * 0.55) {
            crowded = true;
            break;
          }
        }
      }
      if (crowded) continue;
      out.push({ x, y, r, kind: options.kind });
    }
  }
  return out;
}

/** 擦除模式：返回落在任意擦除圆心半径内的既有林木 id（沿笔迹多点调用） */
export function treesWithinBrush(
  trees: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>,
  cx: number,
  cy: number,
  radiusM: number,
): string[] {
  const hit: string[] = [];
  for (const tree of trees) {
    if (Math.hypot(tree.x - cx, tree.y - cy) <= radiusM) hit.push(tree.id);
  }
  return hit;
}
