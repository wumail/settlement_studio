export const SCHEMA_VERSION = '3.0.0' as const;
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

/** 左侧工具坞 16 枚测绘工具（V3 七组聚合，严守 NG-01：无任何单栋房屋手动编辑工具） */
export const TOOL_IDS = [
  'select', 'reroll_stamp',
  'sculpt_brush', 'contour_drag', 'add_hill', 'add_ridge',
  'draw_river', 'draw_water_area', 'place_hydraulic',
  'draw_road', 'edit_crossing',
  'draw_zone', 'place_structure',
  'tree_brush',
  'place_landmark', 'measure',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** 高程涂抹微雕笔刷七种工作模式（V3 新增 terrace / ramp / erase） */
export type SculptBrushMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'terrace' | 'ramp' | 'erase';

/** 右侧属性检视器五大标签页 */
export type InspectorTabId = 'terrain' | 'hydro_road' | 'zone' | 'structure' | 'legend' | 'palette';

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

/** 画布可拾取对象目标（严格对应 hitTest 14 级优先级，水工与建筑群先于选区） */
export type SelectionTargetType =
  | 'landmark'
  | 'reef'
  | 'ford'
  | 'weir'
  | 'dock'
  | 'watermill'
  | 'structure'
  | 'bridge'
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

export type {
  BuildingRecordBase,
  CollisionDetail,
  CollisionReport,
  CompiledSceneBase,
  CompiledZoneResultBase,
  FarmlandPlot,
  FenceRecordBase,
  GateStructure,
  MarketApron,
  SaltpanCell,
  TreeRecordBase,
  WallSegment,
  WallTowerPoint,
  WaterGate,
  WellPoint,
} from './scene.types';
