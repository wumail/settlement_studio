import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { hashSeed } from '../core/math/rng';
import { sampleElevation, sampleSlopeDeg } from '../core/terrain/elevationField';
import type { Vec2 } from '../schema/geometry.types';
import { StageBitmapCache } from '../renderer/stageCache';
import { fitViewportToWorld, screenToWorld, zoomViewportAtScreenPoint } from '../renderer/RenderBackend';
import { useStudioStore } from '../store/useStudioStore';
import { abortStageDrag, createStageHandlers, type DragSession, type StageRefs } from './canvasStageInput';
import { commitDraftPoints } from './canvasStageHandlers';
import { currentField } from './stageBrush';
import { paintStageFrame } from './stageRender';
import { buildBrushCursor } from './stageCursor';
import type { CursorTelemetry } from './StatusBar';

function toTuples(points: ReadonlyArray<Vec2>): Array<[number, number]> {
  return points.map((point) => [point[0], point[1]] as [number, number]);
}

function isFormFocus(): boolean {
  const tag = document.activeElement?.tagName ?? '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 动静分离画布舞台：useRef + store.subscribe + rAF 直接驱动 Canvas2DBackend，零外层重渲染 */
export const CanvasStage = memo(function CanvasStageImpl(props: {
  onCursorSample?: (sample: CursorTelemetry) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<Vec2 | null>(null);
  const draftRef = useRef<Vec2[]>([]);
  const dragRef = useRef<DragSession | null>(null);
  const measureRef = useRef<readonly [Vec2, Vec2] | null>(null);
  const hoverRef = useRef<string | null>(null);
  const liveContoursRef = useRef<StageRefs['liveContours']['current']>(null);
  const sculptB64Ref = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const spaceRef = useRef(false);
  const sampleRef = useRef(0);
  const commitRef = useRef<() => void>(() => {});
  const cacheRef = useRef<StageBitmapCache | null>(null);
  const fitRef = useRef<{ zoom: number; panX: number; panY: number } | null>(null);
  const cursorSampleRef = useRef(props.onCursorSample);
  cursorSampleRef.current = props.onCursorSample;

  const refs: StageRefs = useMemo(() => ({
    canvas: canvasRef,
    cursor: cursorRef,
    draft: draftRef,
    drag: dragRef,
    measure: measureRef,
    hover: hoverRef,
    liveContours: liveContoursRef,
    sculptB64: sculptB64Ref,
    dirty: dirtyRef,
    space: spaceRef,
  }), []);

  useEffect(() => {
    let prevTool = useStudioStore.getState().activeTool;
    return useStudioStore.subscribe((state) => {
      dirtyRef.current = true;
      if (state.activeTool !== prevTool) {
        prevTool = state.activeTool;
        draftRef.current = [];
        hoverRef.current = null;
        measureRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    cacheRef.current = new StageBitmapCache();
    let raf = 0;
    const render = (): void => {
      raf = window.requestAnimationFrame(render);
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // 位图尺寸必须逐帧对齐 CSS 盒子：首帧布局未定时算出的 643 会把画布纵向拉成 1.22 倍
      const stale = canvas.width !== width * dpr || canvas.height !== height * dpr;
      if (!dirtyRef.current && !stale) return;
      dirtyRef.current = false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (stale) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const state = useStudioStore.getState();
      const base = state.compiledScene;
      const live = liveContoursRef.current;
      const scene = base && live ? { ...base, terrain: { ...base.terrain, contours: live } } : base;
      const cursor = cursorRef.current;
      const field = currentField();
      const dragging = dragRef.current !== null;
      const brush = buildBrushCursor(state, cursor, field, dragging, dragRef.current);
      paintStageFrame(cacheRef.current ?? new StageBitmapCache(), {
        ctx,
        width,
        height,
        dpr,
        project: state.project,
        scene,
        viewport: { ...state.viewport, widthPx: width, heightPx: height, dpr },
        selection: state.selection,
        draftPoints: draftRef.current,
        hoverContourId: hoverRef.current,
        measureSegment: measureRef.current,
        brushCursor: brush,
        dragging,
      });
    };
    raf = window.requestAnimationFrame(render);
    // 首帧布局未定（侧栏/状态栏尚未排完）时算出的 fit 会偏大，必须等尺寸稳定后重算：
    // 只要视口仍是上次 fit 的结果（用户没手动平移缩放），尺寸或图幅变化就重新适配。
    const syncFit = (force = false): void => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const state = useStudioStore.getState();
      const vp = state.viewport;
      const fit = fitRef.current;
      const untouched =
        force ||
        fit === null ||
        (Math.abs(vp.zoom - fit.zoom) < 1e-9 &&
          Math.abs(vp.panX - fit.panX) < 0.6 &&
          Math.abs(vp.panY - fit.panY) < 0.6);
      if (!untouched) {
        state.updateViewport({ widthPx: rect.width, heightPx: rect.height });
        return;
      }
      const next = fitViewportToWorld(vp, rect.width, rect.height, state.project.meta.worldSizeM);
      const same =
        Math.abs(next.zoom - vp.zoom) < 1e-9 &&
        Math.abs(next.panX - vp.panX) < 0.6 &&
        Math.abs(next.panY - vp.panY) < 0.6;
      if (!same) state.updateViewport(next);
      fitRef.current = { zoom: next.zoom, panX: next.panX, panY: next.panY };
      dirtyRef.current = true;
    };
    const observer = new ResizeObserver(() => syncFit());
    observer.observe(wrap);
    syncFit(true);
    let prevWorld = useStudioStore.getState().project.meta.worldSizeM;
    const unsubWorld = useStudioStore.subscribe((state) => {
      if (state.project.meta.worldSizeM === prevWorld) return;
      prevWorld = state.project.meta.worldSizeM;
      fitRef.current = null;
      syncFit(true);
    });
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const state = useStudioStore.getState();
      if (event.shiftKey) {
        const factor = event.deltaY > 0 ? 0.92 : 1.087;
        const target = state.activeTool === 'tree_brush' ? state.treeBrush : state.brush;
        const patch = { radiusM: target.radiusM * factor };
        if (state.activeTool === 'tree_brush') state.updateTreeBrush(patch);
        else state.updateBrush(patch);
        dirtyRef.current = true;
        return;
      }
      // 触控板双指滑动 = 平移；⌘/Ctrl（含 macOS 捏合手势）= 缩放；滚轮按住 ⌘ 同样缩放
      const zoomIntent = event.ctrlKey || event.metaKey;
      if (!zoomIntent) {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
        state.updateViewport({
          panX: state.viewport.panX - event.deltaX * unit,
          panY: state.viewport.panY - event.deltaY * unit,
        });
        return;
      }
      const next = zoomViewportAtScreenPoint(
        { ...state.viewport, widthPx: rect.width, heightPx: rect.height },
        event.clientX - rect.left,
        event.clientY - rect.top,
        event.deltaY > 0 ? 0.9 : 1.1111,
      );
      state.updateViewport({ zoom: next.zoom, panX: next.panX, panY: next.panY });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isFormFocus()) return;
      if (event.code === 'Space') {
        spaceRef.current = true;
        event.preventDefault();
      } else if (event.key === 'Enter') {
        commitRef.current();
      } else if (event.key === 'Escape') {
        draftRef.current = [];
        measureRef.current = null;
        hoverRef.current = null;
        dirtyRef.current = true;
        useStudioStore.getState().setSelection(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spaceRef.current = false;
    };
    const onBlur = (): void => {
      spaceRef.current = false;
      abortStageDrag(refs);
      dirtyRef.current = true;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      unsubWorld();
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [refs]);

  const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    const wrap = wrapRef.current;
    const state = useStudioStore.getState();
    if (!wrap) return [0, 0];
    const rect = wrap.getBoundingClientRect();
    return screenToWorld(clientX - rect.left, clientY - rect.top, { ...state.viewport, widthPx: rect.width, heightPx: rect.height });
  }, []);

  const emit = useCallback((world: Vec2): void => {
    const now = performance.now();
    if (now - sampleRef.current < 90) return;
    sampleRef.current = now;
    const field = currentField();
    cursorSampleRef.current?.({
      wx: world[0],
      wy: world[1],
      elevM: field ? sampleElevation(field, world[0], world[1]) : null,
      slopeDeg: field ? sampleSlopeDeg(field, world[0], world[1]) : null,
      visible: true,
    });
  }, []);

  const commitDraft = useCallback((): void => {
    const state = useStudioStore.getState();
    let points = toTuples(draftRef.current);
    draftRef.current = [];
    dirtyRef.current = true;
    if (points.length >= 2) {
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      const dedupeTol = 6 / Math.max(0.06, state.viewport.zoom);
      if (last && prev && Math.hypot(last[0] - prev[0], last[1] - prev[1]) < dedupeTol) points = points.slice(0, -1);
    }
    const result = commitDraftPoints(points, {
      tool: state.activeTool,
      waterMode: state.drawWaterMode,
      roadTier: state.drawRoadTier,
      zoneContentType: state.drawZoneContentType,
      linearType: state.drawLinearShapeType,
    }, hashSeed(`${Date.now()}|${points.length}`));
    if (!result.ok && result.reason === 'area') state.showToast('选区面积需不小于 400 m²');
  }, []);
  commitRef.current = commitDraft;

  const handlers = useMemo(
    () => createStageHandlers({ refs, toWorld, emit, commitDraft }),
    [commitDraft, emit, refs, toWorld],
  );

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handlers.down}
        onPointerMove={handlers.move}
        onPointerUp={handlers.up}
        onPointerCancel={handlers.up}
        onPointerLeave={() => {
          cursorRef.current = null;
          hoverRef.current = null;
          dirtyRef.current = true;
        }}
        onDoubleClick={() => commitDraft()}
        onContextMenu={handlers.contextMenu}
      />
    </div>
  );
});

/** 供测试复用的指针事件类型别名 */
export type StagePointerEvent = ReactPointerEvent<HTMLCanvasElement>;
