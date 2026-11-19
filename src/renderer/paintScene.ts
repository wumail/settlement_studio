import type { BBox, CompiledSceneBase, Polygon, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import type { LegendDisplayMode } from '../schema/legend.schema';
import { resolveEffectiveLegend } from '../schema/legend.schema';
import { getActivePalette, type ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import { computePolygonBBox, pointInPolygon } from '../core/math/polygon';
import { paintFurniture } from './furnitureLayout';
import { paintAuthored } from './paintAuthored';
import { hasCustomOrder } from './drawOrder';
import { paintBuildings, paintWalls } from './paintBuildings';
import { paintBridges, paintCanals, paintReefsFords, paintWater } from './paintHydro';
import { paintAprons, paintExclusion, paintFarmland, paintLanes, paintRoads, paintSaltpan, paintTrees } from './paintLand';
import { paintHydraulicWorks, paintStructures } from './paintStructures';
import { paintAnnotations, paintGuidedDirectory } from './paintAnnotations';
import { makeContext, type PaintContext, type PaintSceneData } from './paintContext';
import { type BrushCursorInput, type OverlayInput, paintOverlay } from './paintOverlay';
import { paintHachures, paintTerrainTint } from './paintTerrain';
import { type RenderBackend, worldRectToScreen } from './RenderBackend';
import { measureLabel } from './measureLabel';

export interface PaintSceneOptions {
  readonly isExport?: boolean;
  readonly cleanPaper?: boolean;
  readonly includeCartouche?: boolean;
  readonly overlayOnly?: boolean;
  readonly selection?: SelectionTarget | null;
  readonly hoverContourId?: string | null;
  readonly draftPoints?: ReadonlyArray<Vec2>;
  readonly brushCursor?: BrushCursorInput | null;
  readonly measureSegment?: readonly [Vec2, Vec2] | null;
  readonly displayMode?: LegendDisplayMode;
}

const SERIF = '"Palatino Linotype", "Book Antiqua", "Songti SC", serif';
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

function contourLabel(ctx: PaintContext, elev: number, x: number, y: number): void {
  if (ctx.labelOpacity <= 0) return;
  ctx.backend.drawText(`${Math.round(elev)}m`, x + 3, y - 3, {
    fontFamily: SERIF,
    fontSizePx: 9,
    fill: ctx.pal.inkMuted,
    baseline: 'middle',
    haloColor: ctx.pal.paperBg,
    haloWidthPx: 2.2,
    opacity: ctx.labelOpacity,
  });
}

/** 第 13 层图饰与导览目录：交互态钉视口四角，导出态落回地图纸框 */
function paintChrome(
  ctx: PaintContext,
  mode: LegendDisplayMode,
  frame: Rect,
  bounds: Rect,
  boundsMode: 'frame' | 'viewport',
  selection: SelectionTarget | null | undefined,
): void {
  const { backend, pal, project, scene, vp } = ctx;
  paintFurniture(backend, {
    project,
    palette: pal,
    selection,
    legend: resolveEffectiveLegend(
      project.legend,
      (scene as { legend?: TownProject['legend'] } | null)?.legend ?? null,
    ),
    frame,
    widthPx: vp.widthPx,
    heightPx: vp.heightPx,
    zoom: vp.zoom,
    boundsMode,
    opacity: ctx.furnitureOpacity,
  });
  if (mode === 'guided') paintGuidedDirectory(ctx, bounds);
}

function hoveredContour(data: PaintSceneData | null, id: string | null | undefined) {
  if (!data || !id) return null;
  const contour = data.terrain.contours.find((item) => item.id === id);
  return contour ? { points: contour.points, isIndex: contour.isIndex } : null;
}

/**
 * 唯一地图绘制源：Canvas 与 SVG 共享同一套 17 层画家算法指令流。
 * 交互编辑态图饰钉在视口四角；导出成图态图饰排入地图纸框。
 */
export function paintScene(
  backend: RenderBackend,
  project: TownProject,
  scene: CompiledSceneBase | null,
  vp: ViewportState,
  options: PaintSceneOptions = {},
): void {
  const pal: ResolvedPalette = getActivePalette(project.palette);
  const frame = worldRectToScreen(vp);
  const data = scene as PaintSceneData | null;
  const ctx = makeContext(backend, project, data, vp, pal, options.selection ?? null, options.hoverContourId ?? null);
  const mode: LegendDisplayMode = options.displayMode ?? project.legend.displayMode;
  const pure = mode === 'pure';
  const withLabels = !pure;
  const interactive = options.isExport !== true;
  const boundsMode = interactive ? 'viewport' : 'frame';
  const bounds: Rect = interactive
    ? { x: 0, y: 0, w: vp.widthPx, h: vp.heightPx }
    : { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  const overlayInput: OverlayInput = {
    selection: options.selection ?? null,
    draftPoints: options.draftPoints ?? [],
    brushCursor: options.brushCursor ?? null,
    measureSegment: options.measureSegment ?? null,
    measureLabel: measureLabel(scene, options.measureSegment ?? null),
    hoverContour: hoveredContour(data, options.hoverContourId),
  };
  const clip = (id: string, draw: () => void): void => {
    backend.beginLayer(id);
    backend.pushClipRect(frame.x, frame.y, frame.w, frame.h);
    draw();
    backend.popClip();
    backend.endLayer();
  };

  const paintContours = (): void => {
    if (!data) return;
    const opacity = Math.max(0.05, Math.min(1, project.terrain.contourOpacity));
    const showLabels = withLabels && data.terrain.contours.length <= 90;
    const waterMasks: Array<{ readonly box: BBox; readonly poly: Polygon }> = [];
    for (const river of data.hydro.rivers) {
      if (river.bankPolygon.length >= 3) {
        waterMasks.push({ box: computePolygonBBox(river.bankPolygon), poly: river.bankPolygon });
      }
    }
    for (const wb of data.hydro.waterBodies) {
      if (wb.shorePoly.length >= 3) {
        waterMasks.push({ box: computePolygonBBox(wb.shorePoly), poly: wb.shorePoly });
      }
    }
    const inWater = (wx: number, wy: number): boolean => {
      for (const item of waterMasks) {
        if (wx < item.box[0] || wx > item.box[2] || wy < item.box[1] || wy > item.box[3]) continue;
        if (pointInPolygon(wx, wy, item.poly)) return true;
      }
      return false;
    };
    for (const contour of data.terrain.contours) {
      const strokeStyle = {
        stroke: pal.contourLine,
        lineWidth: contour.isIndex ? 1.45 : 0.75,
        opacity: contour.isIndex ? opacity : opacity * 0.72,
      };
      if (waterMasks.length === 0) {
        backend.drawPolyline(contour.points.map(ctx.pt), strokeStyle);
      } else {
        let run: Vec2[] = [];
        for (const p of contour.points) {
          if (inWater(p[0], p[1])) {
            if (run.length >= 2) backend.drawPolyline(run.map(ctx.pt), strokeStyle);
            run = [];
          } else {
            run.push(p);
          }
        }
        if (run.length >= 2) backend.drawPolyline(run.map(ctx.pt), strokeStyle);
      }
      if (!showLabels || !contour.isIndex || contour.points.length <= 6) continue;
      const anchor = contour.points[Math.floor(contour.points.length / 2)];
      if (!anchor || inWater(anchor[0], anchor[1])) continue;
      const screen = ctx.pt(anchor);
      contourLabel(ctx, contour.elev, screen[0], screen[1]);
    }
    const dryTicks = waterMasks.length === 0
      ? data.terrain.scarpTicks
      : data.terrain.scarpTicks.filter((tick) => !inWater((tick.x1 + tick.x2) * 0.5, (tick.y1 + tick.y2) * 0.5));
    backend.drawSegments(
      dryTicks.map((tick) => [ctx.pt([tick.x1, tick.y1]), ctx.pt([tick.x2, tick.y2])] as const),
      { stroke: pal.contourLine, lineWidth: 0.75, opacity },
    );
  };

  if (options.overlayOnly === true) {
    if (options.includeCartouche !== false && !pure) {
      backend.beginLayer('cartouche');
      paintChrome(ctx, mode, frame, bounds, boundsMode, options.selection);
      backend.endLayer();
    }
    backend.beginLayer('ui-overlay');
    paintOverlay(backend, project, vp, pal, overlayInput);
    backend.endLayer();
    return;
  }

  backend.beginLayer('paper-bg');
  backend.drawPaperBackground(pal.paperBg, options.cleanPaper !== true && !pure);
  backend.endLayer();

  clip('terrain-tint', () => paintTerrainTint(ctx));
  if (hasCustomOrder(project)) {
    // 任一物体被手动调层后：全部可选物体按 zIndex 排序统一绘制，可跨类别压盖
    clip('authored', () => paintAuthored(ctx, withLabels));
  } else {
    clip('land-plots', () => {
      paintExclusion(ctx);
      paintFarmland(ctx);
      paintSaltpan(ctx);
      paintAprons(ctx);
      paintHachures(ctx);
    });
    clip('water-bodies', () => paintWater(ctx));
    clip('reefs-fords', () => paintReefsFords(ctx));
    clip('canals', () => paintCanals(ctx));
    clip('hydraulic-works', () => paintHydraulicWorks(ctx));
    clip('roads-streets', () => {
      paintLanes(ctx);
      paintRoads(ctx);
    });
    clip('bridges', () => paintBridges(ctx));
    clip('buildings', () => paintBuildings(ctx));
    clip('walls-wells', () => paintWalls(ctx));
    clip('structures', () => paintStructures(ctx, withLabels));
    clip('trees-canopy', () => paintTrees(ctx));
  }

  // 等高线固定最高层（等效 z=9999，任何物体 zIndex 上限 500 都压不到它）：只以低透明度覆在最上
  clip('contours', paintContours);

  if (data) {
    backend.beginLayer('landmarks-labels');
    backend.pushClipRect(frame.x, frame.y, frame.w, frame.h);
    paintAnnotations(ctx, mode, bounds);
    backend.popClip();
    backend.endLayer();
  }

  if (options.includeCartouche !== false && !pure) {
    backend.beginLayer('cartouche');
    paintChrome(ctx, mode, frame, bounds, boundsMode, options.selection);
    backend.endLayer();
  }

  if (!interactive) return;
  backend.beginLayer('ui-overlay');
  paintOverlay(backend, project, vp, pal, overlayInput);
  backend.endLayer();
}
