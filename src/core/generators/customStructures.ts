import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { ProjectStructure, StructureKind, StructureRoofKind } from '../../schema/v3.entity.schema';
import type { TownProject } from '../../schema/project.schema';
import { computePolygonCentroid } from '../math/polygon';
import { orientedRect } from '../math/oriented';

export interface BuiltExtraRoof {
  readonly polygon: Polygon;
  readonly shadow: Polygon;
  readonly ridge: readonly [Vec2, Vec2] | null;
}

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
  /** 合院附属屋顶（东西厢房 / 南门房），各自带阴影与屋脊 */
  readonly extraPolygons?: ReadonlyArray<BuiltExtraRoof>;
  /** 合院院坪（整块占地外框），同时作为刚性障碍防民房侵入 */
  readonly yardPolygon?: Polygon | null;
  /** 合院实线矮院墙（南向正中留院门豁口，单条折线） */
  readonly wallPolylines?: ReadonlyArray<Polyline>;
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

function localToWorld(lx: number, ly: number, cx: number, cy: number, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  return [cx + lx * ca - ly * sa, cy + lx * sa + ly * ca];
}

function localRect(lx: number, ly: number, w: number, d: number): Array<readonly [number, number]> {
  const hw = w * 0.5;
  const hd = d * 0.5;
  return [
    [lx - hw, ly - hd],
    [lx + hw, ly - hd],
    [lx + hw, ly + hd],
    [lx - hw, ly + hd],
  ];
}

function shadowOf(poly: Polygon): Polygon {
  return poly.map((p) => [p[0] + 3.2, p[1] + 3.2] as Vec2);
}

/** 局部矩形屋脊：alongX 沿局部 x，否则沿局部 y，长度取屋面长向的 72% */
function rectRidge(
  lx: number,
  ly: number,
  lenM: number,
  angleDeg: number,
  alongX: boolean,
  cx: number,
  cy: number,
): readonly [Vec2, Vec2] {
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const ux = alongX ? ca : -sa;
  const uy = alongX ? sa : ca;
  const half = lenM * 0.36;
  const center = localToWorld(lx, ly, cx, cy, angleDeg);
  return [
    [center[0] - ux * half, center[1] - uy * half],
    [center[0] + ux * half, center[1] + uy * half],
  ];
}

/** L 形曲尺厅：6 顶点，主翼进深 ≤ 13.0m、侧翼面宽 ≤ 12.0m（木构物理进深硬上限） */
function lHallPoints(w: number, d: number): Array<readonly [number, number]> {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const mainD = Math.min(13.0, d * 0.42);
  const sideW = Math.min(12.0, w * 0.34);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, -hd + mainD],
    [-hw + sideW, -hd + mainD],
    [-hw + sideW, hd],
    [-hw, hd],
  ];
}

/** U 形三合院：8 顶点，中庭开口朝南，三面翼楼厚度 ≤ 12.0m */
function uCourtPoints(w: number, d: number): Array<readonly [number, number]> {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const t = Math.min(12.0, Math.min(w, d) * 0.30);
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

/**
 * 合院建筑群：院坪外框 + 南向留豁口实线矮院墙 + 北侧正堂 + 东西独立厢房 + 南门房。
 * 正堂进深 ≤ 11.5m、厢房进深 ≤ 8.2m，与正堂脱开 2.2m 火巷，彻底消灭巨型实心砖块。
 */
function buildCourtyard(source: ProjectStructure): BuiltStructure {
  const w = source.widthM;
  const d = source.depthM;
  const hw = w * 0.5;
  const hd = d * 0.5;
  const angle = source.angleDeg;
  const to = (pts: ReadonlyArray<readonly [number, number]>): Vec2[] =>
    rotateLocal(pts, source.x, source.y, angle);
  const gateHalf = Math.min(7, w * 0.2) * 0.5;
  const ins = 0.6;
  const wallPolylines: Polyline[] = [
    to([
      [gateHalf, hd - ins],
      [hw - ins, hd - ins],
      [hw - ins, -hd + ins],
      [-hw + ins, -hd + ins],
      [-hw + ins, hd - ins],
      [-gateHalf, hd - ins],
    ]),
  ];
  const mainW = Math.min(w - 6, Math.max(12, w * 0.68));
  const mainD = Math.min(11.5, Math.max(7.2, d * 0.26));
  const mainLy = -hd + mainD * 0.5 + 1.6;
  const polygon = to(localRect(0, mainLy, mainW, mainD));
  const extras: BuiltExtraRoof[] = [];
  const hasGates = w >= 34 && d >= 30;
  const gateW = Math.min(10, w * 0.24);
  const gateD = hasGates ? Math.min(6.8, d * 0.16) : 0;
  const gateLy = hd - gateD * 0.5 - 1.4;
  if (hasGates) {
    for (const side of [-1, 1]) {
      const lx = side * (hw - gateW * 0.5 - 1.2);
      const poly = to(localRect(lx, gateLy, gateW, gateD));
      extras.push({ polygon: poly, shadow: shadowOf(poly), ridge: rectRidge(lx, gateLy, gateW, angle, true, source.x, source.y) });
    }
  }
  const wingD = Math.min(8.2, Math.max(5.5, w * 0.19));
  const startLy = mainLy + mainD * 0.5 + 2.2;
  const stopLy = hasGates ? gateLy - gateD * 0.5 - 1.0 : hd - 1.8;
  const wingLen = Math.min(Math.max(8, d * 0.44), stopLy - startLy);
  if (wingLen >= 6) {
    const wingLy = startLy + wingLen * 0.5;
    for (const side of [-1, 1]) {
      const lx = side * (hw - wingD * 0.5 - 1.4);
      const poly = to(localRect(lx, wingLy, wingD, wingLen));
      extras.push({ polygon: poly, shadow: shadowOf(poly), ridge: rectRidge(lx, wingLy, wingLen, angle, false, source.x, source.y) });
    }
  }
  return {
    id: source.id,
    name: source.name,
    x: source.x,
    y: source.y,
    angleDeg: angle,
    widthM: w,
    depthM: d,
    kind: 'courtyard',
    roofKind: source.roofKind,
    polygon,
    innerRing: null,
    ridge: rectRidge(0, mainLy, mainW, angle, true, source.x, source.y),
    shadow: shadowOf(polygon),
    extraPolygons: extras,
    yardPolygon: orientedRect(source.x, source.y, w, d, angle),
    wallPolylines,
  };
}

export function buildCustomStructures(project: TownProject): ReadonlyArray<BuiltStructure> {
  const out: BuiltStructure[] = [];
  for (const source of project.structures) {
    if (source.kind === 'courtyard') {
      out.push(buildCourtyard(source));
      continue;
    }
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
      shadow: shadowOf(polygon),
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
