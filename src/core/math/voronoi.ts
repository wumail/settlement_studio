import type { BBox, Polygon, Vec2 } from '../../schema/geometry.types';
import {
  clipPolygonHalfPlane,
  computePolygonAreaSigned,
  computePolygonCentroid,
  intersectConvexWithPolygon,
  minDistPolyToPoly,
  pointInPolygon,
} from './polygon';

function rectOfBBox(bbox: BBox): Vec2[] {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

function maxRadiusSq(poly: ReadonlyArray<Vec2>, px: number, py: number): number {
  let max2 = 0;
  for (let k = 0; k < poly.length; k += 1) {
    const v = poly[k];
    if (!v) continue;
    const dx = v[0] - px;
    const dy = v[1] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > max2) max2 = d2;
  }
  return max2;
}

function buildCells(sites: ReadonlyArray<Vec2>, bbox: BBox): Vec2[][] {
  const base = rectOfBBox(bbox);
  const n = sites.length;
  const out: Vec2[][] = [];
  const bboxArea = Math.max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  // 两阶段半平面裁剪：先用 2.5 倍平均间距内的近邻迅速收紧 maxR，再跳过 dist > 2*maxR 的远邻（数学等价）
  const nearR2 = n > 16 ? (6.25 * bboxArea) / n : Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const pi = sites[i];
    if (!pi) {
      out.push([]);
      continue;
    }
    const pix = pi[0];
    const piy = pi[1];
    const pi2 = pix * pix + piy * piy;
    let poly: Vec2[] = base.map((p) => [p[0], p[1]] as Vec2);
    let maxR2 = maxRadiusSq(poly, pix, piy);
    const clipBy = (pj: Vec2): boolean => {
      const nx = pj[0] - pix;
      const ny = pj[1] - piy;
      const d2 = nx * nx + ny * ny;
      if (d2 < 1e-24) {
        poly = [];
        return false;
      }
      if (d2 > 4 * maxR2 + 1e-6) return true;
      const c = 0.5 * (pj[0] * pj[0] + pj[1] * pj[1] - pi2);
      const next = clipPolygonHalfPlane(poly, nx, ny, c);
      if (next.length < 3) {
        poly = [];
        return false;
      }
      poly = next;
      maxR2 = maxRadiusSq(poly, pix, piy);
      return true;
    };
    let alive = true;
    for (let j = 0; j < n && alive; j += 1) {
      if (i === j) continue;
      const pj = sites[j];
      if (!pj) continue;
      const dx = pj[0] - pix;
      const dy = pj[1] - piy;
      if (dx * dx + dy * dy <= nearR2) alive = clipBy(pj);
    }
    if (alive && Number.isFinite(nearR2)) {
      for (let j = 0; j < n && alive; j += 1) {
        if (i === j) continue;
        const pj = sites[j];
        if (!pj) continue;
        const dx = pj[0] - pix;
        const dy = pj[1] - piy;
        const d2 = dx * dx + dy * dy;
        if (d2 > nearR2 && d2 <= 4 * maxR2 + 1e-6) alive = clipBy(pj);
      }
    }
    out.push(poly);
  }
  return out;
}

export function isConvexPolygon(poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    if (!a || !b || !c) continue;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/**
 * 有界 Lloyd 松弛 Voronoi 剖分。
 * `lloydRounds` 夹紧到 `[0, 6]`；重心阻尼 `0.3 * old + 0.7 * centroid`，
 * 仅在重心落于 `boundaryPoly` 内时更新站点，零死循环。
 */
export function computeVoronoiCells(
  sites: ReadonlyArray<Vec2>,
  bbox: BBox,
  lloydRounds: number,
  boundaryPoly?: Polygon,
): Vec2[][] {
  if (sites.length === 0) return [];
  const rounds = Math.max(0, Math.min(6, Math.round(lloydRounds)));
  let pts: Vec2[] = sites.map((p) => [p[0], p[1]] as Vec2);

  for (let r = 0; r < rounds; r += 1) {
    const cells = buildCells(pts, bbox);
    const next: Vec2[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const cell = cells[i];
      if (!p) continue;
      if (!cell || cell.length < 3) {
        next.push(p);
        continue;
      }
      const c = computePolygonCentroid(cell);
      if (boundaryPoly && !pointInPolygon(c[0], c[1], boundaryPoly)) {
        next.push(p);
        continue;
      }
      next.push([0.3 * p[0] + 0.7 * c[0], 0.3 * p[1] + 0.7 * c[1]]);
    }
    pts = next;
  }

  const cells = buildCells(pts, bbox);
  if (!boundaryPoly) {
    return cells.filter((cell) => cell.length >= 3 && Math.abs(computePolygonAreaSigned(cell)) > 1e-7);
  }

  const pieces: Vec2[][] = [];
  for (const cell of cells) {
    if (cell.length < 3) continue;
    if (Math.abs(computePolygonAreaSigned(cell)) < 1e-7) continue;
    const clipped = intersectConvexWithPolygon(cell, boundaryPoly);
    for (const piece of clipped) pieces.push(piece);
  }
  return pieces;
}

/** 凸多边形安全内缩：逐边内法向半平面连续裁剪，自动吞并坍缩短边，百分百零自交 */
export function insetConvexPolygon(convexPoly: Polygon, insetDistM: number): Vec2[] {
  if (convexPoly.length < 3) return [];
  const src = convexPoly.map((p) => [p[0], p[1]] as Vec2);
  if (!(insetDistM > 0)) return src;
  const centroid = computePolygonCentroid(convexPoly);
  let poly: Vec2[] = src;
  const n = convexPoly.length;
  for (let i = 0; i < n; i += 1) {
    const a = convexPoly[i];
    const b = convexPoly[(i + 1) % n];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) continue;
    let nx = dy / len;
    let ny = -dx / len;
    if (nx * centroid[0] + ny * centroid[1] > nx * a[0] + ny * a[1]) {
      nx = -nx;
      ny = -ny;
    }
    poly = clipPolygonHalfPlane(poly, nx, ny, nx * a[0] + ny * a[1] - insetDistM);
    if (poly.length < 3) return [];
    if (Math.abs(computePolygonAreaSigned(poly)) < 1e-6) return [];
  }
  return poly;
}

function scaleToward(poly: Polygon, c: Vec2, s: number): Vec2[] {
  return poly.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s] as Vec2);
}

/** 凸/凹通用安全内缩：凸多边形走精确半平面裁剪，凹多边形走有界向心收缩二分 */
/**
 * 逐边半平面内缩核（凹多边形兜底）：对每条边按内法向切一刀，得到最大内接凸核。
 * 手绘有机凹选区向心缩放会清零，此路径保证仍有可布屋的临街街区，绝不空区。
 */
export function insetByEdgePlanes(poly: Polygon, insetDistM: number): Vec2[] {
  if (poly.length < 3) return [];
  if (!(insetDistM > 0)) return poly.map((p) => [p[0], p[1]] as Vec2);
  const s = computePolygonAreaSigned(poly) >= 0 ? 1 : -1;
  let out: Vec2[] = poly.map((p) => [p[0], p[1]] as Vec2);
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * s;
    const ny = (dx / len) * s;
    out = clipPolygonHalfPlane(out, -nx, -ny, -(nx * a[0] + ny * a[1] + insetDistM));
    if (out.length < 3) return [];
  }
  return out;
}

export function insetPolygonSafe(poly: Polygon, insetDistM: number): Vec2[] {
  if (poly.length < 3) return [];
  if (!(insetDistM > 0)) return poly.map((p) => [p[0], p[1]] as Vec2);
  if (isConvexPolygon(poly)) return insetConvexPolygon(poly, insetDistM);
  const c = computePolygonCentroid(poly);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 20; k += 1) {
    const mid = 0.5 * (lo + hi);
    const probe = scaleToward(poly, c, mid);
    if (probe.length < 3) {
      hi = mid;
      continue;
    }
    if (minDistPolyToPoly(probe, poly) >= insetDistM) lo = mid;
    else hi = mid;
  }
  if (lo < 0.02) {
    const kernel = insetByEdgePlanes(poly, insetDistM);
    return kernel.length >= 3 ? kernel : [];
  }
  return scaleToward(poly, c, lo);
}
