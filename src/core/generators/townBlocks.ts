import type { BBox, Polygon, Vec2 } from '../../schema/geometry.types';
import {
  clipPolygonHalfPlane,
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import type { RngFn } from '../math/rng';
import { computeVoronoiCells, insetPolygonSafe } from '../math/voronoi';
import { orientedRect } from '../math/oriented';
import {
  clearsPolygon,
  clearsPolyline,
  pointToPolylineDist,
  polygonRadiusOf,
} from '../obstacles/collisionAudit';
import {
  type BuildingRoofKind,
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeTree,
} from '../obstacles/guardSafe';
import type { BuiltRoad } from '../hydro/reefRoadBridge';
import { splitByRoadSkeleton } from './streetSkeleton';
import { collectInnerHoles } from './zoneHoles';

const MAX_EDGE_ROWS = 9;

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

interface PreppedRoadSeg {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly nx: number;
  readonly ny: number;
  readonly c: number;
  readonly halfW: number;
  readonly box: BBox;
}

function boxesOverlap(a: BBox, b: BBox, pad: number): boolean {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

function prepRoadSegs(roads: ReadonlyArray<BuiltRoad>, regionBox: BBox): PreppedRoadSeg[] {
  const segs: PreppedRoadSeg[] = [];
  for (const road of roads) {
    const halfW = 0.5 * road.widthM + 2.5;
    if (!boxesOverlap(regionBox, computePolygonBBox(road.centerline), halfW)) continue;
    for (let i = 0; i < road.centerline.length - 1; i += 1) {
      const a = road.centerline[i];
      const b = road.centerline[i + 1];
      if (!a || !b) continue;
      const box: BBox = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
      if (!boxesOverlap(regionBox, box, halfW)) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len;
      const ny = dx / len;
      segs.push({ a, b, nx, ny, c: nx * a[0] + ny * a[1], halfW, box });
    }
  }
  return segs;
}

/**
 * 街坊按道路廊道切分：仅对真实接触街坊的线段执行切分（预计算法向与 BBox 粗筛，
 * 避免无限直线误裁非接触块且兼顾单区重抽 < 80ms）；整块落入路廊则直接舍弃。
 */
function splitBlockByRoads(block: Polygon, segs: ReadonlyArray<PreppedRoadSeg>): Polygon[] {
  if (segs.length === 0) return [block];
  let parts: Polygon[] = [block];
  for (const seg of segs) {
    if (parts.length === 0 || parts.length > 6) break;
    const next: Polygon[] = [];
    for (const part of parts) {
      if (!boxesOverlap(computePolygonBBox(part), seg.box, seg.halfW)) {
        next.push(part);
        continue;
      }
      const pc = computePolygonCentroid(part);
      if (clearsPolyline(part, pc, polygonRadiusOf(part, pc), [seg.a, seg.b], seg.halfW)) {
        next.push(part);
        continue;
      }
      const near = clipPolygonHalfPlane(part, seg.nx, seg.ny, seg.c - seg.halfW);
      const off = clipPolygonHalfPlane(part, -seg.nx, -seg.ny, -(seg.c + seg.halfW));
      if (near.length >= 3) next.push(near);
      if (off.length >= 3) next.push(off);
    }
    parts = next;
  }
  return parts;
}

/** 沿单条临街边排布定向矩形/曲尺屋宇：面宽 9.5–17.5m、进深 8.0–14.5m（乘建筑尺度） */
function placeFacadeRow(ctx: FacadeContext, a: Vec2, b: Vec2): void {
  const { input, block, roofKind, holes, rng } = ctx;
  const zone = input.zone;
  const scale = Math.max(0.45, Math.min(1.6, zone.buildingScale ?? 1));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 10.5 * scale) return;
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const nrm = inwardNormal(a, b, block);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  let cursor = 0.9 + rng() * 1.2;
  let placed = 0;
  while (cursor < len - 5 && placed < MAX_EDGE_ROWS) {
    const widthM = (9.5 + rng() * 8.0) * scale;
    if (cursor + widthM > len - 1.2) break;
    const depthM = (8.0 + rng() * 6.5) * scale;
    const mid = cursor + widthM * 0.5;
    const setback = (1.1 + rng() * 0.7) * scale;
    const cx = a[0] + ux * mid + nrm[0] * (depthM * 0.5 + setback);
    const cy = a[1] + uy * mid + nrm[1] * (depthM * 0.5 + setback);
    cursor += widthM + (0.45 + rng() * 0.65) * scale;
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
      const wingW = Math.max(8.6 * scale, widthM * 0.6);
      const wingD = Math.max(9.2 * scale, depthM * 0.85);
      const wingRect = orientedRect(wingCx, wingCy, wingW, wingD, angle + 90);
      if (!overlapsAny(wingRect, holes)) {
        const wing = guardSafeBuilding(
          wingRect,
          zone,
          { roofKind, kind: 'wing', label: `${zone.name} 厢房` },
          input.obstacleCtx,
        );
        if (wing) input.targetResult.buildings.push(wing);
      }
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
  const scale = Math.max(0.45, Math.min(1.6, zone.buildingScale ?? 1));
  const parts = splitByRoadSkeleton(innerPoly, obstacleCtx.roadsBuilt);
  const c0 = computePolygonCentroid(innerPoly);
  let radius = 0;
  for (const p of innerPoly) radius = Math.max(radius, Math.hypot(p[0] - c0[0], p[1] - c0[1]));
  for (const part of parts) {
    const areaM2 = Math.abs(computePolygonAreaSigned(part));
    if (areaM2 < 200) continue;
    // 目标街坊块 ~1.25–2.4k m²（乘建筑尺度平方）：按面积定站点数，绝不因 k 上限跳空
    const targetCellM2 = (1250 + (1 - zone.density) * 1150) * scale * scale;
    const k = Math.max(3, Math.min(280, Math.round(areaM2 / targetCellM2)));
    const bbox = computePolygonBBox(part);
    const roadSegs = prepRoadSegs(obstacleCtx.roadsBuilt, bbox);
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
    // 街坊退界 = 半街宽 + 0.2m：对街两排屋宇间自然留出 8–11m 街面（细密肌理的关键）
    const insetDist = 0.5 * zone.streetWidthM + 0.2;
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
      for (const piece of splitBlockByRoads(block, roadSegs)) {
        const blockArea = Math.abs(computePolygonAreaSigned(piece));
        if (blockArea < lotMinM2 * 0.65 * scale * scale || blockArea > lotMaxM2 * 26) continue;
        const ctx: FacadeContext = { input, block: piece, roofKind, holes, radius, rng };
        for (let i = 0; i < piece.length; i += 1) {
          const a = piece[i];
          const b = piece[(i + 1) % piece.length];
          if (a && b) placeFacadeRow(ctx, a, b);
        }
        plantCourtyard(ctx, piece);
      }
    }
  }
}

/** town_blocks 关厢坊巷：选区退界 6m 后按道路骨架 + OBB 临街排屋，内嵌集市/堡寨/禁建圈自动挖空 */
export function compileTownBlocksZone(input: ZoneGeneratorInput): void {
  const inner = insetPolygonSafe(input.zone.points, 6.0);
  if (inner.length < 3) return;
  generateObbStreetBlocks(input, inner, 60, 210, 'town', collectInnerHoles(input));
}
