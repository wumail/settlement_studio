import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { createRng, hashSeed } from '../math/rng';
import { buildCumulativeLengths, computeNodeTangents, sampleCatmullRom } from '../math/spline';
import {
  type BuiltBridge,
  type FordCrossing,
  applyBridgeOverrides,
  solveCanalBridges,
  solveRiverBridges,
} from './bridgeSolver';
import { solveWaterBodyBridges } from './waterBodyBridge';
import {
  type BuiltCanal,
  type BuiltRiver,
  type BuiltWaterBody,
  buildCanalGeometry,
  buildRiverGeometry,
  buildWaterBodyGeometry,
} from './riverCanal';

export type { BridgeStyle, BuiltBridge, BuiltFort, FordCrossing } from './bridgeSolver';

type ReefSource = TownProject['reefs'][number];
type RoadSource = TownProject['roads'][number];

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

/**
 * 水文与道路总装：河桥 + 明渠小桥 + 覆写（双桥头堡/木桥/渡口）三段合成。
 * 覆写按 35m 最近桥位匹配，fortified_twin 的桥头堡足印另行并入刚性障碍场。
 */
export function buildHydroRoadPackage(project: TownProject): HydroRoadPackage {
  const rivers = project.rivers.map(buildRiverGeometry);
  const waterBodies = project.waterBodies.map(buildWaterBodyGeometry);
  const canals = project.canals.map(buildCanalGeometry);
  const reefs = project.reefs.map(buildReefGeometry);
  const roads = project.roads.map(buildRoadGeometry);
  const river = solveRiverBridges(roads, rivers, project.fords);
  const canalBridges = solveCanalBridges(roads, canals);
  const waterBridges = solveWaterBodyBridges(roads, waterBodies);
  const merged = applyBridgeOverrides(
    [...river.bridges, ...canalBridges, ...waterBridges],
    project.bridgeOverrides,
    river.fordCrossings,
  );
  return {
    rivers,
    waterBodies,
    canals,
    reefs,
    roads,
    bridges: merged.bridges,
    fordCrossings: merged.fordCrossings,
    riverIslandCount: 0,
  };
}

/** 兼容旧调用：仅河桥求解（无明渠与覆写） */
export function solveOrthogonalBridges(
  roads: ReadonlyArray<BuiltRoad>,
  rivers: ReadonlyArray<BuiltRiver>,
  fords: ReadonlyArray<TownProject['fords'][number]>,
): { bridges: BuiltBridge[]; fordCrossings: FordCrossing[] } {
  return solveRiverBridges(roads, rivers, fords);
}
