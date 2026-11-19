/**
 * Terrax Settlement Studio — M3 九类抽卡选区与双重硬碰撞零穿模引擎
 * 文件：web/js/gacha_zone_engine.js
 *
 * 实现内容：
 *   1. 鞋带面积、公顷换算、面积加权重心、点在多边形内、线段相交与线段最小距离算子；
 *   2. Sutherland-Hodgman 单半平面裁剪、有界 2 轮 Lloyd 松弛 Voronoi 剖分、防蝴蝶结半平面街坊内缩；
 *   3. 第一阶段 512×512 障碍掩码栅格化 + 双遍 Chamfer（1.0 / 1.4142135）有向距离场；
 *   4. 第二阶段全顶点 / 边中点 / 全边段精确解析距离复检 isPolygonSafe（含 82% 收缩挽救）；
 *   5. 9 类 content type 完整几何编译：walled_city / town_blocks / village / citadel /
 *      market / farmland / saltpan / woodland / exclusion（无任何单栋房屋 CRUD）；
 *   6. 全场景联动编译、独立审计 verifyZeroCollisions、单选区 <80ms 重抽 rerollZoneSeed。
 *
 * 无头铁律：本模块零 DOM 依赖，可在纯 Node.js 环境直接 import。
 */

import {
  createRng,
  hashSeed,
  GRID_N,
  OBSTACLE_GRID_N,
  ZONE_CONTENT_TYPES,
  syncLegendWithProject
} from './state_and_schema.js';
import {
  sampleElevation,
  sampleSlopeDeg,
  buildElevationField,
  buildTerrainPackage
} from './terrain_engine.js';
import {
  sampleCatmullRom,
  closestPointOnSegment,
  buildHydroRoadPackage
} from './hydro_road_engine.js';

const GRID_POINT_COUNT = GRID_N * GRID_N;

/* ------------------------------------------------------------------------------------------------
 * 一、通用数值与多边形基础算子
 * ---------------------------------------------------------------------------------------------- */

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

export function computePolygonAreaSigned(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area2 = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return area2 * 0.5;
}

export function computePolygonAreaHa(points) {
  return Math.abs(computePolygonAreaSigned(points)) / 10000;
}

export function computePolygonCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return [0, 0];
  if (points.length < 3) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < points.length; i += 1) {
      sx += points[i][0];
      sy += points[i][1];
    }
    return [sx / points.length, sy / points.length];
  }
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a[0] * b[1] - b[0] * a[1];
    area2 += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i += 1) {
      sx += points[i][0];
      sy += points[i][1];
    }
    return [sx / n, sy / n];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

export function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = ((yi > py) === (yj > py) ? false : true) &&
      (px < ((xj - xi) * (py - yi)) / ((yj - yi) + 1e-12) + xi);
    if (intersect) {
      inside = inside ? false : true;
    }
  }
  return inside;
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const onSeg = (ox, oy, px, py, qx, qy) =>
    Math.min(ox, px) - 1e-9 <= qx && qx <= Math.max(ox, px) + 1e-9 &&
    Math.min(oy, py) - 1e-9 <= qy && qy <= Math.max(oy, py) + 1e-9;

  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (Math.abs(d1) <= 1e-9 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d2) <= 1e-9 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  if (Math.abs(d3) <= 1e-9 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d4) <= 1e-9 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export function segmentToSegmentDist(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0.0;
  return Math.min(
    pointToSegmentDist(ax, ay, cx, cy, dx, dy),
    pointToSegmentDist(bx, by, cx, cy, dx, dy),
    pointToSegmentDist(cx, cy, ax, ay, bx, by),
    pointToSegmentDist(dx, dy, ax, ay, bx, by)
  );
}

export function clipPolygonHalfPlane(polygon, nx, ny, offsetC) {
  if (Array.isArray(polygon) === false || polygon.length < 3) return [];
  const out = [];
  const count = polygon.length;
  for (let i = 0; i < count; i += 1) {
    const curr = polygon[i];
    const prev = polygon[(i + count - 1) % count];
    const dCurr = nx * curr[0] + ny * curr[1] - offsetC;
    const dPrev = nx * prev[0] + ny * prev[1] - offsetC;
    const currInside = dCurr <= 1e-7;
    const prevInside = dPrev <= 1e-7;

    if ((currInside === prevInside) === false) {
      const denom = dPrev - dCurr;
      const t = Math.abs(denom) < 1e-12 ? 0.5 : dPrev / denom;
      out.push([
        prev[0] + (curr[0] - prev[0]) * t,
        prev[1] + (curr[1] - prev[1]) * t
      ]);
    }
    if (currInside) {
      out.push([curr[0], curr[1]]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * 二、凸性判定、三角剖分与凸多边形 × 任意多边形求交
 * ---------------------------------------------------------------------------------------------- */

function isConvexPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function ensureCCW(poly) {
  const out = poly.map((p) => [p[0], p[1]]);
  if (computePolygonAreaSigned(out) < 0) out.reverse();
  return out;
}

/** 清除裁剪产生的重合顶点与闭合重复点，保证折线零退化边。 */
function cleanPolygon(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (out.length > 0) {
      const q = out[out.length - 1];
      if (Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7) continue;
    }
    out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) {
      out.pop();
    } else {
      break;
    }
  }
  return out;
}

function pointInTriangle(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const hasNeg = (d1 < -1e-9) || (d2 < -1e-9) || (d3 < -1e-9);
  const hasPos = (d1 > 1e-9) || (d2 > 1e-9) || (d3 > 1e-9);
  return !(hasNeg && hasPos);
}

/** 有界耳切三角剖分：任何简单多边形均可在 O(n²) 内完成，绝不进入无界递归。 */
function triangulatePolygon(poly) {
  const tris = [];
  if (!Array.isArray(poly) || poly.length < 3) return tris;
  const p = ensureCCW(poly);
  const n = p.length;
  if (n === 3) {
    tris.push(p);
    return tris;
  }
  const idx = [];
  for (let i = 0; i < n; i += 1) idx.push(i);
  let guard = 0;
  const guardMax = n * n + 16;
  while (idx.length > 3 && guard < guardMax) {
    guard += 1;
    let clipped = false;
    const m = idx.length;
    for (let i = 0; i < m; i += 1) {
      const i0 = idx[(i - 1 + m) % m];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % m];
      const a = p[i0];
      const b = p[i1];
      const c = p[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) continue;
      let contains = false;
      for (let k = 0; k < m; k += 1) {
        const id = idx[k];
        if (id === i0 || id === i1 || id === i2) continue;
        if (pointInTriangle(p[id][0], p[id][1], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    tris.push([p[idx[0]], p[idx[1]], p[idx[2]]]);
  } else if (idx.length > 3) {
    for (let i = 1; i + 1 < idx.length; i += 1) {
      tris.push([p[idx[0]], p[idx[i]], p[idx[i + 1]]]);
    }
  }
  return tris;
}

function clipConvexByConvex(subject, clipPoly) {
  let work = subject.map((p) => [p[0], p[1]]);
  const clip = ensureCCW(clipPoly);
  const n = clip.length;
  for (let i = 0; i < n; i += 1) {
    if (work.length < 3) return [];
    const a = clip[i];
    const b = clip[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const nx = ey / len;
    const ny = -ex / len;
    const c = nx * a[0] + ny * a[1];
    work = clipPolygonHalfPlane(work, nx, ny, c);
  }
  const cleaned = cleanPolygon(work);
  return cleaned.length >= 3 ? cleaned : [];
}

/** 凸多边形 ∩ 任意简单多边形：先耳切三角化，再逐三角形裁剪，结果恒为凸片。 */
function intersectConvexWithPolygon(convexPoly, boundaryPoly) {
  if (!Array.isArray(convexPoly) || convexPoly.length < 3) return [];
  if (!Array.isArray(boundaryPoly) || boundaryPoly.length < 3) {
    return [convexPoly.map((p) => [p[0], p[1]])];
  }
  if (isConvexPolygon(boundaryPoly)) {
    const piece = clipConvexByConvex(convexPoly, boundaryPoly);
    return piece.length >= 3 ? [piece] : [];
  }
  const tris = triangulatePolygon(boundaryPoly);
  const pieces = [];
  for (let i = 0; i < tris.length; i += 1) {
    const piece = clipConvexByConvex(convexPoly, tris[i]);
    if (piece.length >= 3 && Math.abs(computePolygonAreaSigned(piece)) > 0.5) {
      pieces.push(piece);
    }
  }
  return pieces;
}

/* ------------------------------------------------------------------------------------------------
 * 三、有界 Voronoi 街坊剖分与 2 轮 Lloyd 松弛
 * ---------------------------------------------------------------------------------------------- */

function buildCellsForSites(sites, bboxPoly) {
  const cells = new Array(sites.length);
  for (let i = 0; i < sites.length; i += 1) {
    let cell = bboxPoly.map((p) => [p[0], p[1]]);
    const siX = sites[i][0];
    const siY = sites[i][1];
    for (let j = 0; j < sites.length; j += 1) {
      if (j === i) continue;
      const dx = sites[j][0] - siX;
      const dy = sites[j][1] - siY;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
      const mx = 0.5 * (siX + sites[j][0]);
      const my = 0.5 * (siY + sites[j][1]);
      const offsetC = dx * mx + dy * my;
      cell = clipPolygonHalfPlane(cell, dx, dy, offsetC);
      if (cell.length < 3) break;
    }
    cells[i] = cell;
  }
  return cells;
}

export function computeVoronoiCells(sites, bbox, lloydRounds, boundaryPoly) {
  const siteList = [];
  if (Array.isArray(sites)) {
    for (let i = 0; i < sites.length; i += 1) {
      const s = sites[i];
      if (Array.isArray(s) && s.length >= 2 && Number.isFinite(s[0]) && Number.isFinite(s[1])) {
        siteList.push([s[0], s[1]]);
      }
    }
  }
  if (siteList.length === 0) return [];

  let box;
  if (Array.isArray(bbox) && bbox.length === 4 &&
    Number.isFinite(bbox[0]) && Number.isFinite(bbox[1]) &&
    Number.isFinite(bbox[2]) && Number.isFinite(bbox[3])) {
    box = [bbox[0], bbox[1], bbox[2], bbox[3]];
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < siteList.length; i += 1) {
      minX = Math.min(minX, siteList[i][0]);
      minY = Math.min(minY, siteList[i][1]);
      maxX = Math.max(maxX, siteList[i][0]);
      maxY = Math.max(maxY, siteList[i][1]);
    }
    box = [minX - 16, minY - 16, maxX + 16, maxY + 16];
  }

  const rounds = Math.max(0, Math.min(6, Math.round(toNum(lloydRounds, 2))));
  const bboxPoly = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]]
  ];
  const working = siteList.map((s) => [s[0], s[1]]);
  let cells = [];

  for (let round = 0; round <= rounds; round += 1) {
    cells = buildCellsForSites(working, bboxPoly);
    if (round === rounds) break;
    for (let i = 0; i < working.length; i += 1) {
      const cell = cells[i];
      if (!cell || cell.length < 3) continue;
      const cent = computePolygonCentroid(cell);
      if (Array.isArray(boundaryPoly) && boundaryPoly.length >= 3) {
        if (pointInPolygon(cent[0], cent[1], boundaryPoly) === false) continue;
      }
      working[i] = [
        0.3 * working[i][0] + 0.7 * cent[0],
        0.3 * working[i][1] + 0.7 * cent[1]
      ];
    }
  }

  const out = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cleanPolygon(cells[i] || []);
    if (!cell || cell.length < 3) continue;
    if (!Array.isArray(boundaryPoly) || boundaryPoly.length < 3) {
      if (Math.abs(computePolygonAreaSigned(cell)) > 4) out.push(cell);
      continue;
    }
    const pieces = intersectConvexWithPolygon(cell, boundaryPoly);
    for (let k = 0; k < pieces.length; k += 1) {
      const piece = cleanPolygon(pieces[k]);
      if (piece.length >= 3 && Math.abs(computePolygonAreaSigned(piece)) > 4) {
        out.push(piece);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * 四、防蝴蝶结半平面街坊内缩
 * ---------------------------------------------------------------------------------------------- */

export function insetConvexPolygon(convexPoly, insetDistM) {
  if (!Array.isArray(convexPoly) || convexPoly.length < 3) return [];
  const dist = Math.max(0, toNum(insetDistM, 0));
  if (dist <= 1e-9) return convexPoly.map((p) => [p[0], p[1]]);
  const centroid = computePolygonCentroid(convexPoly);
  const src = convexPoly;
  let work = convexPoly.map((p) => [p[0], p[1]]);
  const n = src.length;
  for (let i = 0; i < n; i += 1) {
    const a = src[i];
    const b = src[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-4) continue;
    let inx = -ey / len;
    let iny = ex / len;
    if ((centroid[0] - a[0]) * inx + (centroid[1] - a[1]) * iny < 0) {
      inx = -inx;
      iny = -iny;
    }
    const nx = -inx;
    const ny = -iny;
    const px = a[0] + dist * inx;
    const py = a[1] + dist * iny;
    const offsetC = nx * px + ny * py;
    work = clipPolygonHalfPlane(work, nx, ny, offsetC);
    if (work.length < 3) return [];
  }
  const cleaned = cleanPolygon(work);
  return cleaned.length >= 3 ? cleaned : [];
}

/* ------------------------------------------------------------------------------------------------
 * 五、多边形包围盒、线段表缓存与空间哈希
 * ---------------------------------------------------------------------------------------------- */

const shapeInfoCache = new WeakMap();

function getShapeInfo(poly) {
  if (!Array.isArray(poly) || poly.length < 2) {
    return { bbox: [0, 0, 0, 0], segs: new Float64Array(0), closed: false, len: 0 };
  }
  let info = shapeInfoCache.get(poly);
  if (info && info.len === poly.length) return info;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const segCount = poly.length - 1;
  const segs = new Float64Array(Math.max(0, segCount) * 4);
  for (let i = 0; i < segCount; i += 1) {
    segs[i * 4] = poly[i][0];
    segs[i * 4 + 1] = poly[i][1];
    segs[i * 4 + 2] = poly[i + 1][0];
    segs[i * 4 + 3] = poly[i + 1][1];
  }
  info = { bbox: [minX, minY, maxX, maxY], segs, closed: false, len: poly.length };
  shapeInfoCache.set(poly, info);
  return info;
}

function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
  const dy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
  return Math.hypot(dx, dy);
}

function polygonBBox(poly) {
  return getShapeInfo(poly).bbox;
}

function minDistPolyToPoly(candPoly, otherPoly, requiredDist) {
  if (!Array.isArray(otherPoly) || otherPoly.length < 2) return Infinity;
  const ci = getShapeInfo(candPoly);
  const oi = getShapeInfo(otherPoly);
  if (bboxGap(ci.bbox, oi.bbox) >= requiredDist) return Infinity;
  let minD = Infinity;
  const cN = candPoly.length;
  const oN = otherPoly.length;
  const oClosed = otherPoly.length >= 3;
  const oSegCount = oClosed ? oN : oN - 1;
  for (let i = 0; i < cN; i += 1) {
    const a = candPoly[i];
    const b = candPoly[(i + 1) % cN];
    for (let j = 0; j < oSegCount; j += 1) {
      const c = otherPoly[j];
      const d = otherPoly[(j + 1) % oN];
      const dist = segmentToSegmentDist(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      if (dist < minD) minD = dist;
      if (minD === 0) return 0;
    }
  }
  return minD;
}

function minDistPolyToPolyline(candPoly, polyline, requiredDist) {
  if (!Array.isArray(polyline) || polyline.length < 2) return Infinity;
  const ci = getShapeInfo(candPoly);
  const oi = getShapeInfo(polyline);
  if (bboxGap(ci.bbox, oi.bbox) >= requiredDist) return Infinity;
  let minD = Infinity;
  const cN = candPoly.length;
  const pN = polyline.length;
  for (let i = 0; i < cN; i += 1) {
    const a = candPoly[i];
    const b = candPoly[(i + 1) % cN];
    for (let j = 0; j + 1 < pN; j += 1) {
      const c = polyline[j];
      const d = polyline[j + 1];
      const dist = segmentToSegmentDist(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      if (dist < minD) minD = dist;
      if (minD === 0) return 0;
    }
  }
  return minD;
}

class SpatialHash {
  constructor(worldSizeM, cellSizeM) {
    this.cellSize = Math.max(8, toNum(cellSizeM, 32));
    this.cells = new Map();
    this.worldSizeM = toNum(worldSizeM, 2400);
  }

  keyOf(cx, cy) {
    return `${cx}_${cy}`;
  }

  insert(poly, payload) {
    const bbox = polygonBBox(poly);
    const cs = this.cellSize;
    const cx0 = Math.floor(bbox[0] / cs);
    const cy0 = Math.floor(bbox[1] / cs);
    const cx1 = Math.floor(bbox[2] / cs);
    const cy1 = Math.floor(bbox[3] / cs);
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = this.keyOf(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(payload);
      }
    }
  }

  queryPolygonBBox(poly, pad) {
    const bbox = polygonBBox(poly);
    const cs = this.cellSize;
    const p = Math.max(0, toNum(pad, 0));
    const cx0 = Math.floor((bbox[0] - p) / cs);
    const cy0 = Math.floor((bbox[1] - p) / cs);
    const cx1 = Math.floor((bbox[2] + p) / cs);
    const cy1 = Math.floor((bbox[3] + p) / cs);
    const seen = new Set();
    const out = [];
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const bucket = this.cells.get(this.keyOf(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const item = bucket[i];
          if (seen.has(item)) continue;
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }
}

function polygonsOverlapOrTooClose(polyA, polyB, minGap) {
  if (bboxGap(polygonBBox(polyA), polygonBBox(polyB)) >= minGap) return false;
  if (pointInPolygon(polyA[0][0], polyA[0][1], polyB)) return true;
  if (pointInPolygon(polyB[0][0], polyB[0][1], polyA)) return true;
  return minDistPolyToPoly(polyA, polyB, minGap) < minGap;
}

/* ------------------------------------------------------------------------------------------------
 * 六、第一阶段：512×512 障碍掩码与双遍 Chamfer 距离场
 * ---------------------------------------------------------------------------------------------- */

function buildSlopeGrid(terrainData) {
  const H = terrainData.elevation;
  const n = terrainData.gridN || GRID_N;
  const cell = terrainData.cellSizeM || 1;
  const slope = new Float32Array(n * n);
  for (let gy = 0; gy < n; gy += 1) {
    const rowBase = gy * n;
    const yPrev = gy > 0 ? gy - 1 : gy;
    const yNext = gy < n - 1 ? gy + 1 : gy;
    for (let gx = 0; gx < n; gx += 1) {
      const xPrev = gx > 0 ? gx - 1 : gx;
      const xNext = gx < n - 1 ? gx + 1 : gx;
      const dzdx = (H[rowBase + xNext] - H[rowBase + xPrev]) /
        (Math.max(1, xNext - xPrev) * cell);
      const dzdy = (H[yNext * n + gx] - H[yPrev * n + gx]) /
        (Math.max(1, yNext - yPrev) * cell);
      slope[rowBase + gx] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  return slope;
}

function rasterizeSegmentEnvelope(mask, N, stepM, worldSizeM, ax, ay, bx, by, radiusM) {
  const r = Math.max(0.2, radiusM);
  const minX = Math.max(0, Math.floor((Math.min(ax, bx) - r) / stepM));
  const maxX = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + r) / stepM));
  const minY = Math.max(0, Math.floor((Math.min(ay, by) - r) / stepM));
  const maxY = Math.min(N - 1, Math.ceil((Math.max(ay, by) + r) / stepM));
  if (maxX < minX || maxY < minY) return;
  for (let gy = minY; gy <= maxY; gy += 1) {
    const wy = gy * stepM;
    const rowBase = gy * N;
    for (let gx = minX; gx <= maxX; gx += 1) {
      const wx = gx * stepM;
      if (pointToSegmentDist(wx, wy, ax, ay, bx, by) <= r) {
        mask[rowBase + gx] = 1;
      }
    }
  }
}

function rasterizePolygonInterior(mask, N, stepM, poly) {
  const bbox = polygonBBox(poly);
  const minX = Math.max(0, Math.floor(bbox[0] / stepM));
  const maxX = Math.min(N - 1, Math.ceil(bbox[2] / stepM));
  const minY = Math.max(0, Math.floor(bbox[1] / stepM));
  const maxY = Math.min(N - 1, Math.ceil(bbox[3] / stepM));
  for (let gy = minY; gy <= maxY; gy += 1) {
    const wy = gy * stepM;
    const rowBase = gy * N;
    for (let gx = minX; gx <= maxX; gx += 1) {
      const wx = gx * stepM;
      if (pointInPolygon(wx, wy, poly)) {
        mask[rowBase + gx] = 1;
      }
    }
  }
}

export function buildObstacleGrid(project, terrainData, hydroRoadData, wallsBuilt) {
  const p = (project && typeof project === 'object') ? project : {};
  const worldSizeM = clampNum(toNum(p.meta && p.meta.worldSizeM, 2400), 600, 8000);
  const N = OBSTACLE_GRID_N;
  const stepM = worldSizeM / (N - 1);
  const blocked = new Uint8Array(N * N);
  const dist = new Float32Array(N * N);
  const slopeGrid = terrainData ? buildSlopeGrid(terrainData) : null;
  const terrainN = terrainData ? (terrainData.gridN || GRID_N) : GRID_N;

  let globalMaxSlope = 30;
  const zones = Array.isArray(p.zones) ? p.zones : [];
  for (let i = 0; i < zones.length; i += 1) {
    globalMaxSlope = Math.max(globalMaxSlope, toNum(zones[i].maxSlopeDeg, 24) + 6);
  }
  globalMaxSlope = clampNum(globalMaxSlope, 10, 72);

  const slopeAt = new Float32Array(N * N);
  if (slopeGrid) {
    const terrainCell = worldSizeM / (terrainN - 1);
    const tgxArr = new Int32Array(N);
    for (let gx = 0; gx < N; gx += 1) {
      tgxArr[gx] = clampNum(Math.round((gx * stepM) / terrainCell), 0, terrainN - 1);
    }
    for (let gy = 0; gy < N; gy += 1) {
      const tgy = clampNum(Math.round((gy * stepM) / terrainCell), 0, terrainN - 1);
      const rowBase = gy * N;
      const tRow = tgy * terrainN;
      for (let gx = 0; gx < N; gx += 1) {
        const s = slopeGrid[tRow + tgxArr[gx]];
        slopeAt[rowBase + gx] = s;
        if (s > globalMaxSlope) blocked[rowBase + gx] = 1;
      }
    }
  }

  const hydro = (hydroRoadData && typeof hydroRoadData === 'object') ? hydroRoadData : {};
  const rivers = Array.isArray(hydro.rivers) ? hydro.rivers : [];
  const waterBodies = Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [];
  const canals = Array.isArray(hydro.canals) ? hydro.canals : [];
  const roads = Array.isArray(hydro.roads) ? hydro.roads : [];

  for (let r = 0; r < rivers.length; r += 1) {
    const river = rivers[r];
    const cl = river.centerline;
    if (!Array.isArray(cl) || cl.length < 2) continue;
    // halfWidths 本身已是半宽，此处严禁再乘 0.5
    for (let i = 0; i + 1 < cl.length; i += 1) {
      const halfW = Math.max(river.halfWidths[i], river.halfWidths[i + 1]);
      rasterizeSegmentEnvelope(
        blocked, N, stepM, worldSizeM,
        cl[i][0], cl[i][1], cl[i + 1][0], cl[i + 1][1],
        halfW + 8.0
      );
    }
    // 河面内部必须整片填实，避免宽河中心出现可建/可植树的空洞
    if (Array.isArray(river.bankPolygon) && river.bankPolygon.length >= 3) {
      rasterizePolygonInterior(blocked, N, stepM, river.bankPolygon);
    }
  }

  for (let w = 0; w < waterBodies.length; w += 1) {
    const wb = waterBodies[w];
    if (!Array.isArray(wb.shorePoly) || wb.shorePoly.length < 3) continue;
    rasterizePolygonInterior(blocked, N, stepM, wb.shorePoly);
    const shore = wb.shorePoly;
    for (let i = 0; i < shore.length; i += 1) {
      const a = shore[i];
      const b = shore[(i + 1) % shore.length];
      rasterizeSegmentEnvelope(blocked, N, stepM, worldSizeM, a[0], a[1], b[0], b[1], 8.0);
    }
  }

  const wallList = Array.isArray(wallsBuilt) ? wallsBuilt : [];
  for (let w = 0; w < wallList.length; w += 1) {
    const wall = wallList[w];
    const line = wall && wall.polyline;
    if (!Array.isArray(line) || line.length < 2) continue;
    const halfThickness = 0.5 * toNum(wall.thicknessM, 5) + 1.2;
    for (let i = 0; i + 1 < line.length; i += 1) {
      rasterizeSegmentEnvelope(
        blocked, N, stepM, worldSizeM,
        line[i][0], line[i][1], line[i + 1][0], line[i + 1][1],
        halfThickness
      );
    }
  }

  for (let c = 0; c < canals.length; c += 1) {
    const canal = canals[c];
    const cl = canal.centerline;
    if (!Array.isArray(cl) || cl.length < 2) continue;
    const req = 0.5 * canal.widthM + 4.0;
    for (let i = 0; i + 1 < cl.length; i += 1) {
      rasterizeSegmentEnvelope(blocked, N, stepM, worldSizeM, cl[i][0], cl[i][1], cl[i + 1][0], cl[i + 1][1], req);
    }
  }

  for (let rd = 0; rd < roads.length; rd += 1) {
    const road = roads[rd];
    const cl = road.centerline;
    if (!Array.isArray(cl) || cl.length < 2) continue;
    const req = 0.5 * road.widthM + 2.5;
    for (let i = 0; i + 1 < cl.length; i += 1) {
      rasterizeSegmentEnvelope(blocked, N, stepM, worldSizeM, cl[i][0], cl[i][1], cl[i + 1][0], cl[i + 1][1], req);
    }
  }

  for (let z = 0; z < zones.length; z += 1) {
    const zone = zones[z];
    if (!zone || zone.contentType !== 'exclusion') continue;
    if (!Array.isArray(zone.points) || zone.points.length < 3) continue;
    rasterizePolygonInterior(blocked, N, stepM, zone.points);
    const pts = zone.points;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      rasterizeSegmentEnvelope(blocked, N, stepM, worldSizeM, a[0], a[1], b[0], b[1], 2.0);
    }
  }

  const INF = 1e6;
  for (let i = 0; i < dist.length; i += 1) {
    dist[i] = blocked[i] === 1 ? 0 : INF;
  }
  const DIAG = 1.4142135;

  for (let gy = 0; gy < N; gy += 1) {
    const rowBase = gy * N;
    for (let gx = 0; gx < N; gx += 1) {
      const idx = rowBase + gx;
      let best = dist[idx];
      if (gx > 0) {
        const v = dist[idx - 1] + 1;
        if (v < best) best = v;
      }
      if (gy > 0) {
        const up = idx - N;
        const v1 = dist[up] + 1;
        if (v1 < best) best = v1;
        if (gx > 0) {
          const v2 = dist[up - 1] + DIAG;
          if (v2 < best) best = v2;
        }
        if (gx < N - 1) {
          const v3 = dist[up + 1] + DIAG;
          if (v3 < best) best = v3;
        }
      }
      dist[idx] = best;
    }
  }

  for (let gy = N - 1; gy >= 0; gy -= 1) {
    const rowBase = gy * N;
    for (let gx = N - 1; gx >= 0; gx -= 1) {
      const idx = rowBase + gx;
      let best = dist[idx];
      if (gx < N - 1) {
        const v = dist[idx + 1] + 1;
        if (v < best) best = v;
      }
      if (gy < N - 1) {
        const down = idx + N;
        const v1 = dist[down] + 1;
        if (v1 < best) best = v1;
        if (gx < N - 1) {
          const v2 = dist[down + 1] + DIAG;
          if (v2 < best) best = v2;
        }
        if (gx > 0) {
          const v3 = dist[down - 1] + DIAG;
          if (v3 < best) best = v3;
        }
      }
      dist[idx] = best;
    }
  }

  for (let i = 0; i < dist.length; i += 1) {
    dist[i] = dist[i] * stepM;
  }

  return {
    gridN: N,
    worldSizeM,
    stepM,
    blockedMask: blocked,
    distanceField: dist,
    slopeAt,
    globalMaxSlope
  };
}

export function sampleObstacleClearance(obstacleGrid, worldSizeM, wx, wy) {
  if (!obstacleGrid || !obstacleGrid.distanceField) return Infinity;
  const N = obstacleGrid.gridN || OBSTACLE_GRID_N;
  const ws = toNum(worldSizeM, obstacleGrid.worldSizeM || 2400);
  const stepM = obstacleGrid.stepM || (ws / (N - 1));
  const field = obstacleGrid.distanceField;
  let fx = toNum(wx, 0) / stepM;
  let fy = toNum(wy, 0) / stepM;
  fx = clampNum(fx, 0, N - 1);
  fy = clampNum(fy, 0, N - 1);
  const gx0 = Math.floor(fx);
  const gy0 = Math.floor(fy);
  const gx1 = gx0 + 1 <= N - 1 ? gx0 + 1 : N - 1;
  const gy1 = gy0 + 1 <= N - 1 ? gy0 + 1 : N - 1;
  const tx = fx - gx0;
  const ty = fy - gy0;
  const r0 = gy0 * N;
  const r1 = gy1 * N;
  const v00 = field[r0 + gx0];
  const v10 = field[r0 + gx1];
  const v01 = field[r1 + gx0];
  const v11 = field[r1 + gx1];
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/* ------------------------------------------------------------------------------------------------
 * 七、第二阶段：精确解析几何复核
 * ---------------------------------------------------------------------------------------------- */

export function isPolygonSafe(candidatePoly, obstacleCtx, extraMarginM = 0) {
  if (Array.isArray(candidatePoly) === false || candidatePoly.length < 3) {
    return false;
  }
  const ctx = obstacleCtx || {};
  const worldSizeM = toNum(ctx.worldSizeM, 2400);
  const maxSlopeDeg = toNum(ctx.maxSlopeDeg, 24);
  const extra = toNum(extraMarginM, 0);
  const terrainData = ctx.terrainData || null;

  const centroid = computePolygonCentroid(candidatePoly);
  const candBox = polygonBBox(candidatePoly);
  const testPoints = [...candidatePoly, centroid];
  for (let i = 0; i < candidatePoly.length; i += 1) {
    const a = candidatePoly[i];
    const b = candidatePoly[(i + 1) % candidatePoly.length];
    testPoints.push([0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
  }

  const worldPad = 6.0;
  for (let i = 0; i < testPoints.length; i += 1) {
    const px = testPoints[i][0];
    const py = testPoints[i][1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    if (px < worldPad || py < worldPad || px > worldSizeM - worldPad || py > worldSizeM - worldPad) {
      return false;
    }
    if (terrainData && sampleSlopeDeg(terrainData, px, py) > maxSlopeDeg) {
      return false;
    }
  }

  if (ctx.grid) {
    const clearance = sampleObstacleClearance(ctx.grid, worldSizeM, centroid[0], centroid[1]);
    if (clearance <= 0.02) return false;
  }

  const riversBuilt = Array.isArray(ctx.riversBuilt) ? ctx.riversBuilt : [];
  for (let i = 0; i < riversBuilt.length; i += 1) {
    const riv = riversBuilt[i];
    if (!riv || !Array.isArray(riv.bankPolygon) || riv.bankPolygon.length < 3) continue;
    const req = 8.0 + extra;
    if (bboxGap(candBox, polygonBBox(riv.bankPolygon)) >= req) continue;
    for (let k = 0; k < testPoints.length; k += 1) {
      if (pointInPolygon(testPoints[k][0], testPoints[k][1], riv.bankPolygon)) return false;
    }
    if (minDistPolyToPoly(candidatePoly, riv.bankPolygon, req) < req) return false;
  }

  const waterBodiesBuilt = Array.isArray(ctx.waterBodiesBuilt) ? ctx.waterBodiesBuilt : [];
  for (let i = 0; i < waterBodiesBuilt.length; i += 1) {
    const wb = waterBodiesBuilt[i];
    if (!wb || !Array.isArray(wb.shorePoly) || wb.shorePoly.length < 3) continue;
    const req = 8.0 + extra;
    if (bboxGap(candBox, polygonBBox(wb.shorePoly)) >= req) continue;
    for (let k = 0; k < testPoints.length; k += 1) {
      if (pointInPolygon(testPoints[k][0], testPoints[k][1], wb.shorePoly)) return false;
    }
    if (minDistPolyToPoly(candidatePoly, wb.shorePoly, req) < req) return false;
  }

  const exclusionPolys = Array.isArray(ctx.exclusionPolys) ? ctx.exclusionPolys : [];
  for (let i = 0; i < exclusionPolys.length; i += 1) {
    const exZone = exclusionPolys[i];
    if (!Array.isArray(exZone) || exZone.length < 3) continue;
    const req = 2.0 + extra;
    if (bboxGap(candBox, polygonBBox(exZone)) >= req) continue;
    for (let k = 0; k < testPoints.length; k += 1) {
      if (pointInPolygon(testPoints[k][0], testPoints[k][1], exZone)) return false;
    }
    if (minDistPolyToPoly(candidatePoly, exZone, req) < req) return false;
  }

  const canalsBuilt = Array.isArray(ctx.canalsBuilt) ? ctx.canalsBuilt : [];
  for (let i = 0; i < canalsBuilt.length; i += 1) {
    const canal = canalsBuilt[i];
    if (!canal || !Array.isArray(canal.centerline)) continue;
    const req = 0.5 * toNum(canal.widthM, 6) + 4.0 + extra;
    if (bboxGap(candBox, polygonBBox(canal.centerline)) >= req) continue;
    if (minDistPolyToPolyline(candidatePoly, canal.centerline, req) < req) return false;
  }

  const roadsBuilt = Array.isArray(ctx.roadsBuilt) ? ctx.roadsBuilt : [];
  for (let i = 0; i < roadsBuilt.length; i += 1) {
    const road = roadsBuilt[i];
    if (!road || !Array.isArray(road.centerline)) continue;
    const req = 0.5 * toNum(road.widthM, 9) + 2.5 + extra;
    if (bboxGap(candBox, polygonBBox(road.centerline)) >= req) continue;
    if (minDistPolyToPolyline(candidatePoly, road.centerline, req) < req) return false;
  }

  const wallsBuilt = Array.isArray(ctx.wallsBuilt) ? ctx.wallsBuilt : [];
  for (let i = 0; i < wallsBuilt.length; i += 1) {
    const wall = wallsBuilt[i];
    if (!wall || !Array.isArray(wall.polyline)) continue;
    const req = 0.5 * toNum(wall.thicknessM, 5) + 3.0 + extra;
    if (bboxGap(candBox, polygonBBox(wall.polyline)) >= req) continue;
    if (minDistPolyToPolyline(candidatePoly, wall.polyline, req) < req) return false;
  }

  if (ctx.spatialHash && typeof ctx.spatialHash.queryPolygonBBox === 'function') {
    const nearby = ctx.spatialHash.queryPolygonBBox(candidatePoly, 4.0);
    for (let i = 0; i < nearby.length; i += 1) {
      const other = nearby[i];
      if (!other || !Array.isArray(other.points)) continue;
      if (polygonsOverlapOrTooClose(candidatePoly, other.points, 0.8 + extra)) return false;
    }
  }

  return true;
}

/* ------------------------------------------------------------------------------------------------
 * 八、障碍上下文
 * ---------------------------------------------------------------------------------------------- */

function createObstacleContext(project, terrainData, hydroRoadData, options) {
  const opts = options || {};
  const p = (project && typeof project === 'object') ? project : {};
  const worldSizeM = clampNum(toNum(p.meta && p.meta.worldSizeM, 2400), 600, 8000);
  const hydro = (hydroRoadData && typeof hydroRoadData === 'object') ? hydroRoadData : {};
  const ctx = {
    worldSizeM,
    terrainData: terrainData || null,
    maxSlopeDeg: 24,
    riversBuilt: Array.isArray(hydro.rivers) ? hydro.rivers : [],
    waterBodiesBuilt: Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [],
    canalsBuilt: Array.isArray(hydro.canals) ? hydro.canals : [],
    roadsBuilt: Array.isArray(hydro.roads) ? hydro.roads : [],
    wallsBuilt: [],
    exclusionPolys: [],
    spatialHash: new SpatialHash(worldSizeM, 32),
    grid: opts.grid || null,
    buildingSeq: 0,
    treeSeq: 0,
    zoneSeq: 0
  };
  const zones = Array.isArray(p.zones) ? p.zones : [];
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    if (zone && zone.contentType === 'exclusion' &&
      Array.isArray(zone.points) && zone.points.length >= 3) {
      ctx.exclusionPolys.push(zone.points.map((pt) => [pt[0], pt[1]]));
    }
  }
  if (opts.withGrid) {
    ctx.grid = buildObstacleGrid(p, terrainData, hydro);
  }
  return ctx;
}

/* ------------------------------------------------------------------------------------------------
 * 九、多边形辅助算子
 * ---------------------------------------------------------------------------------------------- */

function polygonMinEdgeLength(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let minLen = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    minLen = Math.min(minLen, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return Number.isFinite(minLen) ? minLen : 0;
}

function shrinkPolygon(poly, factor) {
  const c = computePolygonCentroid(poly);
  const f = clampNum(toNum(factor, 0.82), 0.2, 1);
  return poly.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
}

function rectPolygon(cx, cy, w, h, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const local = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function densifyRing(points, stepM) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / Math.max(4, stepM)));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function cumulativeOf(points, closed) {
  const cum = new Float64Array(points.length + 1);
  let acc = 0;
  for (let i = 0; i < points.length; i += 1) {
    cum[i] = acc;
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (i === points.length - 1 && closed === false) break;
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  cum[points.length] = acc;
  return { cum, total: Math.max(acc, 1e-9) };
}

function offsetRingInward(poly, dist, centroid) {
  const n = poly.length;
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    let nx = 0;
    let ny = 0;
    if (l1 > 1e-9) {
      nx += e1y / l1;
      ny += -e1x / l1;
    }
    if (l2 > 1e-9) {
      nx += e2y / l2;
      ny += -e2x / l2;
    }
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) {
      nx = curr[0] - centroid[0];
      ny = curr[1] - centroid[1];
      const cl = Math.hypot(nx, ny) || 1;
      nx /= cl;
      ny /= cl;
    } else {
      nx /= nl;
      ny /= nl;
    }
    if ((centroid[0] - curr[0]) * nx + (centroid[1] - curr[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    out[i] = [curr[0] + nx * dist, curr[1] + ny * dist];
  }
  return out;
}

/** 任意简单多边形向内收缩：凸多边形走半平面精确内缩，凹多边形带多重兜底，绝不自交打结。 */
function insetPolygonSafe(poly, dist) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const d = Math.max(0, toNum(dist, 0));
  if (d <= 1e-9) return poly.map((p) => [p[0], p[1]]);
  const area0 = Math.abs(computePolygonAreaSigned(poly));
  if (isConvexPolygon(poly)) {
    const inset = insetConvexPolygon(poly, d);
    if (inset.length >= 3 && Math.abs(computePolygonAreaSigned(inset)) > 1) return inset;
    return [];
  }
  const eroded = insetConvexPolygon(poly, d);
  if (eroded.length >= 3 && Math.abs(computePolygonAreaSigned(eroded)) > area0 * 0.12) {
    return eroded;
  }
  const centroid = computePolygonCentroid(poly);
  const ring = offsetRingInward(poly, d, centroid);
  if (ring.length >= 3) {
    let valid = true;
    for (let i = 0; i < ring.length; i += 1) {
      if (!pointInPolygon(ring[i][0], ring[i][1], poly)) {
        valid = false;
        break;
      }
    }
    if (valid && Math.abs(computePolygonAreaSigned(ring)) > area0 * 0.08) return ring;
  }
  const shrink = Math.max(0.1, 1 - d / 200);
  return poly.map((p) => [centroid[0] + (p[0] - centroid[0]) * shrink, centroid[1] + (p[1] - centroid[1]) * shrink]);
}

function principalAngleOf(poly) {
  let bestLen = -1;
  let bestAngle = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return bestAngle;
}

function clipLineToPolygon(ax, ay, bx, by, poly, stepM) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return [];
  const steps = Math.max(2, Math.ceil(len / Math.max(3, stepM)));
  const runs = [];
  let run = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (pointInPolygon(x, y, poly)) {
      run.push([x, y]);
    } else if (run.length > 0) {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/* ------------------------------------------------------------------------------------------------
 * 十、选区结果骨架与建筑入库
 * ---------------------------------------------------------------------------------------------- */

function makeZoneResult(zone) {
  return {
    id: zone.id,
    name: zone.name,
    contentType: zone.contentType,
    seed: zone.seed,
    points: zone.points.map((p) => [p[0], p[1]]),
    areaHa: computePolygonAreaHa(zone.points),
    buildings: [],
    walls: [],
    towers: [],
    internalStreets: [],
    lanes: [],
    gardenFences: [],
    trees: [],
    farmlandPlots: [],
    saltpanCells: [],
    marketAprons: [],
    marketStalls: [],
    wells: [],
    exclusionPoly: null,
    counts: {}
  };
}

function buildingRidgeLine(poly, areaM2) {
  if (areaM2 <= 120) return null;
  const n = poly.length;
  if (n < 4) return null;
  let bestLen = -1;
  let bestA = null;
  let bestB = null;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      bestA = a;
      bestB = b;
    }
  }
  if (!bestA) return null;
  const cx = (bestA[0] + bestB[0]) * 0.5;
  const cy = (bestA[1] + bestB[1]) * 0.5;
  const angle = Math.atan2(bestB[1] - bestA[1], bestB[0] - bestA[0]);
  const half = bestLen * 0.42;
  return [
    [cx - Math.cos(angle) * half, cy - Math.sin(angle) * half],
    [cx + Math.cos(angle) * half, cy + Math.sin(angle) * half]
  ];
}

function tryAddBuilding(Z, poly, roofKind, kind, label) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  const area = Math.abs(computePolygonAreaSigned(poly));
  if (area < 18) return null;
  for (let i = 0; i < poly.length; i += 1) {
    if (!pointInPolygon(poly[i][0], poly[i][1], Z.zone.points)) return null;
  }
  let usePoly = poly;
  if (!isPolygonSafe(usePoly, Z.ctx, 0)) {
    const shrunk = shrinkPolygon(poly, 0.82);
    if (shrunk.length >= 3 && polygonMinEdgeLength(shrunk) >= 4.8 &&
      isPolygonSafe(shrunk, Z.ctx, 0)) {
      usePoly = shrunk;
    } else {
      return null;
    }
  }
  const areaFinal = Math.abs(computePolygonAreaSigned(usePoly));
  if (areaFinal < 14) return null;
  const centroid = computePolygonCentroid(usePoly);
  Z.ctx.buildingSeq += 1;
  const building = {
    id: `bld_${Z.zone.id}_${Z.ctx.buildingSeq}`,
    zoneId: Z.zone.id,
    zoneName: Z.zone.name,
    contentType: Z.zone.contentType,
    roofKind,
    kind: kind || 'house',
    label: label || '',
    points: usePoly,
    centroid,
    areaM2: areaFinal,
    ridge: buildingRidgeLine(usePoly, areaFinal)
  };
  Z.result.buildings.push(building);
  if (kind === 'stall') Z.result.marketStalls.push(building);
  Z.ctx.spatialHash.insert(usePoly, building);
  return building;
}

function nearPolylineLocal(x, y, poly, requiredDist) {
  if (!Array.isArray(poly) || poly.length < 2) return false;
  const box = polygonBBox(poly);
  const req = toNum(requiredDist, 0);
  if (x < box[0] - req || x > box[2] + req || y < box[1] - req || y > box[3] + req) return false;
  return distanceToPolylineLocal(x, y, poly) < req;
}

function nearPolygonLocal(x, y, poly, requiredDist) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  const box = polygonBBox(poly);
  const req = toNum(requiredDist, 0);
  if (x < box[0] - req || x > box[2] + req || y < box[1] - req || y > box[3] + req) return false;
  return pointInPolygon(x, y, poly) || distanceToPolylineLocal(x, y, poly.concat([poly[0]])) < req;
}

function distanceToPolylineLocal(x, y, poly) {
  if (!Array.isArray(poly) || poly.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const hit = closestPointOnSegment(x, y, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    if (hit.dist < best) best = hit.dist;
  }
  return best;
}

/** 树木落点硬校验：任何宽度的河湖渠路墙内与近旁一律拒绝（零入水、零上路）。 */
function treePlacementBlocked(Z, x, y, radius) {
  const rivers = Array.isArray(Z.ctx.riversBuilt) ? Z.ctx.riversBuilt : [];
  for (let i = 0; i < rivers.length; i += 1) {
    const river = rivers[i];
    if (!river) continue;
    if (nearPolygonLocal(x, y, river.bankPolygon, 1.0)) return true;
    if (nearPolylineLocal(x, y, river.centerline, radius * 0.5 + 2.0)) return true;
  }
  const waters = Array.isArray(Z.ctx.waterBodiesBuilt) ? Z.ctx.waterBodiesBuilt : [];
  for (let i = 0; i < waters.length; i += 1) {
    const wb = waters[i];
    if (!wb) continue;
    if (nearPolygonLocal(x, y, wb.shorePoly, 1.0)) return true;
    if (nearPolylineLocal(x, y, wb.shorePoly.concat([wb.shorePoly[0]]), radius * 0.5 + 2.0)) return true;
  }
  const canals = Array.isArray(Z.ctx.canalsBuilt) ? Z.ctx.canalsBuilt : [];
  for (let i = 0; i < canals.length; i += 1) {
    const canal = canals[i];
    if (!canal || !Array.isArray(canal.centerline)) continue;
    const req = 0.5 * toNum(canal.widthM, 6) + 1.0;
    if (nearPolylineLocal(x, y, canal.centerline, req)) return true;
  }
  const roads = Array.isArray(Z.ctx.roadsBuilt) ? Z.ctx.roadsBuilt : [];
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    if (!road || !Array.isArray(road.centerline)) continue;
    const req = 0.5 * toNum(road.widthM, 9) + 1.2;
    if (nearPolylineLocal(x, y, road.centerline, req)) return true;
  }
  const walls = Array.isArray(Z.ctx.wallsBuilt) ? Z.ctx.wallsBuilt : [];
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    if (!wall || !Array.isArray(wall.polyline)) continue;
    const req = 0.5 * toNum(wall.thicknessM, 5) + 1.0;
    if (nearPolylineLocal(x, y, wall.polyline, req)) return true;
  }
  // 禁建圈内一律不植树
  const exclusions = Array.isArray(Z.ctx.exclusionPolys) ? Z.ctx.exclusionPolys : [];
  for (let i = 0; i < exclusions.length; i += 1) {
    const ex = exclusions[i];
    if (Array.isArray(ex) && ex.length >= 3 && pointInPolygon(x, y, ex)) return true;
  }
  return false;
}

/** 多边形是否触碰任一 exclusion 禁建区（含边界相交）。 */
function polygonTouchesExclusion(poly, exclusionPolys, margin) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  const list = Array.isArray(exclusionPolys) ? exclusionPolys : [];
  const pad = toNum(margin, 1.0);
  const polyBox = polygonBBox(poly);
  for (let e = 0; e < list.length; e += 1) {
    const ex = list[e];
    if (!Array.isArray(ex) || ex.length < 3) continue;
    if (bboxGap(polyBox, polygonBBox(ex)) >= pad) continue;
    for (let i = 0; i < poly.length; i += 1) {
      if (pointInPolygon(poly[i][0], poly[i][1], ex)) return true;
    }
    for (let j = 0; j < ex.length; j += 1) {
      if (pointInPolygon(ex[j][0], ex[j][1], poly)) return true;
    }
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      for (let j = 0; j < ex.length; j += 1) {
        const c = ex[j];
        const d = ex[(j + 1) % ex.length];
        if (segmentsIntersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return true;
      }
    }
  }
  return false;
}

function tryAddTree(Z, x, y, r) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!pointInPolygon(x, y, Z.zone.points)) return;
  const radius = clampNum(toNum(r, 6), 2.5, 14);
  let clearance = Infinity;
  if (Z.ctx.grid) {
    clearance = sampleObstacleClearance(Z.ctx.grid, Z.ctx.worldSizeM, x, y);
    if (clearance < 2.0) return;
  }
  // 净空远大于树冠半径时无需逐段解析复检，保证大场景编译速度
  if ((!Z.ctx.grid || clearance <= radius + 10.0) && treePlacementBlocked(Z, x, y, radius)) return;
  const probe = [
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x + radius, y + radius],
    [x - radius, y + radius]
  ];
  const nearby = Z.ctx.spatialHash.queryPolygonBBox(probe, 0);
  for (let i = 0; i < nearby.length; i += 1) {
    const other = nearby[i];
    if (other && Array.isArray(other.points) && pointInPolygon(x, y, other.points)) {
      return;
    }
  }
  Z.ctx.treeSeq += 1;
  Z.result.trees.push({
    x,
    y,
    r: radius,
    zoneId: Z.zone.id,
    kind: 'garden'
  });
}

/* ------------------------------------------------------------------------------------------------
 * 十一、街坊递归剖分与沿街屋宇
 * ---------------------------------------------------------------------------------------------- */

function subdivideBlock(blockPoly, targetMin, targetMax, rng, maxDepth) {
  const lots = [];
  const queue = [{ poly: blockPoly, depth: 0 }];
  let guard = 0;
  const guardMax = 4000;
  while (queue.length > 0 && guard < guardMax) {
    guard += 1;
    const item = queue.shift();
    const poly = item.poly;
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const area = Math.abs(computePolygonAreaSigned(poly));
    if (area <= targetMax || item.depth >= maxDepth || poly.length > 12) {
      lots.push(poly);
      continue;
    }
    // 最长轴 OBB 投影
    let ux = 1;
    let uy = 0;
    let bestLen = -1;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > bestLen) {
        bestLen = len;
        ux = (b[0] - a[0]) / len;
        uy = (b[1] - a[1]) / len;
      }
    }
    let uMin = Infinity;
    let uMax = -Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const proj = poly[i][0] * ux + poly[i][1] * uy;
      if (proj < uMin) uMin = proj;
      if (proj > uMax) uMax = proj;
    }
    if (!Number.isFinite(uMin) || !Number.isFinite(uMax) || uMax - uMin < 1e-6) {
      lots.push(poly);
      continue;
    }
    const ratio = 0.38 + rng() * 0.24;
    const cut = uMin + (uMax - uMin) * ratio;
    const a = clipPolygonHalfPlane(poly, ux, uy, cut);
    const b = clipPolygonHalfPlane(poly, -ux, -uy, -cut);
    if (a.length < 3 || b.length < 3) {
      lots.push(poly);
      continue;
    }
    const areaA = Math.abs(computePolygonAreaSigned(a));
    const areaB = Math.abs(computePolygonAreaSigned(b));
    if (areaA < targetMin * 0.35 || areaB < targetMin * 0.35) {
      lots.push(poly);
      continue;
    }
    queue.push({ poly: a, depth: item.depth + 1 });
    queue.push({ poly: b, depth: item.depth + 1 });
  }
  while (queue.length > 0) {
    lots.push(queue.shift().poly);
  }
  return lots;
}

function frontStripForLot(lot, blockPoly, maxDepth) {
  let best = null;
  const n = blockPoly.length;
  const centre = computePolygonCentroid(blockPoly);
  for (let i = 0; i < n; i += 1) {
    const a = blockPoly[i];
    const b = blockPoly[(i + 1) % n];
    let near = false;
    let lotDepth = 0;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    let inx = -ey / len;
    let iny = ex / len;
    if ((centre[0] - a[0]) * inx + (centre[1] - a[1]) * iny < 0) {
      inx = -inx;
      iny = -iny;
    }
    for (let k = 0; k < lot.length; k += 1) {
      const p = lot[k];
      const dist = pointToSegmentDist(p[0], p[1], a[0], a[1], b[0], b[1]);
      if (dist <= 0.75) near = true;
      const depth = (p[0] - a[0]) * inx + (p[1] - a[1]) * iny;
      if (depth > lotDepth) lotDepth = depth;
    }
    if (!near) continue;
    const depth = clampNum(Math.min(maxDepth, lotDepth * 0.92), 8, maxDepth);
    const cval = inx * (a[0] + depth * inx) + iny * (a[1] + depth * iny);
    const strip = clipPolygonHalfPlane(lot, inx, iny, cval);
    if (strip.length < 3) continue;
    const area = Math.abs(computePolygonAreaSigned(strip));
    if (!best || area > best.area) {
      best = { poly: strip, area, depth, edgeLen: len, a, b, inx, iny };
    }
  }
  return best;
}

function generateStreetFrontage(Z, blockPoly, lotMin, lotMax, roofKind) {
  const lots = subdivideBlock(blockPoly, lotMin, lotMax, Z.rng, 7);
  for (let i = 0; i < lots.length; i += 1) {
    const lot = lots[i];
    const lotArea = Math.abs(computePolygonAreaSigned(lot));
    if (lotArea < 28) continue;
    const strip = frontStripForLot(lot, blockPoly, 20);
    if (!strip || strip.area < 26) {
      if (lotArea > 120) {
        const c = computePolygonCentroid(lot);
        tryAddTree(Z, c[0], c[1], 4.6 + Z.rng() * 2.2);
        if (lotArea > 260 && Z.rng() < 0.5) {
          tryAddTree(Z, c[0] + (Z.rng() - 0.5) * 8, c[1] + (Z.rng() - 0.5) * 8, 3.8 + Z.rng() * 1.6);
        }
      }
      continue;
    }
    let buildPoly = insetConvexPolygon(strip.poly, 0.62);
    if (buildPoly.length < 3) continue;
    if (strip.depth > 16) {
      const cutDepth = strip.depth * 0.62;
      const cval = strip.inx * (strip.a[0] + cutDepth * strip.inx) +
        strip.iny * (strip.a[1] + cutDepth * strip.iny);
      const front = clipPolygonHalfPlane(buildPoly, strip.inx, strip.iny, cval);
      if (front.length >= 3 && Math.abs(computePolygonAreaSigned(front)) > 30) {
        const rearC = computePolygonCentroid(buildPoly);
        const house = tryAddBuilding(Z, front, roofKind, 'house');
        if (house) {
          const backX = rearC[0] + strip.inx * 4.5;
          const backY = rearC[1] + strip.iny * 4.5;
          tryAddTree(Z, backX, backY, 3.4 + Z.rng() * 1.4);
        }
        continue;
      }
    }
    const added = tryAddBuilding(Z, buildPoly, roofKind, 'house');
    if (!added) {
      const c = computePolygonCentroid(buildPoly);
      if (polygonMinEdgeLength(buildPoly) > 6) {
        tryAddTree(Z, c[0], c[1], 4.0 + Z.rng() * 1.6);
      }
    }
  }
}

function generateBlockSet(Z, innerPoly, lotMin, lotMax, roofKind, streetWidthM) {
  const areaHa = Math.abs(computePolygonAreaSigned(innerPoly)) / 10000;
  if (areaHa < 0.02) return [];
  const K = clampNum(Math.round(areaHa * (1.8 + Z.zone.density * 2.4)), 3, 44);
  const bbox = polygonBBox(innerPoly);
  const sites = [];
  const maxAttempts = K * 50;
  let attempts = 0;
  while (sites.length < K && attempts < maxAttempts) {
    attempts += 1;
    const x = bbox[0] + Z.rng() * (bbox[2] - bbox[0]);
    const y = bbox[1] + Z.rng() * (bbox[3] - bbox[1]);
    if (pointInPolygon(x, y, innerPoly)) sites.push([x, y]);
  }
  const cent = computePolygonCentroid(innerPoly);
  while (sites.length < K) {
    sites.push([cent[0] + (Z.rng() - 0.5) * 24, cent[1] + (Z.rng() - 0.5) * 24]);
  }
  const cells = computeVoronoiCells(
    sites,
    [bbox[0] - 16, bbox[1] - 16, bbox[2] + 16, bbox[3] + 16],
    2,
    innerPoly
  );
  const insetDist = 0.5 * streetWidthM + 1.2;
  const blocks = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cell || cell.length < 3) continue;
    const inset = insetConvexPolygon(cell, insetDist);
    if (inset.length < 3) continue;
    const area = Math.abs(computePolygonAreaSigned(inset));
    if (area < 90) continue;
    blocks.push(inset);
    const edges = inset.length;
    for (let k = 0; k < edges; k += 1) {
      Z.result.internalStreets.push([inset[k], inset[(k + 1) % edges]]);
    }
    generateStreetFrontage(Z, inset, lotMin, lotMax, roofKind);
  }
  return blocks;
}

/* ------------------------------------------------------------------------------------------------
 * 十二、城垣环、敌台与城门
 * ---------------------------------------------------------------------------------------------- */

function buildWallSystem(Z, thicknessM, towerIntervalM, gapExtraM) {
  const zone = Z.zone;
  const ring = densifyRing(zone.points, 16);
  const { cum } = cumulativeOf(ring, true);
  const total = cum[ring.length];
  const roads = Array.isArray(Z.ctx.roadsBuilt) ? Z.ctx.roadsBuilt : [];
  const gaps = [];

  for (let r = 0; r < roads.length; r += 1) {
    const road = roads[r];
    const cl = road.centerline;
    if (!Array.isArray(cl) || cl.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (let j = 0; j + 1 < cl.length; j += 1) {
        const c = cl[j];
        const d = cl[j + 1];
        const rx = b[0] - a[0];
        const ry = b[1] - a[1];
        const sx = d[0] - c[0];
        const sy = d[1] - c[1];
        const denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
        const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const px = a[0] + rx * t;
        const py = a[1] + ry * t;
        const arc = cum[i] + t * Math.hypot(rx, ry);
        const halfGap = 0.5 * road.widthM + gapExtraM;
        let merged = false;
        for (let g = 0; g < gaps.length; g += 1) {
          if (Math.abs(gaps[g].arc - arc) < halfGap * 2) {
            gaps[g].halfGap = Math.max(gaps[g].halfGap, halfGap);
            merged = true;
            break;
          }
        }
        if (!merged) {
          gaps.push({
            arc,
            halfGap,
            x: px,
            y: py,
            roadId: road.id,
            roadName: road.name,
            roadWidthM: road.widthM,
            angleDeg: (Math.atan2(ry, rx) * 180) / Math.PI
          });
        }
      }
    }
  }

  gaps.sort((a, b) => a.arc - b.arc);
  const sections = [];
  const gates = [];

  if (gaps.length === 0) {
    sections.push({
      points: ring.concat([ring[0]]),
      closed: true,
      arcStart: 0,
      arcSpan: total,
      gates: [],
      towers: []
    });
  } else {
    for (let g = 0; g < gaps.length; g += 1) {
      const startGap = gaps[g];
      const endGap = gaps[(g + 1) % gaps.length];
      const startArc = startGap.arc + startGap.halfGap;
      let endArc = endGap.arc - endGap.halfGap;
      if (endArc <= startArc) endArc += total;
      const pts = [];
      const steps = Math.max(2, Math.ceil((endArc - startArc) / 12));
      for (let s = 0; s <= steps; s += 1) {
        const arc = startArc + ((endArc - startArc) * s) / steps;
        const norm = ((arc % total) + total) % total;
        const idx = findRingIndex(cum, norm, ring.length);
        const segStart = cum[idx];
        const segEnd = cum[idx + 1];
        const t = segEnd - segStart > 1e-9 ? (norm - segStart) / (segEnd - segStart) : 0;
        const a = ring[idx];
        const b = ring[(idx + 1) % ring.length];
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      if (pts.length >= 2) {
        sections.push({
          points: pts,
          closed: false,
          arcStart: ((startArc % total) + total) % total,
          arcSpan: Math.max(1e-6, endArc - startArc),
          gates: [],
          towers: []
        });
      }
    }
    for (let g = 0; g < gaps.length; g += 1) {
      const gap = gaps[g];
      const idx = findRingIndex(cum, ((gap.arc % total) + total) % total, ring.length);
      const a = ring[idx];
      const b = ring[(idx + 1) % ring.length];
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const nx = Math.sin(angle);
      const ny = -Math.cos(angle);
      const towerOffset = gap.halfGap + 3.4;
      gates.push({
        id: `gate_${Z.zone.id}_${g + 1}`,
        x: gap.x,
        y: gap.y,
        arc: ((gap.arc % total) + total) % total,
        angleDeg: (angle * 180) / Math.PI,
        gapHalf: gap.halfGap,
        roadId: gap.roadId,
        roadName: gap.roadName,
        roadWidthM: gap.roadWidthM,
        towers: [
          [gap.x + Math.cos(angle) * towerOffset + nx * 2.0, gap.y + Math.sin(angle) * towerOffset + ny * 2.0],
          [gap.x - Math.cos(angle) * towerOffset + nx * 2.0, gap.y - Math.sin(angle) * towerOffset + ny * 2.0]
        ]
      });
    }
  }

  // 城门归段：每座城门只挂到其弧段所属的唯一墙段
  for (let g = 0; g < gates.length; g += 1) {
    let owner = null;
    let bestOffset = Infinity;
    for (let s = 0; s < sections.length; s += 1) {
      const sec = sections[s];
      const offset = (((gates[g].arc - sec.arcStart) % total) + total) % total;
      if (offset <= sec.arcSpan + 1e-6 && offset < bestOffset) {
        bestOffset = offset;
        owner = sec;
      }
    }
    if (!owner && sections.length > 0) owner = sections[0];
    if (owner) owner.gates.push(gates[g]);
  }

  // 敌台按墙段独立生成，避免同一批 tower 被重复赋给每段导致叠画
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    const pts = section.points;
    let acc = 0;
    let nextAt = towerIntervalM * 0.5;
    section.towers.push({ x: pts[0][0], y: pts[0][1], radiusM: 5.2, kind: 'tower' });
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      while (nextAt <= acc + segLen) {
        const t = segLen > 1e-9 ? (nextAt - acc) / segLen : 0;
        section.towers.push({
          x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
          y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
          radiusM: 5.2,
          kind: 'tower'
        });
        nextAt += towerIntervalM;
      }
      acc += segLen;
    }
    const last = pts[pts.length - 1];
    section.towers.push({ x: last[0], y: last[1], radiusM: 5.2, kind: 'tower' });
  }

  // 城门门楼塔只挂到所属墙段
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    for (let g = 0; g < section.gates.length; g += 1) {
      const gate = section.gates[g];
      for (let t = 0; t < gate.towers.length; t += 1) {
        section.towers.push({
          x: gate.towers[t][0],
          y: gate.towers[t][1],
          radiusM: 5.2,
          kind: 'gate_tower'
        });
      }
    }
  }

  const allTowers = [];
  const towerSeen = new Set();
  for (let s = 0; s < sections.length; s += 1) {
    for (let t = 0; t < sections[s].towers.length; t += 1) {
      const tower = sections[s].towers[t];
      const key = `${Math.round(tower.x * 10)}:${Math.round(tower.y * 10)}`;
      if (towerSeen.has(key)) continue;
      towerSeen.add(key);
      allTowers.push(tower);
    }
  }

  const wallId = `wall_${Z.zone.id}`;
  for (let s = 0; s < sections.length; s += 1) {
    const uniqueTowers = [];
    const seenTower = new Set();
    for (let t = 0; t < sections[s].towers.length; t += 1) {
      const tower = sections[s].towers[t];
      const key = `${Math.round(tower.x * 10)}:${Math.round(tower.y * 10)}`;
      if (seenTower.has(key)) continue;
      seenTower.add(key);
      uniqueTowers.push(tower);
    }
    sections[s].towers = uniqueTowers;
    const wall = {
      id: sections.length === 1 ? wallId : `${wallId}_${s + 1}`,
      zoneId: Z.zone.id,
      thicknessM,
      polyline: sections[s].points,
      closed: sections[s].closed,
      gates: sections[s].gates,
      towers: uniqueTowers
    };
    Z.result.walls.push(wall);
    Z.ctx.wallsBuilt.push({ id: wall.id, thicknessM, polyline: wall.polyline });
  }
  Z.result.towers = allTowers;
  return { ring, sections, gates, towers: allTowers, total };
}

function findRingIndex(cum, arc, count) {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= arc) lo = mid;
    else hi = mid - 1;
  }
  return clampNum(lo, 0, count - 1);
}

/* ------------------------------------------------------------------------------------------------
 * 十三、九类 content type 生成器
 * ---------------------------------------------------------------------------------------------- */

function buildZoneWallSystem(Z) {
  const zone = Z.zone;
  if (zone.contentType === 'citadel') {
    return buildWallSystem(Z, zone.wallThicknessM, Math.max(60, zone.towerIntervalM * 0.8), 3.5);
  }
  return buildWallSystem(Z, zone.wallThicknessM, zone.towerIntervalM, 4.5);
}

function compileWalledCity(Z, wallsPrebuilt) {
  const zone = Z.zone;
  if (!wallsPrebuilt) buildZoneWallSystem(Z);
  const inner = insetPolygonSafe(zone.points, zone.wallThicknessM + 5);
  if (inner.length < 3) return;
  generateBlockSet(Z, inner, 95, 240, 'inner', zone.streetWidthM);
  addPlazaTrees(Z, inner, { towers: Z.result.towers });
}

function addPlazaTrees(Z, inner, wallInfo) {
  if (!Array.isArray(wallInfo.towers)) return;
  for (let i = 0; i < wallInfo.towers.length; i += 1) {
    const tower = wallInfo.towers[i];
    const cx = tower.x + (Z.rng() - 0.5) * 8;
    const cy = tower.y + (Z.rng() - 0.5) * 8;
    if (pointInPolygon(cx, cy, inner) && Z.rng() < 0.35) {
      tryAddTree(Z, cx, cy, 3.6 + Z.rng() * 1.8);
    }
  }
}

function compileTownBlocks(Z) {
  const zone = Z.zone;
  const inner = insetPolygonSafe(zone.points, 3.5);
  if (inner.length < 3) return;
  generateBlockSet(Z, inner, 110, 280, 'town', zone.streetWidthM);
}

function compileVillage(Z) {
  const zone = Z.zone;
  const centroid = computePolygonCentroid(zone.points);
  const grad = Z.terrainData
    ? sampleGradientLocal(Z.terrainData, centroid[0], centroid[1])
    : { dzdx: 0, dzdy: 1 };
  let tx = -grad.dzdy;
  let ty = grad.dzdx;
  let tl = Math.hypot(tx, ty);
  if (tl < 1e-6) {
    const a = principalAngleOf(zone.points);
    tx = Math.cos(a);
    ty = Math.sin(a);
    tl = 1;
  }
  tx /= tl;
  ty /= tl;
  const nx = ty;
  const ny = -tx;

  const laneCount = 3 + Math.floor(Z.rng() * 2);
  const spacing = 58 + Z.rng() * 26;
  const bbox = polygonBBox(zone.points);
  const diag = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 1.2;
  const lanes = [];
  const laneWidth = 4.5;

  for (let l = 0; l < laneCount; l += 1) {
    const off = (l - (laneCount - 1) * 0.5) * spacing;
    const cx = centroid[0] + nx * off;
    const cy = centroid[1] + ny * off;
    const a = [cx - tx * diag, cy - ty * diag];
    const b = [cx + tx * diag, cy + ty * diag];
    const runs = clipLineToPolygon(a[0], a[1], b[0], b[1], zone.points, 4);
    for (let r = 0; r < runs.length; r += 1) {
      const run = runs[r];
      if (run.length < 2) continue;
      const len = Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1]);
      if (len < 40) continue;
      lanes.push(run);
      Z.result.lanes.push(run);
      Z.result.internalStreets.push(run);
    }
  }

  for (let l = 0; l < lanes.length; l += 1) {
    const lane = lanes[l];
    const laneLen = polylineLen(lane);
    let acc = 8 + Z.rng() * 6;
    let side = Z.rng() < 0.5 ? 1 : -1;
    while (acc < laneLen - 8) {
      const hit = pointAtLength(lane, acc);
      const tangent = hit.tangent;
      const nlx = tangent[1];
      const nly = -tangent[0];
      const offset = 14 + Z.rng() * 6;
      const hx = hit.x + nlx * offset * side;
      const hy = hit.y + nly * offset * side;
      const angle = Math.atan2(tangent[1], tangent[0]);
      const main = rectPolygon(hx, hy, 12, 6.5, angle);
      const house = tryAddBuilding(Z, main, 'town', 'farmhouse');
      if (house) {
        const wingOffset = 8.6;
        const wing = rectPolygon(
          hx + nlx * wingOffset * side,
          hy + nly * wingOffset * side,
          8,
          5,
          angle
        );
        tryAddBuilding(Z, wing, 'town', 'wing');
        const fenceCx = hx + nlx * 22 * side;
        const fenceCy = hy + nly * 22 * side;
        const fence = rectPolygon(fenceCx, fenceCy, 14, 18, angle);
        let fenceSafe = true;
        for (let f = 0; f < fence.length; f += 1) {
          if (!pointInPolygon(fence[f][0], fence[f][1], zone.points)) {
            fenceSafe = false;
            break;
          }
        }
        // 四角 + 四边 + 重心全量复核：避开道路、水系、禁建圈、城墙与已建耳房
        if (fenceSafe && isPolygonSafe(fence, Z.ctx, 0)) {
          Z.result.gardenFences.push({
            points: fence.concat([fence[0]]),
            zoneId: zone.id
          });
        }
        const treeCount = 2 + Math.floor(Z.rng() * 3);
        for (let t = 0; t < treeCount; t += 1) {
          const ta = angle + Math.PI * 0.5 + (Z.rng() - 0.5) * 1.4;
          const tr = 15 + Z.rng() * 7;
          tryAddTree(
            Z,
            hx + Math.cos(ta) * tr * side,
            hy + Math.sin(ta) * tr * side,
            3.2 + Z.rng() * 1.6
          );
        }
        const gardenTree = 1 + Math.floor(Z.rng() * 2);
        for (let t = 0; t < gardenTree; t += 1) {
          tryAddTree(
            Z,
            fenceCx + (Z.rng() - 0.5) * 8,
            fenceCy + (Z.rng() - 0.5) * 10,
            3.6 + Z.rng() * 1.8
          );
        }
      }
      acc += 20 + Z.rng() * 16;
      if (Z.rng() < 0.55) side = -side;
    }
  }
  void laneWidth;
}

function polylineLen(points) {
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return acc;
}

function pointAtLength(points, target) {
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + segLen >= target) {
      const t = segLen > 1e-9 ? (target - acc) / segLen : 0;
      const tx = segLen > 1e-9 ? (b[0] - a[0]) / segLen : 1;
      const ty = segLen > 1e-9 ? (b[1] - a[1]) / segLen : 0;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        tangent: [tx, ty]
      };
    }
    acc += segLen;
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1], tangent: [1, 0] };
}

function sampleGradientLocal(terrainData, wx, wy) {
  const h = terrainData.cellSizeM || 1;
  const dzdx = (sampleElevation(terrainData, wx + h, wy) - sampleElevation(terrainData, wx - h, wy)) / (2 * h);
  const dzdy = (sampleElevation(terrainData, wx, wy + h) - sampleElevation(terrainData, wx, wy - h)) / (2 * h);
  return { dzdx, dzdy };
}

function compileCitadel(Z, wallsPrebuilt) {
  const zone = Z.zone;
  if (!wallsPrebuilt) buildZoneWallSystem(Z);
  const inner = insetPolygonSafe(zone.points, zone.wallThicknessM + 4);
  if (inner.length < 3) return;
  const centroid = computePolygonCentroid(inner);
  const angle = principalAngleOf(inner);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const hall = rectPolygon(
    centroid[0] + cosA * -6,
    centroid[1] + sinA * -6,
    30, 18, angle
  );
  const hallBuilt = tryAddBuilding(Z, hall, 'inner', 'hall', '议事正殿');
  if (!hallBuilt) {
    tryAddBuilding(Z, rectPolygon(centroid[0], centroid[1], 24, 15, angle), 'inner', 'hall');
  }

  const granarySpec = [
    [-34, 26], [34, 26], [-34, -26], [34, -26]
  ];
  for (let i = 0; i < granarySpec.length; i += 1) {
    const u = granarySpec[i][0];
    const v = granarySpec[i][1];
    const gx = centroid[0] + u * cosA - v * sinA;
    const gy = centroid[1] + u * sinA + v * cosA;
    tryAddBuilding(Z, rectPolygon(gx, gy, 26, 9, angle), 'inner', 'granary', '高阶公仓');
  }

  const court = rectPolygon(centroid[0] - 0 * cosA, centroid[1] + 30, 44, 22, angle);
  let courtInside = true;
  for (let i = 0; i < court.length; i += 1) {
    if (!pointInPolygon(court[i][0], court[i][1], inner)) {
      courtInside = false;
      break;
    }
  }
  if (courtInside) {
    Z.result.marketAprons.push({
      points: court,
      kind: 'parade_ground',
      zoneId: zone.id
    });
  }

  for (let t = 0; t < 4; t += 1) {
    const ta = angle + (Math.PI / 2) * t;
    const tx = centroid[0] + Math.cos(ta) * 46;
    const ty = centroid[1] + Math.sin(ta) * 46;
    if (pointInPolygon(tx, ty, inner)) {
      tryAddTree(Z, tx, ty, 4.2 + Z.rng() * 2.0);
    }
  }
}

function projectExtent(poly, cx, cy, ux, uy) {
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const v = (poly[i][0] - cx) * ux + (poly[i][1] - cy) * uy;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return [minV, maxV];
}

function compileMarket(Z) {
  const zone = Z.zone;
  const apron = insetPolygonSafe(zone.points, 4);
  if (apron.length < 3) return;
  Z.result.marketAprons.push({ points: apron, kind: 'market_apron', zoneId: zone.id });
  const angle = principalAngleOf(zone.points);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const centroid = computePolygonCentroid(zone.points);
  const bbox = polygonBBox(apron);
  const diag = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const uExtent = projectExtent(apron, centroid[0], centroid[1], cosA, sinA);
  const vExtent = projectExtent(apron, centroid[0], centroid[1], -sinA, cosA);
  const uSpan = Math.max(1, uExtent[1] - uExtent[0]);
  const vSpan = Math.max(1, vExtent[1] - vExtent[0]);
  const uStep = Math.max(15.0, uSpan / 56);
  const vStep = Math.max(9.0, vSpan / 40);
  const stallW = Math.min(10, uStep * 0.7);
  const stallH = Math.min(4.5, vStep * 0.55);
  const wellsPlaced = [];
  const iuStart = Math.ceil(uExtent[0] / uStep);
  const iuEnd = Math.floor(uExtent[1] / uStep);
  const ivStart = Math.ceil(vExtent[0] / vStep);
  const ivEnd = Math.floor(vExtent[1] / vStep);

  for (let iu = iuStart; iu <= iuEnd; iu += 1) {
    for (let iv = ivStart; iv <= ivEnd; iv += 1) {
      const u = iu * uStep;
      const v = iv * vStep;
      if (Math.abs(u) < 6.5) continue;
      if (Math.abs(v) < 4.5) continue;
      const cx = centroid[0] + u * cosA - v * sinA;
      const cy = centroid[1] + u * sinA + v * cosA;
      const stall = rectPolygon(cx, cy, stallW, stallH, angle);
      let inside = true;
      for (let k = 0; k < stall.length; k += 1) {
        if (!pointInPolygon(stall[k][0], stall[k][1], apron)) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      tryAddBuilding(Z, stall, 'town', 'stall', '货棚');
    }
  }

  const wellPositions = [
    [centroid[0], centroid[1]],
    [centroid[0] + 26 * cosA, centroid[1] + 26 * sinA],
    [centroid[0] - 26 * cosA, centroid[1] - 26 * sinA]
  ];
  for (let i = 0; i < wellPositions.length; i += 1) {
    const wx = wellPositions[i][0];
    const wy = wellPositions[i][1];
    if (pointInPolygon(wx, wy, apron)) {
      wellsPlaced.push({ x: wx, y: wy, radiusM: 2.2, zoneId: zone.id });
    }
  }
  Z.result.wells = wellsPlaced;

  for (let t = 0; t < 6; t += 1) {
    const a = angle + (Math.PI * 2 * t) / 6;
    const tx = centroid[0] + Math.cos(a) * (diag * 0.42);
    const ty = centroid[1] + Math.sin(a) * (diag * 0.42);
    tryAddTree(Z, tx, ty, 3.4 + Z.rng() * 1.6);
  }
}

function compileFarmland(Z) {
  const zone = Z.zone;
  const areaHa = Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
  const K = clampNum(Math.round(areaHa / 0.72), 2, 26);
  const bbox = polygonBBox(zone.points);
  const sites = [];
  let attempts = 0;
  while (sites.length < K && attempts < K * 50) {
    attempts += 1;
    const x = bbox[0] + Z.rng() * (bbox[2] - bbox[0]);
    const y = bbox[1] + Z.rng() * (bbox[3] - bbox[1]);
    if (pointInPolygon(x, y, zone.points)) sites.push([x, y]);
  }
  const cent = computePolygonCentroid(zone.points);
  while (sites.length < K) {
    sites.push([cent[0] + (Z.rng() - 0.5) * 30, cent[1] + (Z.rng() - 0.5) * 30]);
  }
  const cells = computeVoronoiCells(
    sites,
    [bbox[0] - 12, bbox[1] - 12, bbox[2] + 12, bbox[3] + 12],
    1,
    zone.points
  );
  const angles = [0, 35, 75, 120];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cell || cell.length < 3) continue;
    const inner = insetPolygonSafe(cell, 1.5);
    if (inner.length < 3) continue;
    if (polygonTouchesExclusion(inner, Z.ctx.exclusionPolys, 2.0)) continue;
    const area = Math.abs(computePolygonAreaSigned(inner));
    if (area < 120) continue;
    const baseAngle = angles[Math.floor(Z.rng() * angles.length)];
    const angleRad = ((baseAngle + (Z.rng() - 0.5) * 8) * Math.PI) / 180;
    const furrows = buildFurrows(inner, angleRad, 7);
    Z.result.farmlandPlots.push({
      polygon: cell,
      innerPolygon: inner,
      areaHa: area / 10000,
      angleDeg: (angleRad * 180) / Math.PI,
      furrows,
      zoneId: zone.id,
      id: `plot_${zone.id}_${i}`
    });
    if (Z.rng() < 0.4) {
      const c = computePolygonCentroid(inner);
      tryAddTree(Z, c[0] + (Z.rng() - 0.5) * 10, c[1] + (Z.rng() - 0.5) * 10, 3.0 + Z.rng() * 1.4);
    }
  }
}

function buildFurrows(poly, angleRad, spacing) {
  const bbox = polygonBBox(poly);
  const cx = (bbox[0] + bbox[2]) * 0.5;
  const cy = (bbox[1] + bbox[3]) * 0.5;
  const diag = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const ux = Math.cos(angleRad);
  const uy = Math.sin(angleRad);
  const nx = -uy;
  const ny = ux;
  const lines = [];
  const count = Math.min(30, Math.ceil(diag / spacing) + 1);
  for (let i = -count; i <= count; i += 1) {
    const off = i * spacing;
    const ax = cx + nx * off - ux * diag;
    const ay = cy + ny * off - uy * diag;
    const bx = cx + nx * off + ux * diag;
    const by = cy + ny * off + uy * diag;
    const runs = clipLineToPolygon(ax, ay, bx, by, poly, 5);
    for (let r = 0; r < runs.length; r += 1) {
      if (runs[r].length >= 2) lines.push(runs[r]);
    }
  }
  return lines;
}

function compileSaltpan(Z) {
  const zone = Z.zone;
  const angle = principalAngleOf(zone.points);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const centroid = computePolygonCentroid(zone.points);
  const bbox = polygonBBox(zone.points);
  const diag = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const cellW = 24;
  const cellH = 16;
  const gap = 2.0;
  const pitchW = cellW + gap;
  const pitchH = cellH + gap;
  const uExtent = projectExtent(zone.points, centroid[0], centroid[1], cosA, sinA);
  const vExtent = projectExtent(zone.points, centroid[0], centroid[1], -sinA, cosA);
  const iuStart = Math.ceil(uExtent[0] / pitchW);
  const iuEnd = Math.floor(uExtent[1] / pitchW);
  const ivStart = Math.ceil(vExtent[0] / pitchH);
  const ivEnd = Math.floor(vExtent[1] / pitchH);

  for (let iu = iuStart; iu <= iuEnd; iu += 1) {
    for (let iv = ivStart; iv <= ivEnd; iv += 1) {
      const u = iu * pitchW;
      const v = iv * pitchH;
      const cx = centroid[0] + u * cosA - v * sinA;
      const cy = centroid[1] + u * sinA + v * cosA;
      const cellPoly = rectPolygon(cx, cy, cellW, cellH, angle);
      let inside = true;
      for (let k = 0; k < cellPoly.length; k += 1) {
        if (!pointInPolygon(cellPoly[k][0], cellPoly[k][1], zone.points)) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      if (polygonTouchesExclusion(cellPoly, Z.ctx.exclusionPolys, 1.0)) continue;
      Z.result.saltpanCells.push({
        polygon: cellPoly,
        opacity: 0.82 + Z.rng() * 0.18,
        zoneId: zone.id,
        id: `salt_${zone.id}_${iu}_${iv}`
      });
    }
  }
  for (let t = 0; t < 3; t += 1) {
    const a = angle + (Math.PI * 2 * t) / 3;
    tryAddTree(
      Z,
      centroid[0] + Math.cos(a) * diag * 0.4,
      centroid[1] + Math.sin(a) * diag * 0.4,
      3.2 + Z.rng() * 1.4
    );
  }
}

function compileWoodland(Z) {
  const zone = Z.zone;
  const bbox = polygonBBox(zone.points);
  const baseSpacing = 11 + (1 - clampNum(zone.density, 0.2, 1)) * 7;
  const cols = Math.ceil((bbox[2] - bbox[0]) / baseSpacing) + 1;
  const rows = Math.ceil((bbox[3] - bbox[1]) / baseSpacing) + 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const jx = (Z.rng() - 0.5) * baseSpacing * 0.9;
      const jy = (Z.rng() - 0.5) * baseSpacing * 0.9;
      const x = bbox[0] + c * baseSpacing + jx;
      const y = bbox[1] + r * baseSpacing + jy;
      if (!pointInPolygon(x, y, zone.points)) continue;
      if (Z.rng() > 0.35 + zone.density * 0.6) continue;
      if (Z.terrainData) {
        const slope = sampleSlopeDeg(Z.terrainData, x, y);
        if (slope > zone.maxSlopeDeg) continue;
      }
      tryAddTree(Z, x, y, 4.5 + Z.rng() * 5.0);
    }
  }
}

function compileExclusion(Z) {
  Z.result.exclusionPoly = Z.zone.points.map((p) => [p[0], p[1]]);
  let present = false;
  for (let i = 0; i < Z.ctx.exclusionPolys.length; i += 1) {
    const ex = Z.ctx.exclusionPolys[i];
    if (!Array.isArray(ex) || ex.length !== Z.zone.points.length) continue;
    if (Math.abs(ex[0][0] - Z.zone.points[0][0]) < 1e-6 &&
      Math.abs(ex[0][1] - Z.zone.points[0][1]) < 1e-6) {
      present = true;
      break;
    }
  }
  if (!present) {
    Z.ctx.exclusionPolys.push(Z.zone.points.map((p) => [p[0], p[1]]));
  }
}

/* ------------------------------------------------------------------------------------------------
 * 十四、单选区编译
 * ---------------------------------------------------------------------------------------------- */

export function compileSingleZone(zone, project, terrainData, hydroRoadData, obstacleCtx, options) {
  if (!zone || !Array.isArray(zone.points) || zone.points.length < 3) return null;
  const opts = options || {};
  const phase = (opts.phase === 'walls' || opts.phase === 'content') ? opts.phase : 'all';
  const ctx = obstacleCtx || createObstacleContext(project, terrainData, hydroRoadData, { withGrid: false });
  const prevMaxSlope = ctx.maxSlopeDeg;
  ctx.maxSlopeDeg = clampNum(toNum(zone.maxSlopeDeg, 24), 4, 60);

  let result = null;
  if (opts.result && opts.result.id === zone.id && Array.isArray(opts.result.buildings)) {
    result = opts.result;
  } else {
    result = makeZoneResult(zone);
    ctx.zoneSeq += 1;
  }
  const Z = {
    zone,
    project,
    terrainData,
    ctx,
    result,
    rng: createRng(zone.seed === undefined || zone.seed === null ? hashSeed(zone.id) : zone.seed)
  };

  const type = ZONE_CONTENT_TYPES.indexOf(zone.contentType) >= 0 ? zone.contentType : 'town_blocks';
  const walledType = type === 'walled_city' || type === 'citadel';
  if (phase === 'walls') {
    if (walledType) buildZoneWallSystem(Z);
  } else if (phase === 'content') {
    if (type === 'walled_city') compileWalledCity(Z, true);
    else if (type === 'town_blocks') compileTownBlocks(Z);
    else if (type === 'village') compileVillage(Z);
    else if (type === 'citadel') compileCitadel(Z, true);
    else if (type === 'market') compileMarket(Z);
    else if (type === 'farmland') compileFarmland(Z);
    else if (type === 'saltpan') compileSaltpan(Z);
    else if (type === 'woodland') compileWoodland(Z);
    else compileExclusion(Z);
  } else if (type === 'walled_city') compileWalledCity(Z, false);
  else if (type === 'town_blocks') compileTownBlocks(Z);
  else if (type === 'village') compileVillage(Z);
  else if (type === 'citadel') compileCitadel(Z, false);
  else if (type === 'market') compileMarket(Z);
  else if (type === 'farmland') compileFarmland(Z);
  else if (type === 'saltpan') compileSaltpan(Z);
  else if (type === 'woodland') compileWoodland(Z);
  else compileExclusion(Z);

  ctx.maxSlopeDeg = prevMaxSlope;

  result.counts = {
    buildings: result.buildings.length,
    walls: result.walls.length,
    towers: result.towers.length,
    trees: result.trees.length,
    farmlandPlots: result.farmlandPlots.length,
    saltpanCells: result.saltpanCells.length,
    marketStalls: result.marketStalls.length,
    lanes: result.lanes.length,
    internalStreets: result.internalStreets.length
  };
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * 十五、全选区编译与聚合
 * ---------------------------------------------------------------------------------------------- */

function aggregateZones(zoneResults, ctx) {
  const buildings = [];
  const walls = [];
  const trees = [];
  const farmlandPlots = [];
  const saltpanCells = [];
  const marketAprons = [];
  const exclusionPolys = [];
  const lanes = [];
  const gardenFences = [];
  const internalStreets = [];
  const wells = [];
  for (let i = 0; i < zoneResults.length; i += 1) {
    const z = zoneResults[i];
    if (!z) continue;
    for (let k = 0; k < z.buildings.length; k += 1) buildings.push(z.buildings[k]);
    for (let k = 0; k < z.walls.length; k += 1) walls.push(z.walls[k]);
    for (let k = 0; k < z.trees.length; k += 1) trees.push(z.trees[k]);
    for (let k = 0; k < z.farmlandPlots.length; k += 1) farmlandPlots.push(z.farmlandPlots[k]);
    for (let k = 0; k < z.saltpanCells.length; k += 1) saltpanCells.push(z.saltpanCells[k]);
    for (let k = 0; k < z.marketAprons.length; k += 1) marketAprons.push(z.marketAprons[k]);
    for (let k = 0; k < z.lanes.length; k += 1) lanes.push(z.lanes[k]);
    for (let k = 0; k < z.gardenFences.length; k += 1) gardenFences.push(z.gardenFences[k]);
    for (let k = 0; k < z.internalStreets.length; k += 1) internalStreets.push(z.internalStreets[k]);
    for (let k = 0; k < z.wells.length; k += 1) wells.push(z.wells[k]);
    if (z.exclusionPoly) exclusionPolys.push(z.exclusionPoly);
  }
  return {
    zones: zoneResults,
    buildings,
    walls,
    trees,
    farmlandPlots,
    saltpanCells,
    marketAprons,
    exclusionPolys,
    lanes,
    gardenFences,
    internalStreets,
    wells,
    obstacleCtx: ctx,
    counts: {
      zones: zoneResults.length,
      buildings: buildings.length,
      walls: walls.length,
      trees: trees.length,
      farmlandPlots: farmlandPlots.length,
      saltpanCells: saltpanCells.length
    }
  };
}

export function compileAllZones(project, terrainData, hydroRoadData) {
  const p = (project && typeof project === 'object') ? project : { zones: [] };
  const zones = Array.isArray(p.zones) ? p.zones : [];
  // 两阶段：先一次性建立全部城垣并写入障碍场，再生成所有内部内容
  // —— 彻底解除 buildingWallHits 对 project.zones 排列顺序的依赖
  const ctx = createObstacleContext(p, terrainData, hydroRoadData, { withGrid: false });
  const slots = new Array(zones.length).fill(null);
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    if (!zone) continue;
    const type = ZONE_CONTENT_TYPES.indexOf(zone.contentType) >= 0 ? zone.contentType : 'town_blocks';
    if (type === 'walled_city' || type === 'citadel') {
      slots[i] = compileSingleZone(zone, p, terrainData, hydroRoadData, ctx, { phase: 'walls' });
    }
  }
  ctx.grid = buildObstacleGrid(p, terrainData, hydroRoadData, ctx.wallsBuilt);
  const results = [];
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    if (!zone) continue;
    const result = compileSingleZone(zone, p, terrainData, hydroRoadData, ctx, {
      phase: 'content',
      result: slots[i] || null
    });
    if (result) results.push(result);
  }
  rememberScene(project, results, ctx, terrainData, hydroRoadData);
  return aggregateZones(results, ctx);
}

/* ---- 场景缓存：供 rerollZoneSeed 复用邻区上下文，避免整场景重编 ---- */

const sceneCache = new WeakMap();

function hashPointsLight(points) {
  let h = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    h = (h * 31 + Math.round(p[0] * 10)) | 0;
    h = (h * 31 + Math.round(p[1] * 10)) | 0;
  }
  return h;
}

function hashShapeLight(shape) {
  if (!shape) return '0';
  return [
    shape.id, shape.type,
    hashPointsLight(Array.isArray(shape.points) ? shape.points : []),
    Math.round(toNum(shape.cx, 0) * 10),
    Math.round(toNum(shape.cy, 0) * 10),
    Math.round(toNum(shape.rx, 0) * 10),
    Math.round(toNum(shape.ry, 0) * 10),
    Math.round(toNum(shape.deltaElev, 0) * 10),
    Math.round(toNum(shape.widthLeft, 0) * 10),
    Math.round(toNum(shape.widthRight, 0) * 10),
    Math.round(toNum(shape.focusX, 0) * 100),
    Math.round(toNum(shape.focusY, 0) * 100)
  ].join(':');
}

function hashPolyObjectsLight(list, extraOf) {
  const arr = Array.isArray(list) ? list : [];
  let out = `${arr.length}`;
  for (let i = 0; i < arr.length; i += 1) {
    const item = arr[i];
    if (!item) continue;
    const pts = Array.isArray(item.points) ? item.points
      : (Array.isArray(item.centerline) ? item.centerline : []);
    out += `|${item.id}:${hashPointsLight(pts)}:${extraOf ? extraOf(item) : ''}`;
  }
  return out;
}

function projectSignature(p) {
  const zones = Array.isArray(p.zones) ? p.zones : [];
  const parts = [`w${toNum(p.meta && p.meta.worldSizeM, 2400)}`, `z${zones.length}`];
  for (let i = 0; i < zones.length; i += 1) {
    const z = zones[i];
    if (!z) continue;
    parts.push(`${z.id}:${z.contentType}:${z.seed}:${z.locked === true ? 1 : 0}:` +
      `${toNum(z.maxSlopeDeg, 24)}:${toNum(z.density, 0.7)}:${toNum(z.streetWidthM, 6)}:` +
      `${toNum(z.wallThicknessM, 4)}:${toNum(z.towerIntervalM, 110)}:` +
      `${hashPointsLight(Array.isArray(z.points) ? z.points : [])}`);
  }
  parts.push('r' + hashPolyObjectsLight(p.rivers, (it) =>
    `${toNum(it.widthStartM, 28)}:${toNum(it.widthEndM, 46)}:${toNum(it.carveDepthM, 6)}:${toNum(it.rippleLines, 3)}`));
  parts.push('b' + hashPolyObjectsLight(p.waterBodies, (it) => `${toNum(it.rippleLines, 3)}`));
  parts.push('c' + hashPolyObjectsLight(p.canals, (it) => `${toNum(it.widthM, 6)}:${it.style || 'open'}`));
  parts.push('d' + hashPolyObjectsLight(p.roads, (it) => `${toNum(it.widthM, 9)}:${it.tier || 'street'}`));
  const fords = Array.isArray(p.fords) ? p.fords : [];
  parts.push('f' + fords.map((f) => `${f.id}:${Math.round(toNum(f.x, 0) * 10)}:` +
    `${Math.round(toNum(f.y, 0) * 10)}:${toNum(f.radiusM, 24)}`).join(','));
  const terrain = (p.terrain && typeof p.terrain === 'object') ? p.terrain : {};
  const shapes = Array.isArray(terrain.shapes) ? terrain.shapes : [];
  parts.push('t' + [
    Math.round(toNum(terrain.baseElev, 450)),
    Math.round(toNum(terrain.slopeMagM, 18) * 10),
    Math.round(toNum(terrain.slopeDirDeg, 315)),
    toNum(terrain.contourStep, 5),
    toNum(terrain.minContourElev, -500),
    toNum(terrain.maxContourElev, 6000),
    String(terrain.sculptDeltaB64 || '').length,
    shapes.map(hashShapeLight).join(',')
  ].join(':'));
  return parts.join('|');
}

function rememberScene(project, results, ctx, terrainData, hydroRoadData) {
  if (!project || typeof project !== 'object') return;
  sceneCache.set(project, {
    signature: projectSignature(project),
    results,
    ctx,
    terrainData,
    hydro: hydroRoadData
  });
}

function treeFootprint(tree) {
  const r = Math.max(1.5, toNum(tree && tree.r, 4));
  return [
    [tree.x - r, tree.y - r],
    [tree.x + r, tree.y - r],
    [tree.x + r, tree.y + r],
    [tree.x - r, tree.y + r]
  ];
}

/* ------------------------------------------------------------------------------------------------
 * 十六、独立审计器 verifyZeroCollisions
 * ---------------------------------------------------------------------------------------------- */

export function verifyZeroCollisions(project, terrainData, hydroRoadData, zonesData) {
  const p = (project && typeof project === 'object') ? project : {};
  const hydro = (hydroRoadData && typeof hydroRoadData === 'object')
    ? hydroRoadData
    : buildHydroRoadPackage(p, terrainData);
  const zoneList = Array.isArray(zonesData)
    ? zonesData
    : (zonesData && Array.isArray(zonesData.zones) ? zonesData.zones : []);

  const report = {
    passed: true,
    totalHits: 0,
    buildingRoadHits: 0,
    buildingWaterHits: 0,
    buildingWallHits: 0,
    buildingBuildingHits: 0,
    buildingExclusionHits: 0,
    riverIslands: 0,
    details: []
  };

  const rivers = Array.isArray(hydro.rivers) ? hydro.rivers : [];
  const waterBodies = Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [];
  const canals = Array.isArray(hydro.canals) ? hydro.canals : [];
  const roads = Array.isArray(hydro.roads) ? hydro.roads : [];

  let islandCount = 0;
  for (let i = 0; i < rivers.length; i += 1) {
    islandCount += Array.isArray(rivers[i].islands) ? rivers[i].islands.length : 0;
  }
  report.riverIslands = islandCount;

  const exclusionPolys = [];
  for (let i = 0; i < zoneList.length; i += 1) {
    const z = zoneList[i];
    if (!z) continue;
    if (z.contentType === 'exclusion' && Array.isArray(z.points)) {
      exclusionPolys.push(z.points);
    }
  }

  const walls = [];
  const buildings = [];
  for (let i = 0; i < zoneList.length; i += 1) {
    const z = zoneList[i];
    if (!z) continue;
    if (Array.isArray(z.walls)) {
      for (let k = 0; k < z.walls.length; k += 1) {
        const w = z.walls[k];
        if (w && Array.isArray(w.polyline)) {
          walls.push({ thicknessM: toNum(w.thicknessM, 5), polyline: w.polyline });
        }
      }
    }
    if (Array.isArray(z.buildings)) {
      for (let k = 0; k < z.buildings.length; k += 1) {
        const b = z.buildings[k];
        if (b && Array.isArray(b.points) && b.points.length >= 3) buildings.push(b);
      }
    }
  }

  const hash = new SpatialHash(toNum(p.meta && p.meta.worldSizeM, 2400), 32);
  for (let i = 0; i < buildings.length; i += 1) hash.insert(buildings[i].points, buildings[i]);

  const addDetail = (type, building, extra) => {
    if (report.details.length >= 64) return;
    report.details.push({
      type,
      buildingId: building.id,
      zoneId: building.zoneId,
      ...extra
    });
  };

  for (let bi = 0; bi < buildings.length; bi += 1) {
    const b = buildings[bi];
    const poly = b.points;
    const testPts = poly.slice();
    testPts.push(computePolygonCentroid(poly));
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const c = poly[(i + 1) % poly.length];
      testPts.push([0.5 * (a[0] + c[0]), 0.5 * (a[1] + c[1])]);
    }

    let waterHit = false;
    for (let i = 0; i < rivers.length && !waterHit; i += 1) {
      const riv = rivers[i];
      const bank = riv.bankPolygon;
      if (!Array.isArray(bank) || bank.length < 3) continue;
      for (let k = 0; k < testPts.length; k += 1) {
        if (pointInPolygon(testPts[k][0], testPts[k][1], bank)) {
          waterHit = true;
          break;
        }
      }
      if (!waterHit && minDistPolyToPoly(poly, bank, 8) < 8 - 1e-6) waterHit = true;
    }
    for (let i = 0; i < waterBodies.length && !waterHit; i += 1) {
      const wb = waterBodies[i];
      const shore = wb.shorePoly;
      if (!Array.isArray(shore) || shore.length < 3) continue;
      for (let k = 0; k < testPts.length; k += 1) {
        if (pointInPolygon(testPts[k][0], testPts[k][1], shore)) {
          waterHit = true;
          break;
        }
      }
      if (!waterHit && minDistPolyToPoly(poly, shore, 8) < 8 - 1e-6) waterHit = true;
    }
    for (let i = 0; i < canals.length && !waterHit; i += 1) {
      const canal = canals[i];
      if (!Array.isArray(canal.centerline)) continue;
      const req = 0.5 * toNum(canal.widthM, 6) + 4.0;
      if (minDistPolyToPolyline(poly, canal.centerline, req) < req - 1e-6) waterHit = true;
    }
    if (waterHit) {
      report.buildingWaterHits += 1;
      addDetail('water', b);
    }

    let roadHit = false;
    for (let i = 0; i < roads.length && !roadHit; i += 1) {
      const road = roads[i];
      if (!Array.isArray(road.centerline)) continue;
      const req = 0.5 * toNum(road.widthM, 9) + 2.5;
      if (minDistPolyToPolyline(poly, road.centerline, req) < req - 1e-6) roadHit = true;
    }
    if (roadHit) {
      report.buildingRoadHits += 1;
      addDetail('road', b);
    }

    let wallHit = false;
    for (let i = 0; i < walls.length && !wallHit; i += 1) {
      const wall = walls[i];
      const req = 0.5 * wall.thicknessM + 3.0;
      if (minDistPolyToPolyline(poly, wall.polyline, req) < req - 1e-6) wallHit = true;
    }
    if (wallHit) {
      report.buildingWallHits += 1;
      addDetail('wall', b);
    }

    let exclusionHit = false;
    for (let i = 0; i < exclusionPolys.length && !exclusionHit; i += 1) {
      const ex = exclusionPolys[i];
      if (!Array.isArray(ex) || ex.length < 3) continue;
      for (let k = 0; k < testPts.length; k += 1) {
        if (pointInPolygon(testPts[k][0], testPts[k][1], ex)) {
          exclusionHit = true;
          break;
        }
      }
      if (!exclusionHit && minDistPolyToPoly(poly, ex, 2) < 2 - 1e-6) exclusionHit = true;
    }
    if (exclusionHit) {
      report.buildingExclusionHits += 1;
      addDetail('exclusion', b);
    }

    const nearby = hash.queryPolygonBBox(poly, 4.0);
    let buildingHit = false;
    for (let i = 0; i < nearby.length; i += 1) {
      const other = nearby[i];
      if (!other || other === b || !Array.isArray(other.points)) continue;
      if (other.id === b.id) continue;
      if (polygonsOverlapOrTooClose(poly, other.points, 0.8)) {
        buildingHit = true;
        break;
      }
    }
    if (buildingHit) {
      report.buildingBuildingHits += 1;
      addDetail('building', b);
    }
  }

  report.totalHits = report.buildingRoadHits + report.buildingWaterHits +
    report.buildingWallHits + report.buildingBuildingHits + report.buildingExclusionHits;
  report.passed = report.totalHits === 0 && report.riverIslands === 0;
  return report;
}

/* ------------------------------------------------------------------------------------------------
 * 十七、全场景联动编译
 * ---------------------------------------------------------------------------------------------- */

export function compileSettlementScene(project) {
  const t0 = nowMs();
  const p = (project && typeof project === 'object') ? project : {};
  const terrainPkg = buildTerrainPackage(p);
  const terrainData = terrainPkg.terrainData;
  const hydro = buildHydroRoadPackage(p, terrainData);
  const agg = compileAllZones(p, terrainData, hydro);
  const report = verifyZeroCollisions(p, terrainData, hydro, agg.zones);
  const t1 = nowMs();
  const buildings = agg.buildings;
  const scene = {
    schemaVersion: '1.2.0',
    worldSizeM: toNum(p.meta && p.meta.worldSizeM, 2400),
    terrain: {
      terrainData,
      contours: terrainPkg.contours,
      scarpTicks: terrainPkg.scarpTicks,
      stats: terrainPkg.stats
    },
    hydro,
    zones: agg.zones,
    buildings,
    walls: agg.walls,
    trees: agg.trees,
    farmlandPlots: agg.farmlandPlots,
    saltpanCells: agg.saltpanCells,
    marketAprons: agg.marketAprons,
    lanes: agg.lanes,
    gardenFences: agg.gardenFences,
    internalStreets: agg.internalStreets,
    wells: agg.wells,
    exclusionPolys: agg.exclusionPolys,
    collisionReport: report,
    legend: p.legend,
    stats: {
      compileMs: t1 - t0,
      zoneCount: agg.zones.length,
      buildingCount: buildings.length,
      wallCount: agg.walls.length,
      treeCount: agg.trees.length,
      bridgeCount: hydro.bridges.length,
      fordCrossingCount: hydro.fordCrossings.length,
      contourCount: terrainPkg.contours.length,
      scarpTickCount: terrainPkg.scarpTicks.length,
      riverIslandCount: hydro.riverIslandCount,
      collisionHits: report.totalHits
    }
  };
  syncLegendWithProject(p, scene);
  scene.legend = p.legend;
  return scene;
}

/* ------------------------------------------------------------------------------------------------
 * 十八、单选区秒级重抽
 * ---------------------------------------------------------------------------------------------- */

let rerollCounter = 0;

export function rerollZoneSeed(project, zoneId) {
  const t0 = nowMs();
  const p = (project && typeof project === 'object') ? project : {};
  const zones = Array.isArray(p.zones) ? p.zones : [];
  let zone = null;
  for (let i = 0; i < zones.length; i += 1) {
    if (zones[i] && zones[i].id === zoneId) {
      zone = zones[i];
      break;
    }
  }
  if (!zone) {
    return { zoneId, seed: null, zone: null, elapsedMs: nowMs() - t0, found: false };
  }

  // 签名必须在改 seed 之前取，用于判断缓存是否对应当前工程状态
  const signatureBefore = projectSignature(p);
  rerollCounter += 1;
  const nextSeed = hashSeed(`${zone.id}:${zone.seed}:${rerollCounter}`);
  zone.seed = nextSeed >>> 0;

  const cached = sceneCache.get(p);
  const cacheUsable = !!(cached && cached.signature === signatureBefore && cached.ctx && cached.ctx.grid);

  if (cacheUsable) {
    const terrainData = cached.terrainData || buildElevationField(p);
    const hydro = cached.hydro || buildHydroRoadPackage(p, terrainData);
    const ctx = createObstacleContext(p, terrainData, hydro, { withGrid: false });
    // 复用完整障碍场（含全部城垣）与其余选区的建筑 / 树木 / 城垣上下文
    ctx.grid = cached.ctx.grid;
    for (let i = 0; i < cached.results.length; i += 1) {
      const other = cached.results[i];
      if (!other || other.id === zoneId) continue;
      for (let b = 0; b < other.buildings.length; b += 1) {
        const building = other.buildings[b];
        if (building && Array.isArray(building.points)) {
          ctx.spatialHash.insert(building.points, building);
        }
      }
      for (let t = 0; t < other.trees.length; t += 1) {
        const tree = other.trees[t];
        if (!tree) continue;
        const foot = treeFootprint(tree);
        ctx.spatialHash.insert(foot, { points: foot, isTree: true, x: tree.x, y: tree.y });
      }
      for (let w = 0; w < other.walls.length; w += 1) {
        const wall = other.walls[w];
        if (wall) ctx.wallsBuilt.push({ id: wall.id, thicknessM: wall.thicknessM, polyline: wall.polyline });
      }
    }

    const type = ZONE_CONTENT_TYPES.indexOf(zone.contentType) >= 0 ? zone.contentType : 'town_blocks';
    let zoneResult;
    if (type === 'walled_city' || type === 'citadel') {
      zoneResult = compileSingleZone(zone, p, terrainData, hydro, ctx, { phase: 'walls' });
      zoneResult = compileSingleZone(zone, p, terrainData, hydro, ctx, { phase: 'content', result: zoneResult });
    } else {
      zoneResult = compileSingleZone(zone, p, terrainData, hydro, ctx, { phase: 'content' });
    }

    const nextResults = cached.results.map((r) => (r && r.id === zoneId ? zoneResult : r));
    rememberScene(p, nextResults, ctx, terrainData, hydro);

    return {
      zoneId,
      seed: zone.seed,
      zone: zoneResult,
      elapsedMs: nowMs() - t0,
      found: true
    };
  }

  // 冷路径：没有可用缓存时，先做一次完整两阶段编译（含邻区上下文），再取目标选区结果
  const terrainData = buildElevationField(p);
  const hydro = buildHydroRoadPackage(p, terrainData);
  const agg = compileAllZones(p, terrainData, hydro);
  let zoneResult = null;
  for (let i = 0; i < agg.zones.length; i += 1) {
    if (agg.zones[i] && agg.zones[i].id === zoneId) {
      zoneResult = agg.zones[i];
      break;
    }
  }
  return {
    zoneId,
    seed: zone.seed,
    zone: zoneResult,
    elapsedMs: nowMs() - t0,
    found: true
  };
}
