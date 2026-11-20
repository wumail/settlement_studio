import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import { computePolygonAreaSigned, computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { sampleGradient } from '../terrain/elevationField';
import {
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeFence,
  guardSafeTree,
} from '../obstacles/guardSafe';
import { clearsPolygon, pointToPolylineDist, polygonRadiusOf } from '../obstacles/collisionAudit';
import type { RngFn } from '../math/rng';
import { roadSkeletonLines } from './streetSkeleton';

const MAX_HOUSES = 150;

/** 村落排布尺度：compact 为迷你营地/小村紧凑模式（小木屋 + 环径排屋） */
interface VillageLayout {
  readonly compact: boolean;
  readonly scale: number;
  readonly singleSide: boolean;
}

function rectPoly(cx: number, cy: number, angleRad: number, lengthM: number, widthM: number): Vec2[] {
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

function ringOf(poly: Polygon): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

function clipChordToPolygon(
  px: number,
  py: number,
  dirX: number,
  dirY: number,
  halfLen: number,
  poly: Polygon,
): Polyline | null {
  let best: Vec2[] = [];
  let cur: Vec2[] = [];
  for (let t = -halfLen; t <= halfLen; t += 2.0) {
    const x = px + dirX * t;
    const y = py + dirY * t;
    if (pointInPolygon(x, y, poly)) cur.push([x, y]);
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  if (cur.length > best.length) best = cur;
  return best.length >= 2 ? best : null;
}

/** 跨区屋宇净空：选区压在邻区之上时，绝不把木屋塞进别区民宅（重抽与全量同序，天然可复现） */
function clearOfForeign(poly: Polygon, input: ZoneGeneratorInput): boolean {
  const ctx = input.obstacleCtx;
  const c = computePolygonCentroid(poly);
  const radius = polygonRadiusOf(poly, c);
  for (const other of ctx.spatialHash.queryPolygonBBox(poly, 0)) {
    if (other.zoneId === input.zone.id) continue;
    if (!clearsPolygon(poly, c, radius, other.points, 0)) return false;
  }
  return true;
}

/** 树冠净空复核：避免紧凑营地的院树树冠压盖相邻木屋 */
function treeClearsBuildings(x: number, y: number, r: number, input: ZoneGeneratorInput): boolean {
  const pad = r + 1.4;
  for (const item of input.obstacleCtx.spatialHash.queryBox(x - pad, y - pad, x + pad, y + pad)) {
    if (pointInPolygon(x, y, item.points)) return false;
    if (pointToPolylineDist(x, y, ringOf(item.points)) < pad) return false;
  }
  return true;
}

/** 普通村落正房三档：小柴棚/附舍、普通农舍、大户农家（面宽×进深，米，均乘建筑尺度） */
const FARMHOUSE_TIERS: ReadonlyArray<readonly [number, number]> = [
  [7.2, 4.8],
  [10.5, 6.4],
  [13.2, 7.4],
];

function farmhouseSize(rng: RngFn): readonly [number, number] {
  const r = rng();
  return FARMHOUSE_TIERS[r < 0.32 ? 0 : r < 0.78 ? 1 : 2] ?? FARMHOUSE_TIERS[1]!;
}

/** 沿骨架（ribbonSpine / 穿区干道 / 紧凑环径）排布农舍、曲尺厢房、菜畦篱院与院果 */
function placeHousesAlong(input: ZoneGeneratorInput, spine: Polyline, layout: VillageLayout): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const { compact, scale, singleSide } = layout;
  const ringC = singleSide ? computePolygonCentroid(spine) : null;
  let acc = 0;
  let nextAt = compact ? 4 + rng() * 3 : 12 + rng() * 8;
  let index = 0;
  for (let i = 1; i < spine.length; i += 1) {
    const a = spine[i - 1];
    const b = spine[i];
    if (!a || !b) continue;
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 1e-9) continue;
    const dirX = (b[0] - a[0]) / segLen;
    const dirY = (b[1] - a[1]) / segLen;
    const angle = Math.atan2(dirY, dirX);
    const nrmX = -dirY;
    const nrmY = dirX;
    while (nextAt <= acc + segLen && targetResult.buildings.length < MAX_HOUSES) {
      const t = (nextAt - acc) / segLen;
      const hx = a[0] + (b[0] - a[0]) * t;
      const hy = a[1] + (b[1] - a[1]) * t;
      // 环径单侧排屋：法向恒定朝外（朝中心空地），避免挤入空地或越出选区
      let side = index % 2 === 0 ? 1 : -1;
      if (ringC) {
        const mx = (a[0] + b[0]) * 0.5 - ringC[0];
        const my = (a[1] + b[1]) * 0.5 - ringC[1];
        side = nrmX * mx + nrmY * my < 0 ? -1 : 1;
      }
      index += 1;
      const offset = compact ? 4.2 + rng() * 2.4 : 7.5 + rng() * 3.5;
      const cx = hx + nrmX * side * offset;
      const cy = hy + nrmY * side * offset;
      // 迷你营地直接响应 buildingScale ∈ [0.45, 1.0]，消除 [0.45, 0.90) 死区
      const spec = compact ? null : farmhouseSize(rng);
      const lengthM = compact ? (8.8 + rng() * 4.2) * scale : (spec?.[0] ?? 10.5) * scale;
      const widthM = compact ? (6.2 + rng() * 2.6) * scale : (spec?.[1] ?? 6.4) * scale;
      // 普通村落随路微摆 ±4°，消除兵营式呆板感（紧凑营地保持正对骨架）
      const heading = compact ? angle : angle + (rng() - 0.5) * 0.14;
      const houseRect = rectPoly(cx, cy, heading, lengthM, widthM);
      const house = clearOfForeign(houseRect, input)
        ? guardSafeBuilding(
            houseRect,
            zone,
            { roofKind: 'town', kind: 'farmhouse', label: `${zone.name} 正房` },
            obstacleCtx,
          )
        : null;
      if (house) {
        targetResult.buildings.push(house);
        if (!compact || rng() < 0.3) {
          const wingCx = cx + dirX * 8.2 * scale + nrmX * side * 3.4 * scale;
          const wingCy = cy + dirY * 8.2 * scale + nrmY * side * 3.4 * scale;
          const wingRect = compact
            ? rectPoly(wingCx, wingCy, angle + Math.PI / 2, 5.2 * scale, 3.6 * scale)
            : rectPoly(wingCx, wingCy, angle + Math.PI / 2, 8.0 * scale, 5.0 * scale);
          const wing = clearOfForeign(wingRect, input)
            ? guardSafeBuilding(
                wingRect,
                zone,
                { roofKind: 'town', kind: 'wing', label: `${zone.name} 厢房` },
                obstacleCtx,
              )
            : null;
          if (wing) targetResult.buildings.push(wing);
        }
        if (!compact || rng() < 0.25) {
          const gardenDist = compact ? offset + widthM * 0.5 + 5.5 : 24.0;
          const gardenCx = hx + nrmX * side * gardenDist;
          const gardenCy = hy + nrmY * side * gardenDist;
          const fenceRect = compact
            ? rectPoly(gardenCx, gardenCy, angle, 7.0, 5.0)
            : rectPoly(gardenCx, gardenCy, angle, 18, 14);
          const fence = guardSafeFence(fenceRect, zone, obstacleCtx);
          if (fence) targetResult.gardenFences.push(fence);
          const tr = compact ? 2.6 + rng() * 1.3 : 4.2 + rng() * 1.6;
          const tx = gardenCx + dirX * (rng() - 0.5) * (compact ? 3.5 : 6);
          const ty = gardenCy + dirY * (rng() - 0.5) * (compact ? 3.5 : 6);
          if (!compact || treeClearsBuildings(tx, ty, tr, input)) {
            const tree = guardSafeTree(tx, ty, tr, 'garden', zone, obstacleCtx);
            if (tree) targetResult.trees.push(tree);
          }
        } else if (compact && rng() < 0.55) {
          const tr = 2.5 + rng() * 1.2;
          const outDist = offset + widthM * 0.5 + tr + 2.8 + rng() * 2.5;
          const tx = hx + nrmX * side * outDist + dirX * (rng() - 0.5) * 4;
          const ty = hy + nrmY * side * outDist + dirY * (rng() - 0.5) * 4;
          if (treeClearsBuildings(tx, ty, tr, input)) {
            const back = guardSafeTree(tx, ty, tr, 'garden', zone, obstacleCtx);
            if (back) targetResult.trees.push(back);
          }
        }
      }
      nextAt += compact ? 11 + rng() * 7 : 19 + rng() * 15;
    }
    acc += segLen;
  }
}

/** 折线贴合判定：任一骨架顶点距既有道路中心线 < 阈值即视为同走廊 */
function polylineNear(line: Polyline, road: Polyline, distM: number): boolean {
  return line.some((p) => pointToPolylineDist(p[0], p[1], road) < distM);
}

/** 无路可依时按等高线切线生成 3–4 条平行村径（现状回退，保证任意地形可成村） */
function contourFallbackLanes(input: ZoneGeneratorInput, compact: boolean): Polyline[] {
  const { zone, rng, elevationField } = input;
  const c = computePolygonCentroid(zone.points);
  const g = sampleGradient(elevationField, c[0], c[1]);
  const mag = Math.hypot(g.dzdy, g.dzdx);
  const dirX = mag < 1e-9 ? 1 : -g.dzdy / mag;
  const dirY = mag < 1e-9 ? 0 : g.dzdx / mag;
  const nrmX = -dirY;
  const nrmY = dirX;
  let halfLen = 0;
  for (const p of zone.points) halfLen = Math.max(halfLen, Math.hypot(p[0] - c[0], p[1] - c[1]));
  const lanes: Polyline[] = [];
  const laneCount = compact ? 2 : 3 + Math.floor(rng() * 2);
  const spacing = compact ? 16 + rng() * 6 : 30 + rng() * 12;
  for (let i = 0; i < laneCount; i += 1) {
    const off = (i - (laneCount - 1) / 2) * spacing;
    const lane = clipChordToPolygon(
      c[0] + nrmX * off,
      c[1] + nrmY * off,
      dirX,
      dirY,
      halfLen + 4,
      zone.points,
    );
    if (lane) lanes.push(lane);
  }
  return lanes;
}

/** 质心径向外推：把内嵌空地外扩成营地环径外沿 */
function expandRadial(poly: Polygon, distM: number): Vec2[] {
  const c = computePolygonCentroid(poly);
  return poly.map((p) => {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [p[0], p[1]] as Vec2;
    return [p[0] + (dx / len) * distM, p[1] + (dy / len) * distM] as Vec2;
  });
}

/** 紧凑营地环径骨架：优先绕内嵌空地成环，其次选区内部环径；空返回则回退等高线支径 */
function buildCompactRingSpines(input: ZoneGeneratorInput): Polyline[] {
  const { zone, obstacleCtx } = input;
  const inner = obstacleCtx.exclusionPolys.find((poly) => {
    const c = computePolygonCentroid(poly);
    return pointInPolygon(c[0], c[1], zone.points);
  });
  if (inner && inner.length >= 3) return [ringOf(expandRadial(inner, 6.5))];
  const box = computePolygonBBox(zone.points);
  const inradius = 0.5 * Math.min(box[2] - box[0], box[3] - box[1]);
  const shrink = Math.max(2.5, Math.min(12, inradius * 0.35));
  const c = computePolygonCentroid(zone.points);
  const ring: Vec2[] = zone.points.map((p) => {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) return [p[0], p[1]] as Vec2;
    const keep = Math.max(0, dist - shrink) / dist;
    return [c[0] + dx * keep, c[1] + dy * keep] as Vec2;
  });
  return [ringOf(ring)];
}

/** village 带状村寨：优先 ribbonSpine，其次穿区干道，最后回退等高线切线；迷你营地走紧凑环径 */
export function compileVillageZone(input: ZoneGeneratorInput): void {
  const { zone, targetResult } = input;
  const areaHa = Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
  const rawScale = Math.max(0.45, Math.min(1.6, zone.buildingScale ?? 1));
  const compact = areaHa < 1.5 || rawScale < 0.85;
  const compactScale = Math.min(1.0, rawScale);
  const layout: VillageLayout = { compact, scale: compact ? compactScale : rawScale, singleSide: false };
  // 与既有官道贴合的骨架不再重复推白线，避免村道与路面双线叠印
  const pushLane = (lane: Polyline): void => {
    const overlaps = input.obstacleCtx.roadsBuilt.some(
      (road) => road.tier !== 'lane' && polylineNear(lane, road.centerline, 10),
    );
    if (!overlaps) targetResult.lanes.push(lane);
  };
  if (compact && zone.ribbonSpine.length < 2) {
    const laneStart = targetResult.lanes.length;
    const ringSpines = buildCompactRingSpines(input);
    const outward = { ...layout, singleSide: true };
    for (const ring of ringSpines) {
      if (ring.length < 4) continue;
      pushLane(ring);
      placeHousesAlong(input, ring, outward);
    }
    if (targetResult.buildings.length >= 4) return;
    targetResult.lanes.length = laneStart;
  }
  const spines: Polyline[] = zone.ribbonSpine.length >= 2
    ? [zone.ribbonSpine.map((p) => [p[0], p[1]] as Vec2)]
    : roadSkeletonLines(zone.points, input.obstacleCtx.roadsBuilt);
  if (spines.length === 0) {
    for (const lane of contourFallbackLanes(input, compact)) {
      pushLane(lane);
      placeHousesAlong(input, lane, layout);
    }
    return;
  }
  for (const spine of spines) {
    pushLane(spine);
    placeHousesAlong(input, spine, layout);
  }
  if (compact && targetResult.buildings.length < 4) {
    for (const lane of contourFallbackLanes(input, compact)) {
      pushLane(lane);
      placeHousesAlong(input, lane, layout);
    }
  }
}
