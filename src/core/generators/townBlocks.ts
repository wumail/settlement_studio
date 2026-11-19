import type { Polygon, Vec2 } from '../../schema/geometry.types';
import {
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import type { RngFn } from '../math/rng';
import { computeVoronoiCells, insetPolygonSafe } from '../math/voronoi';
import { orientedRect } from '../math/oriented';
import { clearsPolygon, pointToPolylineDist } from '../obstacles/collisionAudit';
import {
  type BuildingRoofKind,
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeTree,
} from '../obstacles/guardSafe';
import { splitByRoadSkeleton } from './streetSkeleton';
import { collectInnerHoles } from './zoneHoles';

const MAX_EDGE_ROWS = 6;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 街坊块内法向：取边中点向内侧偏移 3m 采样，避免依赖环向 */
function inwardNormal(a: Vec2, b: Vec2, block: Polygon): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 1];
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (a[0] + b[0]) * 0.5 + nx * 3;
  const my = (a[1] + b[1]) * 0.5 + ny * 3;
  return pointInPolygon(mx, my, block) ? [nx, ny] : [-nx, -ny];
}

function overlapsAny(poly: Polygon, holes: ReadonlyArray<Polygon>): boolean {
  if (holes.length === 0) return false;
  const c = computePolygonCentroid(poly);
  let radius = 0;
  for (const p of poly) radius = Math.max(radius, Math.hypot(p[0] - c[0], p[1] - c[1]));
  for (const hole of holes) {
    if (hole.length >= 3 && !clearsPolygon(poly, c, radius, hole, 0)) return true;
  }
  return false;
}

/** 外缘衰减概率：离选区中心越远、离干道越远，保留概率越低（平滑梯度，非刀切） */
function keepProbability(input: ZoneGeneratorInput, cx: number, cy: number, radius: number): number {
  const zone = input.zone;
  if (zone.contentType !== 'town_blocks') return 1;
  if (zone.frayOuter === false) return 1;
  const c = computePolygonCentroid(zone.points);
  const radial = clamp01(Math.hypot(cx - c[0], cy - c[1]) / Math.max(1, radius));
  let dRoad = Number.POSITIVE_INFINITY;
  for (const road of input.obstacleCtx.roadsBuilt) {
    if (road.tier === 'lane') continue;
    dRoad = Math.min(dRoad, pointToPolylineDist(cx, cy, road.centerline));
  }
  const tRoad = clamp01((dRoad - 22) / Math.max(48, radius * 0.85));
  const edge = clamp01((radius - Math.hypot(cx - c[0], cy - c[1])) / Math.max(30, radius * 0.35));
  return clamp01(1 - 0.5 * radial - 0.5 * tRoad - 0.25 * (1 - edge));
}

interface FacadeContext {
  readonly input: ZoneGeneratorInput;
  readonly block: Polygon;
  readonly roofKind: BuildingRoofKind;
  readonly holes: ReadonlyArray<Polygon>;
  readonly radius: number;
  readonly rng: RngFn;
}

/** 沿单条临街边排布定向矩形/曲尺屋宇：面宽 14–28m、进深 12–24m，中庭自然留白 */
function placeFacadeRow(ctx: FacadeContext, a: Vec2, b: Vec2): void {
  const { input, block, roofKind, holes, rng } = ctx;
  const zone = input.zone;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 15) return;
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const nrm = inwardNormal(a, b, block);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  let cursor = 1.4 + rng() * 2.2;
  let placed = 0;
  while (cursor < len - 5 && placed < MAX_EDGE_ROWS) {
    const widthM = 14 + rng() * 14;
    if (cursor + widthM > len - 1.2) break;
    const depthM = 12 + rng() * 12;
    const mid = cursor + widthM * 0.5;
    const setback = 1.4 + rng() * 0.8;
    const cx = a[0] + ux * mid + nrm[0] * (depthM * 0.5 + setback);
    const cy = a[1] + uy * mid + nrm[1] * (depthM * 0.5 + setback);
    cursor += widthM + 1.2 + rng() * 1.4;
    if (keepProbability(input, cx, cy, ctx.radius) < rng()) continue;
    const footprint = orientedRect(cx, cy, widthM, depthM, angle);
    if (overlapsAny(footprint, holes)) continue;
    const house = guardSafeBuilding(
      footprint,
      zone,
      { roofKind, kind: 'house', label: zone.name },
      input.obstacleCtx,
    );
    if (house) {
      input.targetResult.buildings.push(house);
      placed += 1;
    }
    if (rng() < 0.3) {
      const side = rng() < 0.5 ? -1 : 1;
      const wingCx = cx + ux * (widthM * 0.42) * side + nrm[0] * (depthM * 0.45);
      const wingCy = cy + uy * (widthM * 0.42) * side + nrm[1] * (depthM * 0.45);
      const wing = guardSafeBuilding(
        orientedRect(wingCx, wingCy, widthM * 0.46, depthM * 0.72, angle + 90),
        zone,
        { roofKind, kind: 'wing', label: `${zone.name} 厢房` },
        input.obstacleCtx,
      );
      if (wing && !overlapsAny(wing.points, holes)) input.targetResult.buildings.push(wing);
    }
  }
}

/** 院落中庭点缀 1–2 棵院树，保持街坊中心留白 */
function plantCourtyard(ctx: FacadeContext, block: Polygon): void {
  const c = computePolygonCentroid(block);
  const area = Math.abs(computePolygonAreaSigned(block));
  if (area < 620) return;
  const count = ctx.rng() < 0.55 ? 1 : 2;
  for (let i = 0; i < count; i += 1) {
    const ang = ctx.rng() * Math.PI * 2;
    const rad = Math.min(18, Math.sqrt(area) * 0.18) * ctx.rng();
    const tree = guardSafeTree(
      c[0] + Math.cos(ang) * rad,
      c[1] + Math.sin(ang) * rad,
      4.2 + ctx.rng() * 3.2,
      'plaza',
      ctx.input.zone,
      ctx.input.obstacleCtx,
    );
    if (tree && !ctx.holes.some((hole) => pointInPolygon(tree.x, tree.y, hole))) {
      ctx.input.targetResult.trees.push(tree);
    }
  }
}

/**
 * 街坊 OBB 布屋算子（V3 重写）：
 * 道路骨架切割 → 有界 Voronoi 次级巷道 → 沿临街边定向矩形/曲尺屋宇 + 中庭留白 + 院树 + 外缘衰减。
 * 彻底废除“碎多边形内缩 0.62m 当屋顶”的碎渣画法。
 */
export function generateObbStreetBlocks(
  input: ZoneGeneratorInput,
  innerPoly: Polygon,
  lotMinM2: number,
  lotMaxM2: number,
  roofKind: BuildingRoofKind,
  holes: ReadonlyArray<Polygon> = [],
): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const parts = splitByRoadSkeleton(innerPoly, obstacleCtx.roadsBuilt);
  const c0 = computePolygonCentroid(innerPoly);
  let radius = 0;
  for (const p of innerPoly) radius = Math.max(radius, Math.hypot(p[0] - c0[0], p[1] - c0[1]));
  for (const part of parts) {
    const areaM2 = Math.abs(computePolygonAreaSigned(part));
    if (areaM2 < 200) continue;
    // 目标街坊块 ~2.0–2.6k m²：按面积定站点数，绝不因 k 上限把整片大城直接跳空
    const targetCellM2 = 1850 + (1 - zone.density) * 1500;
    const k = Math.max(3, Math.min(240, Math.round(areaM2 / targetCellM2)));
    const bbox = computePolygonBBox(part);
    const sites: Vec2[] = [];
    let attempts = 0;
    while (sites.length < k && attempts < k * 45) {
      attempts += 1;
      const x = bbox[0] + rng() * (bbox[2] - bbox[0]);
      const y = bbox[1] + rng() * (bbox[3] - bbox[1]);
      if (!pointInPolygon(x, y, part)) continue;
      sites.push([x, y]);
    }
    if (sites.length < 3) continue;
    const cells = computeVoronoiCells(sites, bbox, 2, part);
    const insetDist = 0.5 * zone.streetWidthM + 1.2;
    for (const cell of cells) {
      if (cell.length < 3) continue;
      const cellCenter = computePolygonCentroid(cell);
      if (holes.some((hole) => pointInPolygon(cellCenter[0], cellCenter[1], hole))) continue;
      const closing = cell[0];
      if (closing && !overlapsAny(cell, holes)) {
        targetResult.internalStreets.push([...cell, closing]);
      }
      const block = insetPolygonSafe(cell, insetDist);
      if (block.length < 3) continue;
      const blockArea = Math.abs(computePolygonAreaSigned(block));
      if (blockArea < lotMinM2 * 0.8 || blockArea > lotMaxM2 * 26) continue;
      const ctx: FacadeContext = { input, block, roofKind, holes, radius, rng };
      for (let i = 0; i < block.length; i += 1) {
        const a = block[i];
        const b = block[(i + 1) % block.length];
        if (a && b) placeFacadeRow(ctx, a, b);
      }
      plantCourtyard(ctx, block);
    }
  }
}

/** town_blocks 关厢坊巷：选区退界 6m 后按道路骨架 + OBB 临街排屋，内嵌集市/堡寨/禁建圈自动挖空 */
export function compileTownBlocksZone(input: ZoneGeneratorInput): void {
  const inner = insetPolygonSafe(input.zone.points, 6.0);
  if (inner.length < 3) return;
  generateObbStreetBlocks(input, inner, 60, 210, 'town', collectInnerHoles(input));
}
