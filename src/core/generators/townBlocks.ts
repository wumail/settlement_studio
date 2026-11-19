import type { Polygon, Vec2 } from '../../schema/geometry.types';
import {
  clipPolygonHalfPlane,
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import type { RngFn } from '../math/rng';
import { computeVoronoiCells, insetPolygonSafe } from '../math/voronoi';
import { pointToPolylineDist } from '../obstacles/collisionAudit';
import {
  type BuildingRoofKind,
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeTree,
} from '../obstacles/guardSafe';

const MAX_SPLIT_DEPTH = 7;

function longestEdge(poly: Polygon): { a: Vec2; b: Vec2; len: number } | null {
  let best: { a: Vec2; b: Vec2; len: number } | null = null;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (best === null || len > best.len) best = { a, b, len };
  }
  return best;
}

/** 沿最长边 [0.38, 0.62] 比例递归半平面剖分宗地（深度 <= 7，面积 <= lotMax 即收口） */
function splitLots(
  poly: Vec2[],
  depth: number,
  lotMinM2: number,
  lotMaxM2: number,
  rng: RngFn,
  out: Vec2[][],
): void {
  const area = Math.abs(computePolygonAreaSigned(poly));
  if (poly.length < 3 || area < lotMinM2 * 0.55) return;
  if (depth >= MAX_SPLIT_DEPTH || area <= lotMaxM2) {
    out.push(poly);
    return;
  }
  const edge = longestEdge(poly);
  if (!edge || edge.len < 1e-6) {
    out.push(poly);
    return;
  }
  const t = 0.38 + rng() * 0.24;
  const px = edge.a[0] + (edge.b[0] - edge.a[0]) * t;
  const py = edge.a[1] + (edge.b[1] - edge.a[1]) * t;
  // 剖分线垂直于临街最长边：半平面法向取边方向本身，两侧各保留一段街面
  const dx = (edge.b[0] - edge.a[0]) / edge.len;
  const dy = (edge.b[1] - edge.a[1]) / edge.len;
  const c = dx * px + dy * py;
  const left = clipPolygonHalfPlane(poly, dx, dy, c);
  const right = clipPolygonHalfPlane(poly, -dx, -dy, -c);
  if (left.length >= 3) splitLots(left, depth + 1, lotMinM2, lotMaxM2, rng, out);
  if (right.length >= 3) splitLots(right, depth + 1, lotMinM2, lotMaxM2, rng, out);
}

/**
 * 共享街坊切屋算子：K = clamp(round(areaHa * (1.8 + density * 2.4)), 3, 44) 站点、
 * 有界拒绝采样 + 2 轮 Lloyd 松弛 Voronoi + 半街宽内缩 + 递归宗地切分 + guardSafeBuilding 收口。
 */
export function generateVoronoiStreetBlocks(
  input: ZoneGeneratorInput,
  innerPoly: Polygon,
  lotMinM2: number,
  lotMaxM2: number,
  roofKind: BuildingRoofKind,
): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const areaHa = Math.abs(computePolygonAreaSigned(innerPoly)) / 10000;
  if (areaHa < 0.02) return;
  const k = Math.max(3, Math.min(44, Math.round(areaHa * (1.8 + zone.density * 2.4))));
  const bbox = computePolygonBBox(innerPoly);
  const sites: Vec2[] = [];
  let attempts = 0;
  const maxAttempts = k * 50;
  while (sites.length < k && attempts < maxAttempts) {
    attempts += 1;
    const x = bbox[0] + rng() * (bbox[2] - bbox[0]);
    const y = bbox[1] + rng() * (bbox[3] - bbox[1]);
    if (!pointInPolygon(x, y, innerPoly)) continue;
    sites.push([x, y]);
  }
  if (sites.length < 3) return;

  const cells = computeVoronoiCells(sites, bbox, 2, innerPoly);
  const insetDist = 0.5 * zone.streetWidthM + 1.2;
  for (const cell of cells) {
    if (cell.length < 3) continue;
    const closing = cell[0];
    if (closing) targetResult.internalStreets.push([...cell, closing]);
    const block = insetPolygonSafe(cell, insetDist);
    if (block.length < 3) continue;
    if (Math.abs(computePolygonAreaSigned(block)) < lotMinM2 * 0.8) continue;

    const lots: Vec2[][] = [];
    splitLots(block, 0, lotMinM2, lotMaxM2, rng, lots);
    const blockClosing = block[0];
    const blockRing = blockClosing ? [...block, blockClosing] : block;
    for (const lot of lots) {
      const lotCenter = computePolygonCentroid(lot);
      if (pointToPolylineDist(lotCenter[0], lotCenter[1], blockRing) > 32) continue;
      const footprint = insetPolygonSafe(lot, 0.62);
      if (footprint.length < 3) continue;
      const b = guardSafeBuilding(
        footprint,
        zone,
        { roofKind, kind: 'house', label: zone.name },
        obstacleCtx,
      );
      if (b) targetResult.buildings.push(b);
    }
    if (rng() < 0.55) {
      const c = computePolygonCentroid(block);
      const tree = guardSafeTree(c[0], c[1], 4.5 + rng() * 3.5, 'plaza', zone, obstacleCtx);
      if (tree) targetResult.trees.push(tree);
    }
  }
}

/** town_blocks 关厢坊巷：选区退界 6m 后复用共享 Voronoi 街坊算子 */
export function compileTownBlocksZone(input: ZoneGeneratorInput): void {
  const inner = insetPolygonSafe(input.zone.points, 6.0);
  if (inner.length < 3) return;
  generateVoronoiStreetBlocks(input, inner, 60, 210, 'town');
}
