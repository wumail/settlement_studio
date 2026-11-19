/**
 * Terrax Settlement Studio — M1 高程场与等高线内核
 * 文件：web/js/terrain_engine.js
 *
 * 实现内容：
 *   1. 257×257 Float32Array 五项高程合成（基准高 + 背景斜坡 + 地形图元 + 手工微雕增量 − 河床下切）；
 *   2. 双线性海拔采样、中心差分梯度与坡度角；
 *   3. 非对称山包/盆地偏心射线有效半径核（双二次平滑，峰值与坡脚一阶导数恒为 0）；
 *   4. 山脊 / 冲沟 / 河阶陡坎左右独立坡宽与纵向端部柔化；
 *   5. 16 状态 + 鞍点渐近中心消歧的 Marching Squares、网格边键哈希无缝拼接与保拓扑柔顺滤波；
 *   6. 可选标准测绘陡坎短齿线（默认关闭，4.0 m 下坡垂直细线，彻底禁画蝌蚪尖刺纹）；
 *   7. 等高线命中拾取、路径子步 + 梯度自适应限幅 + 零边界跳变高斯核直接推拉；
 *   8. 四支高程涂抹笔刷（刷高 / 刷低 / 平滑刷疏 / 定高台地）。
 *
 * 无头铁律：本模块零 DOM 依赖，可在纯 Node.js 环境直接 import。
 */

import {
  GRID_N,
  encodeSculptDelta,
  decodeSculptDelta
} from './state_and_schema.js';

const GRID_POINT_COUNT = GRID_N * GRID_N;
const HALF_PI = Math.PI * 0.5;

/* ------------------------------------------------------------------------------------------------
 * 内部通用工具
 * ---------------------------------------------------------------------------------------------- */

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * 内部 Catmull-Rom 样条（张力 0.5）。与 hydro_road_engine.sampleCatmullRom 数学完全一致；
 * 因 terrain 位于依赖链上游，此处独立实现以避免 M1 → M2 的反向 import。
 */
function catmullRom(points, samplesPerSeg, closed) {
  if (Array.isArray(points) === false || points.length < 2) {
    return Array.isArray(points) ? points.map((p) => [p[0], p[1]]) : [];
  }
  if (points.length === 2 && closed === false) {
    return [[points[0][0], points[0][1]], [points[1][0], points[1][1]]];
  }
  const n = points.length;
  const getPt = (idx) => {
    if (closed) {
      const k = ((idx % n) + n) % n;
      return points[k];
    }
    if (idx < 0) {
      return [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]];
    }
    if (idx >= n) {
      return [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]];
    }
    return points[idx];
  };

  const out = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i += 1) {
    const p0 = getPt(i - 1);
    const p1 = getPt(i);
    const p2 = getPt(i + 1);
    const p3 = getPt(i + 2);
    const steps = Math.max(2, samplesPerSeg);
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1[0]) +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
      );
      const y = 0.5 * (
        (2 * p1[1]) +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
      );
      out.push([x, y]);
    }
  }
  if (closed === false) {
    out.push([points[n - 1][0], points[n - 1][1]]);
  }
  return out;
}

function computeCumulative(poly) {
  const cum = new Float64Array(poly.length);
  let acc = 0;
  for (let i = 1; i < poly.length; i += 1) {
    acc += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    cum[i] = acc;
  }
  return { cum, total: Math.max(acc, 1e-9) };
}

function closestOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) {
    return { t: 0, x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) };
  }
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = clamp(t, 0, 1);
  const x = ax + t * vx;
  const y = ay + t * vy;
  return { t, x, y, dist: Math.hypot(px - x, py - y) };
}

/* ------------------------------------------------------------------------------------------------
 * 折线图元（山脊 / 冲沟 / 陡坎）平滑折线缓存
 * ---------------------------------------------------------------------------------------------- */

const shapePolyCache = new WeakMap();

/**
 * 为折线图元建立「线段桶索引」：以 max(widthLeft, widthRight)/2 为格距，
 * 把每条线段登记进其包围盒外扩 maxW 覆盖的全部格子。查询时只复核所在格的少量线段，
 * 与逐段全局扫描结果完全等价（超出 maxW 的线段贡献恒为 0），但把 66049 格网合成从
 * O(格数 × 段数) 降为 O(格数 × 邻域段数)。
 */
function buildShapeSegmentIndex(poly, maxW) {
  const cellSize = Math.max(24, maxW * 0.5);
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
  const x0 = minX - maxW - cellSize;
  const y0 = minY - maxW - cellSize;
  const cols = Math.max(1, Math.ceil((maxX + maxW + cellSize - x0) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((maxY + maxW + cellSize - y0) / cellSize) + 1);
  const buckets = new Array(cols * rows);
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    const bx0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - maxW - x0) / cellSize));
    const bx1 = Math.min(cols - 1, Math.floor((Math.max(a[0], b[0]) + maxW - x0) / cellSize));
    const by0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - maxW - y0) / cellSize));
    const by1 = Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) + maxW - y0) / cellSize));
    for (let cy = by0; cy <= by1; cy += 1) {
      for (let cx = bx0; cx <= bx1; cx += 1) {
        const key = cy * cols + cx;
        let bucket = buckets[key];
        if (!bucket) {
          bucket = [];
          buckets[key] = bucket;
        }
        bucket.push(i);
      }
    }
  }
  return { cellSize, x0, y0, cols, rows, buckets };
}

function getShapePolyline(shape) {
  const points = Array.isArray(shape.points) ? shape.points : [];
  const srcRef = shape.points;
  let cached = shapePolyCache.get(shape);
  if (cached && cached.srcRef === srcRef && cached.srcLen === points.length) {
    return cached;
  }
  const poly = catmullRom(points, 8, false);
  const cumulative = computeCumulative(poly);
  const maxW = Math.max(
    20,
    Math.max(toNum(shape.widthLeft, 120), toNum(shape.widthRight, 120))
  );
  const index = buildShapeSegmentIndex(poly, maxW);
  cached = {
    srcRef,
    srcLen: points.length,
    poly,
    cum: cumulative.cum,
    total: cumulative.total,
    maxW,
    index
  };
  shapePolyCache.set(shape, cached);
  return cached;
}

/* ------------------------------------------------------------------------------------------------
 * 一、地形图元求值
 * ---------------------------------------------------------------------------------------------- */

function evalHillOrBasin(shape, wx, wy) {
  const rx = Math.max(25, toNum(shape.rx, 200));
  const ry = Math.max(25, toNum(shape.ry, 200));
  const rad = (toNum(shape.angleDeg, 0) * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const dx = wx - toNum(shape.cx, 0);
  const dy = wy - toNum(shape.cy, 0);
  const u = (dx * cosA + dy * sinA) / rx;
  const v = (-dx * sinA + dy * cosA) / ry;
  if (u * u + v * v >= 1.0) {
    return 0.0;
  }

  let fu = toNum(shape.focusX, 0);
  let fv = toNum(shape.focusY, 0);
  const fNorm = Math.hypot(fu, fv);
  if (fNorm > 0.72) {
    fu = (fu * 0.72) / fNorm;
    fv = (fv * 0.72) / fNorm;
  }

  const du = u - fu;
  const dv = v - fv;
  const d = Math.hypot(du, dv);
  const deltaElev = toNum(shape.deltaElev, 0);
  if (d < 1e-8) {
    return deltaElev;
  }
  const dirU = du / d;
  const dirV = dv / d;
  const b = fu * dirU + fv * dirV;
  const c = 1.0 - (fu * fu + fv * fv);
  const rEff = -b + Math.sqrt(Math.max(1e-9, b * b + c));

  const q = Math.min(1.0, d / Math.max(rEff, 1e-6));
  const oneMinusQ2 = 1.0 - q * q;
  return deltaElev * oneMinusQ2 * oneMinusQ2;
}

function evalPolylineShape(shape, wx, wy) {
  const cache = getShapePolyline(shape);
  const poly = cache.poly;
  if (poly.length < 2) {
    return 0;
  }
  const idx = cache.index;
  const ix = Math.floor((wx - idx.x0) / idx.cellSize);
  const iy = Math.floor((wy - idx.y0) / idx.cellSize);
  if (ix < 0 || iy < 0 || ix >= idx.cols || iy >= idx.rows) {
    return 0;
  }
  const bucket = idx.buckets[iy * idx.cols + ix];
  if (!bucket || bucket.length === 0) {
    return 0;
  }

  let bestDist = Infinity;
  let bestX = poly[0][0];
  let bestY = poly[0][1];
  let bestTx = 1;
  let bestTy = 0;
  let bestS = 0;

  for (let bi = 0; bi < bucket.length; bi += 1) {
    const i = bucket[bi];
    const a = poly[i];
    const b = poly[i + 1];
    const hit = closestOnSegment(wx, wy, a[0], a[1], b[0], b[1]);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      bestX = hit.x;
      bestY = hit.y;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen > 1e-9) {
        bestTx = (b[0] - a[0]) / segLen;
        bestTy = (b[1] - a[1]) / segLen;
      } else {
        bestTx = 1;
        bestTy = 0;
      }
      bestS = (cache.cum[i] + hit.t * segLen) / cache.total;
    }
  }

  if (bestDist === Infinity) {
    return 0;
  }

  const edgeS = Math.min(bestS, 1.0 - bestS);
  let endTaper = 1.0;
  if (edgeS < 0.12) {
    const tt = Math.max(0, edgeS) / 0.12;
    endTaper = tt * tt * (3 - 2 * tt);
  }

  const sideProj = (wx - bestX) * bestTy - (wy - bestY) * bestTx;
  const deltaElev = toNum(shape.deltaElev, 0);
  const widthLeft = Math.max(20, toNum(shape.widthLeft, 120));
  const widthRight = Math.max(20, toNum(shape.widthRight, 120));
  const type = shape.type;

  if (type === 'ridge' || type === 'valley') {
    const wSide = sideProj >= 0 ? widthLeft : widthRight;
    if (bestDist >= wSide) return 0;
    const q = bestDist / wSide;
    const oneMinusQ2 = 1.0 - q * q;
    return deltaElev * endTaper * oneMinusQ2 * oneMinusQ2;
  }

  if (type === 'scarp') {
    if (sideProj < 0) {
      if (bestDist >= widthRight) return 0;
      const u = 1.0 - bestDist / widthRight;
      return deltaElev * endTaper * (u * u * (3 - 2 * u));
    }
    if (bestDist <= 0.7 * widthLeft) {
      return deltaElev * endTaper;
    }
    if (bestDist >= widthLeft) return 0;
    const qb = (bestDist - 0.7 * widthLeft) / Math.max(1e-6, 0.3 * widthLeft);
    const oneMinusQb2 = 1.0 - qb * qb;
    return deltaElev * endTaper * oneMinusQb2 * oneMinusQb2;
  }

  return 0;
}

export function evalTerrainShape(shape, wx, wy) {
  if (!shape || typeof shape !== 'object') return 0;
  const type = shape.type;
  if (type === 'hill' || type === 'basin') {
    return evalHillOrBasin(shape, wx, wy);
  }
  if (type === 'ridge' || type === 'valley' || type === 'scarp') {
    if (!Array.isArray(shape.points) || shape.points.length < 2) return 0;
    return evalPolylineShape(shape, wx, wy);
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------------
 * 二、河床下切
 * ---------------------------------------------------------------------------------------------- */

const riverPolyCache = new WeakMap();

function getRiverCarveGeometry(river) {
  const srcRef = river.points;
  const srcLen = Array.isArray(river.points) ? river.points.length : 0;
  let cached = riverPolyCache.get(river);
  if (cached && cached.srcRef === srcRef && cached.srcLen === srcLen) {
    return cached;
  }
  const poly = catmullRom(Array.isArray(river.points) ? river.points : [], 14, false);
  const cumulative = computeCumulative(poly);
  const wStart = Math.max(6, toNum(river.widthStartM, 28));
  const wEnd = Math.max(6, toNum(river.widthEndM, 46));
  cached = {
    srcRef,
    srcLen,
    poly,
    cum: cumulative.cum,
    total: cumulative.total,
    wStart,
    wEnd,
    carveDepth: Math.max(0, toNum(river.carveDepthM, 6))
  };
  riverPolyCache.set(river, cached);
  return cached;
}

function carveAtPoint(geom, wx, wy) {
  const poly = geom.poly;
  if (poly.length < 2) return 0;
  let bestDist = Infinity;
  let bestT = 0;
  let bestIdx = 0;
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    const hit = closestOnSegment(wx, wy, a[0], a[1], b[0], b[1]);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      bestIdx = i;
      bestT = hit.t;
    }
  }
  const segLen = Math.hypot(
    poly[bestIdx + 1][0] - poly[bestIdx][0],
    poly[bestIdx + 1][1] - poly[bestIdx][1]
  );
  const along = (geom.cum[bestIdx] + bestT * segLen) / geom.total;
  const halfW = 0.5 * (geom.wStart + (geom.wEnd - geom.wStart) * clamp(along, 0, 1));
  const carveRadius = halfW * 2.2;
  if (bestDist >= carveRadius) return 0;
  const q = bestDist / carveRadius;
  const oneMinusQ2 = 1.0 - q * q;
  return geom.carveDepth * oneMinusQ2 * oneMinusQ2;
}

export function evalRiverCarve(rivers, wx, wy) {
  if (Array.isArray(rivers) === false || rivers.length === 0) return 0;
  let depth = 0;
  for (let i = 0; i < rivers.length; i += 1) {
    const riv = rivers[i];
    if (!riv || !Array.isArray(riv.points) || riv.points.length < 2) continue;
    const geom = getRiverCarveGeometry(riv);
    const d = carveAtPoint(geom, wx, wy);
    if (d > depth) depth = d;
  }
  return depth;
}

/* ------------------------------------------------------------------------------------------------
 * 三、257×257 高程场合成
 * ---------------------------------------------------------------------------------------------- */

function shapeBBox(shape) {
  if (shape.type === 'hill' || shape.type === 'basin') {
    const rx = Math.max(25, toNum(shape.rx, 200));
    const ry = Math.max(25, toNum(shape.ry, 200));
    const r = Math.hypot(rx, ry);
    return [
      toNum(shape.cx, 0) - r,
      toNum(shape.cy, 0) - r,
      toNum(shape.cx, 0) + r,
      toNum(shape.cy, 0) + r
    ];
  }
  const pts = Array.isArray(shape.points) ? shape.points : [];
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    minX = Math.min(minX, pts[i][0]);
    minY = Math.min(minY, pts[i][1]);
    maxX = Math.max(maxX, pts[i][0]);
    maxY = Math.max(maxY, pts[i][1]);
  }
  const w = Math.max(
    Math.max(20, toNum(shape.widthLeft, 120)),
    Math.max(20, toNum(shape.widthRight, 120))
  );
  return [minX - w, minY - w, maxX + w, maxY + w];
}

export function buildElevationField(project) {
  const p = (project && typeof project === 'object') ? project : {};
  const meta = (p.meta && typeof p.meta === 'object') ? p.meta : {};
  const terrain = (p.terrain && typeof p.terrain === 'object') ? p.terrain : {};
  const worldSizeM = clamp(toNum(meta.worldSizeM, 2400), 600, 8000);
  const cellSizeM = worldSizeM / (GRID_N - 1);
  const baseElev = clamp(toNum(terrain.baseElev, 450), -200, 6000);
  const slopeMagM = clamp(toNum(terrain.slopeMagM, 18), 0, 800);
  const slopeDirDeg = toNum(terrain.slopeDirDeg, 315);

  const elevation = new Float32Array(GRID_POINT_COUNT);
  const half = worldSizeM * 0.5;
  const rad = (slopeDirDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const invWorld = 1 / Math.max(worldSizeM, 1);

  for (let gy = 0; gy < GRID_N; gy += 1) {
    const wy = gy * cellSizeM;
    const rowBase = gy * GRID_N;
    const dyC = wy - half;
    for (let gx = 0; gx < GRID_N; gx += 1) {
      const wx = gx * cellSizeM;
      const proj = ((wx - half) * ux + dyC * uy) * invWorld;
      elevation[rowBase + gx] = baseElev - slopeMagM * proj;
    }
  }

  const shapes = Array.isArray(terrain.shapes) ? terrain.shapes : [];
  for (let s = 0; s < shapes.length; s += 1) {
    const shape = shapes[s];
    if (!shape || typeof shape !== 'object') continue;
    const bbox = shapeBBox(shape);
    if (!bbox) continue;
    const gxMin = Math.max(0, Math.floor(bbox[0] / cellSizeM));
    const gyMin = Math.max(0, Math.floor(bbox[1] / cellSizeM));
    const gxMax = Math.min(GRID_N - 1, Math.ceil(bbox[2] / cellSizeM));
    const gyMax = Math.min(GRID_N - 1, Math.ceil(bbox[3] / cellSizeM));
    for (let gy = gyMin; gy <= gyMax; gy += 1) {
      const wy = gy * cellSizeM;
      const rowBase = gy * GRID_N;
      for (let gx = gxMin; gx <= gxMax; gx += 1) {
        const wx = gx * cellSizeM;
        const value = evalTerrainShape(shape, wx, wy);
        if (value !== 0) {
          elevation[rowBase + gx] += value;
        }
      }
    }
  }

  const sculptDelta = decodeSculptDelta(terrain.sculptDeltaB64, GRID_POINT_COUNT);
  for (let i = 0; i < GRID_POINT_COUNT; i += 1) {
    const d = sculptDelta[i];
    if (d !== 0) {
      elevation[i] += d;
    }
  }

  const rivers = Array.isArray(p.rivers) ? p.rivers : [];
  const carveField = new Float32Array(GRID_POINT_COUNT);
  for (let r = 0; r < rivers.length; r += 1) {
    const riv = rivers[r];
    if (!riv || !Array.isArray(riv.points) || riv.points.length < 2) continue;
    const geom = getRiverCarveGeometry(riv);
    const poly = geom.poly;
    const carveDepth = geom.carveDepth;
    if (carveDepth <= 0) continue;
    for (let i = 0; i + 1 < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[i + 1];
      const uA = geom.cum[i] / geom.total;
      const uB = geom.cum[i + 1] / geom.total;
      const halfA = 0.5 * (geom.wStart + (geom.wEnd - geom.wStart) * clamp(uA, 0, 1));
      const halfB = 0.5 * (geom.wStart + (geom.wEnd - geom.wStart) * clamp(uB, 0, 1));
      const radiusA = halfA * 2.2;
      const radiusB = halfB * 2.2;
      const radiusMax = Math.max(radiusA, radiusB);
      const segMinX = Math.min(a[0], b[0]) - radiusMax;
      const segMaxX = Math.max(a[0], b[0]) + radiusMax;
      const segMinY = Math.min(a[1], b[1]) - radiusMax;
      const segMaxY = Math.max(a[1], b[1]) + radiusMax;
      const gxMin = Math.max(0, Math.floor(segMinX / cellSizeM));
      const gxMax = Math.min(GRID_N - 1, Math.ceil(segMaxX / cellSizeM));
      const gyMin = Math.max(0, Math.floor(segMinY / cellSizeM));
      const gyMax = Math.min(GRID_N - 1, Math.ceil(segMaxY / cellSizeM));
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const len2 = vx * vx + vy * vy;
      if (len2 < 1e-12) continue;
      for (let gy = gyMin; gy <= gyMax; gy += 1) {
        const wy = gy * cellSizeM;
        const rowBase = gy * GRID_N;
        for (let gx = gxMin; gx <= gxMax; gx += 1) {
          const wx = gx * cellSizeM;
          let t = ((wx - a[0]) * vx + (wy - a[1]) * vy) / len2;
          t = clamp(t, 0, 1);
          const cxp = a[0] + t * vx;
          const cyp = a[1] + t * vy;
          const dist = Math.hypot(wx - cxp, wy - cyp);
          if (dist <= 0) {
            const idx0 = rowBase + gx;
            if (carveDepth > carveField[idx0]) carveField[idx0] = carveDepth;
            continue;
          }
          const halfW = halfA + (halfB - halfA) * t;
          const carveRadius = halfW * 2.2;
          if (dist >= carveRadius) continue;
          const q = dist / carveRadius;
          const oneMinusQ2 = 1.0 - q * q;
          const depth = carveDepth * oneMinusQ2 * oneMinusQ2;
          const idx = rowBase + gx;
          if (depth > carveField[idx]) carveField[idx] = depth;
        }
      }
    }
  }

  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < GRID_POINT_COUNT; i += 1) {
    const v = elevation[i] - carveField[i];
    elevation[i] = v;
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }

  return {
    gridN: GRID_N,
    worldSizeM,
    cellSizeM,
    elevation,
    sculptDelta,
    hMin: Number.isFinite(hMin) ? hMin : baseElev,
    hMax: Number.isFinite(hMax) ? hMax : baseElev,
    baseElev,
    slopeMagM,
    slopeDirDeg
  };
}

/* ------------------------------------------------------------------------------------------------
 * 四、采样：双线性海拔、中心差分梯度、坡度角
 * ---------------------------------------------------------------------------------------------- */

export function sampleElevation(terrainData, wx, wy) {
  if (!terrainData || !terrainData.elevation) return 0;
  const n = terrainData.gridN || GRID_N;
  const cell = terrainData.cellSizeM || 1;
  const H = terrainData.elevation;
  let fx = toNum(wx, 0) / cell;
  let fy = toNum(wy, 0) / cell;
  fx = clamp(fx, 0, n - 1);
  fy = clamp(fy, 0, n - 1);
  let gx0 = Math.floor(fx);
  let gy0 = Math.floor(fy);
  if (gx0 > n - 1) gx0 = n - 1;
  if (gy0 > n - 1) gy0 = n - 1;
  const gx1 = gx0 + 1 <= n - 1 ? gx0 + 1 : n - 1;
  const gy1 = gy0 + 1 <= n - 1 ? gy0 + 1 : n - 1;
  const tx = fx - gx0;
  const ty = fy - gy0;
  const row0 = gy0 * n;
  const row1 = gy1 * n;
  const v00 = H[row0 + gx0];
  const v10 = H[row0 + gx1];
  const v01 = H[row1 + gx0];
  const v11 = H[row1 + gx1];
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

export function sampleGradient(terrainData, wx, wy) {
  if (!terrainData || !terrainData.elevation) {
    return { dzdx: 0, dzdy: 0 };
  }
  const h = terrainData.cellSizeM || 1;
  const dzdx = (sampleElevation(terrainData, wx + h, wy) - sampleElevation(terrainData, wx - h, wy)) / (2 * h);
  const dzdy = (sampleElevation(terrainData, wx, wy + h) - sampleElevation(terrainData, wx, wy - h)) / (2 * h);
  return { dzdx, dzdy };
}

export function sampleSlopeDeg(terrainData, wx, wy) {
  const grad = sampleGradient(terrainData, wx, wy);
  return Math.atan(Math.hypot(grad.dzdx, grad.dzdy)) * (180 / Math.PI);
}

/* ------------------------------------------------------------------------------------------------
 * 五、Marching Squares 16 状态表（含鞍点中心均值消歧）
 * ---------------------------------------------------------------------------------------------- */

function marchingSegmentsForMask(mask, v0, v1, v2, v3, level) {
  if (mask === 0 || mask === 15) return [];
  if (mask === 1 || mask === 14) return [[3, 0]];
  if (mask === 2 || mask === 13) return [[0, 1]];
  if (mask === 3 || mask === 12) return [[3, 1]];
  if (mask === 4 || mask === 11) return [[1, 2]];
  if (mask === 6 || mask === 9) return [[0, 2]];
  if (mask === 7 || mask === 8) return [[3, 2]];
  const centerAvg = 0.25 * (v0 + v1 + v2 + v3);
  if (mask === 5) {
    return centerAvg >= level ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]];
  }
  if (mask === 10) {
    return centerAvg >= level ? [[3, 0], [1, 2]] : [[0, 1], [3, 2]];
  }
  return [];
}

function edgePoint(edge, gx, gy, cell, v0, v1, v2, v3, level) {
  const x0 = gx * cell;
  const y0 = gy * cell;
  const x1 = x0 + cell;
  const y1 = y0 + cell;
  if (edge === 0) {
    const t = clamp((level - v0) / ((v1 - v0) + 1e-9), 0, 1);
    return [x0 + t * cell, y0];
  }
  if (edge === 1) {
    const t = clamp((level - v1) / ((v2 - v1) + 1e-9), 0, 1);
    return [x1, y0 + t * cell];
  }
  if (edge === 2) {
    const t = clamp((level - v3) / ((v2 - v3) + 1e-9), 0, 1);
    return [x0 + t * cell, y1];
  }
  const t = clamp((level - v0) / ((v3 - v0) + 1e-9), 0, 1);
  return [x0, y0 + t * cell];
}

function edgeKeyName(edge, gx, gy) {
  if (edge === 0) return `H_${gx}_${gy}`;
  if (edge === 1) return `V_${gx + 1}_${gy}`;
  if (edge === 2) return `H_${gx}_${gy + 1}`;
  return `V_${gx}_${gy}`;
}

function buildLevelSegments(H, n, cell, level) {
  const segments = [];
  for (let gy = 0; gy < n - 1; gy += 1) {
    const row0 = gy * n;
    const row1 = row0 + n;
    for (let gx = 0; gx < n - 1; gx += 1) {
      const v0 = H[row0 + gx];
      const v1 = H[row0 + gx + 1];
      const v2 = H[row1 + gx + 1];
      const v3 = H[row1 + gx];
      const above0 = v0 >= level;
      const above1 = v1 >= level;
      const above2 = v2 >= level;
      const above3 = v3 >= level;
      if (above0 === above1 && above1 === above2 && above2 === above3) {
        continue;
      }
      const mask = (above0 ? 1 : 0) | (above1 ? 2 : 0) | (above2 ? 4 : 0) | (above3 ? 8 : 0);
      const pairs = marchingSegmentsForMask(mask, v0, v1, v2, v3, level);
      if (pairs.length === 0) continue;
      const cache = [null, null, null, null];
      for (let pi = 0; pi < pairs.length; pi += 1) {
        const pair = pairs[pi];
        const ea = pair[0];
        const eb = pair[1];
        if (cache[ea] === null) cache[ea] = edgePoint(ea, gx, gy, cell, v0, v1, v2, v3, level);
        if (cache[eb] === null) cache[eb] = edgePoint(eb, gx, gy, cell, v0, v1, v2, v3, level);
        segments.push({
          ka: edgeKeyName(ea, gx, gy),
          kb: edgeKeyName(eb, gx, gy),
          pa: cache[ea],
          pb: cache[eb]
        });
      }
    }
  }
  return segments;
}

function traceChains(segments) {
  const count = segments.length;
  if (count === 0) return [];
  const adj = new Map();
  for (let i = 0; i < count; i += 1) {
    const seg = segments[i];
    let a = adj.get(seg.ka);
    if (!a) { a = []; adj.set(seg.ka, a); }
    a.push(i);
    let b = adj.get(seg.kb);
    if (!b) { b = []; adj.set(seg.kb, b); }
    b.push(i);
  }
  const used = new Uint8Array(count);
  const chains = [];
  const guardLimit = count + 4;

  const walk = (startIdx) => {
    used[startIdx] = 1;
    const s0 = segments[startIdx];
    const pts = [s0.pa, s0.pb];
    let endKey = s0.kb;
    let closed = false;
    let guard = 0;
    while (guard < guardLimit) {
      guard += 1;
      const cands = adj.get(endKey);
      if (!cands) break;
      let nextIdx = -1;
      for (let k = 0; k < cands.length; k += 1) {
        if (used[cands[k]] === 0) { nextIdx = cands[k]; break; }
      }
      if (nextIdx < 0) break;
      used[nextIdx] = 1;
      const seg = segments[nextIdx];
      if (seg.ka === endKey) {
        pts.push(seg.pb);
        endKey = seg.kb;
      } else {
        pts.push(seg.pa);
        endKey = seg.ka;
      }
      if (endKey === s0.ka) { closed = true; break; }
    }

    if (!closed) {
      let startKey = s0.ka;
      let backGuard = 0;
      while (backGuard < guardLimit) {
        backGuard += 1;
        const cands = adj.get(startKey);
        if (!cands) break;
        let nextIdx = -1;
        for (let k = 0; k < cands.length; k += 1) {
          if (used[cands[k]] === 0) { nextIdx = cands[k]; break; }
        }
        if (nextIdx < 0) break;
        used[nextIdx] = 1;
        const seg = segments[nextIdx];
        if (seg.ka === startKey) {
          pts.unshift(seg.pb);
          startKey = seg.kb;
        } else {
          pts.unshift(seg.pa);
          startKey = seg.ka;
        }
      }
    }

    return { points: pts, closed };
  };

  const degreeOne = [];
  for (const entry of adj) {
    if (entry[1].length === 1) degreeOne.push(entry[1][0]);
  }
  for (let i = 0; i < degreeOne.length; i += 1) {
    if (used[degreeOne[i]] === 0) {
      const chain = walk(degreeOne[i]);
      chain.closed = false;
      chains.push(chain);
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (used[i] === 0) {
      chains.push(walk(i));
    }
  }
  return chains;
}

function dedupeAndSmooth(points, closed) {
  const dedup = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (dedup.length > 0) {
      const q = dedup[dedup.length - 1];
      if (Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7) continue;
    }
    dedup.push([p[0], p[1]]);
  }
  if (closed && dedup.length > 2) {
    const first = dedup[0];
    const last = dedup[dedup.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) {
      dedup.pop();
    }
  }
  let pts = dedup;
  const rounds = 2;
  for (let r = 0; r < rounds; r += 1) {
    const n = pts.length;
    if (n < 3) break;
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
      if (closed === false && (i === 0 || i === n - 1)) {
        out[i] = pts[i];
        continue;
      }
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      out[i] = [
        0.2 * prev[0] + 0.6 * pts[i][0] + 0.2 * next[0],
        0.2 * prev[1] + 0.6 * pts[i][1] + 0.2 * next[1]
      ];
    }
    pts = out;
  }
  return pts;
}

function chainLength(points) {
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return acc;
}

export function extractContours(terrainData, terrainConfig) {
  const cfg = (terrainConfig && typeof terrainConfig === 'object') ? terrainConfig : {};
  if (cfg.showContours === false) return [];
  if (!terrainData || !terrainData.elevation) return [];
  const H = terrainData.elevation;
  const n = terrainData.gridN || GRID_N;
  const cell = terrainData.cellSizeM || 1;
  const step = Math.max(1, toNum(cfg.contourStep, 5));
  const indexEvery = Math.max(1, Math.round(toNum(cfg.indexEvery, 5)));
  const lowLimit = toNum(cfg.minContourElev, -500);
  const highLimit = toNum(cfg.maxContourElev, 6000);

  let hMin = toNum(terrainData.hMin, NaN);
  let hMax = toNum(terrainData.hMax, NaN);
  if (Number.isFinite(hMin) === false || Number.isFinite(hMax) === false) {
    hMin = Infinity;
    hMax = -Infinity;
    for (let i = 0; i < H.length; i += 1) {
      if (H[i] < hMin) hMin = H[i];
      if (H[i] > hMax) hMax = H[i];
    }
  }

  const lowE = Math.max(hMin, lowLimit);
  const highE = Math.min(hMax, highLimit);
  if (highE <= lowE) return [];

  const kStart = Math.ceil(lowE / step - 1e-9);
  const kEnd = Math.floor(highE / step + 1e-9);
  const contours = [];
  let seq = 0;
  for (let k = kStart; k <= kEnd; k += 1) {
    const level = k * step;
    if (level < lowE - 1e-9 || level > highE + 1e-9) continue;
    const isIndex = (k % indexEvery) === 0;
    const segments = buildLevelSegments(H, n, cell, level);
    if (segments.length === 0) continue;
    const chains = traceChains(segments);
    for (let c = 0; c < chains.length; c += 1) {
      const chain = chains[c];
      const smoothed = dedupeAndSmooth(chain.points, chain.closed);
      const minPts = chain.closed ? 4 : 3;
      if (smoothed.length < minPts) continue;
      const len = chainLength(smoothed);
      if (len < cell * 0.6) continue;
      if (chain.closed) {
        let area2 = 0;
        for (let i = 0; i < smoothed.length; i += 1) {
          const a = smoothed[i];
          const b = smoothed[(i + 1) % smoothed.length];
          area2 += a[0] * b[1] - b[0] * a[1];
        }
        if (Math.abs(area2) * 0.5 < cell * cell * 0.2) continue;
      }
      contours.push({
        id: `ct_${seq}`,
        elev: level,
        isIndex,
        closed: chain.closed,
        lengthM: len,
        points: smoothed
      });
      seq += 1;
    }
  }
  return contours;
}

/* ------------------------------------------------------------------------------------------------
 * 六、可选标准测绘陡坎短齿线（默认关闭）
 * ---------------------------------------------------------------------------------------------- */

export function extractScarpTicks(contours, terrainData, terrainConfig) {
  const cfg = (terrainConfig && typeof terrainConfig === 'object') ? terrainConfig : {};
  if (cfg.showScarpTicks !== true) return [];
  if (Array.isArray(contours) === false || contours.length === 0) return [];
  if (!terrainData || !terrainData.elevation) return [];
  const threshold = toNum(cfg.scarpSlopeThresholdDeg, 26);
  const sampleSpacing = 22;
  const tickLen = 4.0;
  const ticks = [];

  for (let ci = 0; ci < contours.length; ci += 1) {
    const contour = contours[ci];
    if (!contour || contour.isIndex !== true) continue;
    const pts = contour.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    let acc = 0;
    let nextAt = 0;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-9) continue;
      while (nextAt <= acc + segLen) {
        const t = (nextAt - acc) / segLen;
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        const slopeDeg = sampleSlopeDeg(terrainData, px, py);
        if (slopeDeg >= threshold) {
          const grad = sampleGradient(terrainData, px, py);
          const gradNorm = Math.hypot(grad.dzdx, grad.dzdy);
          if (gradNorm > 1e-9) {
            const dx = -grad.dzdx / gradNorm;
            const dy = -grad.dzdy / gradNorm;
            ticks.push({
              x1: px,
              y1: py,
              x2: px + tickLen * dx,
              y2: py + tickLen * dy,
              lengthM: tickLen,
              elev: contour.elev,
              slopeDeg
            });
          }
        }
        nextAt += sampleSpacing;
      }
      acc += segLen;
    }
  }
  return ticks;
}

/* ------------------------------------------------------------------------------------------------
 * 七、地形包构建
 * ---------------------------------------------------------------------------------------------- */

export function buildTerrainPackage(project) {
  const t0 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
  const terrainData = buildElevationField(project);
  const terrainConfig = (project && project.terrain) ? project.terrain : {};
  const contours = extractContours(terrainData, terrainConfig);
  const scarpTicks = extractScarpTicks(contours, terrainData, terrainConfig);
  const t1 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
  let indexCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < contours.length; i += 1) {
    if (contours[i].isIndex) indexCount += 1;
    totalPoints += contours[i].points.length;
  }
  return {
    terrainData,
    terrainConfig,
    contours,
    scarpTicks,
    stats: {
      buildMs: t1 - t0,
      contourCount: contours.length,
      indexContourCount: indexCount,
      contourPointCount: totalPoints,
      scarpTickCount: scarpTicks.length,
      hMin: terrainData.hMin,
      hMax: terrainData.hMax
    }
  };
}

/* ------------------------------------------------------------------------------------------------
 * 八、等高线命中拾取
 * ---------------------------------------------------------------------------------------------- */

export function hitTestContourLine(contours, wx, wy, toleranceM) {
  if (Array.isArray(contours) === false || contours.length === 0) return null;
  const tol = Math.max(0.5, toNum(toleranceM, 6));
  let best = null;
  for (let ci = 0; ci < contours.length; ci += 1) {
    const contour = contours[ci];
    const pts = contour && contour.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const segCount = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const hit = closestOnSegment(wx, wy, a[0], a[1], b[0], b[1]);
      if (hit.dist <= tol && (best === null || hit.dist < best.dist)) {
        best = {
          contour,
          contourId: contour.id,
          elev: contour.elev,
          isIndex: contour.isIndex === true,
          segmentIndex: i,
          dist: hit.dist,
          x: hit.x,
          y: hit.y,
          t: hit.t
        };
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * 九、等高线直接拖拽推拉（子步限幅高斯核）
 * ---------------------------------------------------------------------------------------------- */

function currentMs() {
  return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

export function applyContourWarpDrag(project, terrainData, dragCtx) {
  if (!project || !terrainData || !dragCtx) return [];
  const worldSizeM = toNum(project.meta && project.meta.worldSizeM, 2400);
  const cellSizeM = worldSizeM / (GRID_N - 1);
  const radiusM = Math.max(30, toNum(dragCtx.radiusM, 180));
  const strength = Math.max(0.15, Math.min(1.0, toNum(dragCtx.strength, 0.68)));
  const sigma = radiusM / 2.2;
  const twoSigma2 = 2.0 * sigma * sigma;
  const edgeBase = Math.exp(-(radiusM * radiusM) / twoSigma2);
  const normFactor = 1.0 / Math.max(1e-6, 1.0 - edgeBase);

  const prevX = toNum(dragCtx.prevX, 0);
  const prevY = toNum(dragCtx.prevY, 0);
  const currX = toNum(dragCtx.currX, prevX);
  const currY = toNum(dragCtx.currY, prevY);
  const lockedElev = toNum(dragCtx.lockedElev, sampleElevation(terrainData, currX, currY));

  const moveDist = Math.hypot(currX - prevX, currY - prevY);
  const subStepLen = Math.max(4.0, sigma * 0.28);
  const steps = Math.max(1, Math.min(24, Math.ceil(moveDist / subStepLen)));
  const contourStep = Math.max(1, toNum(project.terrain && project.terrain.contourStep, 5));

  const elevation = terrainData.elevation;
  const sculpt = terrainData.sculptDelta;

  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const px = prevX + (currX - prevX) * t;
    const py = prevY + (currY - prevY) * t;

    const currentH = sampleElevation(terrainData, px, py);
    const grad = sampleGradient(terrainData, px, py);
    const gradMag = Math.hypot(grad.dzdx, grad.dzdy);

    const rawDiff = (lockedElev - currentH) * strength;
    const maxStep = Math.max(
      contourStep * 0.45,
      Math.min(contourStep * 2.0, 0.45 * sigma * Math.max(gradMag, 0.05))
    );
    const deltaCenter = Math.max(-maxStep, Math.min(maxStep, rawDiff));

    const gxMin = Math.max(0, Math.floor((px - radiusM) / cellSizeM));
    const gxMax = Math.min(GRID_N - 1, Math.ceil((px + radiusM) / cellSizeM));
    const gyMin = Math.max(0, Math.floor((py - radiusM) / cellSizeM));
    const gyMax = Math.min(GRID_N - 1, Math.ceil((py + radiusM) / cellSizeM));

    for (let gy = gyMin; gy <= gyMax; gy += 1) {
      const wy = gy * cellSizeM;
      const dy = wy - py;
      const rowBase = gy * GRID_N;
      for (let gx = gxMin; gx <= gxMax; gx += 1) {
        const wx = gx * cellSizeM;
        const dx = wx - px;
        const r2 = dx * dx + dy * dy;
        if (r2 <= radiusM * radiusM) {
          const w = (Math.exp(-r2 / twoSigma2) - edgeBase) * normFactor;
          const idx = rowBase + gx;
          const delta = deltaCenter * w;
          let nextDelta = sculpt[idx] + delta;
          if (nextDelta > 3200) nextDelta = 3200;
          if (nextDelta < -3200) nextDelta = -3200;
          const applied = nextDelta - sculpt[idx];
          sculpt[idx] = nextDelta;
          elevation[idx] += applied;
        }
      }
    }
  }

  project.terrain.sculptDeltaB64 = encodeSculptDelta(sculpt);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < elevation.length; i += 1) {
    const v = elevation[i];
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  terrainData.hMin = hMin;
  terrainData.hMax = hMax;
  return extractContours(terrainData, project.terrain);
}

/* ------------------------------------------------------------------------------------------------
 * 十、四支高程涂抹笔刷
 * ---------------------------------------------------------------------------------------------- */

export function applySculptBrush(project, terrainData, brushCtx) {
  if (!project || !terrainData || !brushCtx) return [];
  const worldSizeM = toNum(project.meta && project.meta.worldSizeM, 2400);
  const cellSizeM = worldSizeM / (GRID_N - 1);
  const mode = (brushCtx.mode === 'lower' || brushCtx.mode === 'smooth' || brushCtx.mode === 'flatten')
    ? brushCtx.mode
    : 'raise';
  const px = toNum(brushCtx.x, 0);
  const py = toNum(brushCtx.y, 0);
  const radiusM = Math.max(10, Math.min(1200, toNum(brushCtx.radiusM, 140)));
  const strength = Math.max(0.01, Math.min(1.0, toNum(brushCtx.strength, 0.35)));
  const contourStep = Math.max(1, toNum(project.terrain && project.terrain.contourStep, 5));
  const targetElev = toNum(
    brushCtx.targetElev,
    toNum(project.terrain && project.terrain.baseElev, sampleElevation(terrainData, px, py))
  );

  const elevation = terrainData.elevation;
  const sculpt = terrainData.sculptDelta;
  const n = terrainData.gridN || GRID_N;

  const gxMin = Math.max(0, Math.floor((px - radiusM) / cellSizeM));
  const gxMax = Math.min(n - 1, Math.ceil((px + radiusM) / cellSizeM));
  const gyMin = Math.max(0, Math.floor((py - radiusM) / cellSizeM));
  const gyMax = Math.min(n - 1, Math.ceil((py + radiusM) / cellSizeM));
  const r2Max = radiusM * radiusM;

  let snapH = null;
  if (mode === 'smooth') {
    snapH = new Float32Array((gxMax - gxMin + 1) * (gyMax - gyMin + 1));
    for (let gy = gyMin; gy <= gyMax; gy += 1) {
      const rowBase = gy * n;
      const localRow = (gy - gyMin) * (gxMax - gxMin + 1);
      for (let gx = gxMin; gx <= gxMax; gx += 1) {
        snapH[localRow + (gx - gxMin)] = elevation[rowBase + gx];
      }
    }
  }

  const raiseAmount = contourStep * 0.65 * strength;
  const localWidth = gxMax - gxMin + 1;

  for (let gy = gyMin; gy <= gyMax; gy += 1) {
    const wy = gy * cellSizeM;
    const dy = wy - py;
    const rowBase = gy * n;
    for (let gx = gxMin; gx <= gxMax; gx += 1) {
      const wx = gx * cellSizeM;
      const dx = wx - px;
      const r2 = dx * dx + dy * dy;
      if (r2 > r2Max) continue;
      const u = 1.0 - r2 / r2Max;
      const w = u * u;
      const idx = rowBase + gx;
      let diff = 0;

      if (mode === 'raise') {
        diff = raiseAmount * w;
      } else if (mode === 'lower') {
        diff = -raiseAmount * w;
      } else if (mode === 'smooth') {
        const localRow = (gy - gyMin) * localWidth;
        const localIdx = localRow + (gx - gxMin);
        const c = snapH[localIdx];
        const hasXm = gx > gxMin;
        const hasXp = gx < gxMax;
        const hasYm = gy > gyMin;
        const hasYp = gy < gyMax;
        const xm = hasXm ? snapH[localIdx - 1] : c;
        const xp = hasXp ? snapH[localIdx + 1] : c;
        const ym = hasYm ? snapH[localIdx - localWidth] : c;
        const yp = hasYp ? snapH[localIdx + localWidth] : c;
        const xmym = (hasXm && hasYm) ? snapH[localIdx - localWidth - 1] : c;
        const xpym = (hasXp && hasYm) ? snapH[localIdx - localWidth + 1] : c;
        const xmyp = (hasXm && hasYp) ? snapH[localIdx + localWidth - 1] : c;
        const xpyp = (hasXp && hasYp) ? snapH[localIdx + localWidth + 1] : c;
        const lapAvg = (
          xmym * 1 + ym * 2 + xpym * 1 +
          xm * 2 + c * 4 + xp * 2 +
          xmyp * 1 + yp * 2 + xpyp * 1
        ) / 16;
        diff = (lapAvg - c) * (0.65 * strength * w);
      } else {
        diff = (targetElev - elevation[idx]) * (0.45 * strength * w);
      }

      if (diff === 0) continue;
      let nextDelta = sculpt[idx] + diff;
      if (nextDelta > 3200) nextDelta = 3200;
      if (nextDelta < -3200) nextDelta = -3200;
      const applied = nextDelta - sculpt[idx];
      sculpt[idx] = nextDelta;
      elevation[idx] += applied;
    }
  }

  project.terrain.sculptDeltaB64 = encodeSculptDelta(sculpt);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < elevation.length; i += 1) {
    const v = elevation[i];
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  terrainData.hMin = hMin;
  terrainData.hMax = hMax;
  return extractContours(terrainData, project.terrain);
}
