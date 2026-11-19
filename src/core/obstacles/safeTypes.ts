import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonAreaSigned, computePolygonBBox, computePolygonCentroid } from '../math/polygon';

export const SafeBuildingBrand: unique symbol = Symbol('terrax.SafeBuilding');
export const SafeFenceBrand: unique symbol = Symbol('terrax.SafeFence');
export const SafeTreeBrand: unique symbol = Symbol('terrax.SafeTree');

export type BuildingRoofKind = 'inner' | 'town';
export type BuildingArchetype = 'house' | 'farmhouse' | 'wing' | 'hall' | 'granary' | 'stall';
export type TreeArchetype = 'garden' | 'woodland' | 'plaza' | 'field';

export interface SafeBuilding {
  readonly [SafeBuildingBrand]: true;
  readonly id: string; readonly zoneId: string; readonly zoneName: string;
  readonly contentType: TownProject['zones'][number]['contentType'];
  readonly roofKind: BuildingRoofKind; readonly kind: BuildingArchetype; readonly label: string;
  readonly points: Polygon; readonly centroid: Vec2; readonly areaM2: number;
  readonly ridge: readonly [Vec2, Vec2] | null;
}

export interface SafeFence {
  readonly [SafeFenceBrand]: true; readonly zoneId: string; readonly points: Polyline;
}

export interface SafeTree {
  readonly [SafeTreeBrand]: true; readonly zoneId: string;
  readonly x: number; readonly y: number; readonly r: number; readonly kind: TreeArchetype;
}

/** 涂抹林木专属 zoneId：编译产物携带，渲染层据此去重避免与 project.paintedTrees 双绘 */
export const PAINTED_TREE_ZONE = '__painted__';

export function brandPaintedTree(
  x: number,
  y: number,
  radiusM: number,
  kind: TreeArchetype,
): SafeTree {
  return {
    [SafeTreeBrand]: true,
    zoneId: PAINTED_TREE_ZONE,
    x,
    y,
    r: Math.max(2.5, Math.min(16, radiusM)),
    kind,
  };
}

/**
 * 刚性水工/建筑群足印的 SafeBuilding 视图：仅进入 spatialHash 供邻屋与树木净空查询，
 * 不写入 scene.buildings，不参与屋宇计数与撤栈。
 */
export function brandRigidBuilding(points: Polygon, id: string, label: string): SafeBuilding {
  const centroid = computePolygonCentroid(points);
  return {
    [SafeBuildingBrand]: true,
    id,
    zoneId: '__rigid__',
    zoneName: '刚性障碍',
    contentType: 'citadel',
    roofKind: 'inner',
    kind: 'hall',
    label,
    points,
    centroid,
    areaM2: Math.abs(computePolygonAreaSigned(points)),
    ridge: null,
  } as SafeBuilding;
}

export function rigidBuildingBox(points: Polygon): readonly [number, number, number, number] {
  return computePolygonBBox(points);
}
