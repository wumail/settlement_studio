import type { Polygon, Polyline } from '../../schema/geometry.types';
import {
  computePolygonAreaSigned,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import type { RngFn } from '../math/rng';
import { insetPolygonSafe } from '../math/voronoi';
import {
  clearsPolygon,
  pointToPolylineDist,
  polygonRadiusOf,
} from '../obstacles/collisionAudit';
import {
  type BuildingRoofKind,
  type ObstacleContext,
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeTree,
} from '../obstacles/guardSafe';
import { buildStreetBlocks } from './streetSkeleton';
import { collectInnerHoles } from './zoneHoles';
import { planBlockLots } from './lotSubdivision';

function ringOf(poly: Polygon): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

function overlapsAny(poly: Polygon, holes: ReadonlyArray<Polygon>): boolean {
  if (holes.length === 0) return false;
  const c = computePolygonCentroid(poly);
  const radius = polygonRadiusOf(poly, c);
  for (const hole of holes) {
    if (hole.length >= 3 && !clearsPolygon(poly, c, radius, hole, 0)) return true;
  }
  return false;
}

/** 院树距屋面安全净空复核（>= tree.r + 0.6m，严防压盖屋檐） */
export function treeClearsBuildings(
  x: number,
  y: number,
  clearanceM: number,
  ctx: ObstacleContext,
  zoneId: string,
): boolean {
  const pad = clearanceM + 0.5;
  for (const b of ctx.spatialHash.queryBox(x - pad, y - pad, x + pad, y + pad)) {
    if (b.zoneId !== zoneId) continue;
    if (pointInPolygon(x, y, b.points)) return false;
    if (pointToPolylineDist(x, y, ringOf(b.points)) < clearanceM) return false;
  }
  return true;
}

/** 稀疏内院树簇：仅约 22% 拥有 ≥100m² 开放内院的街块植 1–3 棵紧簇院树，消除全城均布波点 */
function plantCourtyard(
  input: ZoneGeneratorInput,
  courtyards: ReadonlyArray<Polygon>,
  holes: ReadonlyArray<Polygon>,
  rng: RngFn,
): void {
  let bestYard: Polygon | null = null;
  let bestArea = 100;
  for (const yard of courtyards) {
    const area = Math.abs(computePolygonAreaSigned(yard));
    if (area >= bestArea) {
      bestArea = area;
      bestYard = yard;
    }
  }
  if (!bestYard || rng() > 0.22) return;
  const anchor = computePolygonCentroid(bestYard);
  const count = 1 + Math.floor(rng() * 3);
  const baseAng = rng() * Math.PI * 2;
  const spread = count === 1 ? 0 : 1.4 + rng() * 1.1;
  for (let i = 0; i < count; i += 1) {
    const ang = baseAng + (i * Math.PI * 2) / count;
    const tx = anchor[0] + Math.cos(ang) * spread;
    const ty = anchor[1] + Math.sin(ang) * spread;
    const r = 2.8 + rng() * 2.2;
    if (!treeClearsBuildings(tx, ty, r + 0.6, input.obstacleCtx, input.zone.id)) continue;
    if (holes.some((hole) => pointInPolygon(tx, ty, hole))) continue;
    const tree = guardSafeTree(tx, ty, r, 'plaza', input.zone, input.obstacleCtx);
    if (tree) input.targetResult.trees.push(tree);
  }
}

/** 街块布屋：道路水渠切割 → Stage A 扭转 OBB 街坊 → Stage B 宅基地剖分 → 稀疏内院树（零白网 internalStreets） */
export function generateObbStreetBlocks(
  input: ZoneGeneratorInput,
  innerPoly: Polygon,
  lotMinM2: number,
  lotMaxM2: number,
  roofKind: BuildingRoofKind,
  holes: ReadonlyArray<Polygon> = [],
): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const scale = Math.max(0.45, Math.min(1.6, zone.buildingScale ?? 1));
  const blocks = buildStreetBlocks(
    innerPoly,
    obstacleCtx.roadsBuilt,
    obstacleCtx.canalsBuilt,
    holes,
    zone.streetWidthM,
    scale,
    rng,
  );
  const isSuburban = zone.contentType === 'town_blocks' && zone.frayOuter !== false;
  const frayZoneRing = isSuburban ? ringOf(innerPoly) : null;
  const corridors: Polyline[] = isSuburban
    ? [...obstacleCtx.roadsBuilt.map((r) => r.centerline), ...obstacleCtx.canalsBuilt.map((c) => c.centerline)]
    : [];
  void lotMaxM2;
  for (const block of blocks) {
    const blockArea = Math.abs(computePolygonAreaSigned(block));
    if (blockArea < lotMinM2 * 0.65 * scale * scale) continue;
    const bc = computePolygonCentroid(block);
    const br = polygonRadiusOf(block, bc);
    const localHoles = holes.filter((h) => h.length >= 3 && !clearsPolygon(block, bc, br, h, 0));
    const plan = planBlockLots({ block, scale, frayZoneRing, corridors, rng });
    for (const item of plan.buildings) {
      if (overlapsAny(item.footprint, localHoles)) continue;
      const house = guardSafeBuilding(
        item.footprint,
        zone,
        { roofKind, kind: 'house', label: zone.name },
        obstacleCtx,
      );
      if (house) targetResult.buildings.push(house);
    }
    plantCourtyard(input, plan.courtyards, holes, rng);
  }
}

/** town_blocks 关厢坊巷：选区退界 1.8m 后按 OBB 街坊 + 宅基地剖分布屋，外缘无路自然疏散，零白线巷网 */
export function compileTownBlocksZone(input: ZoneGeneratorInput): void {
  const inner = insetPolygonSafe(input.zone.points, 1.8);
  if (inner.length < 3) return;
  generateObbStreetBlocks(input, inner, 60, 210, 'town', collectInnerHoles(input));
}
