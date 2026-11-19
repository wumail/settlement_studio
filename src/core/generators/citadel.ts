import type { Polygon, Vec2 } from '../../schema/geometry.types';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { clearsPolygon, polygonRadiusOf } from '../obstacles/collisionAudit';
import { insetPolygonSafe } from '../math/voronoi';
import { type ZoneGeneratorInput, guardSafeBuilding, guardSafeTree } from '../obstacles/guardSafe';

const CORNER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-0.28, -0.26],
  [0.28, -0.26],
  [0.28, 0.26],
  [-0.28, 0.26],
];

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

function mainAxisAngle(poly: Polygon): number {
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      best = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return best;
}

/** citadel 堡寨：中轴议事正殿 + 四角高阶条形公仓 + 前庭校场铺装 */
export function compileCitadelZone(input: ZoneGeneratorInput): void {
  const { zone, targetResult, obstacleCtx } = input;
  const inner = insetPolygonSafe(zone.points, zone.wallThicknessM + 4.0);
  if (inner.length < 3) return;
  const c = computePolygonCentroid(inner);
  const angle = mainAxisAngle(inner);
  const box = computePolygonBBox(inner);
  const spanX = Math.max(20, box[2] - box[0]);
  const spanY = Math.max(20, box[3] - box[1]);
  const explicit = input.project.structures.filter(
    (item) => item.zoneId === zone.id || pointInPolygon(item.x, item.y, zone.points),
  );
  if (explicit.length > 0) {
    emitParade(input, inner, c, angle, spanX, spanY);
    return;
  }

  const hall = guardSafeBuilding(
    rectPoly(c[0], c[1], angle, Math.min(30, spanX * 0.3), Math.min(18, spanY * 0.3)),
    zone,
    { roofKind: 'inner', kind: 'hall', label: `${zone.name} 议事正殿` },
    obstacleCtx,
  );
  if (hall) targetResult.buildings.push(hall);

  for (const [kx, ky] of CORNER_OFFSETS) {
    const gx = box[0] + spanX * (0.5 + kx);
    const gy = box[1] + spanY * (0.5 + ky);
    const granary = guardSafeBuilding(
      rectPoly(gx, gy, angle, Math.min(26, spanX * 0.26), Math.min(9, spanY * 0.16)),
      zone,
      { roofKind: 'inner', kind: 'granary', label: `${zone.name} 公仓` },
      obstacleCtx,
    );
    if (granary) targetResult.buildings.push(granary);
  }

  emitParade(input, inner, c, angle, spanX, spanY);
}

/** 高阶院坪/校场底面 + 院树：已有显式建筑群时只铺底与点树，不再硬塞固定五小点 */
function emitParade(
  input: ZoneGeneratorInput,
  inner: Polygon,
  c: Vec2,
  angle: number,
  spanX: number,
  spanY: number,
): void {
  const { zone, targetResult, obstacleCtx } = input;
  const parade = rectPoly(c[0], c[1], angle, Math.min(54, spanX * 0.58), Math.min(34, spanY * 0.44));
  const paradeCentroid = computePolygonCentroid(parade);
  const paradeRadius = polygonRadiusOf(parade, paradeCentroid);
  const blocked = obstacleCtx.exclusionPolys.some(
    (ex) => !clearsPolygon(parade, paradeCentroid, paradeRadius, ex, 0),
  );
  const cornersInside = parade.every((point) => pointInPolygon(point[0], point[1], inner));
  if (!blocked && cornersInside) {
    targetResult.marketAprons.push({ zoneId: zone.id, kind: 'parade_ground', points: parade });
  }
  const tree = guardSafeTree(c[0], c[1], 5.6, 'plaza', zone, obstacleCtx);
  if (tree) targetResult.trees.push(tree);
}
