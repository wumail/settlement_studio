import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { hitTestActiveHandles, hitTestSceneObject } from '../core/hitTest';
import { applyContourWarpDrag, hitTestContourLine } from '../core/terrain/terrainSculpt';
import { sampleElevation } from '../core/terrain/elevationField';
import type { SelectionTarget, Vec2 } from '../schema/geometry.types';
import { useStudioStore } from '../store/useStudioStore';
import {
  type HandleDragSession,
  applyHandleDrag,
  beginHandleDrag,
  deleteVertexAt,
  insertVertexAtMid,
} from './canvasStageHandlers';
import {
  type BrushDragState,
  type BrushRefs,
  beginBrushDrag,
  currentField,
  finishBrushDrag,
  updateBrushDrag,
} from './stageBrush';
import {
  cycleBridgeCrossing,
  placeHydraulic,
  placeLandmark,
  placeStructure,
  rerollStampAt,
} from './stagePlacement';

export type DragKind = 'pan' | 'brush' | 'measure' | 'hill' | 'handle';

export interface DragSession {
  readonly kind: DragKind;
  prev: Vec2;
  start: Vec2;
  prevClient: Vec2;
  selection: SelectionTarget | null;
  handle: HandleDragSession | null;
  brush: BrushDragState | null;
  /** 选择工具在空白处按下形成的“软平移”：未发生位移时视为取消选中 */
  softPan?: boolean;
}

export interface StageRefs {
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly cursor: MutableRefObject<Vec2 | null>;
  readonly draft: MutableRefObject<Vec2[]>;
  readonly drag: MutableRefObject<DragSession | null>;
  readonly measure: MutableRefObject<readonly [Vec2, Vec2] | null>;
  readonly hover: MutableRefObject<string | null>;
  readonly liveContours: MutableRefObject<ReturnType<typeof applyContourWarpDrag>['contours'] | null>;
  readonly sculptB64: MutableRefObject<string | null>;
  readonly dirty: MutableRefObject<boolean>;
  readonly space: MutableRefObject<boolean>;
}

export interface StageHandlerContext {
  readonly refs: StageRefs;
  readonly toWorld: (clientX: number, clientY: number) => Vec2;
  readonly emit: (world: Vec2) => void;
  readonly commitDraft: () => void;
}

function brushRefs(refs: StageRefs): BrushRefs {
  return { liveContours: refs.liveContours, sculptB64: refs.sculptB64, dirty: refs.dirty };
}

function makeDrag(kind: DragKind, world: Vec2, client: Vec2): DragSession {
  return { kind, prev: world, start: world, prevClient: client, selection: null, handle: null, brush: null };
}

/** 画布指针状态机：选择手柄 / 平移 / 笔刷三态 / 水工与建筑群落位 / 测距 / 山包 / 草稿落点 */
export function createStageHandlers(ctx: StageHandlerContext): {
  down: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  move: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  up: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  contextMenu: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
} {
  const { refs, toWorld, emit, commitDraft } = ctx;

  const finishActiveEdit = (): void => {
    const drag = refs.drag.current;
    if (!drag) return;
    if (drag.kind === 'brush' && drag.brush) finishBrushDrag(drag.brush, drag.prev, brushRefs(refs), true);
    if (drag.kind === 'handle') useStudioStore.getState().endContinuousEdit(true);
    refs.drag.current = null;
  };

  const down = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    finishActiveEdit();
    const state = useStudioStore.getState();
    const world = toWorld(event.clientX, event.clientY);
    const client: Vec2 = [event.clientX, event.clientY];
    refs.cursor.current = world;
    refs.canvas.current?.setPointerCapture(event.pointerId);
    if (event.button === 1 || refs.space.current) {
      refs.drag.current = makeDrag('pan', world, client);
      return;
    }
    if (event.button === 2) return;
    const tool = state.activeTool;
    if (tool === 'select') {
      if (!state.compiledScene) return;
      const hit = hitTestActiveHandles(state.project, state.selection, world[0], world[1], state.viewport);
      if (hit && state.selection) {
        let session = beginHandleDrag(state.selection, hit, world, state.project);
        if (!session) return;
        state.beginContinuousEdit();
        if (hit.kind === 'edge_mid') {
          let inserted = -1;
          const selection = state.selection;
          state.mutateProject((draft) => { inserted = insertVertexAtMid(draft, selection, hit.index); }, false);
          if (inserted < 0) {
            state.endContinuousEdit(false);
            return;
          }
          session = { kind: 'vertex', index: inserted, grab: [0, 0] };
        }
        refs.drag.current = { ...makeDrag('handle', world, client), selection: state.selection, handle: session };
        return;
      }
      const hitObject = hitTestSceneObject(state.project, state.compiledScene, world[0], world[1], state.viewport);
      if (!hitObject) {
        // 触控板/鼠标左键在空白处直接拖动即可平移地图（无需中键或空格）
        refs.drag.current = { ...makeDrag('pan', world, client), softPan: true };
        return;
      }
      state.setSelection(hitObject);
      return;
    }
    if (tool === 'reroll_stamp') {
      rerollStampAt(world, state.project);
      return;
    }
    if (tool === 'place_hydraulic') {
      placeHydraulic(world, state.hydraulicPreset);
      return;
    }
    if (tool === 'place_structure') {
      const id = placeStructure(world, state.structurePreset);
      state.setSelection({ type: 'structure', id, name: '核心建筑' });
      return;
    }
    if (tool === 'place_landmark') {
      placeLandmark(world);
      return;
    }
    if (tool === 'edit_crossing') {
      const id = cycleBridgeCrossing(world);
      if (id) state.setSelection({ type: 'bridge', id, name: '桥梁覆写' });
      return;
    }
    if (tool === 'sculpt_brush' || tool === 'contour_drag' || tool === 'tree_brush') {
      if (!currentField()) return;
      let lockedElev: number | undefined;
      if (tool === 'contour_drag') {
        if (!state.compiledScene) return;
        const hit = hitTestContourLine(
          state.compiledScene.terrain.contours,
          world[0],
          world[1],
          12 / Math.max(0.06, state.viewport.zoom),
        );
        if (!hit) return;
        lockedElev = hit.elev;
      }
      if (tool === 'sculpt_brush' && state.brush.mode === 'flatten' && event.altKey) {
        const field = currentField();
        if (field) state.updateBrush({ flattenTargetElev: sampleElevation(field, world[0], world[1]) });
        return;
      }
      const brush = beginBrushDrag(world, { alt: event.altKey, shift: event.shiftKey }, lockedElev);
      if (!brush) return;
      refs.drag.current = { ...makeDrag('brush', world, client), brush };
      refs.dirty.current = true;
      return;
    }
    if (tool === 'measure') {
      refs.measure.current = [world, world];
      refs.drag.current = makeDrag('measure', world, client);
      refs.dirty.current = true;
      return;
    }
    if (tool === 'add_hill') {
      refs.drag.current = makeDrag('hill', world, client);
      return;
    }
    const firstPoint = refs.draft.current[0];
    const closeTol = 10 / Math.max(0.06, state.viewport.zoom);
    if (firstPoint && refs.draft.current.length >= 3 && Math.hypot(world[0] - firstPoint[0], world[1] - firstPoint[1]) <= closeTol) {
      commitDraft();
      return;
    }
    refs.draft.current = [...refs.draft.current, world];
    refs.dirty.current = true;
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const state = useStudioStore.getState();
    const world = toWorld(event.clientX, event.clientY);
    refs.cursor.current = world;
    emit(world);
    const drag = refs.drag.current;
    if (!drag) {
      const brushTool =
        state.activeTool === 'sculpt_brush' ||
        state.activeTool === 'contour_drag' ||
        state.activeTool === 'tree_brush';
      if (brushTool) refs.dirty.current = true;
      if (state.activeTool === 'contour_drag' && state.compiledScene) {
        const hit = hitTestContourLine(
          state.compiledScene.terrain.contours,
          world[0],
          world[1],
          12 / Math.max(0.06, state.viewport.zoom),
        );
        const next = hit?.contourId ?? null;
        if (next !== refs.hover.current) {
          refs.hover.current = next;
          refs.dirty.current = true;
        }
      }
      return;
    }
    if (drag.kind === 'pan') {
      const dx = event.clientX - drag.prevClient[0];
      const dy = event.clientY - drag.prevClient[1];
      drag.prevClient = [event.clientX, event.clientY];
      drag.prev = world;
      state.updateViewport({ panX: state.viewport.panX + dx, panY: state.viewport.panY + dy });
      return;
    }
    if (drag.kind === 'handle') {
      if (drag.selection && drag.handle) {
        const selection = drag.selection;
        const handle = drag.handle;
        state.mutateProject((draft) => { applyHandleDrag(draft, selection, handle, world); }, false);
        refs.dirty.current = true;
      }
      return;
    }
    if (drag.kind === 'measure') {
      refs.measure.current = [drag.start, world];
      refs.dirty.current = true;
      return;
    }
    if (drag.kind === 'brush' && drag.brush) {
      updateBrushDrag(drag.brush, world, { alt: event.altKey, shift: event.shiftKey }, brushRefs(refs));
      drag.prev = world;
    }
  };

  const up = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const state = useStudioStore.getState();
    const drag = refs.drag.current;
    refs.drag.current = null;
    refs.canvas.current?.releasePointerCapture(event.pointerId);
    if (!drag) return;
    if (drag.kind === 'brush' && drag.brush) {
      const world = toWorld(event.clientX, event.clientY);
      finishBrushDrag(drag.brush, world, brushRefs(refs), true);
      return;
    }
    if (drag.kind === 'handle') {
      state.endContinuousEdit(true);
      return;
    }
    if (drag.kind === 'pan' && drag.softPan) {
      const world = toWorld(event.clientX, event.clientY);
      const movedPx = Math.hypot(world[0] - drag.start[0], world[1] - drag.start[1]) * state.viewport.zoom;
      if (movedPx < 4) state.setSelection(null);
      return;
    }
    if (drag.kind === 'hill') {
      const world = toWorld(event.clientX, event.clientY);
      const shift = event.shiftKey;
      state.mutateProject((draft) => {
        draft.terrain.shapes.push({
          id: `hill_${Date.now().toString(36)}`, type: shift ? 'basin' : 'hill',
          cx: drag.start[0], cy: drag.start[1],
          rx: Math.max(60, Math.abs(world[0] - drag.start[0])),
          ry: Math.max(60, Math.abs(world[1] - drag.start[1])),
          angleDeg: 0, deltaElev: shift ? -20 : 24, focusX: 0, focusY: 0,
        });
      });
    }
  };

  const contextMenu = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const state = useStudioStore.getState();
    if (state.activeTool !== 'select' || !state.selection) return;
    const world = toWorld(event.clientX, event.clientY);
    const hit = hitTestActiveHandles(state.project, state.selection, world[0], world[1], state.viewport);
    if (!hit || hit.kind !== 'vertex') return;
    const selection = state.selection;
    state.mutateProject((draft) => { deleteVertexAt(draft, selection, hit.index); });
  };

  return { down, move, up, contextMenu };
}

/** 供外部（模糊/卸载）收尾未完成的笔刷拖拽，确保 Base64 只编码一次 */
export function abortStageDrag(refs: StageRefs): void {
  const drag = refs.drag.current;
  refs.drag.current = null;
  if (!drag) return;
  if (drag.kind === 'brush' && drag.brush) {
    finishBrushDrag(drag.brush, null, brushRefs(refs), true);
    return;
  }
  if (drag.kind === 'handle') useStudioStore.getState().endContinuousEdit(true);
}
