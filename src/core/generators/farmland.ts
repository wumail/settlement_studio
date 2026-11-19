import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import {
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import { computeVoronoiCells, insetPolygonSafe } from '../math/voronoi';
import { clearsPolygon, polygonRadiusOf } from '../obstacles/collisionAudit';
import type { ZoneGeneratorInput } from '../obstacles/guardSafe';

const FURROW_ANGLES = [0, 35, 75, 120] as const;
const TARGET_PLOT_HA = 0.72;
const FURROW_SPACING_M = 7.0;

export function polygonTouchesExclusion(
  poly: Polygon,
  exclusionPolys: ReadonlyArray<Polygon>,
  margin: number,
): boolean {
  if (exclusionPolys.length === 0) return false;
  const c = computePolygonCentroid(poly);
  const radius = polygonRadiusOf(poly, c);
  for (const ex of exclusionPolys) {
    if (!clearsPolygon(poly, c, radius, ex, margin)) return true;
  }
  return false;
}

function clipChord(
  px: number,
  py: number,
  dirX: number,
  dirY: number,
  halfLen: number,
  poly: Polygon,
): Polyline[] {
  const runs: Polyline[] = [];
  let cur: Vec2[] = [];
  const step = 2.0;
  for (let t = -halfLen; t <= halfLen; t += step) {
    const x = px + dirX * t;
    const y = py + dirY * t;
    if (pointInPolygon(x, y, poly)) {
      cur.push([x, y]);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** farmland 条田：约 0.72 ha 一格 Voronoi、1.5m 田埂内缩、禁建圈 2m 剔除、多角度平行耕垄 */
export function compileFarmlandZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const areaHa = Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
  if (areaHa < 0.05) return;
  const k = Math.max(1, Math.min(40, Math.round(areaHa / TARGET_PLOT_HA)));
  const bbox = computePolygonBBox(zone.points);
  const sites: Vec2[] = [];
  let attempts = 0;
  while (sites.length < k && attempts < k * 60) {
    attempts += 1;
    const x = bbox[0] + rng() * (bbox[2] - bbox[0]);
    const y = bbox[1] + rng() * (bbox[3] - bbox[1]);
    if (!pointInPolygon(x, y, zone.points)) continue;
    sites.push([x, y]);
  }
  if (sites.length === 0) return;

  const cells = computeVoronoiCells(sites, bbox, 1, zone.points);
  const angleDeg = FURROW_ANGLES[Math.floor(rng() * FURROW_ANGLES.length)] ?? 0;
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);

  for (const cell of cells) {
    if (cell.length < 3) continue;
    const innerPolygon = insetPolygonSafe(cell, 1.5);
    if (innerPolygon.length < 3) continue;
    const plotArea = Math.abs(computePolygonAreaSigned(innerPolygon));
    if (plotArea < 480) continue;
    if (polygonTouchesExclusion(innerPolygon, obstacleCtx.exclusionPolys, 2.0)) continue;

    const c = computePolygonCentroid(innerPolygon);
    // 局部包围盒：仅按当前田块自身对角线裁剪耕垄，避免全选区百万次空步进
    const cellBox = computePolygonBBox(innerPolygon);
    const halfDiag = 0.5 * Math.hypot(cellBox[2] - cellBox[0], cellBox[3] - cellBox[1]) + FURROW_SPACING_M;
    const furrows: Polyline[] = [];
    for (let off = -halfDiag; off <= halfDiag; off += FURROW_SPACING_M) {
      const px = c[0] - dirY * off;
      const py = c[1] + dirX * off;
      const runs = clipChord(px, py, dirX, dirY, halfDiag, innerPolygon);
      for (const run of runs) furrows.push(run);
    }

    targetResult.farmlandPlots.push({
      id: `fp_${zone.id}_${targetResult.farmlandPlots.length + 1}`,
      zoneId: zone.id,
      polygon: cell,
      innerPolygon,
      areaHa: plotArea / 10000,
      angleDeg,
      furrows,
    });
  }
}
