import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { intersectSegmentsExact } from '../math/polygon';
import { createRng, hashSeed } from '../math/rng';
import { buildCumulativeLengths, computeNodeTangents, sampleCatmullRom } from '../math/spline';
import {
  type BuiltCanal,
  type BuiltRiver,
  type BuiltWaterBody,
  buildCanalGeometry,
  buildRiverGeometry,
  buildWaterBodyGeometry,
} from './riverCanal';

type ReefSource = TownProject['reefs'][number];
type RoadSource = TownProject['roads'][number];
type FordSource = TownProject['fords'][number];

export interface BuiltReef {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly count: number;
  readonly rocks: ReadonlyArray<{
    readonly points: Polygon;
    readonly center: Vec2;
    readonly radiusM: number;
  }>;
  readonly foamRing: Polygon;
}

export interface BuiltRoad {
  readonly id: string;
  readonly name: string;
  readonly tier: 'highway' | 'street' | 'lane';
  readonly widthM: number;
  readonly halfWidth: number;
  readonly centerline: Polyline;
  readonly cumLen: Float64Array;
  readonly totalLen: number;
  readonly leftEdge: Polyline;
  readonly rightEdge: Polyline;
}

export interface BuiltBridge {
  readonly id: string;
  readonly roadId: string;
  readonly riverId: string;
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

export interface HydroRoadPackage {
  readonly rivers: ReadonlyArray<BuiltRiver>;
  readonly waterBodies: ReadonlyArray<BuiltWaterBody>;
  readonly canals: ReadonlyArray<BuiltCanal>;
  readonly reefs: ReadonlyArray<BuiltReef>;
  readonly roads: ReadonlyArray<BuiltRoad>;
  readonly bridges: ReadonlyArray<BuiltBridge>;
  readonly fordCrossings: ReadonlyArray<FordCrossing>;
  readonly riverIslandCount: number;
}

const TIER_WIDTH: Readonly<Record<'highway' | 'street' | 'lane', number>> = {
  highway: 14,
  street: 9,
  lane: 5,
};

/** 仅由 explicit project.reefs 驱动的 5—7 边形硬朗棱角岩礁簇 + 48 点碎波圈 */
export function buildReefGeometry(reef: ReefSource): BuiltReef {
  const rng = createRng(reef.seed || hashSeed(reef.id));
  const rockRadius = Math.max(4, reef.radiusM);
  const count = Math.max(1, Math.min(3, Math.round(reef.count)));
  const rocks: Array<{ points: Polygon; center: Vec2; radiusM: number }> = [];

  for (let c = 0; c < count; c += 1) {
    const spreadAngle = (c / Math.max(1, count)) * Math.PI * 2 + reef.angleDeg * 0.0174;
    const offset = c === 0 ? 0 : rockRadius * 0.62;
    const cx = reef.x + Math.cos(spreadAngle) * offset;
    const cy = reef.y + Math.sin(spreadAngle) * offset;
    const localRadius = c === 0 ? rockRadius : rockRadius * (0.52 + rng() * 0.16);
    const sides = 5 + Math.floor(rng() * 3);
    const baseAngle = reef.angleDeg * (Math.PI / 180) + rng() * 0.5;
    const points: Vec2[] = [];
    for (let i = 0; i < sides; i += 1) {
      const jitter = (rng() - 0.5) * 0.36;
      const angle = baseAngle + (i / sides) * Math.PI * 2 + jitter;
      const ratio = i % 2 === 0 ? 0.92 + rng() * 0.08 : 0.55 + rng() * 0.18;
      points.push([cx + Math.cos(angle) * ratio * localRadius, cy + Math.sin(angle) * ratio * localRadius]);
    }
    rocks.push({ points, center: [cx, cy], radiusM: localRadius });
  }

  const foamRing: Vec2[] = [];
  for (let i = 0; i < 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2;
    const wobble = 1 + Math.sin(angle * 5 + reef.seed) * 0.05;
    foamRing.push([
      reef.x + Math.cos(angle) * (rockRadius + 3.5) * wobble,
      reef.y + Math.sin(angle) * (rockRadius + 3.5) * wobble,
    ]);
  }

  return { id: reef.id, x: reef.x, y: reef.y, radiusM: rockRadius, count, rocks, foamRing };
}

export function buildRoadGeometry(road: RoadSource): BuiltRoad {
  const centerline = sampleCatmullRom(road.points, 10, false);
  const { cum, total } = buildCumulativeLengths(centerline);
  const tangents = computeNodeTangents(centerline, false);
  const widthM = Math.max(2, road.widthM || TIER_WIDTH[road.tier]);
  const halfWidth = 0.5 * widthM;
  const leftEdge: Vec2[] = [];
  const rightEdge: Vec2[] = [];
  for (let i = 0; i < centerline.length; i += 1) {
    const p = centerline[i];
    const t = tangents[i];
    if (!p || !t) continue;
    const nx = t[1];
    const ny = -t[0];
    leftEdge.push([p[0] + nx * halfWidth, p[1] + ny * halfWidth]);
    rightEdge.push([p[0] - nx * halfWidth, p[1] - ny * halfWidth]);
  }
  return {
    id: road.id,
    name: road.name,
    tier: road.tier,
    widthM,
    halfWidth,
    centerline,
    cumLen: cum,
    totalLen: total,
    leftEdge,
    rightEdge,
  };
}

interface BridgeSolveResult {
  readonly bridges: BuiltBridge[];
  readonly fordCrossings: FordCrossing[];
}

/** 斜交全跨度正交桥：35m 弧长去重、fords 浅滩豁免、sinAlpha 斜交补偿桥长 */
export function solveOrthogonalBridges(
  roads: ReadonlyArray<BuiltRoad>,
  rivers: ReadonlyArray<BuiltRiver>,
  fords: ReadonlyArray<FordSource>,
): BridgeSolveResult {
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
          const riverWidth = river.widthAtU(uRiver);
          const tangent = tans[i] ?? [1, 0];
          const normal: Vec2 = [-tangent[1], tangent[0]];
          const rdx = rSegLen > 1e-9 ? (d[0] - c[0]) / rSegLen : 1;
          const rdy = rSegLen > 1e-9 ? (d[1] - c[1]) / rSegLen : 0;
          const ford = fords.find(
            (f) => Math.hypot(hit.x - f.x, hit.y - f.y) <= f.radiusM,
          );
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
              riverWidthM: riverWidth,
              radiusM: ford.radiusM,
            });
            continue;
          }

          const sinAlpha = Math.abs(tangent[0] * rdy - tangent[1] * rdx);
          const cosAlpha = Math.abs(tangent[0] * rdx + tangent[1] * rdy);
          const deckWidth = road.widthM + 3.0;
          // 斜交桥跨度两端河宽可能不同：取两端较大值，避免桥角悬水
          const sinSafe = Math.max(0.35, sinAlpha);
          const skewDriftM = (0.5 * deckWidth * cosAlpha) / sinSafe;
          const skewSpanM = ((riverWidth * 0.5 + 4.0) * cosAlpha) / sinSafe;
          const spanHalfU = (riverWidth * 0.5 + 4.0 + skewDriftM + skewSpanM) / Math.max(1, river.totalLen);
          const bridgeRiverWidth = Math.max(
            river.widthAtU(uRiver - spanHalfU),
            river.widthAtU(uRiver + spanHalfU),
          );
          const bridgeLength = (bridgeRiverWidth + 8.0 + deckWidth * cosAlpha) / Math.max(0.35, sinAlpha);
          const hl = 0.5 * bridgeLength;
          const hw = 0.5 * deckWidth;
          const c0: Vec2 = [hit.x - hl * tangent[0] - hw * normal[0], hit.y - hl * tangent[1] - hw * normal[1]];
          const c1: Vec2 = [hit.x + hl * tangent[0] - hw * normal[0], hit.y + hl * tangent[1] - hw * normal[1]];
          const c2: Vec2 = [hit.x + hl * tangent[0] + hw * normal[0], hit.y + hl * tangent[1] + hw * normal[1]];
          const c3: Vec2 = [hit.x - hl * tangent[0] + hw * normal[0], hit.y - hl * tangent[1] + hw * normal[1]];
          const wing = (p: Vec2): readonly [Vec2, Vec2] => {
            const dx = p[0] - hit.x;
            const dy = p[1] - hit.y;
            const len = Math.hypot(dx, dy);
            const k = len > 1e-9 ? 3.0 / len : 0;
            return [p, [p[0] + dx * k, p[1] + dy * k]];
          };
          bridges.push({
            id: `br_${road.id}_${river.id}_${bridges.length}`,
            roadId: road.id,
            riverId: river.id,
            x: hit.x,
            y: hit.y,
            tangent,
            normal,
            angleDeg: (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI,
            riverWidthM: bridgeRiverWidth,
            lengthM: bridgeLength,
            widthM: deckWidth,
            corners: [c0, c1, c2, c3],
            parapetLeft: [c0, c1],
            parapetRight: [c3, c2],
            abutments: [wing(c0), wing(c1), wing(c2), wing(c3)],
          });
        }
      }
    }
  }
  return { bridges, fordCrossings };
}

export function buildHydroRoadPackage(project: TownProject): HydroRoadPackage {
  const rivers = project.rivers.map(buildRiverGeometry);
  const waterBodies = project.waterBodies.map(buildWaterBodyGeometry);
  const canals = project.canals.map(buildCanalGeometry);
  const reefs = project.reefs.map(buildReefGeometry);
  const roads = project.roads.map(buildRoadGeometry);
  const solved = solveOrthogonalBridges(roads, rivers, project.fords);
  return {
    rivers,
    waterBodies,
    canals,
    reefs,
    roads,
    bridges: solved.bridges,
    fordCrossings: solved.fordCrossings,
    riverIslandCount: 0,
  };
}
