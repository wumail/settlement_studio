import type { Polygon, Vec2 } from '../../schema/geometry.types';
import type { StructureKind, StructureRoofKind } from '../../schema/v3.entity.schema';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonCentroid } from '../math/polygon';
import { orientedRect } from '../math/oriented';

export interface BuiltStructure {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
  readonly widthM: number;
  readonly depthM: number;
  readonly kind: StructureKind;
  readonly roofKind: StructureRoofKind;
  readonly polygon: Polygon;
  readonly innerRing: Polygon | null;
  readonly ridge: readonly [Vec2, Vec2] | null;
  readonly shadow: Polygon;
}

function rotateLocal(
  points: ReadonlyArray<readonly [number, number]>,
  cx: number,
  cy: number,
  angleDeg: number,
): Vec2[] {
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  return points.map(([lx, ly]) => [cx + lx * ca - ly * sa, cy + lx * sa + ly * ca] as Vec2);
}

/** L 形曲尺厅：6 顶点，主翼沿面宽、次翼折向进深 */
function lHallPoints(w: number, d: number): Array<readonly [number, number]> {
  const hw = w * 0.5;
  const hd = d * 0.5;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, -hd + d * 0.42],
    [-hw + w * 0.34, -hd + d * 0.42],
    [-hw + w * 0.34, hd],
    [-hw, hd],
  ];
}

/** U 形三合院：8 顶点，中庭开口朝南 */
function uCourtPoints(w: number, d: number): Array<readonly [number, number]> {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const t = Math.min(w, d) * 0.32;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [hw - t, hd],
    [hw - t, hd - t],
    [-hw + t, hd - t],
    [-hw + t, hd],
    [-hw, hd],
  ];
}

/** 16 边圆坛：偶数边正多边形近似圆，内环台基 0.62 倍 */
function roundPoints(w: number, d: number): Vec2[] {
  const r = Math.max(w, d) * 0.5;
  const out: Vec2[] = [];
  for (let i = 0; i < 16; i += 1) {
    const ang = (i / 16) * Math.PI * 2;
    out.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  return out;
}

export function buildStructureFootprint(
  kind: StructureKind,
  x: number,
  y: number,
  widthM: number,
  depthM: number,
  angleDeg: number,
): Polygon {
  if (kind === 'l_hall') return rotateLocal(lHallPoints(widthM, depthM), x, y, angleDeg);
  if (kind === 'u_court') return rotateLocal(uCourtPoints(widthM, depthM), x, y, angleDeg);
  if (kind === 'round_altar') return rotateLocal(roundPoints(widthM, depthM), x, y, angleDeg);
  return orientedRect(x, y, widthM, depthM, angleDeg);
}

export function buildCustomStructures(project: TownProject): ReadonlyArray<BuiltStructure> {
  const out: BuiltStructure[] = [];
  for (const source of project.structures) {
    const polygon = buildStructureFootprint(
      source.kind,
      source.x,
      source.y,
      source.widthM,
      source.depthM,
      source.angleDeg,
    );
    const centroid = computePolygonCentroid(polygon);
    const innerRing =
      source.kind === 'round_altar'
        ? polygon.map(
            (p) => [centroid[0] + (p[0] - centroid[0]) * 0.62, centroid[1] + (p[1] - centroid[1]) * 0.62] as Vec2,
          )
        : null;
    const rad = (source.angleDeg * Math.PI) / 180;
    const ridge: readonly [Vec2, Vec2] | null =
      source.kind === 'round_altar'
        ? null
        : [
            [centroid[0] - Math.cos(rad) * source.widthM * 0.32, centroid[1] - Math.sin(rad) * source.widthM * 0.32],
            [centroid[0] + Math.cos(rad) * source.widthM * 0.32, centroid[1] + Math.sin(rad) * source.widthM * 0.32],
          ];
    const shadow = polygon.map((p) => [p[0] + 3.2, p[1] + 3.2] as Vec2);
    out.push({
      id: source.id,
      name: source.name,
      x: source.x,
      y: source.y,
      angleDeg: source.angleDeg,
      widthM: source.widthM,
      depthM: source.depthM,
      kind: source.kind,
      roofKind: source.roofKind,
      polygon,
      innerRing,
      ridge,
      shadow,
    });
  }
  return out;
}

/** 选中结构的内框（渲染手柄与检视器高亮共用） */
export function structureBBox(polygon: Polygon): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of polygon) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return [minX, minY, maxX, maxY];
}
