import type { Vec2 } from '../../schema/geometry.types';
import { pointInPolygon } from '../math/polygon';
import { computeNodeTangents } from '../math/spline';
import type { BuiltRoad } from './reefRoadBridge';
import type { BuiltWaterBody } from './riverCanal';
import { type BuiltBridge, makeDeck } from './bridgeSolver';

/**
 * 干道 × 湖湾/河口木桥：道路两次穿越水岸多边形（进水面 + 出水面）且水面跨度 12–320m 时架桥，
 * 让出城驿道跨河口连到对岸，而不是把路面直接铺在水上。
 */
export function solveWaterBodyBridges(
  roads: ReadonlyArray<BuiltRoad>,
  waterBodies: ReadonlyArray<BuiltWaterBody>,
): BuiltBridge[] {
  const out: BuiltBridge[] = [];
  for (const road of roads) {
    const tans = computeNodeTangents(road.centerline, false);
    for (const wb of waterBodies) {
      if (wb.areaM2 < 4000) continue;
      let enter: Vec2 | null = null;
      for (let i = 0; i < road.centerline.length; i += 1) {
        const p = road.centerline[i];
        if (!p) continue;
        const wet = pointInPolygon(p[0], p[1], wb.shorePoly);
        if (wet && !enter) {
          enter = p;
          continue;
        }
        if (wet || !enter) continue;
        const span = Math.hypot(p[0] - enter[0], p[1] - enter[1]);
        if (span >= 12 && span <= 320) {
          const tangent = tans[i] ?? [1, 0];
          const deck = makeDeck({
            roadId: road.id,
            waterId: wb.id,
            x: (enter[0] + p[0]) * 0.5,
            y: (enter[1] + p[1]) * 0.5,
            tangent,
            widthAcrossM: span + 6,
            deckWidthM: road.widthM + 2.5,
            sinAlpha: 1,
            cosAlpha: 0,
          });
          out.push({ ...deck, id: `wbr_${road.id}_${wb.id}_${out.length}`, style: 'timber', forts: [] });
        }
        enter = null;
      }
    }
  }
  return out;
}
