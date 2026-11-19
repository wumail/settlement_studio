import type { Polygon, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { TerrainShape, TownProject } from '../schema/project.schema';
import { shapeLocalToWorld } from '../core/hitTest';
import type { RenderBackend } from './RenderBackend';
import { worldToScreen } from './RenderBackend';

const VERTEX = 7;
const MID_R = 3.2;

function ellipseRing(shape: TerrainShape): Vec2[] {
  if ('points' in shape) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < 64; i += 1) {
    const t = (i / 64) * Math.PI * 2;
    out.push(shapeLocalToWorld(shape, Math.cos(t) * shape.rx, Math.sin(t) * shape.ry));
  }
  const first = out[0];
  if (first) out.push(first);
  return out;
}

function linearMidFrame(shape: TerrainShape): { mid: Vec2; nx: number; ny: number } | null {
  if (!('points' in shape)) return null;
  const n = shape.points.length;
  const i = Math.floor(n / 2);
  const mid = shape.points[i];
  const prev = shape.points[Math.max(0, i - 1)];
  const next = shape.points[Math.min(n - 1, i + 1)];
  if (!mid || !prev || !next) return null;
  const tx = next[0] - prev[0];
  const ty = next[1] - prev[1];
  const len = Math.hypot(tx, ty);
  if (len < 1e-9) return { mid, nx: 0, ny: 1 };
  return { mid, nx: ty / len, ny: -tx / len };
}

function collectPolylines(project: TownProject, selection: SelectionTarget): { pts: Vec2[]; closed: boolean } | null {
  if (selection.type === 'zone') {
    const found = project.zones.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: true } : null;
  }
  if (selection.type === 'waterBody') {
    const found = project.waterBodies.find((item) => item.id === selection.id);
    return found ? { pts: found.points, closed: true } : null;
  }
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
  if (selection.type === 'terrainShape') {
    const shape = project.terrain.shapes.find((item) => item.id === selection.id);
    if (shape && 'points' in shape) return { pts: shape.points, closed: false };
  }
  return null;
}

/** 第 14 层交互覆盖：顶点方块、边中点圆点、山包椭圆虚线框与偏心/旋转柄、脊坎双侧坡宽柄 */
export function paintSelectionHandles(
  backend: RenderBackend,
  project: TownProject,
  selection: SelectionTarget | null,
  pal: ResolvedPalette,
  vp: ViewportState,
): void {
  if (!selection) return;
  const pt = (v: Vec2): Vec2 => worldToScreen(v[0], v[1], vp);

  if (selection.type === 'terrainShape') {
    const shape = project.terrain.shapes.find((item) => item.id === selection.id);
    if (!shape) return;
    if (!('points' in shape)) {
      const ring = ellipseRing(shape).map(pt);
      backend.drawPolyline(ring, { stroke: pal.accentPine, lineWidth: 1.2, dash: [6, 4] }, false);
      const c = pt([shape.cx, shape.cy]);
      backend.drawSegments(
        [
          [[c[0] - 6, c[1]], [c[0] + 6, c[1]]],
          [[c[0], c[1] - 6], [c[0], c[1] + 6]],
        ],
        { stroke: pal.accentPine, lineWidth: 1.2 },
      );
      const axisX: Vec2 = pt(shapeLocalToWorld(shape, shape.rx, 0));
      const axisY: Vec2 = pt(shapeLocalToWorld(shape, 0, shape.ry));
      const rotate: Vec2 = pt(shapeLocalToWorld(shape, 0, -(Math.max(shape.rx, shape.ry) + 18)));
      backend.drawSegments(
        [
          [
            pt(shapeLocalToWorld(shape, -shape.rx, 0)),
            pt(shapeLocalToWorld(shape, shape.rx, 0)),
          ],
          [
            pt(shapeLocalToWorld(shape, 0, -shape.ry)),
            pt(shapeLocalToWorld(shape, 0, shape.ry)),
          ],
        ],
        { stroke: pal.accentPine, lineWidth: 0.9, dash: [4, 4], opacity: 0.8 },
      );
      backend.drawSegments([[c, rotate]], { stroke: pal.accentTerracotta, lineWidth: 1.1, dash: [3, 3] });
      backend.drawCircle(axisX[0], axisX[1], 4, { fill: pal.paperBg, stroke: pal.accentPine, lineWidth: 1.2 });
      backend.drawCircle(axisY[0], axisY[1], 4, { fill: pal.paperBg, stroke: pal.accentPine, lineWidth: 1.2 });
      backend.drawCircle(rotate[0], rotate[1], 4.5, { fill: pal.accentTerracotta, stroke: pal.inkDark, lineWidth: 0.9 });
      const focus: Vec2 = pt(shapeLocalToWorld(shape, shape.focusX * shape.rx, shape.focusY * shape.ry));
      backend.drawPolygon(
        [[focus[0], focus[1] - 5], [focus[0] + 5, focus[1]], [focus[0], focus[1] + 5], [focus[0] - 5, focus[1]]],
        { fill: pal.paperBg, stroke: pal.accentPine, lineWidth: 1.3 },
      );
      return;
    }
  }

  const picked = collectPolylines(project, selection);
  if (!picked) return;
  if (selection.type === 'terrainShape') {
    const shape = project.terrain.shapes.find((item) => item.id === selection.id);
    const frame = shape && 'points' in shape ? linearMidFrame(shape) : null;
    if (shape && 'points' in shape && frame) {
      const left: Vec2 = pt([frame.mid[0] + frame.nx * shape.widthLeft, frame.mid[1] + frame.ny * shape.widthLeft]);
      const right: Vec2 = pt([frame.mid[0] - frame.nx * shape.widthRight, frame.mid[1] - frame.ny * shape.widthRight]);
      const midPt = pt(frame.mid);
      backend.drawSegments([[midPt, left], [midPt, right]], { stroke: pal.accentTerracotta, lineWidth: 1.0, dash: [5, 4] });
      backend.drawCircle(left[0], left[1], 4.5, { fill: pal.paperBg, stroke: pal.accentTerracotta, lineWidth: 1.2 });
      backend.drawCircle(right[0], right[1], 4.5, { fill: pal.paperBg, stroke: pal.accentTerracotta, lineWidth: 1.2 });
    }
  }
  const pts = picked.pts;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    if (!p) continue;
    const c = pt(p);
    backend.drawRect(c[0] - VERTEX / 2, c[1] - VERTEX / 2, VERTEX, VERTEX, {
      fill: pal.paperBg,
      stroke: pal.accentPine,
      lineWidth: 1.2,
    });
  }
  const edgeCount = picked.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    const c = pt([0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
    backend.drawCircle(c[0], c[1], MID_R, { fill: pal.paperBg, stroke: pal.accentTerracotta, lineWidth: 1.1 });
  }
}

/** 供命中测试与绘制共用的边中点列表（开放折线不含首尾闭环边） */
export function midpointsOf(points: Polygon, closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) out.push([0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
  }
  return out;
}
