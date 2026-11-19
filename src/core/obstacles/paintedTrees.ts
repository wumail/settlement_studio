import type { Polygon, Polyline } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonBBox } from '../math/polygon';
import type { ElevationFieldData } from '../terrain/elevationField';
import { SpatialHash } from './collisionAudit';
import { type SafeBuilding, type SafeTree, brandPaintedTree } from './guardSafe';
import { isTreeSpotSafe } from './treeGuard';

export interface PaintedTreeContext {
  readonly project: TownProject;
  readonly elevationField: ElevationFieldData;
  readonly rivers: ReadonlyArray<{ readonly bankPolygon: Polygon }>;
  readonly waterBodies: ReadonlyArray<{ readonly shorePoly: Polygon }>;
  readonly canals: ReadonlyArray<{ readonly centerline: Polyline; readonly widthM: number }>;
  readonly roads: ReadonlyArray<{ readonly centerline: Polyline; readonly widthM: number }>;
  readonly walls: ReadonlyArray<{ readonly polyline: Polyline; readonly thicknessM: number }>;
  readonly exclusionPolys: ReadonlyArray<Polygon>;
  readonly rigidPolys: ReadonlyArray<Polygon>;
  readonly buildings: ReadonlyArray<SafeBuilding>;
}

/**
 * 涂抹林木全量复核：笔刷落点经同一套守门规则复检，越界/压水/压路/压屋/压工坊者剔除，
 * 通过者以 SafeTree 品牌身份并入编译产物，参与全局零穿模审计。
 */
export interface PaintedTreeAudit {
  readonly valid: SafeTree[];
  readonly rejectedIds: string[];
}

export function guardedPaintedTrees(ctx: PaintedTreeContext): PaintedTreeAudit {
  const valid: SafeTree[] = [];
  const rejectedIds: string[] = [];
  if (ctx.project.paintedTrees.length === 0) return { valid, rejectedIds };
  const buildingHash = new SpatialHash<{ readonly points: Polygon }>(32);
  for (const b of ctx.buildings) buildingHash.insert(b, computePolygonBBox(b.points));
  const view = {
    worldSizeM: ctx.project.meta.worldSizeM,
    elevationField: ctx.elevationField,
    rivers: ctx.rivers,
    waterBodies: ctx.waterBodies,
    canals: ctx.canals,
    roads: ctx.roads,
    walls: ctx.walls,
    exclusionPolys: ctx.exclusionPolys,
    buildings: ctx.buildings,
    buildingHash,
    rigidPolys: ctx.rigidPolys,
  };
  for (const tree of ctx.project.paintedTrees) {
    if (!isTreeSpotSafe(view, tree.x, tree.y, tree.r, tree.kind, 34)) {
      rejectedIds.push(tree.id);
      continue;
    }
    valid.push(brandPaintedTree(tree.x, tree.y, tree.r, tree.kind));
  }
  return { valid, rejectedIds };
}
