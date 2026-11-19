/**
 * Terrax Settlement Studio — M4 制图渲染内核
 * 文件：web/js/canvas_renderer.js
 *
 * 职责：
 *   1. 高清 DPR 视口模型、世界↔屏幕正逆变换、光标不动点滚轮缩放与整幅适配；
 *   2. Watabou 质感 14 层画家算法渲染（羊皮纸 → 田垄盐池 → 等高线 → 水体 → 礁石 →
 *      明暗渠 → 街巷道路 → 正交桥 → 屋宇 → 城垣 → 双遍融合树冠 → 地标 → 图饰 → 交互层）；
 *   3. 三步双遍融合树冠（阴影 + 外廓 r+1.8m + 叶面 r），彻底消除树丛内部交叉黑圈；
 *   4. 14 类内置微缩真图形图例与 8 类自定义矢量徽记的 Canvas 端绘制。
 *
 * 说明：本模块为浏览器渲染层（不进入无头算法内核），顶层不访问 DOM，仅在函数内使用传入的 ctx。
 */

import { getActivePalette } from './state_and_schema.js';

const MIN_ZOOM = 0.06;
const MAX_ZOOM = 5.0;

/* ------------------------------------------------------------------------------------------------
 * 一、视口模型
 * ---------------------------------------------------------------------------------------------- */

function clampNum(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function createViewport(widthPx, heightPx, worldSizeM) {
  const w = Math.max(1, num(widthPx, 1200));
  const h = Math.max(1, num(heightPx, 820));
  const world = Math.max(600, num(worldSizeM, 2400));
  return {
    widthPx: w,
    heightPx: h,
    dpr: 1,
    panX: 0,
    panY: 0,
    zoom: clampNum(Math.min(w, h) / world, MIN_ZOOM, MAX_ZOOM),
    worldSizeM: world
  };
}

export function worldToScreen(wx, wy, viewport) {
  return {
    x: wx * viewport.zoom + viewport.panX,
    y: wy * viewport.zoom + viewport.panY
  };
}

export function screenToWorld(sx, sy, viewport) {
  return {
    x: (sx - viewport.panX) / viewport.zoom,
    y: (sy - viewport.panY) / viewport.zoom
  };
}

export function zoomViewportAtScreenPoint(viewport, sx, sy, factor) {
  const wxBefore = (sx - viewport.panX) / viewport.zoom;
  const wyBefore = (sy - viewport.panY) / viewport.zoom;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));
  viewport.zoom = nextZoom;
  viewport.panX = sx - wxBefore * nextZoom;
  viewport.panY = sy - wyBefore * nextZoom;
  return viewport;
}

export function fitViewportToWorld(viewport, widthPx, heightPx, worldSizeM, paddingPx) {
  const w = Math.max(1, num(widthPx, viewport.widthPx));
  const h = Math.max(1, num(heightPx, viewport.heightPx));
  const world = Math.max(600, num(worldSizeM, viewport.worldSizeM));
  const pad = Math.max(0, num(paddingPx, 36));
  const zoom = clampNum(Math.min((w - pad * 2) / world, (h - pad * 2) / world), MIN_ZOOM, MAX_ZOOM);
  viewport.widthPx = w;
  viewport.heightPx = h;
  viewport.worldSizeM = world;
  viewport.zoom = zoom;
  viewport.panX = (w - world * zoom) * 0.5;
  viewport.panY = (h - world * zoom) * 0.5;
  return viewport;
}

/* ------------------------------------------------------------------------------------------------
 * 二、三步双遍融合树冠（PRD 10.3 精确实现）
 * ---------------------------------------------------------------------------------------------- */

export function renderMergedTreeCanopy(ctx, trees, viewport, palette) {
  if (Array.isArray(trees) === false || trees.length === 0) return;
  const zoom = viewport.zoom;
  const outlinePadM = 1.8;

  ctx.save();
  ctx.fillStyle = 'rgba(43, 37, 32, 0.15)';
  ctx.beginPath();
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    const sx = (tr.x + 2.2) * zoom + viewport.panX;
    const sy = (tr.y + 2.2) * zoom + viewport.panY;
    const sr = Math.max(1.5, (tr.r + 1.0) * zoom);
    ctx.moveTo(sx + sr, sy);
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.fillStyle = palette.treeOutline;
  ctx.beginPath();
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    const sx = tr.x * zoom + viewport.panX;
    const sy = tr.y * zoom + viewport.panY;
    const sr = Math.max(1.8, (tr.r + outlinePadM) * zoom);
    ctx.moveTo(sx + sr, sy);
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.fillStyle = palette.treeFill;
  ctx.beginPath();
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    const sx = tr.x * zoom + viewport.panX;
    const sy = tr.y * zoom + viewport.panY;
    const sr = Math.max(1.0, tr.r * zoom);
    ctx.moveTo(sx + sr, sy);
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------------------------------------
 * 三、图例徽记绘制（28×18 微缩真图形）
 * ---------------------------------------------------------------------------------------------- */

function hexToRgba(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function glyphMainColor(item, palette) {
  if (item && typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)) {
    return item.color;
  }
  const byGlyph = {
    building_inner: palette.roofInner,
    building_town: palette.roofTown,
    city_wall: '#504233',
    road_main: palette.roadFill,
    bridge: palette.roadFill,
    river: palette.waterFill,
    water_body: palette.waterFill,
    canal: palette.waterFill,
    contour: palette.contourLine,
    scarp_tick: palette.contourLine,
    farmland: palette.farmlandFill,
    saltpan: palette.saltpanFill,
    tree_cluster: palette.treeFill,
    reef: '#585550'
  };
  return byGlyph[item && item.glyphType] || palette.roofTown;
}

function glyphStrokeColor(item, palette) {
  if (item && typeof item.strokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.strokeColor)) {
    return item.strokeColor;
  }
  return palette.inkDark;
}

function drawStarPath(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const ang = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * 在 (x, y, w, h) 框内绘制真实的微缩制图符号。默认按 28×18 px 设计，随框缩放。
 * 严禁以单色圆点或纯色块敷衍。
 */
export function drawLegendGlyphCanvas(ctx, legendItem, x, y, w, h, palette) {
  if (!ctx) return;
  const item = legendItem || {};
  const pal = palette || getActivePalette(null);
  const glyph = item.glyphType || 'building_town';
  const main = glyphMainColor(item, pal);
  const ink = glyphStrokeColor(item, pal);
  const boxW = Math.max(8, num(w, 28));
  const boxH = Math.max(6, num(h, 18));

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(boxW / 28, boxH / 18);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const stroke = (color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
  };
  const fill = (color) => {
    ctx.fillStyle = color;
  };

  if (glyph === 'building_inner') {
    fill('rgba(43, 37, 32, 0.18)');
    ctx.fillRect(5.6, 6.4, 16.4, 8.2);
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.rect(4, 5, 12, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(17, 8.4, 7, 5.2);
    ctx.fill();
    ctx.stroke();
    stroke(ink, 0.5);
    ctx.beginPath();
    ctx.moveTo(10, 5);
    ctx.lineTo(10, 13);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20.5, 8.4);
    ctx.lineTo(20.5, 13.6);
    ctx.stroke();
  } else if (glyph === 'building_town') {
    fill('rgba(43, 37, 32, 0.16)');
    ctx.beginPath();
    ctx.moveTo(4.4, 6.4);
    ctx.lineTo(12.4, 6.4);
    ctx.lineTo(12.4, 9.4);
    ctx.lineTo(16.4, 9.4);
    ctx.lineTo(16.4, 13.6);
    ctx.lineTo(4.4, 13.6);
    ctx.closePath();
    ctx.fill();
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.moveTo(3, 5);
    ctx.lineTo(11, 5);
    ctx.lineTo(11, 8);
    ctx.lineTo(15, 8);
    ctx.lineTo(15, 13);
    ctx.lineTo(3, 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(16.2, 9.2, 6, 3.8);
    ctx.fill();
    ctx.stroke();
    fill(pal.treeFill);
    stroke(pal.treeOutline, 0.5);
    ctx.beginPath();
    ctx.arc(21.6, 5.6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (glyph === 'city_wall') {
    fill(main);
    stroke(ink, 0.7);
    ctx.beginPath();
    ctx.rect(1.6, 7.4, 24.8, 3.6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(6.2, 9.2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(21.8, 9.2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    fill(pal.paperBg);
    ctx.fillRect(13.2, 7.0, 2.6, 4.4);
    stroke(ink, 0.6);
    ctx.beginPath();
    ctx.moveTo(13.2, 7.0);
    ctx.lineTo(13.2, 11.4);
    ctx.moveTo(15.8, 7.0);
    ctx.lineTo(15.8, 11.4);
    ctx.stroke();
  } else if (glyph === 'road_main') {
    fill(main);
    stroke('#5b4a38', 1.0);
    ctx.beginPath();
    ctx.rect(1, 6, 26, 6);
    ctx.fill();
    ctx.stroke();
    stroke('#5b4a38', 1.2);
    ctx.beginPath();
    ctx.moveTo(1, 6);
    ctx.lineTo(27, 6);
    ctx.moveTo(1, 12);
    ctx.lineTo(27, 12);
    ctx.stroke();
    stroke(hexToRgba('#5b4a38', 0.45), 0.5);
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(2, 9);
    ctx.lineTo(26, 9);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (glyph === 'bridge') {
    fill(pal.waterFill);
    ctx.fillRect(10, 1.4, 8, 15.2);
    stroke(pal.waterRipple, 0.8);
    ctx.beginPath();
    ctx.moveTo(11.2, 2.4);
    ctx.lineTo(11.2, 15.6);
    ctx.moveTo(16.8, 2.4);
    ctx.lineTo(16.8, 15.6);
    ctx.stroke();
    fill(main);
    stroke(ink, 1.0);
    ctx.beginPath();
    ctx.rect(1.6, 6.8, 24.8, 4.4);
    ctx.fill();
    ctx.stroke();
    stroke(ink, 1.8);
    ctx.beginPath();
    ctx.moveTo(1.6, 6.8);
    ctx.lineTo(26.4, 6.8);
    ctx.moveTo(1.6, 11.2);
    ctx.lineTo(26.4, 11.2);
    ctx.stroke();
    stroke(ink, 0.9);
    ctx.beginPath();
    ctx.moveTo(1.6, 11.2);
    ctx.lineTo(0.2, 13.6);
    ctx.moveTo(1.6, 6.8);
    ctx.lineTo(0.2, 4.4);
    ctx.moveTo(26.4, 11.2);
    ctx.lineTo(27.8, 13.6);
    ctx.moveTo(26.4, 6.8);
    ctx.lineTo(27.8, 4.4);
    ctx.stroke();
  } else if (glyph === 'river') {
    stroke(main, 6.4);
    ctx.beginPath();
    ctx.moveTo(0.8, 12.4);
    ctx.bezierCurveTo(8, 8.4, 16, 14.4, 27.2, 6.2);
    ctx.stroke();
    stroke(pal.waterRipple, 0.9);
    ctx.beginPath();
    ctx.moveTo(1.2, 10.6);
    ctx.bezierCurveTo(8, 6.8, 16, 12.6, 27, 4.6);
    ctx.moveTo(1.4, 14.2);
    ctx.bezierCurveTo(8, 10.4, 16, 16.2, 27, 8.2);
    ctx.stroke();
  } else if (glyph === 'water_body') {
    fill(main);
    stroke(hexToRgba(ink, 0.75), 0.8);
    ctx.beginPath();
    const r = 3.2;
    ctx.moveTo(2 + r, 3);
    ctx.lineTo(26 - r, 3);
    ctx.quadraticCurveTo(26, 3, 26, 3 + r);
    ctx.lineTo(26, 15 - r);
    ctx.quadraticCurveTo(26, 15, 26 - r, 15);
    ctx.lineTo(2 + r, 15);
    ctx.quadraticCurveTo(2, 15, 2, 15 - r);
    ctx.lineTo(2, 3 + r);
    ctx.quadraticCurveTo(2, 3, 2 + r, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(pal.waterRipple, 0.85);
    ctx.beginPath();
    ctx.moveTo(4.4, 5.2);
    ctx.lineTo(23.6, 5.2);
    ctx.lineTo(23.6, 12.8);
    ctx.lineTo(4.4, 12.8);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6.6, 7.4);
    ctx.lineTo(21.4, 7.4);
    ctx.lineTo(21.4, 10.6);
    ctx.lineTo(6.6, 10.6);
    ctx.closePath();
    ctx.stroke();
  } else if (glyph === 'canal') {
    fill(main);
    stroke(hexToRgba(ink, 0.7), 0.7);
    ctx.beginPath();
    ctx.rect(2, 3.6, 24, 3.4);
    ctx.fill();
    ctx.stroke();
    stroke(pal.waterRipple, 0.7);
    ctx.beginPath();
    ctx.moveTo(3.4, 5.3);
    ctx.lineTo(24.6, 5.3);
    ctx.stroke();
    stroke('#3d6a74', 1.0);
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(2, 12.4);
    ctx.lineTo(26, 12.4);
    ctx.stroke();
    ctx.setLineDash([]);
    stroke('#3d6a74', 0.9);
    fill(pal.paperBg);
    ctx.beginPath();
    ctx.arc(9, 12.4, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(20, 12.4, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (glyph === 'contour') {
    stroke(main, 1.6);
    ctx.beginPath();
    ctx.moveTo(1.6, 5.4);
    ctx.bezierCurveTo(9, 3.6, 18, 7.2, 26.4, 5.2);
    ctx.stroke();
    stroke(hexToRgba(main, 0.5), 0.75);
    ctx.beginPath();
    ctx.moveTo(1.6, 10.4);
    ctx.bezierCurveTo(9, 8.6, 18, 12.2, 26.4, 10.2);
    ctx.moveTo(1.6, 14.4);
    ctx.bezierCurveTo(9, 12.6, 18, 16.2, 26.4, 14.2);
    ctx.stroke();
  } else if (glyph === 'scarp_tick') {
    stroke(main, 1.5);
    ctx.beginPath();
    ctx.moveTo(1.6, 6.2);
    ctx.bezierCurveTo(9, 4.8, 18, 7.8, 26.4, 6.0);
    ctx.stroke();
    stroke(hexToRgba(main, 0.95), 0.7);
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      const tx = 6.4 + i * 4.6;
      const ty = 6.2 + Math.sin(tx * 0.22) * 0.6;
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx, ty + 4.2);
    }
    ctx.stroke();
  } else if (glyph === 'farmland') {
    fill(main);
    stroke('#8a7a52', 0.8);
    ctx.beginPath();
    ctx.moveTo(2.6, 3.6);
    ctx.lineTo(25.4, 3.6);
    ctx.lineTo(22.4, 14.4);
    ctx.lineTo(5.6, 14.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(hexToRgba('#8a7a52', 0.75), 0.6);
    ctx.beginPath();
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const x1 = 2.6 + (25.4 - 2.6) * t;
      const x2 = 5.6 + (22.4 - 5.6) * t;
      ctx.moveTo(x1, 3.6);
      ctx.lineTo(x2, 14.4);
    }
    ctx.stroke();
  } else if (glyph === 'saltpan') {
    const cells = [
      [3, 3.2, 0.96], [14.6, 3.2, 0.74],
      [3, 9.6, 0.74], [14.6, 9.6, 0.96]
    ];
    for (let i = 0; i < cells.length; i += 1) {
      const c = cells[i];
      ctx.globalAlpha = c[2];
      fill(main);
      ctx.fillRect(c[0], c[1], 10.4, 5.2);
      ctx.globalAlpha = 1;
      stroke('rgba(255,255,255,0.82)', 0.9);
      ctx.strokeRect(c[0], c[1], 10.4, 5.2);
    }
  } else if (glyph === 'tree_cluster') {
    const circles = [
      [9.6, 10.2, 5.0],
      [16.8, 8.4, 4.6],
      [14.2, 12.6, 4.7]
    ];
    fill(pal.treeOutline);
    ctx.beginPath();
    for (let i = 0; i < circles.length; i += 1) {
      const c = circles[i];
      ctx.moveTo(c[0] + c[2] + 1.2, c[1]);
      ctx.arc(c[0], c[1], c[2] + 1.2, 0, Math.PI * 2);
    }
    ctx.fill();
    fill(main);
    ctx.beginPath();
    for (let i = 0; i < circles.length; i += 1) {
      const c = circles[i];
      ctx.moveTo(c[0] + c[2], c[1]);
      ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (glyph === 'reef') {
    fill(hexToRgba(pal.waterFill, 0.55));
    ctx.fillRect(0.8, 2.4, 26.4, 13.2);
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.moveTo(7.6, 5.2);
    ctx.lineTo(12.6, 4.4);
    ctx.lineTo(14.6, 8.2);
    ctx.lineTo(11.2, 12.4);
    ctx.lineTo(7.2, 10.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(17.4, 6.6);
    ctx.lineTo(22.4, 6.0);
    ctx.lineTo(23.6, 10.2);
    ctx.lineTo(19.8, 12.6);
    ctx.lineTo(17.0, 9.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(pal.waterRipple, 0.8);
    ctx.setLineDash([2.4, 2.2]);
    ctx.beginPath();
    ctx.arc(14.6, 8.6, 11.2, 0.2, Math.PI - 0.4);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (glyph === 'star_fort') {
    fill(hexToRgba(main, 0.22));
    stroke(main, 1.1);
    drawStarPath(ctx, 14, 9, 7.4, 3.4, 8);
    ctx.fill();
    ctx.stroke();
    fill(ink);
    ctx.beginPath();
    ctx.arc(14, 9, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (glyph === 'tower') {
    fill(main);
    stroke(ink, 0.9);
    ctx.beginPath();
    ctx.rect(9.4, 8.4, 9.2, 7.4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(9.4, 8.4);
    ctx.lineTo(9.4, 5.2);
    ctx.lineTo(11.4, 5.2);
    ctx.lineTo(11.4, 3.4);
    ctx.lineTo(13.4, 3.4);
    ctx.lineTo(13.4, 5.2);
    ctx.lineTo(15.2, 5.2);
    ctx.lineTo(15.2, 3.4);
    ctx.lineTo(17.2, 3.4);
    ctx.lineTo(17.2, 5.2);
    ctx.lineTo(18.6, 5.2);
    ctx.lineTo(18.6, 8.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    fill(pal.paperBg);
    ctx.fillRect(12.9, 11.4, 2.2, 4.4);
  } else if (glyph === 'well_shrine') {
    stroke(main, 1.3);
    fill(hexToRgba(pal.waterFill, 0.5));
    ctx.beginPath();
    ctx.arc(14, 9.4, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    stroke(main, 0.9);
    ctx.beginPath();
    ctx.arc(14, 9.4, 3.6, 0, Math.PI * 2);
    ctx.stroke();
    fill(main);
    ctx.beginPath();
    ctx.moveTo(14, 4.6);
    ctx.bezierCurveTo(16.6, 7.4, 16.8, 9.4, 14, 10.4);
    ctx.bezierCurveTo(11.2, 9.4, 11.4, 7.4, 14, 4.6);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === 'ferry_anchor') {
    stroke(main, 1.4);
    ctx.beginPath();
    ctx.moveTo(14, 3.4);
    ctx.lineTo(14, 14.6);
    ctx.moveTo(9, 6.6);
    ctx.lineTo(19, 6.6);
    ctx.stroke();
    stroke(main, 1.2);
    ctx.beginPath();
    ctx.arc(14, 12.2, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    fill(main);
    ctx.beginPath();
    ctx.arc(14, 3.4, 1.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (glyph === 'gate_arch') {
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.rect(5.2, 7.2, 3.2, 8.4);
    ctx.rect(19.6, 7.2, 3.2, 8.4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(4.2, 5.2, 19.6, 2.6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3.2, 5.2);
    ctx.lineTo(14, 2.2);
    ctx.lineTo(24.8, 5.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(ink, 0.6);
    ctx.beginPath();
    ctx.moveTo(7, 15.6);
    ctx.lineTo(21, 15.6);
    ctx.stroke();
  } else if (glyph === 'market_tent') {
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.moveTo(6.2, 6.6);
    ctx.lineTo(16.4, 6.6);
    ctx.lineTo(11.3, 15.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(ink, 1.0);
    ctx.beginPath();
    ctx.moveTo(16.4, 6.6);
    ctx.lineTo(16.4, 15.4);
    ctx.stroke();
    fill(pal.roofInner);
    stroke(ink, 0.6);
    ctx.beginPath();
    ctx.moveTo(16.4, 3.2);
    ctx.lineTo(23.4, 4.8);
    ctx.lineTo(16.4, 6.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (glyph === 'mine_hammer') {
    stroke(main, 1.5);
    ctx.beginPath();
    ctx.moveTo(6.4, 14.2);
    ctx.lineTo(19.6, 4.4);
    ctx.moveTo(21.4, 13.8);
    ctx.lineTo(9.2, 4.6);
    ctx.stroke();
    fill(main);
    stroke(ink, 0.7);
    ctx.beginPath();
    ctx.rect(18.4, 2.6, 6.2, 3.2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5.2, 12.6);
    ctx.lineTo(8.6, 15.6);
    ctx.lineTo(6.2, 16.6);
    ctx.lineTo(3.6, 14.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (glyph === 'stele') {
    fill(main);
    stroke(ink, 0.9);
    ctx.beginPath();
    ctx.moveTo(9.6, 15.2);
    ctx.lineTo(9.6, 6.4);
    ctx.quadraticCurveTo(9.6, 3.2, 14, 3.2);
    ctx.quadraticCurveTo(18.4, 3.2, 18.4, 6.4);
    ctx.lineTo(18.4, 15.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    stroke(ink, 0.55);
    ctx.beginPath();
    ctx.moveTo(11.8, 7.2);
    ctx.lineTo(16.2, 7.2);
    ctx.moveTo(11.8, 9.6);
    ctx.lineTo(16.2, 9.6);
    ctx.moveTo(11.8, 12.0);
    ctx.lineTo(15.0, 12.0);
    ctx.stroke();
    stroke(ink, 1.1);
    ctx.beginPath();
    ctx.moveTo(6.6, 15.8);
    ctx.lineTo(21.4, 15.8);
    ctx.stroke();
  } else {
    fill(main);
    stroke(ink, 0.8);
    ctx.beginPath();
    ctx.rect(5, 5.5, 18, 8);
    ctx.fill();
    ctx.stroke();
    stroke(ink, 0.5);
    ctx.beginPath();
    ctx.moveTo(14, 5.5);
    ctx.lineTo(14, 13.5);
    ctx.stroke();
  }

  ctx.restore();
}

/* ------------------------------------------------------------------------------------------------
 * 四、绘图基础工具
 * ---------------------------------------------------------------------------------------------- */

function pathFromPoints(ctx, pts, sxFn, syFn, closed) {
  if (!Array.isArray(pts) || pts.length < 2) return false;
  ctx.beginPath();
  const p0 = pts[0];
  ctx.moveTo(sxFn(p0[0]), syFn(p0[1]));
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    ctx.lineTo(sxFn(p[0]), syFn(p[1]));
  }
  if (closed) ctx.closePath();
  return true;
}

function drawHaloText(ctx, textContent, x, y, font, fillColor, haloColor, align, baseline) {
  if (!textContent) return;
  ctx.font = font;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = baseline || 'middle';
  if (haloColor) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = haloColor;
    ctx.lineJoin = 'round';
    ctx.strokeText(textContent, x, y);
  }
  ctx.fillStyle = fillColor;
  ctx.fillText(textContent, x, y);
}

function niceScaleMeters(targetMeters) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let best = steps[0];
  let bestDiff = Infinity;
  for (let i = 0; i < steps.length; i += 1) {
    const diff = Math.abs(steps[i] - targetMeters);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = steps[i];
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * 五、14 层画家算法渲染
 * ---------------------------------------------------------------------------------------------- */

export function renderSceneToCanvas(ctx, project, compiledScene, viewport, renderOptions) {
  if (!ctx || !project || !viewport) return;
  const opts = renderOptions || {};
  const isExport = opts.isExport === true;
  const includeCartouche = opts.includeCartouche !== false;
  const ui = opts.ui || {};
  const palette = getActivePalette(project);
  const scene = compiledScene || { terrain: {}, hydro: {}, zones: [], buildings: [], trees: [] };
  const worldSizeM = num(project.meta && project.meta.worldSizeM, 2400);
  const zoom = viewport.zoom;
  const panX = viewport.panX;
  const panY = viewport.panY;
  const sx = (wx) => wx * zoom + panX;
  const sy = (wy) => wy * zoom + panY;
  const W = viewport.widthPx;
  const H = viewport.heightPx;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* Layer 01 — 羊皮纸底色与亚麻微噪理层 ------------------------------------------------ */
  ctx.fillStyle = palette.paperBg;
  ctx.fillRect(0, 0, W, H);
  const cx = W * 0.5;
  const cy = H * 0.5;
  const radius = Math.max(W, H) * 0.72;
  const vignette = ctx.createRadialGradient(cx, cy, radius * 0.28, cx, cy, radius);
  vignette.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
  vignette.addColorStop(1, 'rgba(120, 100, 68, 0.10)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  if (isExport === false) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = palette.inkDark;
    ctx.lineWidth = 0.6;
    const fibers = 46;
    for (let i = 0; i < fibers; i += 1) {
      const fy = ((i * 137.5) % 100) / 100 * H;
      const fx = ((i * 61.8) % 100) / 100 * W;
      const len = 24 + ((i * 37) % 70);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + len, fy + ((i % 5) - 2) * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 图幅纸边
  ctx.strokeStyle = hexToRgba(palette.inkDark, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(sx(0), sy(0), worldSizeM * zoom, worldSizeM * zoom);

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx(0), sy(0), worldSizeM * zoom, worldSizeM * zoom);
  ctx.clip();

  /* Layer 02 — 农田条垄、晒盐卤畦与集场铺装底层 ---------------------------------------- */
  const plots = Array.isArray(scene.farmlandPlots) ? scene.farmlandPlots : [];
  for (let i = 0; i < plots.length; i += 1) {
    const plot = plots[i];
    const poly = plot.innerPolygon || plot.polygon;
    if (!pathFromPoints(ctx, poly, sx, sy, true)) continue;
    ctx.fillStyle = palette.farmlandFill;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexToRgba('#8a7a52', 0.55);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    const furrows = Array.isArray(plot.furrows) ? plot.furrows : [];
    ctx.strokeStyle = hexToRgba(palette.contourLine, 0.42);
    ctx.lineWidth = Math.max(0.45, 0.7 * Math.min(1.2, zoom * 2.2));
    ctx.beginPath();
    for (let f = 0; f < furrows.length; f += 1) {
      const line = furrows[f];
      if (!Array.isArray(line) || line.length < 2) continue;
      ctx.moveTo(sx(line[0][0]), sy(line[0][1]));
      for (let k = 1; k < line.length; k += 1) {
        ctx.lineTo(sx(line[k][0]), sy(line[k][1]));
      }
    }
    ctx.stroke();
  }

  const salts = Array.isArray(scene.saltpanCells) ? scene.saltpanCells : [];
  for (let i = 0; i < salts.length; i += 1) {
    const cell = salts[i];
    if (!pathFromPoints(ctx, cell.polygon, sx, sy, true)) continue;
    ctx.fillStyle = palette.saltpanFill;
    ctx.globalAlpha = clampNum(num(cell.opacity, 0.9), 0.2, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  const aprons = Array.isArray(scene.marketAprons) ? scene.marketAprons : [];
  for (let i = 0; i < aprons.length; i += 1) {
    const apron = aprons[i];
    if (!pathFromPoints(ctx, apron.points, sx, sy, true)) continue;
    if (apron.kind === 'parade_ground') {
      ctx.fillStyle = hexToRgba(palette.farmlandFill, 0.55);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(palette.inkDark, 0.25);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = hexToRgba(palette.farmlandFill, 0.52);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(palette.inkDark, 0.32);
      ctx.lineWidth = 0.9;
      ctx.setLineDash([5 * Math.max(0.6, zoom), 4 * Math.max(0.6, zoom)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* Layer 03 — 等高线与可选陡坎短齿线层 ------------------------------------------------ */
  const contours = Array.isArray(scene.terrain && scene.terrain.contours) ? scene.terrain.contours : [];
  ctx.strokeStyle = palette.contourLine;
  for (let i = 0; i < contours.length; i += 1) {
    const contour = contours[i];
    if (!pathFromPoints(ctx, contour.points, sx, sy, contour.closed === true)) continue;
    if (contour.isIndex) {
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = 1.45;
    } else {
      ctx.globalAlpha = 0.48;
      ctx.lineWidth = 0.75;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (zoom > 0.3) {
    ctx.font = `${Math.max(8, Math.min(11, 9 + zoom * 4))}px "Avenir Next", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < contours.length; i += 1) {
      const contour = contours[i];
      if (!contour.isIndex || !Array.isArray(contour.points) || contour.points.length < 12) continue;
      const idx = Math.floor(contour.points.length * 0.42);
      const p = contour.points[idx];
      const px = sx(p[0]);
      const py = sy(p[1]);
      if (px < 8 || py < 8 || px > W - 8 || py > H - 8) continue;
      drawHaloText(ctx, `${Math.round(contour.elev)}m`, px, py, ctx.font,
        hexToRgba(palette.inkDark, 0.62), hexToRgba(palette.paperBg, 0.9), 'center');
    }
  }

  const ticks = Array.isArray(scene.terrain && scene.terrain.scarpTicks) ? scene.terrain.scarpTicks : [];
  if (ticks.length > 0) {
    ctx.strokeStyle = hexToRgba(palette.contourLine, 0.95);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < ticks.length; i += 1) {
      const tk = ticks[i];
      ctx.moveTo(sx(tk.x1), sy(tk.y1));
      ctx.lineTo(sx(tk.x2), sy(tk.y2));
    }
    ctx.stroke();
  }

  /* Layer 04 — 湖海与纯净变宽河道水体层 ------------------------------------------------ */
  const hydro = scene.hydro || {};
  const waterBodies = Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [];
  for (let i = 0; i < waterBodies.length; i += 1) {
    const wb = waterBodies[i];
    if (!pathFromPoints(ctx, wb.shorePoly, sx, sy, true)) continue;
    ctx.fillStyle = palette.waterFill;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.55);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    const ripples = Array.isArray(wb.ripples) ? wb.ripples : [];
    ctx.strokeStyle = palette.waterRipple;
    ctx.lineWidth = 0.9;
    for (let r = 0; r < ripples.length; r += 1) {
      if (!pathFromPoints(ctx, ripples[r], sx, sy, true)) continue;
      ctx.globalAlpha = 0.85 - r * 0.18;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const rivers = Array.isArray(hydro.rivers) ? hydro.rivers : [];
  for (let i = 0; i < rivers.length; i += 1) {
    const river = rivers[i];
    if (!pathFromPoints(ctx, river.bankPolygon, sx, sy, true)) continue;
    ctx.fillStyle = palette.waterFill;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.5);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    const ripples = Array.isArray(river.ripples) ? river.ripples : [];
    ctx.strokeStyle = palette.waterRipple;
    ctx.lineWidth = 0.9;
    for (let r = 0; r < ripples.length; r += 1) {
      const run = ripples[r];
      if (!pathFromPoints(ctx, run, sx, sy, false)) continue;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* Layer 05 — 显式基岩暗礁与浅滩渡口层 ------------------------------------------------ */
  const reefs = Array.isArray(hydro.reefs) ? hydro.reefs : [];
  for (let i = 0; i < reefs.length; i += 1) {
    const reef = reefs[i];
    const rocks = Array.isArray(reef.rocks) ? reef.rocks : [];
    for (let r = 0; r < rocks.length; r += 1) {
      if (!pathFromPoints(ctx, rocks[r].points, sx, sy, true)) continue;
      ctx.fillStyle = '#585550';
      ctx.fill();
      ctx.strokeStyle = palette.inkDark;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.strokeStyle = palette.waterRipple;
    ctx.lineWidth = 1;
    ctx.setLineDash([3.2, 2.6]);
    pathFromPoints(ctx, reef.foamRing, sx, sy, true);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const fords = Array.isArray(hydro.fordCrossings) ? hydro.fordCrossings : [];
  for (let i = 0; i < fords.length; i += 1) {
    const ford = fords[i];
    const tx = num(ford.tangent && ford.tangent[0], 0);
    const ty = num(ford.tangent && ford.tangent[1], 1);
    const half = (num(ford.riverWidthM, 30) * 0.5) + 2;
    ctx.fillStyle = hexToRgba(palette.inkDark, 0.72);
    for (let side = -1; side <= 1; side += 2) {
      for (let k = -1; k <= 1; k += 1) {
        const along = k * 3.2;
        const px = ford.x + tx * along - ty * side * 2.2;
        const py = ford.y + ty * along + tx * side * 2.2;
        ctx.beginPath();
        ctx.arc(sx(px), sy(py), Math.max(0.9, 1.5 * Math.min(1.4, zoom * 3)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = hexToRgba(palette.waterRipple, 0.9);
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2.4, 2.4]);
    ctx.beginPath();
    ctx.moveTo(sx(ford.x - ty * half), sy(ford.y + tx * half));
    ctx.lineTo(sx(ford.x + ty * half), sy(ford.y - tx * half));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Layer 06 — 明渠与坎儿井暗渠层 ------------------------------------------------------ */
  const canals = Array.isArray(hydro.canals) ? hydro.canals : [];
  for (let i = 0; i < canals.length; i += 1) {
    const canal = canals[i];
    if (canal.style === 'qanat') {
      ctx.strokeStyle = '#2f6a72';
      ctx.lineWidth = Math.max(1, 1.7 * Math.min(1.5, zoom * 3));
      ctx.setLineDash([8, 6]);
      if (pathFromPoints(ctx, canal.centerline, sx, sy, false)) ctx.stroke();
      ctx.setLineDash([]);
      const shafts = Array.isArray(canal.shaftPoints) ? canal.shaftPoints : [];
      for (let s = 0; s < shafts.length; s += 1) {
        const shaft = shafts[s];
        const px = sx(shaft.x);
        const py = sy(shaft.y);
        const r = Math.max(2, shaft.radiusM * zoom * 0.9);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = palette.paperBg;
        ctx.fill();
        ctx.strokeStyle = '#2f6a72';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    } else {
      if (pathFromPoints(ctx, canal.bankPolygon, sx, sy, true)) {
        ctx.fillStyle = palette.waterFill;
        ctx.fill();
        ctx.strokeStyle = hexToRgba(palette.inkDark, 0.5);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }
  }

  /* Layer 06b — 村寨菜畦（虚线园圃） ---------------------------------------------------- */
  const fences = Array.isArray(scene.gardenFences) ? scene.gardenFences : [];
  if (fences.length > 0) {
    ctx.save();
    for (let i = 0; i < fences.length; i += 1) {
      const fence = fences[i];
      const ring = fence && Array.isArray(fence.points) ? fence.points : null;
      if (!ring || ring.length < 3) continue;
      if (pathFromPoints(ctx, ring, sx, sy, true)) {
        ctx.fillStyle = hexToRgba(palette.farmlandFill, 0.30);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(palette.inkDark, 0.34);
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /* Layer 07 — 选区内部街巷、村径与主次干道层（严格两遍路缘法） ------------------------- */
  const internal = Array.isArray(scene.internalStreets) ? scene.internalStreets : [];
  const lanes = Array.isArray(scene.lanes) ? scene.lanes : [];
  const roads = Array.isArray(hydro.roads) ? hydro.roads : [];
  const streetW = Math.max(1.2, 4.2 * Math.min(1.6, zoom * 3.2));

  // Pass 1：先画全部道路的深色路缘底线（含街巷与村径），避免后画道路切断先画路面形成黑叉
  if (internal.length > 0) {
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.30);
    ctx.lineWidth = streetW + 1.6;
    ctx.beginPath();
    for (let i = 0; i < internal.length; i += 1) {
      const seg = internal[i];
      if (!Array.isArray(seg) || seg.length < 2) continue;
      ctx.moveTo(sx(seg[0][0]), sy(seg[0][1]));
      ctx.lineTo(sx(seg[1][0]), sy(seg[1][1]));
    }
    ctx.stroke();
  }
  for (let i = 0; i < lanes.length; i += 1) {
    if (!pathFromPoints(ctx, lanes[i], sx, sy, false)) continue;
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.26);
    ctx.lineWidth = Math.max(2, 4.5 * zoom + 2.2);
    ctx.stroke();
  }
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    const wPx = Math.max(1.1, road.widthM * zoom);
    if (!pathFromPoints(ctx, road.centerline, sx, sy, false)) continue;
    if (road.tier === 'lane') {
      ctx.strokeStyle = hexToRgba(palette.inkDark, 0.22);
      ctx.lineWidth = wPx + 1.4;
    } else {
      ctx.strokeStyle = '#5b4a38';
      ctx.lineWidth = wPx + 2.2;
    }
    ctx.stroke();
  }

  // Pass 2：再统一画全部亮色路面
  if (internal.length > 0) {
    ctx.strokeStyle = palette.roadFill;
    ctx.lineWidth = streetW;
    ctx.beginPath();
    for (let i = 0; i < internal.length; i += 1) {
      const seg = internal[i];
      if (!Array.isArray(seg) || seg.length < 2) continue;
      ctx.moveTo(sx(seg[0][0]), sy(seg[0][1]));
      ctx.lineTo(sx(seg[1][0]), sy(seg[1][1]));
    }
    ctx.stroke();
  }
  for (let i = 0; i < lanes.length; i += 1) {
    if (!pathFromPoints(ctx, lanes[i], sx, sy, false)) continue;
    ctx.strokeStyle = palette.roadFill;
    ctx.lineWidth = Math.max(1.2, 4.5 * zoom);
    ctx.stroke();
  }
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    const wPx = Math.max(1.1, road.widthM * zoom);
    if (!pathFromPoints(ctx, road.centerline, sx, sy, false)) continue;
    ctx.strokeStyle = palette.roadFill;
    ctx.lineWidth = wPx;
    ctx.stroke();
  }

  // Pass 3：村径中心虚线（叠加在已完成的路面之上）
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    if (road.tier !== 'lane') continue;
    const wPx = Math.max(1.1, road.widthM * zoom);
    if (!pathFromPoints(ctx, road.centerline, sx, sy, false)) continue;
    ctx.strokeStyle = hexToRgba('#5b4a38', 0.55);
    ctx.lineWidth = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Layer 08 — 自动正交桥梁层 ---------------------------------------------------------- */
  const bridges = Array.isArray(hydro.bridges) ? hydro.bridges : [];
  for (let i = 0; i < bridges.length; i += 1) {
    const bridge = bridges[i];
    if (!pathFromPoints(ctx, bridge.corners, sx, sy, true)) continue;
    ctx.fillStyle = palette.roadFill;
    ctx.fill();
    ctx.strokeStyle = palette.inkDark;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.lineWidth = Math.max(1.6, 2.2 * Math.min(1.6, zoom * 3));
    ctx.beginPath();
    ctx.moveTo(sx(bridge.parapetLeft[0][0]), sy(bridge.parapetLeft[0][1]));
    ctx.lineTo(sx(bridge.parapetLeft[1][0]), sy(bridge.parapetLeft[1][1]));
    ctx.moveTo(sx(bridge.parapetRight[0][0]), sy(bridge.parapetRight[0][1]));
    ctx.lineTo(sx(bridge.parapetRight[1][0]), sy(bridge.parapetRight[1][1]));
    ctx.stroke();
    const abutments = Array.isArray(bridge.abutments) ? bridge.abutments : [];
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let a = 0; a < abutments.length; a += 1) {
      const wing = abutments[a];
      if (!Array.isArray(wing) || wing.length < 2) continue;
      ctx.moveTo(sx(wing[0][0]), sy(wing[0][1]));
      ctx.lineTo(sx(wing[1][0]), sy(wing[1][1]));
    }
    ctx.stroke();
  }

  /* Layer 09 — 屋宇东南微阴影与钢笔淡彩屋顶层 ------------------------------------------ */
  const buildings = Array.isArray(scene.buildings) ? scene.buildings : [];
  const shadowShift = 1.8 * zoom;
  ctx.fillStyle = 'rgba(43, 37, 32, 0.18)';
  ctx.beginPath();
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    const pts = b.points;
    if (!Array.isArray(pts) || pts.length < 3) continue;
    ctx.moveTo(sx(pts[0][0]) + shadowShift, sy(pts[0][1]) + shadowShift);
    for (let k = 1; k < pts.length; k += 1) {
      ctx.lineTo(sx(pts[k][0]) + shadowShift, sy(pts[k][1]) + shadowShift);
    }
    ctx.closePath();
  }
  ctx.fill();

  for (let pass = 0; pass < 2; pass += 1) {
    const roofKind = pass === 0 ? 'inner' : 'town';
    ctx.fillStyle = roofKind === 'inner' ? palette.roofInner : palette.roofTown;
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if ((b.roofKind === 'inner' ? 'inner' : 'town') !== roofKind) continue;
      const pts = b.points;
      if (!Array.isArray(pts) || pts.length < 3) continue;
      any = true;
      ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
      for (let k = 1; k < pts.length; k += 1) {
        ctx.lineTo(sx(pts[k][0]), sy(pts[k][1]));
      }
      ctx.closePath();
    }
    if (!any) continue;
    ctx.fill();
    ctx.strokeStyle = palette.inkDark;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }

  ctx.strokeStyle = hexToRgba(palette.inkDark, 0.55);
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    if (!b.ridge) continue;
    ctx.moveTo(sx(b.ridge[0][0]), sy(b.ridge[0][1]));
    ctx.lineTo(sx(b.ridge[1][0]), sy(b.ridge[1][1]));
  }
  ctx.stroke();

  /* Layer 10 — 城垣、角楼敌台与城门阙楼层 ---------------------------------------------- */
  const walls = Array.isArray(scene.walls) ? scene.walls : [];
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    const thicknessPx = Math.max(1.6, wall.thicknessM * zoom);
    if (!pathFromPoints(ctx, wall.polyline, sx, sy, wall.closed === true)) continue;
    ctx.strokeStyle = '#504233';
    ctx.lineWidth = thicknessPx;
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.85);
    ctx.lineWidth = Math.max(0.8, thicknessPx * 0.34);
    ctx.stroke();
  }

  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    const towers = Array.isArray(wall.towers) ? wall.towers : [];
    for (let t = 0; t < towers.length; t += 1) {
      const tower = towers[t];
      const r = Math.max(1.8, num(tower.radiusM, 5.2) * zoom);
      ctx.beginPath();
      ctx.arc(sx(tower.x), sy(tower.y), r, 0, Math.PI * 2);
      ctx.fillStyle = '#504233';
      ctx.fill();
      ctx.strokeStyle = palette.inkDark;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx(tower.x), sy(tower.y), Math.max(0.8, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(palette.paperBg, 0.55);
      ctx.fill();
    }
  }

  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    const gates = Array.isArray(wall.gates) ? wall.gates : [];
    const halfThickness = Math.max(2.4, 0.5 * num(wall.thicknessM, 5));
    for (let g = 0; g < gates.length; g += 1) {
      const gate = gates[g];
      const half = Math.max(3, num(gate.gapHalf, 10));
      const ang = (num(gate.angleDeg, 0) * Math.PI) / 180;
      const tx = Math.cos(ang);
      const ty = Math.sin(ang);
      const nx = -ty;
      const ny = tx;
      // 城门开口沿墙切向，厚度沿墙段真实法向 —— 南北向城门同样有厚度
      const c1 = [gate.x - tx * half - nx * halfThickness, gate.y - ty * half - ny * halfThickness];
      const c2 = [gate.x + tx * half - nx * halfThickness, gate.y + ty * half - ny * halfThickness];
      const c3 = [gate.x + tx * half + nx * halfThickness, gate.y + ty * half + ny * halfThickness];
      const c4 = [gate.x - tx * half + nx * halfThickness, gate.y - ty * half + ny * halfThickness];
      ctx.fillStyle = palette.roadFill;
      ctx.strokeStyle = palette.inkDark;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx(c1[0]), sy(c1[1]));
      ctx.lineTo(sx(c2[0]), sy(c2[1]));
      ctx.lineTo(sx(c3[0]), sy(c3[1]));
      ctx.lineTo(sx(c4[0]), sy(c4[1]));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /* Layer 10b — 市集水井与井圈 --------------------------------------------------------- */
  const wells = Array.isArray(scene.wells) ? scene.wells : [];
  for (let i = 0; i < wells.length; i += 1) {
    const well = wells[i];
    if (!well || !Number.isFinite(well.x) || !Number.isFinite(well.y)) continue;
    const wr = Math.max(1.4, num(well.radiusM, 2.2) * zoom);
    const px = sx(well.x);
    const py = sy(well.y);
    ctx.beginPath();
    ctx.arc(px, py, wr, 0, Math.PI * 2);
    ctx.fillStyle = palette.waterFill;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.72);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.8, wr * 0.42), 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.45);
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - wr - 1.4, py);
    ctx.lineTo(px - wr - 0.2, py);
    ctx.moveTo(px + wr + 0.2, py);
    ctx.lineTo(px + wr + 1.4, py);
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.55);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  /* Layer 11 — Watabou 双遍融合树冠层 -------------------------------------------------- */
  const trees = Array.isArray(scene.trees) ? scene.trees : [];
  renderMergedTreeCanopy(ctx, trees, viewport, palette);

  /* Layer 12 — 地标戳记与地名书法注记层 ------------------------------------------------ */
  const landmarks = Array.isArray(project.landmarks) ? project.landmarks : [];
  const legendAll = (project.legend && Array.isArray(project.legend.items)) ? project.legend.items : [];
  for (let i = 0; i < landmarks.length; i += 1) {
    const lm = landmarks[i];
    let item = null;
    for (let k = 0; k < legendAll.length; k += 1) {
      if (legendAll[k] && legendAll[k].key === lm.legendKey) {
        item = legendAll[k];
        break;
      }
    }
    const sizePx = clampNum(num(lm.sizePx, 15), 8, 48);
    const gx = sx(lm.x) - sizePx * 0.5;
    const gy = sy(lm.y) - sizePx * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx(lm.x), sy(lm.y), sizePx * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(palette.paperBg, 0.92);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(palette.inkDark, 0.35);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
    drawLegendGlyphCanvas(ctx, item || { glyphType: lm.glyphType, color: palette.inkDark }, gx, gy, sizePx, sizePx * 0.64, palette);
    if (lm.showLabel !== false && lm.label) {
      const fs = Math.max(9, Math.min(14, 10.5 + zoom * 3));
      const anchorY = sy(lm.y) + sizePx * 0.62 + 9;
      drawHaloText(ctx, lm.label, sx(lm.x) + sizePx * 0.5 + 4, anchorY,
        `600 ${fs}px "Palatino Linotype", "Songti SC", serif`,
        palette.inkDark, hexToRgba(palette.paperBg, 0.95), 'left');
    }
  }

  if (zoom > 0.22) {
    const zones = Array.isArray(scene.zones) ? scene.zones : [];
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i];
      if (!zone || !zone.name) continue;
      const centroid = zoneCentroid(zone.points);
      if (!centroid) continue;
      const fs = Math.max(10, Math.min(19, 11 + zoom * 9));
      drawHaloText(ctx, zone.name, sx(centroid[0]), sy(centroid[1]),
        `italic ${fs}px "Palatino Linotype", "Songti SC", serif`,
        hexToRgba(palette.inkDark, 0.62), hexToRgba(palette.paperBg, 0.82), 'center');
    }
    for (let i = 0; i < rivers.length; i += 1) {
      const river = rivers[i];
      const cl = river.centerline;
      if (!Array.isArray(cl) || cl.length < 4 || !river.name) continue;
      const p = cl[Math.floor(cl.length * 0.5)];
      const fs = Math.max(9, Math.min(14, 9 + zoom * 6));
      drawHaloText(ctx, river.name, sx(p[0]), sy(p[1]) - 8,
        `italic ${fs}px "Palatino Linotype", "Songti SC", serif`,
        hexToRgba(palette.inkDark, 0.55), hexToRgba(palette.paperBg, 0.85), 'center');
    }
  }

  ctx.restore(); // 结束图幅裁剪

  /* Layer 13 — 成图图饰层 -------------------------------------------------------------- */
  if (includeCartouche) {
    drawCartouche(ctx, project, scene, viewport, palette, W, H);
  }

  /* Layer 14 — 交互编辑覆盖层（导出时强制关闭） ---------------------------------------- */
  if (!isExport) {
    drawInteractionOverlay(ctx, project, scene, viewport, palette, ui);
  }

  ctx.restore();
}

function zoneCentroid(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
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
    let sx0 = 0;
    let sy0 = 0;
    for (let i = 0; i < n; i += 1) {
      sx0 += points[i][0];
      sy0 += points[i][1];
    }
    return [sx0 / n, sy0 / n];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

/* ------------------------------------------------------------------------------------------------
 * 六、图饰层：双线图框、标题签、指北针、比例尺与真图形图例框
 * ---------------------------------------------------------------------------------------------- */

function drawCartouche(ctx, project, scene, viewport, palette, W, H) {
  const zoom = viewport.zoom;
  const ink = palette.inkDark;
  const paper = palette.paperBg;

  ctx.save();
  ctx.strokeStyle = hexToRgba(ink, 0.55);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(16.5, 16.5, W - 33, H - 33);
  ctx.strokeStyle = hexToRgba(ink, 0.3);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(22.5, 22.5, W - 45, H - 45);

  const meta = project.meta || {};
  const title = String(meta.name || '未命名聚落测绘图');
  const subtitle = String(meta.subtitle || '');
  const titleFont = `600 ${Math.max(18, Math.min(30, W * 0.021))}px "Palatino Linotype", "Songti SC", serif`;
  const subFont = `${Math.max(10, Math.min(15, W * 0.0105))}px "Avenir Next", "PingFang SC", sans-serif`;

  ctx.font = titleFont;
  const titleW = ctx.measureText(title).width;
  ctx.font = subFont;
  const subW = subtitle ? ctx.measureText(subtitle).width : 0;
  const plateW = Math.max(titleW, subW) + 34;
  const plateH = subtitle ? 62 : 44;
  const plateX = 30;
  const plateY = 28;
  ctx.fillStyle = hexToRgba(paper, 0.82);
  ctx.fillRect(plateX, plateY, plateW, plateH);
  ctx.strokeStyle = hexToRgba(ink, 0.38);
  ctx.lineWidth = 0.9;
  ctx.strokeRect(plateX, plateY, plateW, plateH);
  ctx.fillStyle = hexToRgba(ink, 0.72);
  ctx.fillRect(plateX, plateY, 4, plateH);

  ctx.font = titleFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.fillText(title, plateX + 16, plateY + (subtitle ? 24 : plateH * 0.5));
  if (subtitle) {
    ctx.font = subFont;
    ctx.fillStyle = hexToRgba(ink, 0.7);
    ctx.fillText(subtitle, plateX + 16, plateY + 45);
  }

  // 指北针
  const compassX = W - 58;
  const compassY = 58;
  ctx.beginPath();
  ctx.arc(compassX, compassY, 19, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(paper, 0.8);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(ink, 0.45);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(compassX, compassY - 14);
  ctx.lineTo(compassX + 5.2, compassY + 3);
  ctx.lineTo(compassX, compassY + 0.5);
  ctx.lineTo(compassX - 5.2, compassY + 3);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(ink, 0.88);
  ctx.fill();
  ctx.font = '600 10px "Palatino Linotype", serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(ink, 0.75);
  ctx.fillText('N', compassX, compassY + 13);

  // 比例尺
  const targetPx = Math.min(190, W * 0.17);
  const meters = niceScaleMeters(targetPx / zoom);
  const barPx = meters * zoom;
  const barX = 34;
  const barY = H - 44;
  const segments = 4;
  ctx.fillStyle = hexToRgba(paper, 0.86);
  ctx.fillRect(barX - 8, barY - 22, barPx + 16, 40);
  ctx.strokeStyle = hexToRgba(ink, 0.32);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(barX - 8, barY - 22, barPx + 16, 40);
  for (let i = 0; i < segments; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? hexToRgba(ink, 0.8) : hexToRgba(paper, 0.95);
    ctx.fillRect(barX + (barPx / segments) * i, barY, barPx / segments, 7);
  }
  ctx.strokeStyle = hexToRgba(ink, 0.65);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(barX, barY, barPx, 7);
  ctx.font = '10px "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = hexToRgba(ink, 0.78);
  ctx.fillText('0', barX, barY + 10);
  ctx.fillText(`${meters} m`, barX + barPx, barY + 10);

  // 真图形图例框
  const legend = project.legend || {};
  if (legend.visible === false) {
    ctx.restore();
    return;
  }
  const items = (Array.isArray(legend.items) ? legend.items : []).filter(
    (item) => item && item.visible !== false && item.autoPresent !== false
  );
  if (items.length === 0) {
    ctx.restore();
    return;
  }
  const columns = legend.columns === 1 ? 1 : 2;
  const colW = Math.max(148, Math.min(196, W * 0.135));
  const rowH = 22;
  const pad = 12;
  const titleH = legend.title ? 24 : 6;
  const rows = Math.ceil(items.length / columns);
  const boxW = columns * colW + pad * 2;
  const boxH = titleH + rows * rowH + pad;
  const margin = 30;
  const pos = legend.position || 'bottom-right';
  let boxX = W - boxW - margin;
  let boxY = H - boxH - margin;
  // 四角自动避让：左上标题牌 / 右上指北针 / 左下比例尺 / 右下悬浮按钮
  if (pos === 'bottom-left') {
    boxX = margin;
    boxY = H - boxH - margin - 46;
  } else if (pos === 'top-right') {
    boxX = W - boxW - margin;
    boxY = margin + 76;
  } else if (pos === 'top-left') {
    boxX = margin;
    boxY = margin + 78;
  } else {
    boxX = W - boxW - margin;
    boxY = H - boxH - margin - 46;
  }
  boxX = Math.max(margin, Math.min(W - boxW - margin, boxX));
  boxY = Math.max(margin, Math.min(H - boxH - margin, boxY));

  ctx.fillStyle = hexToRgba(paper, 0.93);
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = hexToRgba(ink, 0.5);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = hexToRgba(ink, 0.25);
  ctx.lineWidth = 0.6;
  ctx.strokeRect(boxX + 3.5, boxY + 3.5, boxW - 7, boxH - 7);

  if (legend.title) {
    ctx.font = '600 12px "Palatino Linotype", "Songti SC", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexToRgba(ink, 0.9);
    ctx.fillText(String(legend.title), boxX + pad, boxY + 14);
  }

  const maxLabelW = colW - 42;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const col = Math.floor(i / rows);
    const row = i % rows;
    const gx = boxX + pad + col * colW;
    const gy = boxY + titleH + row * rowH;
    drawLegendGlyphCanvas(ctx, item, gx, gy + 2, 28, 18, palette);
    ctx.font = '11px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexToRgba(ink, 0.88);
    ctx.fillText(truncateText(ctx, String(item.label || item.key || ''), maxLabelW), gx + 34, gy + 11);
  }

  ctx.restore();
}

function truncateText(ctx, textContent, maxWidth) {
  if (ctx.measureText(textContent).width <= maxWidth) return textContent;
  let out = textContent;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/* ------------------------------------------------------------------------------------------------
 * 七、交互覆盖层
 * ---------------------------------------------------------------------------------------------- */

function drawInteractionOverlay(ctx, project, scene, viewport, palette, ui) {
  const zoom = viewport.zoom;
  const sx = (wx) => wx * zoom + viewport.panX;
  const sy = (wy) => wy * zoom + viewport.panY;
  const accent = '#b55838';
  const pine = '#365942';

  const selection = ui.selection || null;
  const hover = ui.hover || null;

  // 选区外框与顶点柄
  const zones = Array.isArray(project.zones) ? project.zones : [];
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    const pts = zone.points;
    if (!Array.isArray(pts) || pts.length < 3) continue;
    if (zone.contentType === 'exclusion') {
      // 编辑态常驻禁建提示：半透明斜纹 + 虚线框
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
      for (let k = 1; k < pts.length; k += 1) ctx.lineTo(sx(pts[k][0]), sy(pts[k][1]));
      ctx.closePath();
      ctx.fillStyle = 'rgba(181, 88, 56, 0.05)';
      ctx.fill();
      ctx.save();
      ctx.clip();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < pts.length; k += 1) {
        const px = sx(pts[k][0]);
        const py = sy(pts[k][1]);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      const hatchSpan = Math.max(maxX - minX, maxY - minY);
      ctx.strokeStyle = 'rgba(181, 88, 56, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -hatchSpan; d < hatchSpan * 1.4; d += 13) {
        ctx.moveTo(minX + d, minY);
        ctx.lineTo(minX + d + hatchSpan, maxY);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(181, 88, 56, 0.78)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    const isSelected = selection && selection.type === 'zone' && selection.id === zone.id;
    const isHover = hover && hover.type === 'zone' && hover.id === zone.id;
    if (!isSelected && !isHover) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
    for (let k = 1; k < pts.length; k += 1) ctx.lineTo(sx(pts[k][0]), sy(pts[k][1]));
    ctx.closePath();
    ctx.fillStyle = isSelected ? 'rgba(181, 88, 56, 0.07)' : 'rgba(181, 88, 56, 0.03)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = isSelected ? 1.8 : 1.1;
    ctx.setLineDash(isSelected ? [] : [5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (isSelected) {
      for (let k = 0; k < pts.length; k += 1) {
        const px = sx(pts[k][0]);
        const py = sy(pts[k][1]);
        ctx.beginPath();
        ctx.rect(px - 4, py - 4, 8, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      for (let k = 0; k < pts.length; k += 1) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const mx = (a[0] + b[0]) * 0.5;
        const my = (a[1] + b[1]) * 0.5;
        const px = sx(mx);
        const py = sy(my);
        ctx.beginPath();
        ctx.arc(px, py, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(181, 88, 56, 0.28)';
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - 2, py);
        ctx.lineTo(px + 2, py);
        ctx.moveTo(px, py - 2);
        ctx.lineTo(px, py + 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 线状 / 面状水系选中：绘制可拖拽顶点手柄
  if (selection) {
    const polyMap = {
      river: Array.isArray(project.rivers) ? project.rivers : [],
      road: Array.isArray(project.roads) ? project.roads : [],
      canal: Array.isArray(project.canals) ? project.canals : [],
      waterBody: Array.isArray(project.waterBodies) ? project.waterBodies : []
    };
    const list = polyMap[selection.type];
    if (list) {
      const obj = list.find((item) => item && item.id === selection.id);
      if (obj && Array.isArray(obj.points)) {
        for (let i = 0; i < obj.points.length; i += 1) {
          const px = sx(obj.points[i][0]);
          const py = sy(obj.points[i][1]);
          ctx.beginPath();
          ctx.rect(px - 4.5, py - 4.5, 9, 9);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.fill();
        }
      }
    }
    if (selection.type === 'ford') {
      const ford = (Array.isArray(project.fords) ? project.fords : []).find((f) => f && f.id === selection.id);
      if (ford) {
        const px = sx(ford.x);
        const py = sy(ford.y);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(9, 24 * zoom), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px - 6, py);
        ctx.lineTo(px + 6, py);
        ctx.moveTo(px, py - 6);
        ctx.lineTo(px, py + 6);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 水路 / 道路 / 水渠 / 岩礁 / 地标选中高亮
  if (selection) {
    const hydro = scene.hydro || {};
    const highlightPolyline = (points, color, width, closed) => {
      if (!Array.isArray(points) || points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(sx(points[0][0]), sy(points[0][1]));
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(sx(points[i][0]), sy(points[i][1]));
      if (closed) ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
    if (selection.type === 'river') {
      const river = (hydro.rivers || []).find((r) => r.id === selection.id);
      if (river) highlightPolyline(river.centerline, accent, 2.2, false);
    } else if (selection.type === 'road') {
      const road = (hydro.roads || []).find((r) => r.id === selection.id);
      if (road) highlightPolyline(road.centerline, accent, 2.2, false);
    } else if (selection.type === 'canal') {
      const canal = (hydro.canals || []).find((r) => r.id === selection.id);
      if (canal) highlightPolyline(canal.centerline, accent, 2.2, false);
    } else if (selection.type === 'waterBody') {
      const wb = (hydro.waterBodies || []).find((r) => r.id === selection.id);
      if (wb) highlightPolyline(wb.shorePoly, accent, 2.2, true);
    } else if (selection.type === 'reef') {
      const reef = (hydro.reefs || []).find((r) => r.id === selection.id);
      if (reef) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(sx(reef.x), sy(reef.y), Math.max(6, (reef.radiusM + 6) * zoom), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (selection.type === 'landmark') {
      const lm = (project.landmarks || []).find((r) => r.id === selection.id);
      if (lm) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sx(lm.x), sy(lm.y), Math.max(10, lm.sizePx * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (selection.type === 'shape') {
      drawShapeHandles(ctx, project, selection.id, viewport, palette);
    }
  }

  // 绘制草稿（河 / 渠 / 路 / 选区 / 山脊）
  const draft = ui.draft;
  if (draft && Array.isArray(draft.points) && draft.points.length > 0) {
    ctx.save();
    ctx.strokeStyle = draft.kind === 'zone' ? accent : pine;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(sx(draft.points[0][0]), sy(draft.points[0][1]));
    for (let i = 1; i < draft.points.length; i += 1) {
      ctx.lineTo(sx(draft.points[i][0]), sy(draft.points[i][1]));
    }
    if (draft.cursor) {
      ctx.lineTo(sx(draft.cursor[0]), sy(draft.cursor[1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < draft.points.length; i += 1) {
      ctx.beginPath();
      ctx.arc(sx(draft.points[i][0]), sy(draft.points[i][1]), 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = draft.kind === 'zone' ? accent : pine;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    if (draft.kind === 'zone' && draft.points.length >= 3) {
      let area2 = 0;
      for (let i = 0; i < draft.points.length; i += 1) {
        const a = draft.points[i];
        const b = draft.points[(i + 1) % draft.points.length];
        area2 += a[0] * b[1] - b[0] * a[1];
      }
      const ha = Math.abs(area2 * 0.5) / 10000;
      const c = zoneCentroid(draft.points);
      if (c) {
        drawHaloText(ctx, `${ha.toFixed(2)} ha`, sx(c[0]), sy(c[1]),
          '600 12px "Avenir Next", sans-serif', accent, 'rgba(255,255,255,0.92)', 'center');
      }
    }
    ctx.restore();
  }

  // 笔刷预览
  if (ui.brush && Number.isFinite(ui.brush.x) && Number.isFinite(ui.brush.y)) {
    const rPx = ui.brush.radiusM * zoom;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(sx(ui.brush.x), sy(ui.brush.y), Math.max(4, rPx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sx(ui.brush.x), sy(ui.brush.y), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();
  }

  // 测距
  if (ui.measure && ui.measure.start && ui.measure.end) {
    const a = ui.measure.start;
    const b = ui.measure.end;
    ctx.save();
    ctx.strokeStyle = pine;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
    ctx.setLineDash([]);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const dz = Number.isFinite(ui.measure.dz) ? ui.measure.dz : 0;
    const slope = Number.isFinite(ui.measure.slopeDeg) ? ui.measure.slopeDeg : 0;
    const readout = `${dist.toFixed(1)} m · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(1)} m · ${slope.toFixed(1)}°`;
    drawHaloText(ctx, readout, (sx(a.x) + sx(b.x)) * 0.5, (sy(a.y) + sy(b.y)) * 0.5 - 10,
      '600 12px "SF Mono", monospace', pine, 'rgba(255,255,255,0.92)', 'center');
    ctx.restore();
  }

  // 悬停提示
  if (hover && hover.label) {
    const label = hover.label;
    ctx.save();
    ctx.font = '11px "Avenir Next", "PingFang SC", sans-serif';
    const w = ctx.measureText(label).width + 14;
    const h = 20;
    const px = sx(hover.x) + 12;
    const py = sy(hover.y) + 12;
    ctx.fillStyle = 'rgba(250, 248, 243, 0.95)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = 'rgba(184, 173, 152, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, h);
    ctx.fillStyle = palette.inkDark;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + 7, py + h * 0.5);
    ctx.restore();
  }
}

function drawShapeHandles(ctx, project, shapeId, viewport, palette) {
  const shapes = (project.terrain && Array.isArray(project.terrain.shapes)) ? project.terrain.shapes : [];
  const shape = shapes.find((s) => s.id === shapeId);
  if (!shape) return;
  const zoom = viewport.zoom;
  const sx = (wx) => wx * zoom + viewport.panX;
  const sy = (wy) => wy * zoom + viewport.panY;
  const accent = '#b55838';
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.1;
  ctx.setLineDash([7, 5]);

  if (shape.type === 'hill' || shape.type === 'basin') {
    const rad = (Number(shape.angleDeg) || 0) * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    ctx.beginPath();
    for (let i = 0; i <= 72; i += 1) {
      const t = (i / 72) * Math.PI * 2;
      const lx = Math.cos(t) * shape.rx;
      const ly = Math.sin(t) * shape.ry;
      const wx = shape.cx + lx * cosA - ly * sinA;
      const wy = shape.cy + lx * sinA + ly * cosA;
      if (i === 0) ctx.moveTo(sx(wx), sy(wy));
      else ctx.lineTo(sx(wx), sy(wy));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 中心十字圆柄
    ctx.beginPath();
    ctx.arc(sx(shape.cx), sy(shape.cy), 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx(shape.cx) - 3.5, sy(shape.cy));
    ctx.lineTo(sx(shape.cx) + 3.5, sy(shape.cy));
    ctx.moveTo(sx(shape.cx), sy(shape.cy) - 3.5);
    ctx.lineTo(sx(shape.cx), sy(shape.cy) + 3.5);
    ctx.stroke();

    // 四正轴方柄
    const axes = [[shape.rx, 0], [0, shape.ry], [-shape.rx, 0], [0, -shape.ry]];
    for (let i = 0; i < axes.length; i += 1) {
      const lx = axes[i][0];
      const ly = axes[i][1];
      const wx = shape.cx + lx * cosA - ly * sinA;
      const wy = shape.cy + lx * sinA + ly * cosA;
      ctx.beginPath();
      ctx.rect(sx(wx) - 4, sy(wy) - 4, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // 旋转柄
    const rotX = shape.cx + (0 * cosA - (-shape.ry - 24 / zoom) * sinA);
    const rotY = shape.cy + (0 * sinA + (-shape.ry - 24 / zoom) * cosA);
    ctx.beginPath();
    ctx.moveTo(sx(shape.cx + shape.ry * sinA), sy(shape.cy - shape.ry * cosA));
    ctx.lineTo(sx(rotX), sy(rotY));
    ctx.strokeStyle = 'rgba(181, 88, 56, 0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx(rotX), sy(rotY), 5.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 偏心菱形柄
    const fu = Number(shape.focusX) || 0;
    const fv = Number(shape.focusY) || 0;
    const fwx = shape.cx + fu * shape.rx * cosA - fv * shape.ry * sinA;
    const fwy = shape.cy + fu * shape.rx * sinA + fv * shape.ry * cosA;
    const fpx = sx(fwx);
    const fpy = sy(fwy);
    ctx.beginPath();
    ctx.moveTo(fpx, fpy - 5.5);
    ctx.lineTo(fpx + 5.5, fpy);
    ctx.lineTo(fpx, fpy + 5.5);
    ctx.lineTo(fpx - 5.5, fpy);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  } else if (Array.isArray(shape.points)) {
    ctx.beginPath();
    ctx.moveTo(sx(shape.points[0][0]), sy(shape.points[0][1]));
    for (let i = 1; i < shape.points.length; i += 1) {
      ctx.lineTo(sx(shape.points[i][0]), sy(shape.points[i][1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < shape.points.length; i += 1) {
      ctx.beginPath();
      ctx.arc(sx(shape.points[i][0]), sy(shape.points[i][1]), 4.6, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (let i = 0; i + 1 < shape.points.length; i += 1) {
      const mx = (shape.points[i][0] + shape.points[i + 1][0]) * 0.5;
      const my = (shape.points[i][1] + shape.points[i + 1][1]) * 0.5;
      ctx.beginPath();
      ctx.arc(sx(mx), sy(my), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(181, 88, 56, 0.32)';
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}
