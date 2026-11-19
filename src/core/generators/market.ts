import type { Polygon, Vec2 } from '../../schema/geometry.types';
import { computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import {
  clearsPolygon,
  pointToPolylineDist,
  polygonRadiusOf,
} from '../obstacles/collisionAudit';
import { type ObstacleContext, type ZoneGeneratorInput, guardSafeBuilding } from '../obstacles/guardSafe';
import { sampleSlopeDeg } from '../terrain/elevationField';

function stallRect(cx: number, cy: number, angleRad: number, lengthM: number, widthM: number): Vec2[] {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const hl = 0.5 * lengthM;
  const hw = 0.5 * widthM;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ];
  return corners.map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca] as Vec2);
}

/** 集坪/校场铺地不得落入禁建圈 */
function apronClearOfExclusions(poly: Polygon, ctx: ObstacleContext): boolean {
  if (poly.length < 3) return false;
  const centroid = computePolygonCentroid(poly);
  const radius = polygonRadiusOf(poly, centroid);
  for (const ex of ctx.exclusionPolys) {
    if (!clearsPolygon(poly, centroid, radius, ex, 0)) return false;
  }
  return true;
}

/** 市井水井选址：选区内、禁建圈外、路/水/渠/墙/屋净空与坡度全部达标 */
function wellAllowed(x: number, y: number, zone: ZoneGeneratorInput['zone'], ctx: ObstacleContext): boolean {
  if (!pointInPolygon(x, y, zone.points)) return false;
  if (sampleSlopeDeg(ctx.elevationField, x, y) > zone.maxSlopeDeg) return false;
  for (const ex of ctx.exclusionPolys) {
    if (pointInPolygon(x, y, ex)) return false;
    const ring = ex[0] ? [...ex, ex[0]] : [...ex];
    if (pointToPolylineDist(x, y, ring) < 2.0) return false;
  }
  for (const river of ctx.riversBuilt) {
    if (pointInPolygon(x, y, river.bankPolygon)) return false;
    const ring = river.bankPolygon[0] ? [...river.bankPolygon, river.bankPolygon[0]] : [];
    if (pointToPolylineDist(x, y, ring) < 3.0) return false;
  }
  for (const wb of ctx.waterBodiesBuilt) {
    if (pointInPolygon(x, y, wb.shorePoly)) return false;
    const ring = wb.shorePoly[0] ? [...wb.shorePoly, wb.shorePoly[0]] : [];
    if (pointToPolylineDist(x, y, ring) < 3.0) return false;
  }
  for (const canal of ctx.canalsBuilt) {
    if (pointToPolylineDist(x, y, canal.centerline) < 0.5 * canal.widthM + 2.0) return false;
  }
  for (const road of ctx.roadsBuilt) {
    if (pointToPolylineDist(x, y, road.centerline) < 0.5 * road.widthM + 1.5) return false;
  }
  for (const wall of ctx.wallsBuilt) {
    if (pointToPolylineDist(x, y, wall.polyline) < 0.5 * wall.thicknessM + 1.5) return false;
  }
  const box: Polygon = [[x - 4, y - 4], [x + 4, y - 4], [x + 4, y + 4], [x - 4, y + 4]];
  for (const b of ctx.spatialHash.queryPolygonBBox(box, 1.0)) {
    if (pointInPolygon(x, y, b.points)) return false;
  }
  return true;
}

/** market 集场：硬化集坪底面 + 中央十字主通道 + 行列货棚 + 市井水井 */
export function compileMarketZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const apron = insetPolygonSafe(zone.points, 4.0);
  if (apron.length < 3) return;
  if (apronClearOfExclusions(apron, obstacleCtx)) {
    targetResult.marketAprons.push({ zoneId: zone.id, kind: 'market_apron', points: apron });
  }

  const c = computePolygonCentroid(apron);
  let spanX = 0;
  let spanY = 0;
  for (const p of apron) {
    spanX = Math.max(spanX, Math.abs(p[0] - c[0]));
    spanY = Math.max(spanY, Math.abs(p[1] - c[1]));
  }
  if (spanX < 12 || spanY < 12) return;

  const stallLength = 6.0;
  const stallWidth = 3.0;
  const pitchX = stallLength + 3.2;
  const pitchY = stallWidth + 3.6;
  const cols = Math.max(1, Math.min(9, Math.floor((spanX * 2 - 12) / pitchX)));
  const rows = Math.max(1, Math.min(7, Math.floor((spanY * 2 - 12) / pitchY)));

  for (let ix = -cols; ix <= cols; ix += 1) {
    if (Math.abs(ix) < 1) continue;
    for (let iy = -rows; iy <= rows; iy += 1) {
      if (Math.abs(iy) < 1) continue;
      const cx = c[0] + ix * pitchX * 0.5;
      const cy = c[1] + iy * pitchY * 0.5;
      if (cx < c[0] - spanX + 6 || cx > c[0] + spanX - 6) continue;
      if (cy < c[1] - spanY + 6 || cy > c[1] + spanY - 6) continue;
      const stall = guardSafeBuilding(
        stallRect(cx, cy, 0, stallLength, stallWidth),
        zone,
        { roofKind: 'town', kind: 'stall', label: `${zone.name} 货棚` },
        obstacleCtx,
      );
      if (stall) targetResult.buildings.push(stall);
    }
  }

  const wellCount = 1 + Math.floor(rng() * 3);
  let placed = 0;
  for (let i = 0; i < wellCount * 6 && placed < wellCount; i += 1) {
    const angle = (i / (wellCount * 6)) * Math.PI * 2 + rng() * 0.4;
    const wx = c[0] + Math.cos(angle) * spanX * 0.34;
    const wy = c[1] + Math.sin(angle) * spanY * 0.34;
    if (!wellAllowed(wx, wy, zone, obstacleCtx)) continue;
    targetResult.wells.push({ zoneId: zone.id, x: wx, y: wy, radiusM: 3.6 });
    placed += 1;
  }
}
