import type { Polygon, Polyline, Vec2, ViewportState } from '../schema/geometry.types';

export interface StrokeStyle {
  readonly stroke: string;
  readonly lineWidth: number;
  readonly dash?: ReadonlyArray<number>;
  readonly lineCap?: 'round' | 'butt' | 'square';
  readonly lineJoin?: 'round' | 'miter' | 'bevel';
  readonly opacity?: number;
}

export interface ShapeStyle {
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly lineWidth?: number;
  readonly dash?: ReadonlyArray<number>;
  readonly opacity?: number;
}

export interface TextStyle {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly fontWeight?: number | string;
  readonly italic?: boolean;
  readonly fill: string;
  readonly haloColor?: string;
  readonly haloWidthPx?: number;
  readonly align?: 'left' | 'center' | 'right';
  readonly baseline?: 'top' | 'middle' | 'alphabetic';
  /** 整段文字（含纸晕）统一透明度：0 即完全隐去，双端同源生效 */
  readonly opacity?: number;
}

export interface MergedCircleItem {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface RenderBackend {
  readonly widthPx: number;
  readonly heightPx: number;

  beginLayer(layerId: string): void;
  endLayer(): void;

  pushClipRect(x: number, y: number, w: number, h: number): void;
  popClip(): void;

  pushTransform(tx: number, ty: number, scaleX: number, scaleY: number): void;
  popTransform(): void;

  drawPaperBackground(paperHex: string, withVignette: boolean): void;
  drawRect(x: number, y: number, w: number, h: number, style: ShapeStyle): void;
  drawRoundedRect(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void;
  drawPolygon(points: Polygon, style: ShapeStyle): void;
  drawPolygonWithHoles(outer: Polygon, holes: ReadonlyArray<Polygon>, style: ShapeStyle): void;
  drawBatchPolygons(polygons: ReadonlyArray<Polygon>, style: ShapeStyle): void;
  drawPolyline(points: Polyline, style: StrokeStyle, closed?: boolean): void;
  drawSegments(segments: ReadonlyArray<readonly [Vec2, Vec2]>, style: StrokeStyle): void;
  drawBezier(p0: Vec2, cp1: Vec2, cp2: Vec2, p3: Vec2, style: ShapeStyle, closed?: boolean): void;
  drawCircle(cx: number, cy: number, r: number, style: ShapeStyle): void;
  drawArc(cx: number, cy: number, r: number, startRad: number, endRad: number, style: StrokeStyle): void;
  drawCirclesMergedPass(circles: ReadonlyArray<MergedCircleItem>, fillStyle: string): void;
  drawText(text: string, x: number, y: number, style: TextStyle): void;
  measureTextWidth(text: string, fontSizePx: number): number;
}

export const MIN_ZOOM = 0.06;
export const MAX_ZOOM = 5.0;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function createViewport(
  widthPx: number,
  heightPx: number,
  worldSizeM: number,
  dpr = 1,
): ViewportState {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  const world = Math.max(1, worldSizeM);
  return {
    widthPx: w,
    heightPx: h,
    dpr: Math.max(0.5, dpr),
    panX: 0,
    panY: 0,
    zoom: clampZoom(Math.min(w, h) / world),
    worldSizeM: world,
  };
}

export function worldToScreen(wx: number, wy: number, vp: ViewportState): Vec2 {
  return [vp.panX + wx * vp.zoom, vp.panY + wy * vp.zoom];
}

export function screenToWorld(sx: number, sy: number, vp: ViewportState): Vec2 {
  const zoom = vp.zoom > 1e-9 ? vp.zoom : 1;
  return [(sx - vp.panX) / zoom, (sy - vp.panY) / zoom];
}

/** 光标不动点缩放：缩放前后 (sx, sy) 指向的世界坐标严格恒定 */
export function zoomViewportAtScreenPoint(
  vp: ViewportState,
  sx: number,
  sy: number,
  factor: number,
): ViewportState {
  const anchor = screenToWorld(sx, sy, vp);
  const nextZoom = clampZoom(vp.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  return {
    ...vp,
    zoom: nextZoom,
    panX: sx - anchor[0] * nextZoom,
    panY: sy - anchor[1] * nextZoom,
  };
}

export function fitViewportToWorld(
  vp: ViewportState,
  widthPx: number,
  heightPx: number,
  worldSizeM: number,
  paddingPx = 40,
): ViewportState {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  const world = Math.max(1, worldSizeM);
  const usable = Math.max(16, Math.min(w, h) - paddingPx * 2);
  const zoom = clampZoom(usable / world);
  return {
    ...vp,
    widthPx: w,
    heightPx: h,
    worldSizeM: world,
    zoom,
    panX: (w - world * zoom) * 0.5,
    panY: (h - world * zoom) * 0.5,
  };
}

/** 世界坐标矩形 -> 屏幕矩形（图幅投影框，供裁剪与图饰避让复用） */
export function worldRectToScreen(
  vp: ViewportState,
): { x: number; y: number; w: number; h: number } {
  const topLeft = worldToScreen(0, 0, vp);
  return {
    x: topLeft[0],
    y: topLeft[1],
    w: vp.worldSizeM * vp.zoom,
    h: vp.worldSizeM * vp.zoom,
  };
}
