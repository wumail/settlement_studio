import type { Polygon, Vec2 } from '../../schema/geometry.types';
import type { ProjectBridgeOverride } from '../../schema/v3.entity.schema';
import { intersectSegmentsExact } from '../math/polygon';
import { computeNodeTangents } from '../math/spline';
import { makeDeck } from './bridgeDeck';
import type { BuiltRoad } from './reefRoadBridge';
import type { BuiltCanal, BuiltRiver } from './riverCanal';

export { type DeckSpec, makeDeck } from './bridgeDeck';

export type BridgeStyle = 'stone_arch' | 'timber' | 'fortified_twin' | 'ford';

export interface BuiltFort {
  readonly polygon: Polygon;
  readonly center: Vec2;
  readonly angleDeg: number;
}

export interface BuiltBridge {
  readonly id: string;
  readonly roadId: string;
  readonly riverId: string;
  readonly canalId?: string;
  readonly x: number;
  readonly y: number;
  readonly tangent: Vec2;
  readonly normal: Vec2;
  readonly angleDeg: number;
  readonly riverWidthM: number;
  readonly lengthM: number;
  readonly widthM: number;
  readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
  readonly parapetLeft: readonly [Vec2, Vec2];
  readonly parapetRight: readonly [Vec2, Vec2];
  readonly abutments: ReadonlyArray<readonly [Vec2, Vec2]>;
  readonly style: BridgeStyle;
  readonly forts: ReadonlyArray<BuiltFort>;
}

export interface FordCrossing {
  readonly id: string;
  readonly fordId: string;
  readonly roadId: string;
  readonly riverId: string;
  readonly x: number;
  readonly y: number;
  readonly tangent: Vec2;
  readonly normal: Vec2;
  readonly riverWidthM: number;
  readonly radiusM: number;
}

export interface FordSource {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
}

/** 斜交河桥：35m 弧长去重、fords 浅滩豁免、两端取较大河宽避免桥角悬水 */
export function solveRiverBridges(
  roads: ReadonlyArray<BuiltRoad>,
  rivers: ReadonlyArray<BuiltRiver>,
  fords: ReadonlyArray<FordSource>,
): { bridges: BuiltBridge[]; fordCrossings: FordCrossing[] } {
  const bridges: BuiltBridge[] = [];
  const fordCrossings: FordCrossing[] = [];
  const lastAlong = new Map<string, number>();

  for (const road of roads) {
    const tans = computeNodeTangents(road.centerline, false);
    for (let i = 0; i < road.centerline.length - 1; i += 1) {
      const a = road.centerline[i];
      const b = road.centerline[i + 1];
      if (!a || !b) continue;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const river of rivers) {
        for (let j = 0; j < river.centerline.length - 1; j += 1) {
          const c = river.centerline[j];
          const d = river.centerline[j + 1];
          if (!c || !d) continue;
          const hit = intersectSegmentsExact(a, b, c, d);
          if (!hit) continue;
          const alongM = (road.cumLen[i] ?? 0) + segLen * hit.t;
          const key = `${road.id}|${river.id}`;
          const prev = lastAlong.get(key);
          if (prev !== undefined && Math.abs(alongM - prev) < 35) continue;
          lastAlong.set(key, alongM);
          const rSegLen = Math.hypot(d[0] - c[0], d[1] - c[1]);
          const uRiver = river.totalLen > 1e-9
            ? ((river.cumLen[j] ?? 0) + rSegLen * hit.u) / river.totalLen
            : 0;
          const tangent = tans[i] ?? [1, 0];
          const normal: Vec2 = [-tangent[1], tangent[0]];
          const rdx = rSegLen > 1e-9 ? (d[0] - c[0]) / rSegLen : 1;
          const rdy = rSegLen > 1e-9 ? (d[1] - c[1]) / rSegLen : 0;
          const ford = fords.find((f) => Math.hypot(hit.x - f.x, hit.y - f.y) <= f.radiusM);
          if (ford) {
            fordCrossings.push({
              id: `fc_${road.id}_${river.id}_${fordCrossings.length}`,
              fordId: ford.id,
              roadId: road.id,
              riverId: river.id,
              x: hit.x,
              y: hit.y,
              tangent,
              normal,
              riverWidthM: river.widthAtU(uRiver),
              radiusM: ford.radiusM,
            });
            continue;
          }
          const sinAlpha = Math.abs(tangent[0] * rdy - tangent[1] * rdx);
          const cosAlpha = Math.abs(tangent[0] * rdx + tangent[1] * rdy);
          const deckWidth = road.widthM + 3.0;
          const sinSafe = Math.max(0.35, sinAlpha);
          const skewDriftM = (0.5 * deckWidth * cosAlpha) / sinSafe;
          const skewSpanM = ((river.widthAtU(uRiver) * 0.5 + 4.0) * cosAlpha) / sinSafe;
          const spanHalfU = (river.widthAtU(uRiver) * 0.5 + 4.0 + skewDriftM + skewSpanM) / Math.max(1, river.totalLen);
          const bridgeRiverWidth = Math.max(
            river.widthAtU(uRiver - spanHalfU),
            river.widthAtU(uRiver + spanHalfU),
          );
          const deck = makeDeck({
            roadId: road.id, waterId: river.id, x: hit.x, y: hit.y, tangent,
            widthAcrossM: bridgeRiverWidth, deckWidthM: deckWidth, sinAlpha, cosAlpha,
          });
          bridges.push({
            ...deck,
            id: `br_${road.id}_${river.id}_${bridges.length}`,
            style: 'stone_arch',
            forts: [],
          });
        }
      }
    }
  }
  return { bridges, fordCrossings };
}

/** 干道 × 明渠石板小桥：qanat 与 < 3.5m 细渠不架桥，避免暗渠口被盖死 */
export function solveCanalBridges(
  roads: ReadonlyArray<BuiltRoad>,
  canals: ReadonlyArray<BuiltCanal>,
): BuiltBridge[] {
  const out: BuiltBridge[] = [];
  const lastAlong = new Map<string, number>();
  for (const road of roads) {
    const tans = computeNodeTangents(road.centerline, false);
    for (let i = 0; i < road.centerline.length - 1; i += 1) {
      const a = road.centerline[i];
      const b = road.centerline[i + 1];
      if (!a || !b) continue;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const canal of canals) {
        if (canal.style === 'qanat' || canal.widthM < 3.5) continue;
        for (let j = 0; j < canal.centerline.length - 1; j += 1) {
          const c = canal.centerline[j];
          const d = canal.centerline[j + 1];
          if (!c || !d) continue;
          const hit = intersectSegmentsExact(a, b, c, d);
          if (!hit) continue;
          const alongM = (road.cumLen[i] ?? 0) + segLen * hit.t;
          const key = `${road.id}|${canal.id}`;
          const prev = lastAlong.get(key);
          if (prev !== undefined && Math.abs(alongM - prev) < 25) continue;
          lastAlong.set(key, alongM);
          const cSegLen = Math.hypot(d[0] - c[0], d[1] - c[1]);
          const tangent = tans[i] ?? [1, 0];
          const cdx = cSegLen > 1e-9 ? (d[0] - c[0]) / cSegLen : 1;
          const cdy = cSegLen > 1e-9 ? (d[1] - c[1]) / cSegLen : 0;
          const sinAlpha = Math.abs(tangent[0] * cdy - tangent[1] * cdx);
          const cosAlpha = Math.abs(tangent[0] * cdx + tangent[1] * cdy);
          const deck = makeDeck({
            roadId: road.id, waterId: canal.id, canalId: canal.id, x: hit.x, y: hit.y, tangent,
            widthAcrossM: canal.widthM + 1.2, deckWidthM: road.widthM + 1.8, sinAlpha, cosAlpha,
          });
          out.push({
            ...deck,
            id: `cbr_${road.id}_${canal.id}_${out.length}`,
            style: canal.widthM >= 6 ? 'stone_arch' : 'timber',
            forts: [],
          });
        }
      }
    }
  }
  return out;
}

function fortPair(bridge: BuiltBridge, sizeM: number): BuiltFort[] {
  const half = bridge.lengthM * 0.5 + sizeM * 0.42;
  const list: BuiltFort[] = [];
  for (const sign of [-1, 1]) {
    const cx = bridge.x + bridge.tangent[0] * half * sign;
    const cy = bridge.y + bridge.tangent[1] * half * sign;
    const h = sizeM * 0.5;
    list.push({
      center: [cx, cy],
      angleDeg: bridge.angleDeg,
      polygon: [
        [cx - h, cy - h],
        [cx + h, cy - h],
        [cx + h, cy + h],
        [cx - h, cy + h],
      ],
    });
  }
  return list;
}

/** 桥梁覆写匹配：35m 内最近桥位按覆盖写入风格，fortified_twin 生双桥头堡，ford 降级为渡口 */
export function applyBridgeOverrides(
  bridges: ReadonlyArray<BuiltBridge>,
  overrides: ReadonlyArray<ProjectBridgeOverride>,
  fordCrossings: ReadonlyArray<FordCrossing>,
): { bridges: BuiltBridge[]; fordCrossings: FordCrossing[] } {
  const out = bridges.map((b) => ({ ...b }));
  const fords = [...fordCrossings];
  for (const override of overrides) {
    let bestIndex = -1;
    let bestDist = 35;
    for (let i = 0; i < out.length; i += 1) {
      const bridge = out[i];
      if (!bridge) continue;
      const dist = Math.hypot(bridge.x - override.x, bridge.y - override.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) continue;
    const target = out[bestIndex];
    if (!target) continue;
    if (override.style === 'ford') {
      fords.push({
        id: `fc_override_${override.id}`,
        fordId: override.id,
        roadId: target.roadId,
        riverId: target.riverId,
        x: target.x,
        y: target.y,
        tangent: target.tangent,
        normal: target.normal,
        riverWidthM: target.riverWidthM,
        radiusM: Math.max(14, override.fortSizeM * 0.6),
      });
      out.splice(bestIndex, 1);
      continue;
    }
    out[bestIndex] = {
      ...target,
      style: override.style,
      widthM: override.widthM ?? target.widthM,
      forts: override.style === 'fortified_twin' ? fortPair(target, override.fortSizeM) : [],
    };
  }
  return { bridges: out, fordCrossings: fords };
}
