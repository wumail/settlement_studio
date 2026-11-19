import type { Polygon } from '../../schema/geometry.types';
import { computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { clearsPolygon, polygonRadiusOf } from '../obstacles/collisionAudit';
import type { ZoneGeneratorInput } from '../obstacles/guardSafe';

/**
 * 城中套城内孔：落在本选区内或与本选区相交的堡寨 / 集市 / 禁建圈，
 * 作为街坊与屋宇的硬性避让区（walled_city 与 town_blocks 共用）。
 */
export function collectInnerHoles(input: ZoneGeneratorInput): Polygon[] {
  const zone = input.zone;
  const out: Polygon[] = [];
  for (const other of input.project.zones) {
    if (other.id === zone.id) continue;
    if (
      other.contentType !== 'citadel' &&
      other.contentType !== 'market' &&
      other.contentType !== 'exclusion'
    ) {
      continue;
    }
    const c = computePolygonCentroid(other.points);
    if (!pointInPolygon(c[0], c[1], zone.points)) {
      const radius = polygonRadiusOf(other.points, c);
      if (clearsPolygon(other.points, c, radius, zone.points, 0)) continue;
    }
    out.push(other.points);
  }
  return out;
}
