import type { CompiledSceneBase, Vec2 } from '../schema/geometry.types';
import { type ElevationFieldData, sampleElevation } from '../core/terrain/elevationField';

/** 测距读数：距离 · 高差 · 坡度（无高程场的 Node 导出降级为纯距离） */
export function measureLabel(
  scene: CompiledSceneBase | null,
  segment: readonly [Vec2, Vec2] | null,
): string | null {
  if (!segment) return null;
  const [a, b] = segment;
  const field = (scene as { terrain?: { terrainData?: ElevationFieldData } } | null)?.terrain?.terrainData;
  const distM = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dz = field ? sampleElevation(field, b[0], b[1]) - sampleElevation(field, a[0], a[1]) : 0;
  const slopeDeg = distM > 1e-6 ? (Math.atan2(dz, distM) * 180) / Math.PI : 0;
  return `${distM.toFixed(0)} m · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(1)} m · ${slopeDeg.toFixed(1)}°`;
}
