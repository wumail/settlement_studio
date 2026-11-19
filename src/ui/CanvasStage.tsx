import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { hashSeed } from '../core/math/rng';
import { applyContourWarpDrag } from '../core/terrain/terrainSculpt';
import { type ElevationFieldData, sampleElevation, sampleSlopeDeg } from '../core/terrain/elevationField';
import type { CompiledSceneBase, Vec2 } from '../schema/geometry.types';
import { Canvas2DBackend } from '../renderer/Canvas2DBackend';
import { paintScene } from '../renderer/paintScene';
import { fitViewportToWorld, screenToWorld, zoomViewportAtScreenPoint } from '../renderer/RenderBackend';
import { useStudioStore } from '../store/useStudioStore';
import {
  createStageHandlers,
  type DragSession,
  type StageRefs,
} from './canvasStageInput';
import { commitDraftPoints } from './canvasStageHandlers';
import type { CursorTelemetry } from './StatusBar';

type SceneWithField = CompiledSceneBase & {
  readonly terrain: CompiledSceneBase['terrain'] & { readonly terrainData?: ElevationFieldData };
};

function currentField(): ElevationFieldData | null {
  const scene = useStudioStore.getState().compiledScene as SceneWithField | null;
  return scene?.terrain.terrainData ?? null;
}

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
  const liveContoursRef = useRef<ReturnType<typeof applyContourWarpDrag>['contours'] | null>(null);
  const sculptB64Ref = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const spaceRef = useRef(false);
  const sampleRef = useRef(0);
  const commitRef = useRef<() => void>(() => {});
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
    let raf = 0;
    const render = (): void => {
      raf = window.requestAnimationFrame(render);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const state = useStudioStore.getState();
      const base = state.compiledScene;
      const live = liveContoursRef.current;
      const scene = base && live ? { ...base, terrain: { ...base.terrain, contours: live } } : base;
      paintScene(new Canvas2DBackend(ctx, width, height, dpr), state.project, scene, { ...state.viewport, widthPx: width, heightPx: height, dpr }, {
        selection: state.selection,
        draftPoints: draftRef.current,
        hoverContourId: hoverRef.current,
        measureSegment: measureRef.current,
        brushCursor:
          state.activeTool === 'sculpt_brush' && cursorRef.current
            ? { x: cursorRef.current[0], y: cursorRef.current[1], radiusM: state.brush.radiusM }
            : null,
      });
    };
    raf = window.requestAnimationFrame(render);
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const state = useStudioStore.getState();
      if (state.viewport.panX === 0 && state.viewport.panY === 0) {
        state.updateViewport(fitViewportToWorld(state.viewport, rect.width, rect.height, state.project.meta.worldSizeM));
      } else {
        state.updateViewport({ widthPx: rect.width, heightPx: rect.height });
      }
      dirtyRef.current = true;
    });
    observer.observe(wrap);
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const state = useStudioStore.getState();
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
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'contour' || drag.kind === 'sculpt' || drag.kind === 'handle') {
        const b64 = sculptB64Ref.current;
        if (b64) useStudioStore.getState().mutateProject((draft) => { draft.terrain.sculptDeltaB64 = b64; }, false);
        liveContoursRef.current = null;
        sculptB64Ref.current = null;
        dragRef.current = null;
        useStudioStore.getState().endContinuousEdit(true);
        return;
      }
      dragRef.current = null;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

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
