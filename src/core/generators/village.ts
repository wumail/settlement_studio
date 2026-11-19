import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import { computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { sampleGradient } from '../terrain/elevationField';
import {
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeFence,
  guardSafeTree,
} from '../obstacles/guardSafe';
import { pointToPolylineDist } from '../obstacles/collisionAudit';
import { roadSkeletonLines } from './streetSkeleton';

const MAX_HOUSES = 150;

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

/** 沿骨架（ribbonSpine / 穿区干道）双侧带状排布农舍、曲尺厢房、菜畦篱院与院果 */
function placeHousesAlong(input: ZoneGeneratorInput, spine: Polyline): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  let acc = 0;
  let nextAt = 12 + rng() * 8;
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
      const side = index % 2 === 0 ? 1 : -1;
      index += 1;
      const offset = 7.5 + rng() * 3.5;
      const cx = hx + nrmX * side * offset;
      const cy = hy + nrmY * side * offset;
      const mainRect = rectPoly(cx, cy, angle, 12 + rng() * 3, 6.5 + rng() * 1.6);
      const house = guardSafeBuilding(
        mainRect,
        zone,
        { roofKind: 'town', kind: 'farmhouse', label: `${zone.name} 正房` },
        obstacleCtx,
      );
      if (house) {
        targetResult.buildings.push(house);
        const wingCx = cx + dirX * 8.2 + nrmX * side * 3.4;
        const wingCy = cy + dirY * 8.2 + nrmY * side * 3.4;
        const wing = guardSafeBuilding(
          rectPoly(wingCx, wingCy, angle + Math.PI / 2, 8, 5),
          zone,
          { roofKind: 'town', kind: 'wing', label: `${zone.name} 厢房` },
          obstacleCtx,
        );
        if (wing) targetResult.buildings.push(wing);
        const gardenCx = hx + nrmX * side * 24.0;
        const gardenCy = hy + nrmY * side * 24.0;
        const fence = guardSafeFence(rectPoly(gardenCx, gardenCy, angle, 18, 14), zone, obstacleCtx);
        if (fence) targetResult.gardenFences.push(fence);
        const tree = guardSafeTree(
          gardenCx + dirX * (rng() - 0.5) * 6,
          gardenCy + dirY * (rng() - 0.5) * 6,
          4.2 + rng() * 1.6,
          'garden',
          zone,
          obstacleCtx,
        );
        if (tree) targetResult.trees.push(tree);
      }
      nextAt += 19 + rng() * 15;
    }
    acc += segLen;
  }
}

/** 折线贴合判定：任一骨架顶点距既有道路中心线 < 阈值即视为同走廊 */
function polylineNear(line: Polyline, road: Polyline, distM: number): boolean {
  for (const p of line) {
    if (pointToPolylineDist(p[0], p[1], road) < distM) return true;
  }
  return false;
}

/** 无路可依时按等高线切线生成 3–4 条平行村径（现状回退，保证任意地形可成村） */
function contourFallbackLanes(input: ZoneGeneratorInput): Polyline[] {
  const { zone, rng, elevationField } = input;
  const c = computePolygonCentroid(zone.points);
  const g = sampleGradient(elevationField, c[0], c[1]);
  let dirX = -g.dzdy;
  let dirY = g.dzdx;
  const mag = Math.hypot(dirX, dirY);
  if (mag < 1e-9) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX /= mag;
    dirY /= mag;
  }
  const nrmX = -dirY;
  const nrmY = dirX;
  let halfLen = 0;
  for (const p of zone.points) halfLen = Math.max(halfLen, Math.hypot(p[0] - c[0], p[1] - c[1]));
  const lanes: Polyline[] = [];
  const laneCount = 3 + Math.floor(rng() * 2);
  const spacing = 30 + rng() * 12;
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

/** village 带状村寨：优先 ribbonSpine，其次穿区干道，最后回退等高线切线 */
export function compileVillageZone(input: ZoneGeneratorInput): void {
  const { zone, targetResult } = input;
  const spines: Polyline[] = [];
  if (zone.ribbonSpine.length >= 2) {
    spines.push(zone.ribbonSpine.map((p) => [p[0], p[1]] as Vec2));
  } else {
    const roads = roadSkeletonLines(zone.points, input.obstacleCtx.roadsBuilt);
    for (const road of roads) spines.push(road);
  }
  if (spines.length === 0) {
    const lanes = contourFallbackLanes(input);
    for (const lane of lanes) {
      targetResult.lanes.push(lane);
      placeHousesAlong(input, lane);
    }
    return;
  }
  for (const spine of spines) {
    // 骨架已贴合现有主干道（< 10m）时不再重复推白线，避免村道与官道双线叠印
    const overlapsRoad = input.obstacleCtx.roadsBuilt.some(
      (road) => road.tier !== 'lane' && polylineNear(spine, road.centerline, 10),
    );
    if (!overlapsRoad) targetResult.lanes.push(spine);
    placeHousesAlong(input, spine);
  }
}
