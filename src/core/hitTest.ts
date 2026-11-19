import type {
  CompiledSceneBase,
  Polyline,
  SelectionTarget,
  Vec2,
  ViewportState,
} from '../schema/geometry.types';
import type { TerrainShape, TownProject } from '../schema/project.schema';
import { pointToPolylineDist, pointToSegmentDist } from './obstacles/collisionAudit';
import { ENTITY_SELECTION_TYPES, hitEntityHandle } from './entityHandles';
import { pointInPolygon } from './math/polygon';

export type HandleKind =
  | 'entity_center'
  | 'entity_rotate'
  | 'entity_scale_w'
  | 'entity_scale_d'
  | 'vertex'
  | 'edge_mid'
  | 'shape_center'
  | 'shape_scale_x'
  | 'shape_scale_y'
  | 'shape_rotate'
  | 'shape_focus'
  | 'shape_width_left'
  | 'shape_width_right';

export interface HandleHit {
  readonly kind: HandleKind;
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

function toleranceM(viewport?: ViewportState | null): number {
  const zoom = viewport && viewport.zoom > 1e-6 ? viewport.zoom : 1;
  return 9.0 / zoom;
}

function ringOf(poly: Polyline): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

/** 山包局部坐标 → 世界坐标（严格乘 angleDeg 旋转矩阵） */
export function shapeLocalToWorld(shape: TerrainShape, lx: number, ly: number): Vec2 {
  if ('points' in shape) return [shape.points[0]?.[0] ?? 0, shape.points[0]?.[1] ?? 0];
  const rad = (shape.angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  return [shape.cx + lx * ca - ly * sa, shape.cy + lx * sa + ly * ca];
}

/** 世界坐标 → 山包局部坐标（乘逆旋转矩阵，拖拽反算专用） */
export function shapeWorldToLocal(shape: TerrainShape, wx: number, wy: number): Vec2 {
  if ('points' in shape) return [wx, wy];
  const rad = (shape.angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const dx = wx - shape.cx;
  const dy = wy - shape.cy;
  return [dx * ca + dy * sa, -dx * sa + dy * ca];
}

function hitLinearShape(shape: TerrainShape, wx: number, wy: number, tol: number): boolean {
  if ('points' in shape) return pointToPolylineDist(wx, wy, shape.points) <= tol;
  const rad = (shape.angleDeg * Math.PI) / 180;
  const dx = wx - shape.cx;
  const dy = wy - shape.cy;
  const u = (dx * Math.cos(rad) + dy * Math.sin(rad)) / Math.max(25, shape.rx);
  const v = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / Math.max(25, shape.ry);
  const scale = 1 + tol / Math.max(25, Math.min(shape.rx, shape.ry));
  return u * u + v * v <= scale * scale;
}

/** 旋转矩形（OBB）命中：把世界点反旋到局部轴系后按半宽/半高比较 */
function hitObb(
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  widthM: number,
  depthM: number,
  angleDeg: number,
  tol: number,
): boolean {
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * ca + dy * sa;
  const ly = -dx * sa + dy * ca;
  return Math.abs(lx) <= depthM * 0.5 + tol && Math.abs(ly) <= widthM * 0.5 + tol;
}

/**
 * 14 级严格优先级拾取：landmark -> reef -> ford -> weir -> dock -> watermill -> structure -> bridge
 * -> canal -> road -> river -> waterBody -> zone -> terrainShape。
 * 水工与核心建筑群强制先于选区，zone 先于 terrainShape，且永不拾取单栋房屋（严守 NG-01）。
 */
export function hitTestSceneObject(
  project: TownProject,
  scene: CompiledSceneBase,
  wx: number,
  wy: number,
  viewport?: ViewportState | null,
): SelectionTarget | null {
  const tol = toleranceM(viewport);
  const zoom = viewport && viewport.zoom > 1e-6 ? viewport.zoom : 1;

  for (const lm of project.landmarks) {
    const radius = Math.max(10, lm.sizePx / zoom) + tol;
    if (Math.hypot(wx - lm.x, wy - lm.y) <= radius) {
      return { type: 'landmark', id: lm.id, name: lm.label };
    }
  }
  for (const reef of scene.hydro.reefs) {
    if (Math.hypot(wx - reef.x, wy - reef.y) <= reef.radiusM + tol) {
      return { type: 'reef', id: reef.id };
    }
  }
  const crossedFords = new Set<string>();
  for (const ford of scene.hydro.fordCrossings) {
    crossedFords.add(ford.fordId);
    if (Math.hypot(wx - ford.x, wy - ford.y) <= Math.max(8, ford.radiusM) + tol) {
      return { type: 'ford', id: ford.fordId };
    }
  }
  for (const ford of project.fords) {
    if (Math.hypot(wx - ford.x, wy - ford.y) <= Math.max(8, ford.radiusM) + tol) {
      return { type: 'ford', id: ford.id, name: ford.name };
    }
  }
  void crossedFords;
  for (const weir of project.weirs) {
    if (pointToSegmentDist(wx, wy, weir.pStart, weir.pEnd) <= weir.widthM * 0.5 + tol) {
      return { type: 'weir', id: weir.id, name: weir.name };
    }
  }
  for (const dock of project.docks) {
    if (hitObb(wx, wy, dock.x, dock.y, dock.widthM, dock.lengthM, dock.angleDeg, tol)) {
      return { type: 'dock', id: dock.id, name: dock.name };
    }
  }
  for (const mill of project.watermills) {
    if (hitObb(wx, wy, mill.x, mill.y, mill.widthM, mill.depthM, mill.angleDeg, tol)) {
      return { type: 'watermill', id: mill.id, name: mill.name };
    }
  }
  for (const structure of project.structures) {
    const hit = structure.kind === 'round_altar'
      ? Math.hypot(wx - structure.x, wy - structure.y) <= Math.max(structure.widthM, structure.depthM) * 0.5 + tol
      : hitObb(wx, wy, structure.x, structure.y, structure.widthM, structure.depthM, structure.angleDeg, tol);
    if (hit) return { type: 'structure', id: structure.id, name: structure.name };
  }
  for (const bridge of project.bridgeOverrides) {
    if (Math.hypot(wx - bridge.x, wy - bridge.y) <= 16 + tol) {
      return { type: 'bridge', id: bridge.id, name: '桥梁覆写' };
    }
  }
  for (const canal of scene.hydro.canals) {
    if (pointToPolylineDist(wx, wy, canal.centerline) <= tol) {
      return { type: 'canal', id: canal.id, name: canal.name };
    }
  }
  for (const road of scene.hydro.roads) {
    if (pointToPolylineDist(wx, wy, road.centerline) <= tol) {
      return { type: 'road', id: road.id, name: road.name };
    }
  }
  for (const river of scene.hydro.rivers) {
    if (pointToPolylineDist(wx, wy, river.centerline) <= tol) {
      return { type: 'river', id: river.id, name: river.name };
    }
    if (pointToPolylineDist(wx, wy, ringOf(river.bankPolygon)) <= tol) {
      return { type: 'river', id: river.id, name: river.name };
    }
  }
  for (const wb of scene.hydro.waterBodies) {
    if (pointInPolygon(wx, wy, wb.shorePoly) || pointToPolylineDist(wx, wy, ringOf(wb.shorePoly)) <= tol) {
      return { type: 'waterBody', id: wb.id, name: wb.name };
    }
  }
  for (let i = project.zones.length - 1; i >= 0; i -= 1) {
    const zone = project.zones[i];
    if (!zone) continue;
    if (pointInPolygon(wx, wy, zone.points)) {
      return { type: 'zone', id: zone.id, name: zone.name };
    }
    if (pointToPolylineDist(wx, wy, ringOf(zone.points)) <= tol) {
      return { type: 'zone', id: zone.id, name: zone.name };
    }
  }
  for (const shape of project.terrain.shapes) {
    if (hitLinearShape(shape, wx, wy, tol)) {
      return { type: 'terrainShape', id: shape.id };
    }
  }
  return null;
}

function pushVertexHandles(out: HandleHit[], poly: Polyline, closed: boolean, tol: number, wx: number, wy: number): void {
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    if (!p) continue;
    if (Math.hypot(wx - p[0], wy - p[1]) <= tol) out.push({ kind: 'vertex', index: i, x: p[0], y: p[1] });
  }
  const last = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const mx = 0.5 * (a[0] + b[0]);
    const my = 0.5 * (a[1] + b[1]);
    if (Math.hypot(wx - mx, wy - my) <= tol) out.push({ kind: 'edge_mid', index: i, x: mx, y: my });
  }
}

function selectedPolyline(project: TownProject, selection: SelectionTarget): { pts: Polyline; closed: boolean } | null {
  if (selection.type === 'river') {
    const found = project.rivers.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: false } : null;
  }
  if (selection.type === 'canal') {
    const found = project.canals.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: false } : null;
  }
  if (selection.type === 'road') {
    const found = project.roads.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: false } : null;
  }
  if (selection.type === 'waterBody') {
    const found = project.waterBodies.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: true } : null;
  }
  if (selection.type === 'zone') {
    const found = project.zones.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: true } : null;
  }
  return null;
}

/** 选中对象的活动手柄命中：折线/多边形顶点与边中点、山包中心/轴/旋转/偏心焦点、脊坎坡宽柄 */
export function hitTestActiveHandles(
  project: TownProject,
  selection: SelectionTarget | null,
  wx: number,
  wy: number,
  viewport?: ViewportState | null,
): HandleHit | null {
  if (!selection) return null;
  const tol = toleranceM(viewport) * 1.4;
  const out: HandleHit[] = [];
  if (ENTITY_SELECTION_TYPES.includes(selection.type)) {
    const hit = hitEntityHandle(project, selection, wx, wy, tol);
    return hit ? { kind: hit.kind, index: 0, x: hit.x, y: hit.y } : null;
  }

  if (selection.type === 'terrainShape') {
    const shape = project.terrain.shapes.find((s) => s.id === selection.id);
    if (!shape) return null;
    if ('points' in shape) {
      pushVertexHandles(out, shape.points, false, tol, wx, wy);
      const n = shape.points.length;
      const mid = shape.points[Math.floor(n / 2)];
      const prev = shape.points[Math.max(0, Math.floor(n / 2) - 1)];
      const next = shape.points[Math.min(n - 1, Math.floor(n / 2) + 1)];
      if (mid && prev && next) {
        const tx = next[0] - prev[0];
        const ty = next[1] - prev[1];
        const len = Math.hypot(tx, ty);
        const nx = len > 1e-9 ? ty / len : 0;
        const ny = len > 1e-9 ? -tx / len : 1;
        const left: Vec2 = [mid[0] + nx * shape.widthLeft, mid[1] + ny * shape.widthLeft];
        const right: Vec2 = [mid[0] - nx * shape.widthRight, mid[1] - ny * shape.widthRight];
        if (Math.hypot(wx - left[0], wy - left[1]) <= tol) out.push({ kind: 'shape_width_left', index: 0, x: left[0], y: left[1] });
        if (Math.hypot(wx - right[0], wy - right[1]) <= tol) out.push({ kind: 'shape_width_right', index: 1, x: right[0], y: right[1] });
      }
    } else {
      const focus: Vec2 = shapeLocalToWorld(shape, shape.focusX * shape.rx, shape.focusY * shape.ry);
      if (Math.hypot(wx - focus[0], wy - focus[1]) <= tol) {
        out.push({ kind: 'shape_focus', index: 5, x: focus[0], y: focus[1] });
      } else if (Math.hypot(wx - shape.cx, wy - shape.cy) <= tol) {
        out.push({ kind: 'shape_center', index: 0, x: shape.cx, y: shape.cy });
      }
      const axisX: Vec2 = shapeLocalToWorld(shape, shape.rx, 0);
      const axisXNeg: Vec2 = shapeLocalToWorld(shape, -shape.rx, 0);
      const axisY: Vec2 = shapeLocalToWorld(shape, 0, shape.ry);
      const axisYNeg: Vec2 = shapeLocalToWorld(shape, 0, -shape.ry);
      const rotate: Vec2 = shapeLocalToWorld(shape, 0, -(Math.max(shape.rx, shape.ry) + 18));
      const handles: ReadonlyArray<readonly [HandleKind, number, Vec2]> = [
        ['shape_scale_x', 0, axisX],
        ['shape_scale_x', 1, axisXNeg],
        ['shape_scale_y', 2, axisY],
        ['shape_scale_y', 3, axisYNeg],
        ['shape_rotate', 4, rotate],
      ];
      for (const [kind, index, point] of handles) {
        if (Math.hypot(wx - point[0], wy - point[1]) <= tol) out.push({ kind, index, x: point[0], y: point[1] });
      }
    }
  } else {
    const picked = selectedPolyline(project, selection);
    if (picked) pushVertexHandles(out, picked.pts, picked.closed, tol, wx, wy);
  }

  if (out.length === 0) return null;
  return out[0] ?? null;
}
