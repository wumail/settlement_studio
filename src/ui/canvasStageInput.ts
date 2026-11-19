import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { hitTestActiveHandles, hitTestSceneObject } from '../core/hitTest';
import { hashSeed } from '../core/math/rng';
import { applyContourWarpDrag, applySculptBrush, hitTestContourLine } from '../core/terrain/terrainSculpt';
import { type ElevationFieldData, sampleElevation } from '../core/terrain/elevationField';
import type { CompiledSceneBase, SelectionTarget, Vec2 } from '../schema/geometry.types';
import { CUSTOM_GLYPH_TYPES, type CustomGlyphType } from '../schema/legend.schema';
import { useStudioStore } from '../store/useStudioStore';
import {
  applyHandleDrag,
  beginHandleDrag,
  deleteVertexAt,
  insertVertexAtMid,
  type HandleDragSession,
} from './canvasStageHandlers';

export type DragKind = 'pan' | 'contour' | 'sculpt' | 'measure' | 'hill' | 'handle';

export interface DragSession {
  readonly kind: DragKind;
  prev: Vec2;
  start: Vec2;
  elev: number;
  prevClient: Vec2;
  selection: SelectionTarget | null;
  handle: HandleDragSession | null;
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

type SceneWithField = CompiledSceneBase & {
  readonly terrain: CompiledSceneBase['terrain'] & { readonly terrainData?: ElevationFieldData };
};

let uidSeq = 0;
function uid(prefix: string): string {
  uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}`;
}

function currentField(): ElevationFieldData | null {
  const scene = useStudioStore.getState().compiledScene as SceneWithField | null;
  return scene?.terrain.terrainData ?? null;
}

export interface StageHandlerContext {
  readonly refs: StageRefs;
  readonly toWorld: (clientX: number, clientY: number) => Vec2;
  readonly emit: (world: Vec2) => void;
  readonly commitDraft: () => void;
}

/** 画布指针状态机：选择手柄 / 平移 / 推拉 / 笔刷 / 测距 / 山包 / 草稿落点 */
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
    const state = useStudioStore.getState();
    if (drag.kind === 'contour' || drag.kind === 'sculpt' || drag.kind === 'handle') {
      const b64 = refs.sculptB64.current;
      if (b64) state.mutateProject((draft) => { draft.terrain.sculptDeltaB64 = b64; }, false);
      refs.liveContours.current = null;
      refs.sculptB64.current = null;
      state.endContinuousEdit(true);
    }
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
      refs.drag.current = { kind: 'pan', prev: world, start: world, elev: 0, prevClient: client, selection: null, handle: null };
      return;
    }
    if (event.button === 2) return;
    if (state.activeTool === 'select') {
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
        refs.drag.current = { kind: 'handle', prev: world, start: world, elev: 0, prevClient: client, selection: state.selection, handle: session };
        return;
      }
      state.setSelection(hitTestSceneObject(state.project, state.compiledScene, world[0], world[1], state.viewport));
      return;
    }
    if (state.activeTool === 'place_reef') {
      state.mutateProject((draft) => {
        if (state.drawReefMode === 'ford') {
          draft.fords.push({ id: uid('frd'), name: '新渡口', x: world[0], y: world[1], radiusM: 24 });
        } else {
          draft.reefs.push({ id: uid('reef'), x: world[0], y: world[1], radiusM: 14, angleDeg: 0, seed: hashSeed(`${world[0]}`), count: 2 });
        }
      });
      return;
    }
    if (state.activeTool === 'place_landmark') {
      const legendItem = state.project.legend.items.find((item) => item.key === state.activeLandmarkKey);
      const rawGlyph = legendItem?.glyphType
        ?? (state.activeLandmarkKey.startsWith('custom_') ? state.activeLandmarkKey.slice(7) : 'stele');
      const glyphType: CustomGlyphType = (CUSTOM_GLYPH_TYPES as ReadonlyArray<string>).includes(rawGlyph)
        ? (rawGlyph as CustomGlyphType)
        : 'stele';
      state.mutateProject((draft) => {
        draft.landmarks.push({ id: uid('lm'), legendKey: state.activeLandmarkKey, glyphType, label: state.activeLandmarkLabel, x: world[0], y: world[1], showLabel: true, sizePx: 15 });
      });
      return;
    }
    if (state.activeTool === 'contour_drag') {
      if (!currentField() || !state.compiledScene) return;
      const hit = hitTestContourLine(state.compiledScene.terrain.contours, world[0], world[1], 12 / Math.max(0.06, state.viewport.zoom));
      if (!hit) return;
      state.beginContinuousEdit();
      refs.drag.current = { kind: 'contour', prev: world, start: world, elev: hit.elev, prevClient: client, selection: null, handle: null };
      return;
    }
    if (state.activeTool === 'sculpt_brush') {
      const field = currentField();
      if (!field) return;
      if (event.altKey) {
        state.updateBrush({ flattenTargetElev: sampleElevation(field, world[0], world[1]) });
        return;
      }
      state.beginContinuousEdit();
      const first = applySculptBrush(field, state.project.terrain, { x: world[0], y: world[1], radiusM: state.brush.radiusM, strength: state.brush.strength, mode: state.brush.mode, flattenTargetElev: state.brush.flattenTargetElev });
      refs.liveContours.current = first.contours;
      refs.sculptB64.current = first.sculptDeltaB64;
      refs.drag.current = { kind: 'sculpt', prev: world, start: world, elev: 0, prevClient: client, selection: null, handle: null };
      refs.dirty.current = true;
      return;
    }
    if (state.activeTool === 'measure') {
      refs.measure.current = [world, world];
      refs.drag.current = { kind: 'measure', prev: world, start: world, elev: 0, prevClient: client, selection: null, handle: null };
      refs.dirty.current = true;
      return;
    }
    if (state.activeTool === 'add_hill') {
      refs.drag.current = { kind: 'hill', prev: world, start: world, elev: 0, prevClient: client, selection: null, handle: null };
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
      if (state.activeTool === 'contour_drag' && state.compiledScene) {
        const hit = hitTestContourLine(state.compiledScene.terrain.contours, world[0], world[1], 12 / Math.max(0.06, state.viewport.zoom));
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
    if (drag.kind === 'contour' || drag.kind === 'sculpt') {
      const field = currentField();
      if (!field) return;
      const result = drag.kind === 'contour'
        ? applyContourWarpDrag(field, state.project.terrain, { prevX: drag.prev[0], prevY: drag.prev[1], currX: world[0], currY: world[1], lockedElev: drag.elev, radiusM: 90, strength: 0.85 })
        : applySculptBrush(field, state.project.terrain, { x: world[0], y: world[1], radiusM: state.brush.radiusM, strength: state.brush.strength, mode: state.brush.mode, flattenTargetElev: state.brush.flattenTargetElev });
      refs.liveContours.current = result.contours;
      refs.sculptB64.current = result.sculptDeltaB64;
      drag.prev = world;
      refs.dirty.current = true;
    }
  };

  const up = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const state = useStudioStore.getState();
    const drag = refs.drag.current;
    refs.drag.current = null;
    refs.canvas.current?.releasePointerCapture(event.pointerId);
    if (!drag) return;
    if (drag.kind === 'handle') {
      state.endContinuousEdit(true);
      return;
    }
    if (drag.kind === 'contour' || drag.kind === 'sculpt') {
      const b64 = refs.sculptB64.current;
      if (b64) state.mutateProject((draft) => { draft.terrain.sculptDeltaB64 = b64; }, false);
      refs.liveContours.current = null;
      refs.sculptB64.current = null;
      state.endContinuousEdit(true);
      return;
    }
    if (drag.kind === 'hill') {
      const world = toWorld(event.clientX, event.clientY);
      const shift = event.shiftKey;
      state.mutateProject((draft) => {
        draft.terrain.shapes.push({
          id: uid('hill'), type: shift ? 'basin' : 'hill',
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
