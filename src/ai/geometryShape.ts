import type { Vec2 } from '../schema/geometry.types';
import { computePolygonAreaSigned, computePolygonBBox } from '../core/math/polygon';
import { createRng } from '../core/math/rng';
import type { RelativeShape } from './geometryPolyline';

function unitShape(shape: RelativeShape, seed: number): Vec2[] {
  if (shape === 'rect') return [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const count = shape === 'octagonal' ? 8 : shape === 'polygon_13' ? 13 : 12;
  const rng = createRng(Math.abs(Math.floor(seed)) || 1);
  const jitter = shape === 'polygon_13' ? 0.07 : shape === 'organic' ? 0.16 : 0;
  const phase = shape === 'octagonal' ? Math.PI / 8 : 0;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const ang = phase + (i / count) * Math.PI * 2;
    const r = 1 + (jitter > 0 ? (rng() * 2 - 1) * jitter : 0);
    out.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  return out;
}

/** 相对选区多边形：精确面积归一化 + 图幅内夹紧，确定性无随机源 */
export function buildRelativePolygon(
  anchorCenter: Vec2,
  shape: RelativeShape,
  areaHa: number,
  aspectRatio = 1,
  rotationDeg = 0,
  seed = 1,
  worldSizeM = 2400,
): Vec2[] {
  const targetArea = Math.max(400, areaHa * 10000);
  const aspect = Math.max(0.25, Math.min(4, aspectRatio));
  const base = unitShape(shape, seed).map(
    ([x, y]) => [x * Math.sqrt(aspect), y / Math.sqrt(aspect)] as Vec2,
  );
  const baseArea = Math.abs(computePolygonAreaSigned(base));
  const scale = Math.sqrt(targetArea / Math.max(1e-9, baseArea));
  const rad = (rotationDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  let poly: Vec2[] = base.map(([x, y]) => [
    anchorCenter[0] + (x * ca - y * sa) * scale,
    anchorCenter[1] + (x * sa + y * ca) * scale,
  ]);
  poly = clampToWorld(poly, worldSizeM);
  return poly;
}

/** 整体平移进图幅；仍超出则等比缩小，绝不逐点硬截破坏形状 */
function clampToWorld(poly: Vec2[], worldSizeM: number): Vec2[] {
  const margin = 20;
  let [minX, minY, maxX, maxY] = computePolygonBBox(poly);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const maxSpan = Math.max(10, worldSizeM - margin * 2);
  let out = poly;
  if (spanX > maxSpan || spanY > maxSpan) {
    const k = Math.min(maxSpan / Math.max(1e-9, spanX), maxSpan / Math.max(1e-9, spanY));
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    out = out.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Vec2);
    [minX, minY, maxX, maxY] = computePolygonBBox(out);
  }
  let dx = 0;
  let dy = 0;
  if (minX < margin) dx = margin - minX;
  else if (maxX > worldSizeM - margin) dx = worldSizeM - margin - maxX;
  if (minY < margin) dy = margin - minY;
  else if (maxY > worldSizeM - margin) dy = worldSizeM - margin - maxY;
  return dx === 0 && dy === 0 ? out : out.map(([x, y]) => [x + dx, y + dy] as Vec2);
}

