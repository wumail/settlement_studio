import type { Polygon, Vec2 } from '../../schema/geometry.types';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import type { ZoneGeneratorInput } from '../obstacles/guardSafe';
import { polygonTouchesExclusion } from './farmland';

const CELL_LENGTH_M = 24;
const CELL_WIDTH_M = 16;
const BUND_M = 2.0;

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

function cellRect(cx: number, cy: number, angleRad: number, lengthM: number, widthM: number): Vec2[] {
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

/** saltpan 卤畦：沿选区主轴 24×16m 正交盐格、2m 盐埂、越界与禁建圈剔除、0.82—1.0 微差透明度 */
export function compileSaltpanZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const inner = insetPolygonSafe(zone.points, BUND_M);
  if (inner.length < 3) return;
  const angle = mainAxisAngle(inner);
  const c = computePolygonCentroid(inner);
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const box = computePolygonBBox(inner);

  const halfX = Math.max(Math.abs(box[2] - c[0]), Math.abs(c[0] - box[0]));
  const halfY = Math.max(Math.abs(box[3] - c[1]), Math.abs(c[1] - box[1]));
  const pitchX = CELL_LENGTH_M + BUND_M;
  const pitchY = CELL_WIDTH_M + BUND_M;
  const cols = Math.min(26, Math.ceil(halfX / pitchX) + 1);
  const rows = Math.min(26, Math.ceil(halfY / pitchY) + 1);

  for (let ix = -cols; ix <= cols; ix += 1) {
    for (let iy = -rows; iy <= rows; iy += 1) {
      const lx = ix * pitchX;
      const ly = iy * pitchY;
      const wx = c[0] + lx * ca - ly * sa;
      const wy = c[1] + lx * sa + ly * ca;
      if (wx < box[0] - 40 || wx > box[2] + 40 || wy < box[1] - 40 || wy > box[3] + 40) continue;
      const rect = cellRect(wx, wy, angle, CELL_LENGTH_M, CELL_WIDTH_M);
      let inside = true;
      for (const p of rect) {
        if (!pointInPolygon(p[0], p[1], inner)) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      if (polygonTouchesExclusion(rect, obstacleCtx.exclusionPolys, 2.0)) continue;
      targetResult.saltpanCells.push({
        id: `sp_${zone.id}_${targetResult.saltpanCells.length + 1}`,
        zoneId: zone.id,
        polygon: rect,
        opacity: 0.82 + rng() * 0.18,
      });
    }
  }
}
