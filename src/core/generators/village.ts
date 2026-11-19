import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import { computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { sampleGradient } from '../terrain/elevationField';
import {
  type ZoneGeneratorInput,
  guardSafeBuilding,
  guardSafeFence,
  guardSafeTree,
} from '../obstacles/guardSafe';

const MAX_HOUSES = 140;

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

function placeHousesAlong(
  input: ZoneGeneratorInput,
  lane: Polyline,
  dirX: number,
  dirY: number,
  nrmX: number,
  nrmY: number,
): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const angle = Math.atan2(dirY, dirX);
  let acc = 0;
  let nextAt = 14 + rng() * 8;
  let index = 0;

  for (let i = 1; i < lane.length; i += 1) {
    const a = lane[i - 1];
    const b = lane[i];
    if (!a || !b) continue;
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 1e-9) continue;
    while (nextAt <= acc + segLen && targetResult.buildings.length < MAX_HOUSES) {
      const t = (nextAt - acc) / segLen;
      const hx = a[0] + (b[0] - a[0]) * t;
      const hy = a[1] + (b[1] - a[1]) * t;
      const side = index % 2 === 0 ? 1 : -1;
      index += 1;
      const nx = nrmX * side;
      const ny = nrmY * side;

      const mainRect = rectPoly(hx + nx * 9.5, hy + ny * 9.5, angle, 12, 6.5);
      const house = guardSafeBuilding(
        mainRect,
        zone,
        { roofKind: 'town', kind: 'farmhouse', label: `${zone.name} 正房` },
        obstacleCtx,
      );
      if (house) {
        targetResult.buildings.push(house);
        const wingCx = hx + nx * 9.5 + dirX * 8.0;
        const wingCy = hy + ny * 9.5 + dirY * 8.0;
        const wing = guardSafeBuilding(
          rectPoly(wingCx, wingCy, angle, 8, 5),
          zone,
          { roofKind: 'town', kind: 'wing', label: `${zone.name} 厢房` },
          obstacleCtx,
        );
        if (wing) targetResult.buildings.push(wing);

        const gardenCx = hx + nx * 25.0;
        const gardenCy = hy + ny * 25.0;
        const fence = guardSafeFence(rectPoly(gardenCx, gardenCy, angle, 18, 14), zone, obstacleCtx);
        if (fence) targetResult.gardenFences.push(fence);

        const tree = guardSafeTree(
          gardenCx + dirX * 3.0,
          gardenCy + dirY * 3.0,
          4.5,
          'garden',
          zone,
          obstacleCtx,
        );
        if (tree) targetResult.trees.push(tree);
      }
      nextAt += 20 + rng() * 16;
    }
    acc += segLen;
  }
}

/** village 顺坡散居：等高线切线方向 3—4 条村径 + 正房/曲尺厢房 + 菜畦篱院 + 果树 */
export function compileVillageZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, elevationField } = input;
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

  const laneCount = 3 + Math.floor(rng() * 2);
  const spacing = 30 + rng() * 12;
  for (let i = 0; i < laneCount; i += 1) {
    const off = (i - (laneCount - 1) / 2) * spacing;
    const ox = c[0] + nrmX * off;
    const oy = c[1] + nrmY * off;
    const lane = clipChordToPolygon(ox, oy, dirX, dirY, halfLen + 4, zone.points);
    if (!lane) continue;
    targetResult.lanes.push(lane);
    placeHousesAlong(input, lane, dirX, dirY, nrmX, nrmY);
  }
}
