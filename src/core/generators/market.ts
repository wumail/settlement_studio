import type { Polygon, Vec2 } from '../../schema/geometry.types';
import { computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import { orientedRect } from '../math/oriented';
import {
  clearsPolygon,
  pointToPolylineDist,
  polygonRadiusOf,
} from '../obstacles/collisionAudit';
import { type ObstacleContext, type ZoneGeneratorInput, guardSafeBuilding } from '../obstacles/guardSafe';
import { sampleSlopeDeg } from '../terrain/elevationField';

/** 摊棚按“疏排摊列”铺展：12m 排距 + 5.5m 深棚 + 列间随机断口，消除实心巧克力板观感 */
const ROW_PITCH_Y = 11.6;
const SEG_PITCH_X = 26;
const SEG_GAP_M = 2.2;
const STALL_D = 5.5;
/** 前檐雨棚进深：计入足印但不改变 5.5m 主体尺度观感 */
const STALL_AWNING_D = 1.0;
const AISLE_M = 5.0;
const MAX_STALLS = 420;

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


/** 水平扫描线求选区在该行的 x 区间，摊列严格贴坪边铺满而非被裁多边形拒掉 */
function rowSpans(poly: Polygon, y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    if ((a[1] > y) !== (b[1] > y)) {
      xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i] ?? 0, xs[i + 1] ?? 0]);
  return out;
}

/** stalls：疏排摊列（12m 排距 + 5.5m 深棚 + 前檐雨棚），按行扫描铺满集坪 */
function placeStalls(input: ZoneGeneratorInput, apron: Polygon, c: Vec2, spanX: number, spanY: number): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const rows = Math.max(1, Math.min(44, Math.round((spanY * 2 - 2) / ROW_PITCH_Y)));
  const usableY = rows * ROW_PITCH_Y;
  const segMax = SEG_PITCH_X - SEG_GAP_M;
  let placed = 0;
  for (let iy = 0; iy < rows && placed < MAX_STALLS; iy += 1) {
    const y = c[1] - usableY * 0.5 + (iy + 0.5) * ROW_PITCH_Y;
    for (const [x0, x1] of rowSpans(apron, y)) {
      const lo = x0 + 1.2;
      const hi = x1 - 1.2;
      if (hi - lo < 7) continue;
      const pieces: Array<[number, number]> = [];
      // 窄坪不再中央开路，避免两侧都放不下整棚
      if (hi - lo > 36 && c[0] - AISLE_M * 0.5 > lo && c[0] + AISLE_M * 0.5 < hi) {
        pieces.push([lo, c[0] - AISLE_M * 0.5], [c[0] + AISLE_M * 0.5, hi]);
      } else {
        pieces.push([lo, hi]);
      }
      for (const [a, b] of pieces) {
        let cursor = a;
        while (cursor + 8 <= b && placed < MAX_STALLS) {
          const len = Math.min(segMax, b - cursor);
          const cx = cursor + len * 0.5;
          cursor += len + SEG_GAP_M * (0.7 + rng() * 0.9);
          const stall = guardSafeBuilding(
            orientedRect(cx, y + (rng() - 0.5) * 0.4, len * (0.94 + rng() * 0.06), STALL_D + STALL_AWNING_D, 0),
            zone,
            { roofKind: 'town', kind: 'stall', label: `${zone.name} 货棚` },
            obstacleCtx,
          );
          if (stall) {
            targetResult.buildings.push(stall);
            placed += 1;
          }
        }
      }
    }
  }
  void spanX;
}

/** timber_yard：大梁木料堆场 + 账房，堆垛间距更大、留出吊运通道 */
function placeTimberYard(input: ZoneGeneratorInput, c: Vec2, spanX: number, spanY: number): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const cols = Math.max(1, Math.min(14, Math.round((spanX * 2 - 4) / 22)));
  const rows = Math.max(1, Math.min(24, Math.round((spanY * 2 - 4) / 13.5)));
  const usableX = cols * 22;
  const usableY = rows * 13.5;
  for (let ix = 0; ix < cols; ix += 1) {
    const x = c[0] - usableX * 0.5 + (ix + 0.5) * 22;
    for (let iy = 0; iy < rows; iy += 1) {
      const y = c[1] - usableY * 0.5 + (iy + 0.5) * 13.5;
      if (Math.abs(y - c[1]) < 5.5) continue;
      const stack = guardSafeBuilding(
        orientedRect(x + (rng() - 0.5) * 2.2, y, 12.5 + rng() * 2, 5.8, (rng() - 0.5) * 7),
        zone,
        { roofKind: 'town', kind: 'stall', label: `${zone.name} 木料堆` },
        obstacleCtx,
      );
      if (stack) targetResult.buildings.push(stack);
    }
  }
  const hut = guardSafeBuilding(
    orientedRect(c[0] + spanX * 0.42, c[1] - spanY * 0.55, 11, 7, 0),
    zone,
    { roofKind: 'town', kind: 'hall', label: `${zone.name} 木行账房` },
    obstacleCtx,
  );
  if (hut) targetResult.buildings.push(hut);
}

/** port_apron：沿岸货栈一字排开（26m 柱距），内侧两排验货棚，岸坪始终贴着水岸 */
function placePortApron(input: ZoneGeneratorInput, apron: Polygon, c: Vec2, spanX: number, spanY: number): void {
  const { zone, targetResult, obstacleCtx } = input;
  let bestA = apron[0] ?? [0, 0];
  let bestB = apron[1] ?? [0, 0];
  let bestLen = 0;
  for (let i = 0; i < apron.length; i += 1) {
    const a = apron[i];
    const b = apron[(i + 1) % apron.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      bestA = a;
      bestB = b;
    }
  }
  if (bestLen < 20) return;
  const ux = (bestB[0] - bestA[0]) / bestLen;
  const uy = (bestB[1] - bestA[1]) / bestLen;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  // 法向朝内：以岸线中点向两侧各探 10m，落在集坪内的一侧才是陆地
  const mx = (bestA[0] + bestB[0]) * 0.5;
  const my = (bestA[1] + bestB[1]) * 0.5;
  let nx = -uy;
  let ny = ux;
  if (!pointInPolygon(mx + nx * 10, my + ny * 10, apron)) {
    nx = -nx;
    ny = -ny;
  }
  const count = Math.max(2, Math.min(8, Math.floor(bestLen / 26)));
  for (let i = 0; i < count; i += 1) {
    const t = ((i + 0.5) / count) * bestLen;
    const warehouse = guardSafeBuilding(
      orientedRect(bestA[0] + ux * t + nx * 9.5, bestA[1] + uy * t + ny * 9.5, 22, 13, angle),
      zone,
      { roofKind: 'town', kind: 'hall', label: `${zone.name} 货栈` },
      obstacleCtx,
    );
    if (warehouse) targetResult.buildings.push(warehouse);
  }
  for (const offset of [24, 36]) {
    let cursor = 1.5;
    while (cursor + 9 < bestLen - 1.5) {
      const len = Math.min(SEG_PITCH_X - SEG_GAP_M, bestLen - 1.5 - cursor);
      const t = cursor + len * 0.5;
      const px = bestA[0] + ux * t + nx * offset;
      const py = bestA[1] + uy * t + ny * offset;
      cursor += len + SEG_GAP_M;
      if (!pointInPolygon(px, py, apron)) continue;
      const shed = guardSafeBuilding(
        orientedRect(px, py, len * 0.9, STALL_D, angle),
        zone,
        { roofKind: 'town', kind: 'stall', label: `${zone.name} 验货棚` },
        obstacleCtx,
      );
      if (shed) targetResult.buildings.push(shed);
    }
  }
  void spanX;
  void spanY;
  void c;
}

/** market 集场：硬化集坪 + 十字主通道 + 三种集市模式 + 市井水井 */
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

  if (zone.marketMode === 'timber_yard') placeTimberYard(input, c, spanX, spanY);
  else if (zone.marketMode === 'port_apron') placePortApron(input, apron, c, spanX, spanY);
  else placeStalls(input, apron, c, spanX, spanY);

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
