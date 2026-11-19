import type { WritableDraft } from 'immer';
import type { SelectionTarget, Vec2 } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';

export type EntityHandleKind = 'entity_center' | 'entity_rotate' | 'entity_scale_w' | 'entity_scale_d';

export const ENTITY_SELECTION_TYPES: ReadonlyArray<SelectionTarget['type']> = [
  'weir',
  'dock',
  'watermill',
  'structure',
];

export interface EntityFrame {
  readonly type: SelectionTarget['type'];
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly angleDeg: number;
  readonly widthM: number;
  readonly depthM: number;
  readonly scalable: boolean;
}

function frameOf(
  type: SelectionTarget['type'],
  id: string,
  cx: number,
  cy: number,
  angleDeg: number,
  widthM: number,
  depthM: number,
  scalable = true,
): EntityFrame {
  return { type, id, cx, cy, angleDeg, widthM, depthM, scalable };
}

/** 选中 V3 实体的可操控框（世界坐标中心/旋角/面宽/进深） */
export function entityFrame(project: TownProject, selection: SelectionTarget | null): EntityFrame | null {
  if (!selection) return null;
  const id = selection.id;
  if (selection.type === 'weir') {
    const weir = project.weirs.find((item) => item.id === id);
    if (!weir) return null;
    const dx = weir.pEnd[0] - weir.pStart[0];
    const dy = weir.pEnd[1] - weir.pStart[1];
    return frameOf(
      'weir', id,
      (weir.pStart[0] + weir.pEnd[0]) * 0.5,
      (weir.pStart[1] + weir.pEnd[1]) * 0.5,
      (Math.atan2(dy, dx) * 180) / Math.PI,
      Math.hypot(dx, dy),
      weir.widthM,
    );
  }
  if (selection.type === 'dock') {
    const dock = project.docks.find((item) => item.id === id);
    return dock
      ? frameOf('dock', id, dock.x, dock.y, dock.angleDeg, dock.widthM, dock.lengthM)
      : null;
  }
  if (selection.type === 'watermill') {
    const mill = project.watermills.find((item) => item.id === id);
    return mill
      ? frameOf('watermill', id, mill.x, mill.y, mill.angleDeg, mill.widthM, mill.depthM)
      : null;
  }
  if (selection.type === 'structure') {
    const item = project.structures.find((entry) => entry.id === id);
    return item
      ? frameOf('structure', id, item.x, item.y, item.angleDeg, item.widthM, item.depthM)
      : null;
  }
  if (selection.type === 'bridge') {
    const bridge = project.bridgeOverrides.find((entry) => entry.id === id);
    return bridge ? frameOf('bridge', id, bridge.x, bridge.y, 0, 0, 0, false) : null;
  }
  return null;
}

export function toLocal(frame: EntityFrame, wx: number, wy: number): Vec2 {
  const rad = (frame.angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const dx = wx - frame.cx;
  const dy = wy - frame.cy;
  return [dx * ca + dy * sa, -dx * sa + dy * ca];
}

export function toWorld(frame: EntityFrame, lx: number, ly: number): Vec2 {
  const rad = (frame.angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  return [frame.cx + lx * ca - ly * sa, frame.cy + lx * sa + ly * ca];
}

/** 中心 / 旋转 / 面宽 / 进深四类手柄的世界坐标 */
export function entityHandlePoints(frame: EntityFrame): {
  center: Vec2;
  rotate: Vec2 | null;
  scaleW: Vec2 | null;
  scaleD: Vec2 | null;
} {
  const center: Vec2 = [frame.cx, frame.cy];
  if (!frame.scalable) return { center, rotate: null, scaleW: null, scaleD: null };
  const halfW = frame.widthM * 0.5;
  const halfD = frame.depthM * 0.5;
  return {
    center,
    rotate: toWorld(frame, 0, -(halfD + 20)),
    scaleW: toWorld(frame, halfW, 0),
    scaleD: toWorld(frame, 0, halfD),
  };
}

export interface EntityHandleHit {
  readonly kind: EntityHandleKind;
  readonly x: number;
  readonly y: number;
}

/** 手柄命中：容差由视口缩放换算，优先旋转/缩放再中心 */
export function hitEntityHandle(
  project: TownProject,
  selection: SelectionTarget | null,
  wx: number,
  wy: number,
  tolM: number,
): EntityHandleHit | null {
  const frame = entityFrame(project, selection);
  if (!frame) return null;
  const points = entityHandlePoints(frame);
  const candidates: Array<readonly [EntityHandleKind, Vec2]> = [];
  if (points.rotate) candidates.push(['entity_rotate', points.rotate]);
  if (points.scaleW) candidates.push(['entity_scale_w', points.scaleW]);
  if (points.scaleD) candidates.push(['entity_scale_d', points.scaleD]);
  candidates.push(['entity_center', points.center]);
  for (const [kind, p] of candidates) {
    if (Math.hypot(wx - p[0], wy - p[1]) <= tolM) return { kind, x: p[0], y: p[1] };
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 拖拽写回：中心平移 / 旋转 / 面宽对拉 / 进深对拉（按实体类别限幅） */
export function applyEntityHandleDrag(
  draft: WritableDraft<TownProject>,
  selection: SelectionTarget,
  kind: EntityHandleKind,
  world: Vec2,
  project: TownProject,
  grab: Vec2 = [0, 0],
): boolean {
  const frame = entityFrame(project, selection);
  if (!frame) return false;
  const id = selection.id;
  if (kind === 'entity_center') {
    const nx = world[0] + grab[0];
    const ny = world[1] + grab[1];
    if (selection.type === 'weir') {
      const weir = draft.weirs.find((item) => item.id === id);
      if (!weir) return false;
      const shiftX = nx - weir.pStart[0] - (weir.pEnd[0] - weir.pStart[0]) * 0.5;
      const shiftY = ny - weir.pStart[1] - (weir.pEnd[1] - weir.pStart[1]) * 0.5;
      weir.pStart = [weir.pStart[0] + shiftX, weir.pStart[1] + shiftY];
      weir.pEnd = [weir.pEnd[0] + shiftX, weir.pEnd[1] + shiftY];
      return true;
    }
    if (selection.type === 'dock') {
      const dock = draft.docks.find((item) => item.id === id);
      if (!dock) return false;
      dock.x = nx;
      dock.y = ny;
      return true;
    }
    if (selection.type === 'watermill') {
      const mill = draft.watermills.find((item) => item.id === id);
      if (!mill) return false;
      mill.x = nx;
      mill.y = ny;
      return true;
    }
    if (selection.type === 'structure') {
      const item = draft.structures.find((entry) => entry.id === id);
      if (!item) return false;
      item.x = nx;
      item.y = ny;
      return true;
    }
    if (selection.type === 'bridge') {
      const bridge = draft.bridgeOverrides.find((entry) => entry.id === id);
      if (!bridge) return false;
      bridge.x = nx;
      bridge.y = ny;
      return true;
    }
    return false;
  }

  if (kind === 'entity_rotate') {
    const angle = clamp(
      (Math.atan2(world[0] - frame.cx, -(world[1] - frame.cy)) * 180) / Math.PI,
      -180,
      180,
    );
    if (selection.type === 'dock') {
      const dock = draft.docks.find((item) => item.id === id);
      if (dock) dock.angleDeg = angle;
    } else if (selection.type === 'watermill') {
      const mill = draft.watermills.find((item) => item.id === id);
      if (mill) mill.angleDeg = angle;
    } else if (selection.type === 'structure') {
      const item = draft.structures.find((entry) => entry.id === id);
      if (item) item.angleDeg = angle;
    } else if (selection.type === 'weir') {
      const weir = draft.weirs.find((item) => item.id === id);
      if (weir) {
        const half = Math.hypot(weir.pEnd[0] - weir.pStart[0], weir.pEnd[1] - weir.pStart[1]) * 0.5;
        const rad = (angle * Math.PI) / 180;
        weir.pStart = [frame.cx - Math.cos(rad) * half, frame.cy - Math.sin(rad) * half];
        weir.pEnd = [frame.cx + Math.cos(rad) * half, frame.cy + Math.sin(rad) * half];
      }
    }
    return true;
  }

  const local = toLocal(frame, world[0], world[1]);
  if (kind === 'entity_scale_w') {
    const width = Math.abs(local[0]) * 2;
    if (selection.type === 'dock') {
      const dock = draft.docks.find((item) => item.id === id);
      if (dock) dock.widthM = clamp(width, 4, 24);
    } else if (selection.type === 'watermill') {
      const mill = draft.watermills.find((item) => item.id === id);
      if (mill) mill.widthM = clamp(width, 8, 40);
    } else if (selection.type === 'structure') {
      const item = draft.structures.find((entry) => entry.id === id);
      if (item) item.widthM = clamp(width, 8, 160);
    } else if (selection.type === 'weir') {
      const weir = draft.weirs.find((item) => item.id === id);
      if (weir) {
        const half = clamp(width * 0.5, 4, 60);
        const rad = (frame.angleDeg * Math.PI) / 180;
        weir.pStart = [frame.cx - Math.cos(rad) * half, frame.cy - Math.sin(rad) * half];
        weir.pEnd = [frame.cx + Math.cos(rad) * half, frame.cy + Math.sin(rad) * half];
      }
    }
    return true;
  }
  const depth = Math.abs(local[1]) * 2;
  if (selection.type === 'dock') {
    const dock = draft.docks.find((item) => item.id === id);
    if (dock) dock.lengthM = clamp(depth, 12, 120);
  } else if (selection.type === 'watermill') {
    const mill = draft.watermills.find((item) => item.id === id);
    if (mill) mill.depthM = clamp(depth, 6, 30);
  } else if (selection.type === 'structure') {
    const item = draft.structures.find((entry) => entry.id === id);
    if (item) item.depthM = clamp(depth, 8, 160);
  } else if (selection.type === 'weir') {
    const weir = draft.weirs.find((item) => item.id === id);
    if (weir) weir.widthM = clamp(depth, 3, 24);
  }
  return true;
}
