export const SCHEMA_VERSION = '2.0.0' as const;
export const GRID_N = 257 as const;
export const GRID_POINT_COUNT = 66049 as const; // 257 * 257
export const OBSTACLE_GRID_N = 512 as const;

/** 二维世界平面坐标 [wx, wy]，单位：米 (m) */
export type Vec2 = readonly [number, number];

/** 开折线顶点序列（至少 2 点），严禁嵌套为四维数组 */
export type Polyline = ReadonlyArray<Vec2>;

/** 简单闭合多边形外环顶点序列（至少 3 点，首尾不重复存储） */
export type Polygon = ReadonlyArray<Vec2>;

/** 轴对齐包围盒 [minX, minY, maxX, maxY] */
export type BBox = readonly [number, number, number, number];

/** 左侧工具坞锁死 12 枚测绘工具枚举（严守 NG-01：无任何单栋房屋手动编辑工具） */
export const TOOL_IDS = [
  'select', 'contour_drag', 'sculpt_brush', 'add_hill', 'add_ridge', 'draw_river',
  'draw_water_area', 'place_reef', 'draw_road', 'draw_zone', 'place_landmark', 'measure',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** 高程涂抹微雕笔刷四种工作模式 */
export type SculptBrushMode = 'raise' | 'lower' | 'smooth' | 'flatten';

/** 右侧属性检视器五大标签页 */
export type InspectorTabId = 'terrain' | 'hydro_road' | 'zone' | 'legend' | 'palette';

/** 画布视口状态模型 */
export interface ViewportState {
  widthPx: number;
  heightPx: number;
  dpr: number;
  panX: number;
  panY: number;
  zoom: number;
  worldSizeM: number;
}

/** 画布可拾取对象目标（严格对应 hitTest 9 级优先级） */
export type SelectionTargetType =
  | 'landmark'
  | 'reef'
  | 'ford'
  | 'canal'
  | 'road'
  | 'river'
  | 'waterBody'
  | 'zone'
  | 'terrainShape';

export interface SelectionTarget {
  readonly type: SelectionTargetType;
  readonly id: string;
  readonly name?: string;
}

/** 碰撞冲突明细与全局零穿模核验报告 */
export interface CollisionDetail {
  readonly type: 'water' | 'road' | 'wall' | 'building' | 'exclusion';
  readonly buildingId: string;
  readonly zoneId: string;
}

export interface CollisionReport {
  readonly passed: boolean;
  readonly totalHits: number;
  readonly buildingRoadHits: number;
  readonly buildingWaterHits: number;
  readonly buildingWallHits: number;
  readonly buildingBuildingHits: number;
  readonly buildingExclusionHits: number;
  readonly riverIslands: number;
  readonly details: ReadonlyArray<CollisionDetail>;
}

/** L0 零上层依赖场景基础契约（供 M0 Store 与 M4 渲染层直接引用，M3 用 Safe* 品牌类型收窄） */
export interface BuildingRecordBase {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneName: string;
  readonly contentType: string;
  readonly roofKind: 'inner' | 'town';
  readonly kind: 'house' | 'farmhouse' | 'wing' | 'hall' | 'granary' | 'stall';
  readonly label: string;
  readonly points: Polygon;
  readonly centroid: Vec2;
  readonly areaM2: number;
  readonly ridge: readonly [Vec2, Vec2] | null;
}

export interface FenceRecordBase {
  readonly zoneId: string;
  readonly points: Polyline;
}

export interface TreeRecordBase {
  readonly zoneId: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly kind: 'garden' | 'woodland' | 'plaza' | 'field';
}

export interface WallTowerPoint {
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly kind: 'tower' | 'gate_tower';
}

export interface GateStructure {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly arc: number;
  readonly angleDeg: number;
  readonly gapHalf: number;
  readonly thicknessM: number;
  readonly polygon: Polygon;
  readonly roadId: string;
  readonly roadName: string;
  readonly roadWidthM: number;
  readonly towers: readonly [Vec2, Vec2];
}

export interface WallSegment {
  readonly id: string;
  readonly zoneId: string;
  readonly thicknessM: number;
  readonly polyline: Polyline;
  readonly closed: boolean;
  readonly gates: ReadonlyArray<GateStructure>;
  readonly towers: ReadonlyArray<WallTowerPoint>;
}

export interface FarmlandPlot {
  readonly id: string;
  readonly zoneId: string;
  readonly polygon: Polygon;
  readonly innerPolygon: Polygon;
  readonly areaHa: number;
  readonly angleDeg: number;
  readonly furrows: ReadonlyArray<Polyline>;
}

export interface SaltpanCell {
  readonly id: string;
  readonly zoneId: string;
  readonly polygon: Polygon;
  readonly opacity: number;
}

export interface MarketApron {
  readonly zoneId: string;
  readonly kind: 'market_apron' | 'parade_ground';
  readonly points: Polygon;
}

export interface WellPoint {
  readonly zoneId: string;
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
}

export interface CompiledZoneResultBase<
  TBuilding = BuildingRecordBase,
  TFence = FenceRecordBase,
  TTree = TreeRecordBase,
> {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly seed: number;
  readonly points: Polygon;
  readonly areaHa: number;
  readonly buildings: ReadonlyArray<TBuilding>;
  readonly walls: ReadonlyArray<WallSegment>;
  readonly towers: ReadonlyArray<WallTowerPoint>;
  readonly internalStreets: ReadonlyArray<Polyline>;
  readonly lanes: ReadonlyArray<Polyline>;
  readonly gardenFences: ReadonlyArray<TFence>;
  readonly trees: ReadonlyArray<TTree>;
  readonly farmlandPlots: ReadonlyArray<FarmlandPlot>;
  readonly saltpanCells: ReadonlyArray<SaltpanCell>;
  readonly marketAprons: ReadonlyArray<MarketApron>;
  readonly wells: ReadonlyArray<WellPoint>;
  readonly exclusionPoly: Polygon | null;
}

export interface CompiledSceneBase<
  TBuilding = BuildingRecordBase,
  TFence = FenceRecordBase,
  TTree = TreeRecordBase,
> {
  readonly schemaVersion: string;
  readonly worldSizeM: number;
  readonly terrain: {
    readonly contours: ReadonlyArray<{
      readonly id: string;
      readonly elev: number;
      readonly isIndex: boolean;
      readonly closed: boolean;
      readonly points: Polyline;
    }>;
    readonly scarpTicks: ReadonlyArray<{
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }>;
    readonly minElev: number;
    readonly maxElev: number;
  };
  readonly hydro: {
    readonly rivers: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly centerline: Polyline;
      readonly bankPolygon: Polygon;
      readonly ripples: ReadonlyArray<Polyline>;
      readonly islands: readonly never[];
    }>;
    readonly waterBodies: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly kind: 'lake' | 'sea';
      readonly shorePoly: Polygon;
      readonly ripples: ReadonlyArray<Polygon>;
    }>;
    readonly canals: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly style: 'open' | 'qanat';
      readonly centerline: Polyline;
      readonly widthM: number;
      readonly bankPolygon: Polygon;
      readonly shaftPoints: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
        readonly radiusM: number;
      }>;
    }>;
    readonly reefs: ReadonlyArray<{
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly radiusM: number;
      readonly rocks: ReadonlyArray<{ readonly points: Polygon }>;
      readonly foamRing: Polygon;
    }>;
    readonly roads: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly tier: 'highway' | 'street' | 'lane';
      readonly widthM: number;
      readonly centerline: Polyline;
    }>;
    readonly bridges: ReadonlyArray<{
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
      readonly parapetLeft: readonly [Vec2, Vec2];
      readonly parapetRight: readonly [Vec2, Vec2];
      readonly abutments: ReadonlyArray<readonly [Vec2, Vec2]>;
    }>;
    readonly fordCrossings: ReadonlyArray<{
      readonly id: string;
      readonly fordId: string;
      readonly roadId: string;
      readonly riverId: string;
      readonly x: number;
      readonly y: number;
      readonly tangent: Vec2;
      readonly normal: Vec2;
      readonly riverWidthM: number;
      readonly radiusM: number;
    }>;
    readonly riverIslandCount: number;
  };
  readonly zones: ReadonlyArray<CompiledZoneResultBase<TBuilding, TFence, TTree>>;
  readonly buildings: ReadonlyArray<TBuilding>;
  readonly walls: ReadonlyArray<WallSegment>;
  readonly trees: ReadonlyArray<TTree>;
  readonly farmlandPlots: ReadonlyArray<FarmlandPlot>;
  readonly saltpanCells: ReadonlyArray<SaltpanCell>;
  readonly marketAprons: ReadonlyArray<MarketApron>;
  readonly lanes: ReadonlyArray<Polyline>;
  readonly gardenFences: ReadonlyArray<TFence>;
  readonly internalStreets: ReadonlyArray<Polyline>;
  readonly wells: ReadonlyArray<WellPoint>;
  readonly exclusionPolys: ReadonlyArray<Polygon>;
  readonly collisionReport: CollisionReport;
  readonly stats: {
    readonly compileMs: number;
    readonly zoneCount: number;
    readonly buildingCount: number;
    readonly wallCount: number;
    readonly treeCount: number;
    readonly bridgeCount: number;
    readonly contourCount: number;
    readonly collisionHits: number;
  };
}
