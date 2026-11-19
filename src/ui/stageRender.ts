import type { CompiledSceneBase, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import type { BrushCursorInput } from '../renderer/paintOverlay';
import { Canvas2DBackend } from '../renderer/Canvas2DBackend';
import { paintScene } from '../renderer/paintScene';
import { StageBitmapCache, buildStageCacheKey, isStageCacheSupported } from '../renderer/stageCache';
import { planStageBlit } from './stageBlit';

export interface StageFrameInput {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly project: TownProject;
  readonly scene: CompiledSceneBase | null;
  readonly viewport: ViewportState;
  readonly selection: SelectionTarget | null;
  readonly draftPoints: ReadonlyArray<Vec2>;
  readonly hoverContourId: string | null;
  readonly measureSegment: readonly [Vec2, Vec2] | null;
  readonly brushCursor: BrushCursorInput | null;
  readonly dragging: boolean;
}

function paletteKeyOf(project: TownProject): string {
  return `${project.palette.themeId}|${JSON.stringify(project.palette.overrides ?? {})}`;
}

/** 缓存贴图记录：记住位图绘制时的平移原点，供后续平移做偏移贴图 */
const cacheMeta = new WeakMap<StageBitmapCache, { key: string; panX: number; panY: number }>();

/**
 * 单帧绘制：静态 1–13 层命中离屏缓存时仅 drawImage（按平移偏移）+ 第 14 层浮层。
 * 拖拽 / 悬停 / 画草稿 / ramp 预览都不再退回全量直绘；悬停高亮与图饰改由浮层每帧重绘。
 */
export function paintStageFrame(cache: StageBitmapCache, input: StageFrameInput): void {
  const { ctx, width, height, dpr } = input;
  const vp = input.viewport;
  const overlay = {
    selection: input.selection,
    draftPoints: input.draftPoints,
    hoverContourId: input.hoverContourId,
    measureSegment: input.measureSegment,
    brushCursor: input.brushCursor,
  };
  const fullRedraw = (): void => {
    paintScene(new Canvas2DBackend(ctx, width, height, dpr), input.project, input.scene, vp, overlay);
  };
  if (!isStageCacheSupported()) {
    fullRedraw();
    return;
  }
  const plan = planStageBlit(vp, width, height, dpr);
  const { bucketX, bucketY } = plan;
  const key = buildStageCacheKey({
    layer: 'static',
    sceneRef: input.scene,
    projectRef: input.project,
    paletteKey: paletteKeyOf(input.project),
    displayMode: input.project.legend.displayMode,
    zoom: vp.zoom,
    panX: bucketX,
    panY: bucketY,
    widthPx: width,
    heightPx: height,
    dpr,
    revision: input.scene ? 1 : 0,
  });
  const state = cacheMeta.get(cache);
  const fresh = !state || state.key !== key;
  const originX = fresh ? bucketX : state.panX;
  const originY = fresh ? bucketY : state.panY;
  const cacheVp: ViewportState = {
    ...vp,
    widthPx: plan.cacheWidthPx,
    heightPx: plan.cacheHeightPx,
    panX: plan.cachePanX,
    panY: plan.cachePanY,
  };
  const image = cache.acquire(
    'static',
    key,
    plan.cacheWidthPx,
    plan.cacheHeightPx,
    dpr,
    (backend) => paintScene(backend, input.project, input.scene, cacheVp, {
      isExport: true,
      includeCartouche: false,
    }),
    (target, w, h, ratio) => new Canvas2DBackend(target, w, h, ratio),
  );
  if (!image) {
    fullRedraw();
    return;
  }
  if (fresh) cacheMeta.set(cache, { key, panX: originX, panY: originY });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // 1:1 贴图：destX 由 planStageBlit 保证 destX/dpr + cachePanX === vp.panX，绝不缩放
  ctx.drawImage(image, 0, 0, image.width, image.height, plan.destX, plan.destY, image.width, image.height);
  ctx.restore();
  paintScene(new Canvas2DBackend(ctx, width, height, dpr), input.project, input.scene, vp, {
    ...overlay,
    overlayOnly: true,
  });
}
