import { computePolygonCentroid } from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import { type ZoneGeneratorInput, guardSafeTree } from '../obstacles/guardSafe';
import { generateObbStreetBlocks } from './townBlocks';
import { collectInnerHoles } from './zoneHoles';

export { collectInnerHoles };

/** walled_city 内城：城垣退界后按道路骨架 + OBB 布屋，内嵌堡寨/集市/禁建圈自动挖空 */
export function compileWalledCityZone(input: ZoneGeneratorInput): void {
  const zone = input.zone;
  const inner = insetPolygonSafe(zone.points, zone.wallThicknessM + 5.0);
  if (inner.length < 3) return;
  const holes = collectInnerHoles(input);
  generateObbStreetBlocks(input, inner, 95, 240, 'inner', holes);

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
