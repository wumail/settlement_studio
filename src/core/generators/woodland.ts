import { computePolygonBBox } from '../math/polygon';
import { type ZoneGeneratorInput, guardSafeTree } from '../obstacles/guardSafe';

/** woodland 成片疏林：间距 11 + (1 - density) * 7 米抖动网格，逐点经 guardSafeTree 剔除水系/道路/房屋/禁建圈 */
export function compileWoodlandZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  const spacing = 11 + (1 - zone.density) * 7;
  const box = computePolygonBBox(zone.points);
  let row = 0;
  for (let y = box[1]; y <= box[3]; y += spacing) {
    row += 1;
    const rowOffset = row % 2 === 0 ? spacing * 0.5 : 0;
    for (let x = box[0] + rowOffset; x <= box[2]; x += spacing) {
      const jx = x + (rng() - 0.5) * spacing * 0.6;
      const jy = y + (rng() - 0.5) * spacing * 0.6;
      const tree = guardSafeTree(jx, jy, 3.4 + rng() * 3.2, 'woodland', zone, obstacleCtx);
      if (tree) targetResult.trees.push(tree);
    }
  }
}

/** exclusion 禁建保护区：零屋零田零树，仅记录多边形供编辑态虚线渲染 */
export function compileExclusionZone(input: ZoneGeneratorInput): void {
  input.targetResult.exclusionPoly = input.zone.points;
}
