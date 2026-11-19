import type { Vec2 } from '../../schema/geometry.types';

/** 以中心、宽（局部 x）高（局部 y）与旋角生成定向矩形四角 */
export function orientedRect(
  cx: number,
  cy: number,
  widthM: number,
  heightM: number,
  angleDeg: number,
): Vec2[] {
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const hw = widthM * 0.5;
  const hh = heightM * 0.5;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return corners.map(([lx, ly]) => [cx + lx * ca - ly * sa, cy + lx * sa + ly * ca] as Vec2);
}

/** 定向矩形的局部轴：ux 沿局部 x，uy 沿局部 y */
export function orientedAxes(angleDeg: number): { ux: Vec2; uy: Vec2 } {
  const rad = (angleDeg * Math.PI) / 180;
  return { ux: [Math.cos(rad), Math.sin(rad)], uy: [-Math.sin(rad), Math.cos(rad)] };
}

/** 多边形整体平移 */
export function translatePolygon(poly: ReadonlyArray<Vec2>, dx: number, dy: number): Vec2[] {
  return poly.map((p) => [p[0] + dx, p[1] + dy] as Vec2);
}

/** 多边形向内缩放（绕重心），factor < 1 收缩 */
export function scalePolygonAbout(
  poly: ReadonlyArray<Vec2>,
  cx: number,
  cy: number,
  factor: number,
): Vec2[] {
  return poly.map((p) => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor] as Vec2);
}
