import type { ElevationFieldData } from '../core/terrain/elevationField';
import { sampleElevation } from '../core/terrain/elevationField';
import type { Vec2 } from '../schema/geometry.types';
import type { BrushCursorInput } from '../renderer/paintOverlay';
import type { DragSession } from './canvasStageInput';

interface StageViewState {
  activeTool: string;
  brush: {
    mode: BrushCursorInput['mode'];
    radiusM: number;
    hardness: number;
    flattenTargetElev: number;
    terraceStepM: number;
  };
  treeBrush: { radiusM: number; eraseMode: boolean };
}

export function buildBrushCursor(
  state: StageViewState,
  cursor: Vec2 | null,
  field: ElevationFieldData | null,
  dragging: boolean,
  drag: DragSession | null,
): BrushCursorInput | null {
  if (!cursor) return null;
  const elevM = field ? sampleElevation(field, cursor[0], cursor[1]) : null;
  if (state.activeTool === 'sculpt_brush') {
    const ramp = dragging && drag?.brush?.mode === 'ramp' && drag.brush.start
      ? {
          ax: drag.brush.start[0],
          ay: drag.brush.start[1],
          bx: cursor[0],
          by: cursor[1],
          startElev: drag.brush.startElev,
          endElev: elevM ?? drag.brush.startElev,
        }
      : null;
    return {
      x: cursor[0], y: cursor[1], radiusM: state.brush.radiusM, hardness: state.brush.hardness,
      mode: state.brush.mode, kind: 'terrain', elevM,
      flattenTargetElev: state.brush.flattenTargetElev,
      terraceStepM: state.brush.terraceStepM,
      ramp,
    };
  }
  if (state.activeTool === 'tree_brush') {
    return {
      x: cursor[0], y: cursor[1], radiusM: state.treeBrush.radiusM, hardness: 0.9,
      mode: 'raise', kind: 'tree', elevM, treeErase: state.treeBrush.eraseMode,
    };
  }
  if (state.activeTool === 'contour_drag') {
    return {
      x: cursor[0], y: cursor[1], radiusM: state.brush.radiusM, hardness: state.brush.hardness,
      mode: 'raise', kind: 'contour', elevM,
    };
  }
  return null;
}

