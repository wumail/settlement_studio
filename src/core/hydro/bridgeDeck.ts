import type { Vec2 } from '../../schema/geometry.types';
import type { BuiltBridge } from './bridgeSolver';

export interface DeckSpec {
  readonly roadId: string;
  readonly waterId: string;
  readonly canalId?: string;
  readonly x: number;
  readonly y: number;
  readonly tangent: Vec2;
  readonly widthAcrossM: number;
  readonly deckWidthM: number;
  readonly sinAlpha: number;
  readonly cosAlpha: number;
}

/** 正交（含斜交补偿）桥面四角与栏杆/桥台：跨度按水面宽度 + 两端各 4m 落地 */
export function makeDeck(spec: DeckSpec): Omit<BuiltBridge, 'style' | 'forts'> {
  const normal: Vec2 = [-spec.tangent[1], spec.tangent[0]];
  const sinSafe = Math.max(0.35, spec.sinAlpha);
  const bridgeLength = (spec.widthAcrossM + 8.0 + spec.deckWidthM * spec.cosAlpha) / sinSafe;
  const hl = 0.5 * bridgeLength;
  const hw = 0.5 * spec.deckWidthM;
  const c0: Vec2 = [spec.x - hl * spec.tangent[0] - hw * normal[0], spec.y - hl * spec.tangent[1] - hw * normal[1]];
  const c1: Vec2 = [spec.x + hl * spec.tangent[0] - hw * normal[0], spec.y + hl * spec.tangent[1] - hw * normal[1]];
  const c2: Vec2 = [spec.x + hl * spec.tangent[0] + hw * normal[0], spec.y + hl * spec.tangent[1] + hw * normal[1]];
  const c3: Vec2 = [spec.x - hl * spec.tangent[0] + hw * normal[0], spec.y - hl * spec.tangent[1] + hw * normal[1]];
  const wing = (p: Vec2): readonly [Vec2, Vec2] => {
    const dx = p[0] - spec.x;
    const dy = p[1] - spec.y;
    const len = Math.hypot(dx, dy);
    const k = len > 1e-9 ? 3.0 / len : 0;
    return [p, [p[0] + dx * k, p[1] + dy * k]];
  };
  return {
    id: '',
    roadId: spec.roadId,
    riverId: spec.waterId,
    canalId: spec.canalId,
    x: spec.x,
    y: spec.y,
    tangent: spec.tangent,
    normal,
    angleDeg: (Math.atan2(spec.tangent[1], spec.tangent[0]) * 180) / Math.PI,
    riverWidthM: spec.widthAcrossM,
    lengthM: bridgeLength,
    widthM: spec.deckWidthM,
    corners: [c0, c1, c2, c3],
    parapetLeft: [c0, c1],
    parapetRight: [c3, c2],
    abutments: [wing(c0), wing(c1), wing(c2), wing(c3)],
  };
}
