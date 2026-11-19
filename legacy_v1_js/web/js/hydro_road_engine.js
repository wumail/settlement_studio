/**
 * Terrax Settlement Studio — M2 纯净水系、显式岩礁、多级道路与自动正交桥梁内核
 * 文件：web/js/hydro_road_engine.js
 *
 * 实现内容：
 *   1. 开/闭双模 Catmull-Rom（张力 0.5）样条平滑、折线周长与线段/折线最近投影；
 *   2. 变宽纯净河道双岸闭合多边形 + 贴岸向内收缩水纹弦线，`islands` 恒为空数组（BG-02 铁律）；
 *   3. 湖海闭合岸线内缩水纹环、砌石明渠水带与坎儿井暗渠 45 m 竖井串；
 *   4. 显式基岩暗礁 5—7 边形硬朗棱角簇（极角均匀 + ±0.18 rad 抖动）与外扩碎波圈；
 *   5. 三级道路（highway / street / lane）平滑中心线、路缘与默认宽度；
 *   6. 道路 × 河流精确求交、35 m 邻近去重、浅滩渡口豁免与严格正交木石桥几何求解。
 *
 * 无头铁律：本模块零 DOM 依赖，可在纯 Node.js 环境直接 import。
 */

import {
  createRng,
  hashSeed
} from './state_and_schema.js';

/* ------------------------------------------------------------------------------------------------
 * 一、基础几何算子
 * ---------------------------------------------------------------------------------------------- */

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sampleCatmullRom(points, samplesPerSeg = 12, closed = false) {
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

export function polylineLength(points) {
  if (Array.isArray(points) === false || points.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return acc;
}

export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) {
    return { t: 0, x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) };
  }
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const x = ax + t * vx;
  const y = ay + t * vy;
  return { t, x, y, dist: Math.hypot(px - x, py - y) };
}

export function closestPointOnPolyline(px, py, polyline) {
  if (Array.isArray(polyline) === false || polyline.length === 0) {
    return { x: px, y: py, dist: Infinity, segIndex: -1, t: 0, sAlong: 0, totalLen: 0 };
  }
  if (polyline.length === 1) {
    return {
      x: polyline[0][0],
      y: polyline[0][1],
      dist: Math.hypot(px - polyline[0][0], py - polyline[0][1]),
      segIndex: 0,
      t: 0,
      sAlong: 0,
      totalLen: 0
    };
  }
  let best = null;
  let cum = 0;
  const segLens = [];
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const len = Math.hypot(polyline[i + 1][0] - polyline[i][0], polyline[i + 1][1] - polyline[i][1]);
    segLens.push(len);
  }
  const totalLen = segLens.reduce((a, b) => a + b, 0);
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const hit = closestPointOnSegment(px, py, a[0], a[1], b[0], b[1]);
    if (best === null || hit.dist < best.dist) {
      best = {
        x: hit.x,
        y: hit.y,
        dist: hit.dist,
        segIndex: i,
        t: hit.t,
        sAlong: totalLen > 1e-9 ? (cum + hit.t * segLens[i]) / totalLen : 0,
        totalLen
      };
    }
    cum += segLens[i];
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * 二、变宽纯净河道（零河心岛）
 * ---------------------------------------------------------------------------------------------- */

function buildCumulative(poly) {
  const cum = new Float64Array(poly.length);
  let acc = 0;
  for (let i = 1; i < poly.length; i += 1) {
    acc += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    cum[i] = acc;
  }
  return { cum, total: Math.max(acc, 1e-9) };
}

function nodeTangents(poly, closed) {
  const n = poly.length;
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let prevIdx;
    let nextIdx;
    if (closed) {
      prevIdx = (i - 1 + n) % n;
      nextIdx = (i + 1) % n;
    } else {
      prevIdx = Math.max(0, i - 1);
      nextIdx = Math.min(n - 1, i + 1);
    }
    const a = poly[prevIdx];
    const b = poly[nextIdx];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty);
    if (len < 1e-9) {
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }
    out[i] = [tx, ty];
  }
  return out;
}

export function buildRiverGeometry(river, worldSizeM) {
  if (!river || !Array.isArray(river.points) || river.points.length < 2) {
    return null;
  }
  const centerline = sampleCatmullRom(river.points, 14, false);
  const { cum, total } = buildCumulative(centerline);
  const tangents = nodeTangents(centerline, false);
  const widthStartM = Math.max(6, toNum(river.widthStartM, 28));
  const widthEndM = Math.max(6, toNum(river.widthEndM, 46));
  const leftBank = [];
  const rightBank = [];
  const halfWidths = new Float32Array(centerline.length);
  const widths = new Float32Array(centerline.length);
  const pathU = new Float32Array(centerline.length);

  for (let k = 0; k < centerline.length; k += 1) {
    const u = cum[k] / total;
    const widthAtK = Math.max(6, widthStartM + (widthEndM - widthStartM) * u);
    let halfW = 0.5 * widthAtK;
    // 急弯处按局部曲率半径夹紧半宽，避免内侧岸线自交翻转
    if (k > 0 && k < centerline.length - 1) {
      const p0 = centerline[k - 1];
      const p2 = centerline[k + 1];
      const ds = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
      const t0 = tangents[k - 1];
      const t2 = tangents[k + 1];
      const dot = Math.max(-1, Math.min(1, t0[0] * t2[0] + t0[1] * t2[1]));
      const theta = Math.acos(dot);
      if (ds > 1e-6 && theta > 1e-4) {
        const radius = ds / theta;
        halfW = Math.min(halfW, Math.max(2.0, radius * 0.55));
      }
    }
    const t = tangents[k];
    const nx = t[1];
    const ny = -t[0];
    const c = centerline[k];
    leftBank.push([c[0] + halfW * nx, c[1] + halfW * ny]);
    rightBank.push([c[0] - halfW * nx, c[1] - halfW * ny]);
    halfWidths[k] = halfW;
    widths[k] = widthAtK;
    pathU[k] = u;
  }

  let bankPolygon = [];
  for (let k = 0; k < leftBank.length; k += 1) bankPolygon.push(leftBank[k]);
  for (let k = rightBank.length - 1; k >= 0; k -= 1) bankPolygon.push(rightBank[k]);

  // 急弯自交修复：检测两岸折线自交，局部收窄对应采样点的半宽后重建
  const bankCount = centerline.length;
  const segmentsCrossLocal = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const r1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const r2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const r3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const r4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((r1 > 0 && r2 < 0) || (r1 < 0 && r2 > 0)) && ((r3 > 0 && r4 < 0) || (r3 < 0 && r4 > 0));
  };
  for (let iter = 0; iter < 6; iter += 1) {
    const poly = bankPolygon;
    const total = poly.length;
    let fixed = false;
    for (let i = 0; i < total; i += 1) {
      for (let j = i + 2; j < total; j += 1) {
        if (i === 0 && j === total - 1) continue;
        const a = poly[i];
        const b = poly[(i + 1) % total];
        const c = poly[j];
        const d = poly[(j + 1) % total];
        if (!segmentsCrossLocal(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) continue;
        fixed = true;
        const mapIndex = (idx) => (idx < bankCount ? idx : (2 * bankCount - 1 - idx));
        const centers = [mapIndex(i), mapIndex(j)];
        for (let ci = 0; ci < centers.length; ci += 1) {
          for (let off = -2; off <= 2; off += 1) {
            const k = Math.max(1, Math.min(bankCount - 2, centers[ci] + off));
            halfWidths[k] = Math.max(2.0, halfWidths[k] * 0.72);
          }
        }
      }
    }
    if (!fixed) break;
    leftBank.length = 0;
    rightBank.length = 0;
    for (let k = 0; k < bankCount; k += 1) {
      const t = tangents[k];
      const nx = t[1];
      const ny = -t[0];
      const c = centerline[k];
      const h = halfWidths[k];
      leftBank.push([c[0] + h * nx, c[1] + h * ny]);
      rightBank.push([c[0] - h * nx, c[1] - h * ny]);
    }
    bankPolygon = [];
    for (let k = 0; k < leftBank.length; k += 1) bankPolygon.push(leftBank[k]);
    for (let k = rightBank.length - 1; k >= 0; k -= 1) bankPolygon.push(rightBank[k]);
  }

  const rippleCount = Math.max(0, Math.min(3, Math.round(toNum(river.rippleLines, 3))));
  const offsets = [2.2, 5.0, 8.5];
  const ripples = [];
  for (let oi = 0; oi < rippleCount; oi += 1) {
    const dOff = offsets[oi];
    // buildBankRipple 返回折线数组，必须展开推入，否则 Canvas/SVG 会静默丢失全部水纹
    ripples.push(...buildBankRipple(centerline, halfWidths, tangents, dOff, 1));
    ripples.push(...buildBankRipple(centerline, halfWidths, tangents, dOff, -1));
  }

  return {
    id: river.id,
    name: river.name,
    points: river.points,
    centerline,
    cumLen: cum,
    totalLen: total,
    widthStartM,
    widthEndM,
    widths,
    halfWidths,
    pathU,
    tangents,
    leftBank,
    rightBank,
    bankPolygon,
    ripples,
    islands: [],
    carveDepthM: Math.max(0, toNum(river.carveDepthM, 6)),
    rippleLines: rippleCount,
    worldSizeM: toNum(worldSizeM, 2400),
    widthAtU(u) {
      const uu = Math.max(0, Math.min(1, toNum(u, 0)));
      return Math.max(6, widthStartM + (widthEndM - widthStartM) * uu);
    }
  };
}

function buildBankRipple(centerline, halfWidths, tangents, dOff, sideSign) {
  const out = [];
  let run = [];
  for (let k = 0; k < centerline.length; k += 1) {
    const halfW = halfWidths[k];
    if (halfW > dOff + 1.8) {
      const t = tangents[k];
      const nx = t[1] * sideSign;
      const ny = -t[0] * sideSign;
      const c = centerline[k];
      const r = halfW - dOff;
      run.push([c[0] + r * nx, c[1] + r * ny]);
    } else if (run.length > 0) {
      if (run.length >= 2) out.push(run);
      run = [];
    }
  }
  if (run.length >= 2) out.push(run);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * 三、湖海多边形与内外水纹环
 * ---------------------------------------------------------------------------------------------- */

function polygonCentroid(points) {
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
    return [n > 0 ? sx / n : 0, n > 0 ? sy / n : 0];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

function offsetRingInward(ring, distM, centroid) {
  const n = ring.length;
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    let n1x = l1 > 1e-9 ? e1y / l1 : 0;
    let n1y = l1 > 1e-9 ? -e1x / l1 : 0;
    let n2x = l2 > 1e-9 ? e2y / l2 : 0;
    let n2y = l2 > 1e-9 ? -e2x / l2 : 0;
    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) {
      nx = curr[0] - centroid[0];
      ny = curr[1] - centroid[1];
      const cl = Math.hypot(nx, ny);
      if (cl < 1e-9) {
        nx = 0;
        ny = 0;
      } else {
        nx /= cl;
        ny /= cl;
      }
    } else {
      nx /= nl;
      ny /= nl;
    }
    const toCenterX = centroid[0] - curr[0];
    const toCenterY = centroid[1] - curr[1];
    if (nx * toCenterX + ny * toCenterY < 0) {
      nx = -nx;
      ny = -ny;
    }
    out[i] = [curr[0] + nx * distM, curr[1] + ny * distM];
  }
  return out;
}

function ringSignedArea(ring) {
  let area2 = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return area2 * 0.5;
}

function pointInRing(px, py, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > py) === (yj > py)) ? false
      : (px < ((xj - xi) * (py - yi)) / ((yj - yi) + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function buildWaterBodyGeometry(waterBody) {
  if (!waterBody || !Array.isArray(waterBody.points) || waterBody.points.length < 3) {
    return null;
  }
  const shorePoly = sampleCatmullRom(waterBody.points, 10, true);
  if (shorePoly.length < 3) return null;
  const centroid = polygonCentroid(shorePoly);
  const baseArea = Math.abs(ringSignedArea(shorePoly));
  const baseRadius = Math.sqrt(Math.max(baseArea, 1) / Math.PI);
  const rippleCount = Math.max(0, Math.min(3, Math.round(toNum(waterBody.rippleLines, 3))));
  const offsets = [3.0, 7.0, 12.5];
  const ripples = [];

  for (let i = 0; i < rippleCount; i += 1) {
    const d = offsets[i];
    if (d > baseRadius * 0.42) break;
    let ring = offsetRingInward(shorePoly, d, centroid);
    const area = Math.abs(ringSignedArea(ring));
    let valid = area > baseArea * 0.02;
    if (valid) {
      for (let k = 0; k < ring.length; k += 1) {
        if (!pointInRing(ring[k][0], ring[k][1], shorePoly)) {
          valid = false;
          break;
        }
      }
    }
    if (!valid) {
      const shrink = Math.max(0.05, 1 - d / Math.max(baseRadius, 1));
      ring = shorePoly.map((p) => [
        centroid[0] + (p[0] - centroid[0]) * shrink,
        centroid[1] + (p[1] - centroid[1]) * shrink
      ]);
    }
    ripples.push(ring);
  }

  return {
    id: waterBody.id,
    name: waterBody.name,
    kind: waterBody.kind === 'sea' ? 'sea' : 'lake',
    points: waterBody.points,
    shorePoly,
    centroid,
    areaM2: baseArea,
    ripples,
    rippleLines: rippleCount
  };
}

/* ------------------------------------------------------------------------------------------------
 * 四、明渠与坎儿井暗渠
 * ---------------------------------------------------------------------------------------------- */

export function buildCanalGeometry(canal) {
  if (!canal || !Array.isArray(canal.points) || canal.points.length < 2) {
    return null;
  }
  const centerline = sampleCatmullRom(canal.points, 10, false);
  const { cum, total } = buildCumulative(centerline);
  const tangents = nodeTangents(centerline, false);
  const widthM = Math.max(1.2, toNum(canal.widthM, 6));
  const halfW = 0.5 * widthM;
  // 每个采样点独立半宽：急折角处允许局部收窄，禁止引用未声明的 halfWidths / widths
  const halfWidths = new Float64Array(centerline.length).fill(halfW);
  const leftBank = [];
  const rightBank = [];
  for (let k = 0; k < centerline.length; k += 1) {
    const t = tangents[k];
    const nx = t[1];
    const ny = -t[0];
    const c = centerline[k];
    const h = halfWidths[k];
    leftBank.push([c[0] + h * nx, c[1] + h * ny]);
    rightBank.push([c[0] - h * nx, c[1] - h * ny]);
  }
  let bankPolygon = [];
  for (let k = 0; k < leftBank.length; k += 1) bankPolygon.push(leftBank[k]);
  for (let k = rightBank.length - 1; k >= 0; k -= 1) bankPolygon.push(rightBank[k]);

  // 急弯自交修复：检测两岸折线自交，局部收窄对应采样点的半宽后重建
  const bankCount = centerline.length;
  const segmentsCrossLocal = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const r1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const r2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const r3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const r4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((r1 > 0 && r2 < 0) || (r1 < 0 && r2 > 0)) && ((r3 > 0 && r4 < 0) || (r3 < 0 && r4 > 0));
  };
  for (let iter = 0; iter < 6; iter += 1) {
    const poly = bankPolygon;
    const total = poly.length;
    let fixed = false;
    for (let i = 0; i < total; i += 1) {
      for (let j = i + 2; j < total; j += 1) {
        if (i === 0 && j === total - 1) continue;
        const a = poly[i];
        const b = poly[(i + 1) % total];
        const c = poly[j];
        const d = poly[(j + 1) % total];
        if (!segmentsCrossLocal(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) continue;
        fixed = true;
        const mapIndex = (idx) => (idx < bankCount ? idx : (2 * bankCount - 1 - idx));
        const centers = [mapIndex(i), mapIndex(j)];
        for (let ci = 0; ci < centers.length; ci += 1) {
          for (let off = -2; off <= 2; off += 1) {
            const k = Math.max(1, Math.min(bankCount - 2, centers[ci] + off));
            halfWidths[k] = Math.max(2.0, halfWidths[k] * 0.72);
          }
        }
      }
    }
    if (!fixed) break;
    leftBank.length = 0;
    rightBank.length = 0;
    for (let k = 0; k < bankCount; k += 1) {
      const t = tangents[k];
      const nx = t[1];
      const ny = -t[0];
      const c = centerline[k];
      const h = halfWidths[k];
      leftBank.push([c[0] + h * nx, c[1] + h * ny]);
      rightBank.push([c[0] - h * nx, c[1] - h * ny]);
    }
    bankPolygon = [];
    for (let k = 0; k < leftBank.length; k += 1) bankPolygon.push(leftBank[k]);
    for (let k = rightBank.length - 1; k >= 0; k -= 1) bankPolygon.push(rightBank[k]);
  }

  const shaftPoints = [];
  if (canal.style === 'qanat') {
    const spacing = 45;
    let nextAt = spacing;
    while (nextAt < total) {
      const idx = findIndexAtLength(cum, nextAt);
      const segLen = cum[idx + 1] - cum[idx];
      const t = segLen > 1e-9 ? (nextAt - cum[idx]) / segLen : 0;
      const a = centerline[idx];
      const b = centerline[idx + 1];
      shaftPoints.push({
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        radiusM: 3.2,
        sAlong: nextAt
      });
      nextAt += spacing;
    }
  }

  return {
    id: canal.id,
    name: canal.name,
    style: canal.style === 'qanat' ? 'qanat' : 'open',
    points: canal.points,
    centerline,
    cumLen: cum,
    totalLen: total,
    widthM,
    halfWidth: halfW,
    leftBank,
    rightBank,
    bankPolygon,
    shaftPoints
  };
}

function findIndexAtLength(cum, target) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, cum.length - 2);
}

/* ------------------------------------------------------------------------------------------------
 * 五、显式基岩暗礁（5—7 边形硬朗棱角簇）
 * ---------------------------------------------------------------------------------------------- */

export function buildReefGeometry(reef) {
  if (!reef || typeof reef !== 'object') return null;
  const radiusM = Math.max(4, toNum(reef.radiusM, 14));
  const count = Math.max(1, Math.min(3, Math.round(toNum(reef.count, 2))));
  const seed = Number.isFinite(Number(reef.seed)) && Number(reef.seed) !== 0
    ? Number(reef.seed)
    : hashSeed(reef.id);
  const rng = createRng(seed);
  const baseAngle = (toNum(reef.angleDeg, 20) * Math.PI) / 180;
  const baseX = toNum(reef.x, 0);
  const baseY = toNum(reef.y, 0);
  const rocks = [];

  for (let c = 0; c < count; c += 1) {
    const clusterSpread = count === 1 ? 0 : radiusM * 0.42;
    const clusterAngle = baseAngle + (c * Math.PI * 2) / count + (rng() - 0.5) * 0.6;
    const clusterDist = count === 1 ? 0 : clusterSpread * (0.5 + rng() * 0.5);
    const cx = baseX + Math.cos(clusterAngle) * clusterDist;
    const cy = baseY + Math.sin(clusterAngle) * clusterDist;
    const vertCount = 5 + Math.floor(rng() * 3);
    const rockRadius = radiusM * (0.52 + 0.34 * rng());
    const angleJitter = baseAngle + (rng() - 0.5) * 0.5;
    const points = [];
    for (let v = 0; v < vertCount; v += 1) {
      const ang = angleJitter + (v * Math.PI * 2) / vertCount + (rng() - 0.5) * 0.36;
      const radial = rockRadius * (v % 2 === 0 ? (0.92 + rng() * 0.08) : (0.55 + rng() * 0.18));
      points.push([cx + Math.cos(ang) * radial, cy + Math.sin(ang) * radial]);
    }
    rocks.push({ points, center: [cx, cy], radiusM: rockRadius, vertexCount: vertCount });
  }

  const foamRing = [];
  const foamRadius = radiusM + 3.5;
  const foamSegments = 48;
  for (let i = 0; i < foamSegments; i += 1) {
    const ang = baseAngle + (i * Math.PI * 2) / foamSegments;
    const wobble = 1 + 0.06 * Math.sin(ang * 5 + baseAngle);
    foamRing.push([baseX + Math.cos(ang) * foamRadius * wobble, baseY + Math.sin(ang) * foamRadius * wobble]);
  }

  return {
    id: reef.id,
    x: baseX,
    y: baseY,
    radiusM,
    count,
    rocks,
    foamRing,
    foamRadius,
    seed
  };
}

/* ------------------------------------------------------------------------------------------------
 * 六、三级道路
 * ---------------------------------------------------------------------------------------------- */

const ROAD_DEFAULT_WIDTH = { highway: 14, street: 9, lane: 5 };

export function buildRoadGeometry(road) {
  if (!road || !Array.isArray(road.points) || road.points.length < 2) {
    return null;
  }
  const tier = (road.tier === 'street' || road.tier === 'lane') ? road.tier : 'highway';
  const widthM = Math.max(2, toNum(road.widthM, ROAD_DEFAULT_WIDTH[tier]));
  const centerline = sampleCatmullRom(road.points, 10, false);
  const { cum, total } = buildCumulative(centerline);
  const tangents = nodeTangents(centerline, false);
  const halfW = 0.5 * widthM;
  const leftEdge = [];
  const rightEdge = [];
  for (let k = 0; k < centerline.length; k += 1) {
    const t = tangents[k];
    const nx = t[1];
    const ny = -t[0];
    const c = centerline[k];
    leftEdge.push([c[0] + halfW * nx, c[1] + halfW * ny]);
    rightEdge.push([c[0] - halfW * nx, c[1] - halfW * ny]);
  }
  return {
    id: road.id,
    name: road.name,
    tier,
    points: road.points,
    widthM,
    halfWidth: halfW,
    centerline,
    cumLen: cum,
    totalLen: total,
    tangents,
    leftEdge,
    rightEdge
  };
}

/* ------------------------------------------------------------------------------------------------
 * 七、自动正交桥梁求解
 * ---------------------------------------------------------------------------------------------- */

function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return {
    t: Math.max(0, Math.min(1, t)),
    u: Math.max(0, Math.min(1, u)),
    x: ax + rx * t,
    y: ay + ry * t
  };
}

export function solveOrthogonalBridges(roadsBuilt, riversBuilt, fords = []) {
  const bridges = [];
  const fordCrossings = [];
  if (Array.isArray(roadsBuilt) === false || Array.isArray(riversBuilt) === false) {
    return { bridges, fordCrossings };
  }
  const fordList = Array.isArray(fords) ? fords : [];
  const seenByPair = new Map();
  let seq = 0;

  for (let ri = 0; ri < roadsBuilt.length; ri += 1) {
    const road = roadsBuilt[ri];
    if (!road || !Array.isArray(road.centerline) || road.centerline.length < 2) continue;
    const roadCum = road.cumLen;
    for (let vi = 0; vi < riversBuilt.length; vi += 1) {
      const river = riversBuilt[vi];
      if (!river || !Array.isArray(river.centerline) || river.centerline.length < 2) continue;
      const pairKey = `${road.id}|${river.id}`;
      let seenLens = seenByPair.get(pairKey);
      if (!seenLens) {
        seenLens = [];
        seenByPair.set(pairKey, seenLens);
      }
      for (let i = 0; i + 1 < road.centerline.length; i += 1) {
        const a = road.centerline[i];
        const b = road.centerline[i + 1];
        const segLenA = roadCum[i + 1] - roadCum[i];
        for (let j = 0; j + 1 < river.centerline.length; j += 1) {
          const c = river.centerline[j];
          const d = river.centerline[j + 1];
          const hit = segmentIntersection(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
          if (!hit) continue;

          const roadArc = roadCum[i] + hit.t * segLenA;
          let duplicated = false;
          for (let k = 0; k < seenLens.length; k += 1) {
            if (Math.abs(seenLens[k] - roadArc) <= 35) {
              duplicated = true;
              break;
            }
          }
          if (duplicated) continue;
          seenLens.push(roadArc);

          const riverSegLen = river.cumLen[j + 1] - river.cumLen[j];
          const uRiver = river.totalLen > 1e-9
            ? (river.cumLen[j] + hit.u * riverSegLen) / river.totalLen
            : 0;
          const widthAt = (typeof river.widthAtU === 'function')
            ? river.widthAtU(uRiver)
            : Math.max(6, toNum(river.widthStartM, 28));

          let tx = b[0] - a[0];
          let ty = b[1] - a[1];
          const tl = Math.hypot(tx, ty);
          if (tl < 1e-9) {
            tx = 1;
            ty = 0;
          } else {
            tx /= tl;
            ty /= tl;
          }
          const nx = -ty;
          const ny = tx;

          let ford = null;
          for (let f = 0; f < fordList.length; f += 1) {
            const item = fordList[f];
            if (!item) continue;
            const radius = Math.max(6, toNum(item.radiusM, 24));
            if (Math.hypot(hit.x - toNum(item.x, 0), hit.y - toNum(item.y, 0)) <= radius) {
              ford = item;
              break;
            }
          }

          if (ford) {
            fordCrossings.push({
              id: `ford_cross_${seq}`,
              fordId: ford.id,
              fordName: ford.name,
              roadId: road.id,
              roadName: road.name,
              riverId: river.id,
              riverName: river.name,
              x: hit.x,
              y: hit.y,
              tangent: [tx, ty],
              normal: [nx, ny],
              riverWidthM: widthAt,
              radiusM: Math.max(6, toNum(ford.radiusM, 24)),
              angleDeg: (Math.atan2(ty, tx) * 180) / Math.PI
            });
            seq += 1;
            continue;
          }

          let rdx = d[0] - c[0];
          let rdy = d[1] - c[1];
          const rl = Math.hypot(rdx, rdy);
          if (rl > 1e-9) {
            rdx /= rl;
            rdy /= rl;
          } else {
            rdx = -ty;
            rdy = tx;
          }
          const sinAlpha = Math.abs(tx * rdy - ty * rdx);
          const cosAlpha = Math.abs(tx * rdx + ty * rdy);
          const widthM = road.widthM + 3.0;
          // 斜交时按桥面宽度在法向上的投影补偿，保证四个桥角全部落在两岸干陆
          const lengthM = (widthAt + 8.0 + widthM * cosAlpha) / Math.max(0.35, sinAlpha);
          const hl = 0.5 * lengthM;
          const hw = 0.5 * widthM;
          const px = hit.x;
          const py = hit.y;
          const C0 = [px - hl * tx - hw * nx, py - hl * ty - hw * ny];
          const C1 = [px + hl * tx - hw * nx, py + hl * ty - hw * ny];
          const C2 = [px + hl * tx + hw * nx, py + hl * ty + hw * ny];
          const C3 = [px - hl * tx + hw * nx, py - hl * ty + hw * ny];

          const wingLen = 3.0;
          const abutments = [
            [C0, [C0[0] - wingLen * tx + wingLen * nx, C0[1] - wingLen * ty + wingLen * ny]],
            [C1, [C1[0] + wingLen * tx + wingLen * nx, C1[1] + wingLen * ty + wingLen * ny]],
            [C3, [C3[0] - wingLen * tx - wingLen * nx, C3[1] - wingLen * ty - wingLen * ny]],
            [C2, [C2[0] + wingLen * tx - wingLen * nx, C2[1] + wingLen * ty - wingLen * ny]]
          ];

          bridges.push({
            id: `bridge_${seq}`,
            roadId: road.id,
            roadName: road.name,
            riverId: river.id,
            riverName: river.name,
            x: px,
            y: py,
            tangent: [tx, ty],
            normal: [nx, ny],
            angleDeg: (Math.atan2(ty, tx) * 180) / Math.PI,
            riverWidthM: widthAt,
            lengthM,
            widthM,
            corners: [C0, C1, C2, C3],
            parapetLeft: [C0, C1],
            parapetRight: [C3, C2],
            abutments,
            roadArcM: roadArc
          });
          seq += 1;
        }
      }
    }
  }

  return { bridges, fordCrossings };
}

/* ------------------------------------------------------------------------------------------------
 * 八、水路道路总包
 * ---------------------------------------------------------------------------------------------- */

export function buildHydroRoadPackage(project, terrainData) {
  const t0 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
  const p = (project && typeof project === 'object') ? project : {};
  const worldSizeM = toNum(p.meta && p.meta.worldSizeM, 2400);

  const rivers = [];
  const riversRaw = Array.isArray(p.rivers) ? p.rivers : [];
  for (let i = 0; i < riversRaw.length; i += 1) {
    const built = buildRiverGeometry(riversRaw[i], worldSizeM);
    if (built) rivers.push(built);
  }

  const waterBodies = [];
  const wbRaw = Array.isArray(p.waterBodies) ? p.waterBodies : [];
  for (let i = 0; i < wbRaw.length; i += 1) {
    const built = buildWaterBodyGeometry(wbRaw[i]);
    if (built) waterBodies.push(built);
  }

  const canals = [];
  const canalsRaw = Array.isArray(p.canals) ? p.canals : [];
  for (let i = 0; i < canalsRaw.length; i += 1) {
    const built = buildCanalGeometry(canalsRaw[i]);
    if (built) canals.push(built);
  }

  const reefs = [];
  const reefsRaw = Array.isArray(p.reefs) ? p.reefs : [];
  for (let i = 0; i < reefsRaw.length; i += 1) {
    const built = buildReefGeometry(reefsRaw[i]);
    if (built) reefs.push(built);
  }

  const roads = [];
  const roadsRaw = Array.isArray(p.roads) ? p.roads : [];
  for (let i = 0; i < roadsRaw.length; i += 1) {
    const built = buildRoadGeometry(roadsRaw[i]);
    if (built) roads.push(built);
  }

  const solved = solveOrthogonalBridges(roads, rivers, Array.isArray(p.fords) ? p.fords : []);

  let islandCount = 0;
  for (let i = 0; i < rivers.length; i += 1) {
    islandCount += Array.isArray(rivers[i].islands) ? rivers[i].islands.length : 0;
  }

  const t1 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  return {
    rivers,
    waterBodies,
    canals,
    reefs,
    roads,
    bridges: solved.bridges,
    fordCrossings: solved.fordCrossings,
    riverIslandCount: islandCount,
    stats: {
      buildMs: t1 - t0,
      riverCount: rivers.length,
      waterBodyCount: waterBodies.length,
      canalCount: canals.length,
      reefCount: reefs.length,
      roadCount: roads.length,
      bridgeCount: solved.bridges.length,
      fordCrossingCount: solved.fordCrossings.length,
      riverIslandCount: islandCount
    }
  };
}
