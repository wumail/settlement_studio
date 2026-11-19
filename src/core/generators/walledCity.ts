import { computePolygonCentroid } from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import { type ZoneGeneratorInput, guardSafeTree } from '../obstacles/guardSafe';
import { generateVoronoiStreetBlocks } from './townBlocks';

/** walled_city 内城：阶段一已建城墙，阶段二退界 wallThickness + 5m 后复用共享街坊算子 */
export function compileWalledCityZone(input: ZoneGeneratorInput): void {
  const zone = input.zone;
  const inner = insetPolygonSafe(zone.points, zone.wallThicknessM + 5.0);
  if (inner.length < 3) return;
  generateVoronoiStreetBlocks(input, inner, 95, 240, 'inner');

  const c = computePolygonCentroid(inner);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const tree = guardSafeTree(
      c[0] + Math.cos(angle) * 20,
      c[1] + Math.sin(angle) * 20,
      5.5,
      'plaza',
      zone,
      input.obstacleCtx,
    );
    if (tree) input.targetResult.trees.push(tree);
  }
}
