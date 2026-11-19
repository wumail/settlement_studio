import type { WritableDraft } from 'immer';
import type { SelectionTarget, ToolId, Vec2 } from '../schema/geometry.types';
import type { TerrainShape, TownProject } from '../schema/project.schema';
import { computePolygonAreaSigned } from '../core/math/polygon';
import { shapeWorldToLocal, type HandleKind } from '../core/hitTest';
import { useStudioStore } from '../store/useStudioStore';

export interface HandleDragSession {
  readonly kind: HandleKind;
  readonly index: number;
  readonly grab: Vec2;
}

type ShapeDraft = WritableDraft<TerrainShape>;

/** 手柄拖拽会话：记录抓取偏移，避免中心/焦点柄瞬移到光标造成跳变 */
export function beginHandleDrag(
  selection: SelectionTarget,
  hit: { kind: HandleKind; index: number; x: number; y: number },
  world: Vec2,
  project: TownProject,
): HandleDragSession | null {
  if (selection.type === 'terrainShape') {
    const shape = project.terrain.shapes.find((item) => item.id === selection.id);
    if (shape && !('points' in shape) && hit.kind === 'shape_center') {
      return { kind: hit.kind, index: hit.index, grab: [shape.cx - world[0], shape.cy - world[1]] };
    }
    if (shape && 'points' in shape) {
      return { kind: hit.kind, index: hit.index, grab: [0, 0] };
    }
  }
  return { kind: hit.kind, index: hit.index, grab: [0, 0] };
}

function targetPoints(draft: WritableDraft<TownProject>, selection: SelectionTarget): Vec2[] | null {
  if (selection.type === 'zone') return draft.zones.find((item) => item.id === selection.id)?.points ?? null;
  if (selection.type === 'river') return draft.rivers.find((item) => item.id === selection.id)?.points ?? null;
  if (selection.type === 'canal') return draft.canals.find((item) => item.id === selection.id)?.points ?? null;
  if (selection.type === 'road') return draft.roads.find((item) => item.id === selection.id)?.points ?? null;
  if (selection.type === 'waterBody') return draft.waterBodies.find((item) => item.id === selection.id)?.points ?? null;
  return null;
}

function isClosedSelection(selection: SelectionTarget): boolean {
  return selection.type === 'zone' || selection.type === 'waterBody';
}

function dragShape(
  shape: ShapeDraft,
  session: HandleDragSession,
  world: Vec2,
): void {
  if ('points' in shape) {
    if (session.kind === 'vertex') {
      if (session.index >= 0 && session.index < shape.points.length) {
        shape.points[session.index] = [world[0], world[1]];
      }
      return;
    }
    if (session.kind === 'edge_mid') {
      const at = Math.min(session.index + 1, shape.points.length);
      shape.points.splice(at, 0, [world[0], world[1]]);
      return;
    }
    if (session.kind === 'shape_width_left' || session.kind === 'shape_width_right') {
      const mid = shape.points[Math.floor(shape.points.length / 2)];
      const prev = shape.points[Math.max(0, Math.floor(shape.points.length / 2) - 1)];
      const next = shape.points[Math.min(shape.points.length - 1, Math.floor(shape.points.length / 2) + 1)];
      if (!mid || !prev || !next) return;
      const tx = next[0] - prev[0];
      const ty = next[1] - prev[1];
      const len = Math.hypot(tx, ty);
      if (len < 1e-9) return;
      const nx = -ty / len;
      const ny = tx / len;
      const dist = Math.abs((world[0] - mid[0]) * nx + (world[1] - mid[1]) * ny);
      if (session.kind === 'shape_width_left') shape.widthLeft = Math.max(20, Math.min(600, dist));
      else shape.widthRight = Math.max(20, Math.min(600, dist));
    }
    return;
  }
  if (session.kind === 'shape_center') {
    shape.cx = world[0] + session.grab[0];
    shape.cy = world[1] + session.grab[1];
    return;
  }
  const local = shapeWorldToLocal(shape, world[0], world[1]);
  if (session.kind === 'shape_scale_x') shape.rx = Math.max(25, Math.min(1600, Math.abs(local[0])));
  else if (session.kind === 'shape_scale_y') shape.ry = Math.max(25, Math.min(1600, Math.abs(local[1])));
  else if (session.kind === 'shape_rotate') {
    const angle = (Math.atan2(world[0] - shape.cx, -(world[1] - shape.cy)) * 180) / Math.PI;
    shape.angleDeg = Math.max(-180, Math.min(180, angle));
  } else if (session.kind === 'shape_focus') {
    let fx = local[0] / Math.max(25, shape.rx);
    let fy = local[1] / Math.max(25, shape.ry);
    const mag = Math.hypot(fx, fy);
    if (mag > 0.72) {
      const k = 0.72 / mag;
      fx *= k;
      fy *= k;
    }
    shape.focusX = fx;
    shape.focusY = fy;
  }
}

/** 把一次手柄拖拽写入工程草稿（顶点、边中点插点、山包中心/轴/旋转/焦点、脊坎坡宽） */
export function applyHandleDrag(
  draft: WritableDraft<TownProject>,
  selection: SelectionTarget,
  session: HandleDragSession,
  world: Vec2,
): void {
  if (selection.type === 'terrainShape') {
    const shape = draft.terrain.shapes.find((item) => item.id === selection.id);
    if (shape) dragShape(shape, session, world);
    return;
  }
  const points = targetPoints(draft, selection);
  if (!points) return;
  if (session.kind === 'vertex') {
    if (session.index >= 0 && session.index < points.length) {
      points[session.index] = [world[0], world[1]];
    }
    return;
  }
  if (session.kind === 'edge_mid') {
    points.splice(Math.min(session.index + 1, points.length), 0, [world[0], world[1]]);
  }
}


/** 点击边中点柄时先插入一个新顶点（返回新顶点索引），随后按普通顶点拖拽 */
export function insertVertexAtMid(
  draft: WritableDraft<TownProject>,
  selection: SelectionTarget,
  edgeIndex: number,
): number {
  if (selection.type === 'terrainShape') {
    const shape = draft.terrain.shapes.find((item) => item.id === selection.id);
    if (!shape || !('points' in shape)) return -1;
    const a = shape.points[edgeIndex];
    const b = shape.points[edgeIndex + 1];
    if (!a || !b) return -1;
    shape.points.splice(edgeIndex + 1, 0, [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
    return edgeIndex + 1;
  }
  const points = targetPoints(draft, selection);
  if (!points) return -1;
  const a = points[edgeIndex];
  const b = points[(edgeIndex + 1) % points.length];
  if (!a || !b) return -1;
  const at = Math.min(edgeIndex + 1, points.length);
  points.splice(at, 0, [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
  return at;
}

/** 右键删除顶点：闭合多边形保底 3 点，开放折线保底 2 点 */
export function deleteVertexAt(
  draft: WritableDraft<TownProject>,
  selection: SelectionTarget,
  index: number,
): boolean {
  if (selection.type === 'terrainShape') {
    const shape = draft.terrain.shapes.find((item) => item.id === selection.id);
    if (!shape || !('points' in shape)) return false;
    if (shape.points.length <= 2) return false;
    shape.points.splice(index, 1);
    return true;
  }
  const points = targetPoints(draft, selection);
  if (!points) return false;
  const minPoints = isClosedSelection(selection) ? 3 : 2;
  if (points.length <= minPoints) return false;
  if (index < 0 || index >= points.length) return false;
  points.splice(index, 1);
  return true;
}

/** 选区草稿面积守卫：闭合多边形 >= 400 m² 方可落盘 */
export function draftAreaOk(points: ReadonlyArray<Vec2>, minAreaM2 = 400): boolean {
  if (points.length < 3) return false;
  return Math.abs(computePolygonAreaSigned([...points])) >= minAreaM2;
}


export interface DraftCommitContext {
  readonly tool: ToolId;
  readonly waterMode: 'lake' | 'sea' | 'open_canal' | 'qanat_canal';
  readonly roadTier: 'highway' | 'street' | 'lane';
  readonly zoneContentType: WritableDraft<TownProject>['zones'][number]['contentType'];
  readonly linearType: 'ridge' | 'valley' | 'scarp';
}

export interface DraftCommitResult {
  readonly ok: boolean;
  readonly zoneId: string | null;
  readonly reason?: 'area' | 'points';
}

/** 闭合草稿判定：仅多边形选区与湖/海需要 400m² 面积守卫，明渠/坎儿井按开放折线落盘 */
export function isClosedDraftTool(tool: ToolId, waterMode: DraftCommitContext['waterMode']): boolean {
  if (tool === 'draw_zone') return true;
  return tool === 'draw_water_area' && (waterMode === 'lake' || waterMode === 'sea');
}

let draftUid = 0;
function draftId(prefix: string): string {
  draftUid += 1;
  return `${prefix}_${Date.now().toString(36)}${draftUid.toString(36)}`;
}

/** 草稿落盘唯一入口：先写工程，评审通过后再 setSelection，避免 mutate 内重入丢失选中态 */
export function commitDraftPoints(
  points: Vec2[],
  context: DraftCommitContext,
  seed: number,
): DraftCommitResult {
  if (isClosedDraftTool(context.tool, context.waterMode) && !draftAreaOk(points)) {
    return { ok: false, zoneId: null, reason: 'area' };
  }
  if (points.length < 2) return { ok: false, zoneId: null, reason: 'points' };
  const pts = points.map((point) => [point[0], point[1]] as [number, number]);
  const zoneId = context.tool === 'draw_zone' && points.length >= 3 ? draftId('zn') : null;
  const state = useStudioStore.getState();
  state.mutateProject((draft) => {
    if (context.tool === 'draw_river') {
      draft.rivers.push({ id: draftId('riv'), name: '新河道', points: pts, widthStartM: 28, widthEndM: 40, carveDepthM: 6, rippleLines: 3 });
    } else if (context.tool === 'draw_road') {
      const tier = context.roadTier;
      draft.roads.push({ id: draftId('rd'), name: '新道路', tier, points: pts, widthM: tier === 'highway' ? 14 : tier === 'lane' ? 5 : 9 });
    } else if (context.tool === 'draw_zone' && zoneId) {
      draft.zones.push({ id: zoneId, name: '新选区', contentType: context.zoneContentType, points: pts, seed, locked: false, density: 0.72, maxSlopeDeg: 24, streetWidthM: 7.5, wallThicknessM: 5.5, towerIntervalM: 110 });
    } else if (context.tool === 'draw_water_area') {
      if (context.waterMode === 'lake' || context.waterMode === 'sea') {
        if (points.length >= 3) draft.waterBodies.push({ id: draftId('wb'), name: '新水体', kind: context.waterMode, points: pts, rippleLines: 3 });
      } else {
        draft.canals.push({ id: draftId('cn'), name: '新水渠', style: context.waterMode === 'qanat_canal' ? 'qanat' : 'open', points: pts, widthM: 6 });
      }
    } else if (context.tool === 'add_ridge') {
      const type = context.linearType;
      draft.terrain.shapes.push({ id: draftId('shp'), type, points: pts, deltaElev: type === 'valley' ? -12 : 12, widthLeft: 90, widthRight: 70 });
    }
  });
  if (zoneId) useStudioStore.getState().setSelection({ type: 'zone', id: zoneId });
  return { ok: true, zoneId };
}
