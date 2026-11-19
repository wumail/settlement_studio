import type { MutableRefObject } from 'react';
import { hashSeed } from '../core/math/rng';
import { extractContours } from '../core/terrain/marchingSquares';
import {
  applyContourWarpDrag,
  applyRampStroke,
  applySculptStrokeSegment,
  encodeSculptField,
} from '../core/terrain/terrainSculpt';
import { scatterTreesAlongStroke, treesWithinBrush } from '../core/terrain/treeBrush';
import { type ElevationFieldData, sampleElevation } from '../core/terrain/elevationField';
import type { TreeGuardView } from '../core/obstacles/treeGuard';
import type { CompiledSceneBase, SculptBrushMode, Vec2 } from '../schema/geometry.types';
import { useStudioStore } from '../store/useStudioStore';

type SceneWithField = CompiledSceneBase & {
  readonly terrain: CompiledSceneBase['terrain'] & { readonly terrainData?: ElevationFieldData };
};

export interface BrushDragState {
  readonly kind: 'sculpt' | 'contour' | 'tree';
  readonly mode: SculptBrushMode;
  readonly erase: boolean;
  prev: Vec2;
  readonly start: Vec2;
  readonly startElev: number;
  lastContourAt: number;
}

export interface BrushRefs {
  readonly liveContours: MutableRefObject<ReturnType<typeof extractContours> | null>;
  readonly sculptB64: MutableRefObject<string | null>;
  readonly dirty: MutableRefObject<boolean>;
}

let uidSeq = 0;
export function nextId(prefix: string): string {
  uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}`;
}

export function currentField(): ElevationFieldData | null {
  const scene = useStudioStore.getState().compiledScene as SceneWithField | null;
  return scene?.terrain.terrainData ?? null;
}

export function buildTreeGuardView(scene: CompiledSceneBase | null, worldSizeM: number): TreeGuardView | null {
  const withField = scene as SceneWithField | null;
  if (!withField) return null;
  return {
    worldSizeM,
    elevationField: withField.terrain.terrainData ?? null,
    rivers: withField.hydro.rivers,
    waterBodies: withField.hydro.waterBodies,
    canals: withField.hydro.canals,
    roads: withField.hydro.roads,
    walls: withField.walls,
    exclusionPolys: withField.exclusionPolys,
    buildings: withField.buildings,
  };
}

/** 按住 Shift 临时平滑、按住 Alt 隆起<->下压互逆 */
export function resolveBrushMode(base: SculptBrushMode, alt: boolean, shift: boolean): SculptBrushMode {
  if (shift && base !== 'ramp' && base !== 'erase' && base !== 'terrace') return 'smooth';
  if (alt && base === 'raise') return 'lower';
  if (alt && base === 'lower') return 'raise';
  return base;
}

function refreshContours(refs: BrushRefs, drag: BrushDragState, force = false): void {
  const field = currentField();
  if (!field) return;
  const now = performance.now();
  if (!force && now - drag.lastContourAt < 70) return;
  drag.lastContourAt = now;
  refs.liveContours.current = extractContours(field, useStudioStore.getState().project.terrain);
  refs.dirty.current = true;
}

/** 落笔：sculpt / contour / tree 三态统一入口，返回 null 表示当前工具不进入拖拽 */
export function beginBrushDrag(
  world: Vec2,
  modifiers: { alt: boolean; shift: boolean },
  lockedElev?: number,
): BrushDragState | null {
  const state = useStudioStore.getState();
  const field = currentField();
  if (!field) return null;
  if (state.activeTool === 'tree_brush') {
    state.beginContinuousEdit();
    return {
      kind: 'tree',
      mode: 'raise',
      erase: state.treeBrush.eraseMode || modifiers.alt,
      prev: world,
      start: world,
      startElev: 0,
      lastContourAt: performance.now(),
    };
  }
  if (state.activeTool === 'contour_drag') {
    state.beginContinuousEdit();
    return {
      kind: 'contour',
      mode: 'raise',
      erase: false,
      prev: world,
      start: world,
      startElev: lockedElev ?? sampleElevation(field, world[0], world[1]),
      lastContourAt: performance.now(),
    };
  }
  if (state.activeTool !== 'sculpt_brush') return null;
  const mode = resolveBrushMode(state.brush.mode, modifiers.alt, modifiers.shift);
  if (state.brush.mode === 'flatten' && state.brush.autoLockStartElev) {
    state.updateBrush({ flattenTargetElev: sampleElevation(field, world[0], world[1]) });
  }
  state.beginContinuousEdit();
  return {
    kind: 'sculpt',
    mode,
    erase: false,
    prev: world,
    start: world,
    startElev: sampleElevation(field, world[0], world[1]),
    lastContourAt: performance.now(),
  };
}

function brushInput(world: Vec2, mode: SculptBrushMode) {
  const state = useStudioStore.getState();
  return {
    x: world[0],
    y: world[1],
    radiusM: state.brush.radiusM,
    strength: state.brush.strength,
    mode,
    flattenTargetElev: state.brush.flattenTargetElev,
    hardness: state.brush.hardness,
    terraceStepM: state.brush.terraceStepM,
    baseElev: state.project.terrain.baseElev,
  };
}

/** 拖拽：弧长插值逐段落笔，skipEncode 保证 pointermove 零 Base64 编码 */
export function updateBrushDrag(
  drag: BrushDragState,
  world: Vec2,
  modifiers: { alt: boolean; shift: boolean },
  refs: BrushRefs,
): void {
  const state = useStudioStore.getState();
  const field = currentField();
  if (!field) return;
  const mode = resolveBrushMode(
    drag.kind === 'sculpt' ? state.brush.mode : drag.mode,
    drag.kind === 'sculpt' ? modifiers.alt : false,
    drag.kind === 'sculpt' ? modifiers.shift : false,
  );
  if (drag.kind === 'contour') {
    const out = applyContourWarpDrag(
      field,
      state.project.terrain,
      {
        prevX: drag.prev[0],
        prevY: drag.prev[1],
        currX: world[0],
        currY: world[1],
        lockedElev: drag.startElev,
        radiusM: state.brush.radiusM,
        strength: state.brush.strength,
      },
      { skipEncode: true },
    );
    refs.liveContours.current = out.contours;
    drag.prev = world;
    refs.dirty.current = true;
    return;
  }
  if (drag.kind === 'sculpt') {
    const input = brushInput(world, mode);
    if (drag.mode === 'ramp') {
      drag.prev = world;
      refs.dirty.current = true;
      return;
    }
    applySculptStrokeSegment(field, state.project.terrain, drag.prev, world, input, {
      skipEncode: true,
      skipContours: true,
    });
    drag.prev = world;
    refreshContours(refs, drag);
    return;
  }

  const scene = state.compiledScene;
  const view = buildTreeGuardView(scene, state.project.meta.worldSizeM);
  if (!view) return;
  if (drag.erase) {
    const ids = treesWithinBrush(state.project.paintedTrees, world[0], world[1], state.treeBrush.radiusM);
    if (ids.length > 0) {
      state.mutateProject((draft) => {
        draft.paintedTrees = draft.paintedTrees.filter((tree) => !ids.includes(tree.id));
      }, false);
      refs.dirty.current = true;
    }
    drag.prev = world;
    return;
  }
  const scattered = scatterTreesAlongStroke(
    drag.prev,
    world,
    view,
    {
      radiusM: state.treeBrush.radiusM,
      spacingFactor: state.treeBrush.spacingM,
      minR: state.treeBrush.minR,
      maxR: state.treeBrush.maxR,
      kind: 'woodland',
      seed: hashSeed(`${world[0].toFixed(1)}|${world[1].toFixed(1)}|${state.project.paintedTrees.length}`),
      slopeLimitDeg: 32,
    },
    state.project.paintedTrees,
  );
  if (scattered.length > 0) {
    state.mutateProject((draft) => {
      for (const tree of scattered) {
        draft.paintedTrees.push({ id: nextId('ptr'), x: tree.x, y: tree.y, r: tree.r, kind: tree.kind });
      }
    }, false);
    refs.dirty.current = true;
  }
  drag.prev = world;
}

/** 松手：斜坡一次拉出 + 单次 Base64 编码提交 + 合并为单步撤销 */
export function finishBrushDrag(
  drag: BrushDragState,
  world: Vec2 | null,
  refs: BrushRefs,
  recompile: boolean,
): void {
  const state = useStudioStore.getState();
  const field = currentField();
  if (drag.kind === 'sculpt' && drag.mode === 'ramp' && field && world) {
    const endElev = sampleElevation(field, world[0], world[1]);
    applyRampStroke(
      field,
      state.project.terrain,
      {
        a: [drag.start[0], drag.start[1]],
        b: [world[0], world[1]],
        startElev: drag.startElev,
        endElev,
        radiusM: state.brush.radiusM,
        hardness: state.brush.hardness,
        strength: 1,
      },
      { skipEncode: true, skipContours: true },
    );
    refs.liveContours.current = extractContours(field, state.project.terrain);
  }
  if ((drag.kind === 'sculpt' || drag.kind === 'contour') && field) {
    const b64 = refs.sculptB64.current ?? encodeSculptField(field);
    state.mutateProject((draft) => { draft.terrain.sculptDeltaB64 = b64; }, false);
    refs.liveContours.current = null;
    refs.sculptB64.current = null;
  }
  state.endContinuousEdit(recompile);
}
