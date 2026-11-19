/**
 * Terrax Settlement Studio — M4 导出内核
 * 文件：web/js/exporter.js
 *
 * 职责：
 *   1. 1x / 2x / 3x 离屏 Canvas PNG 导出（full 出版成图 / clean 纯净底图）；
 *   2. 纯字符串拼接的独立矢量 SVG 序列化（零 DOM 依赖，可在 Node 直接调用校验）；
 *   3. 14 类内置微缩真图形图例与 8 类自定义徽记的 SVG 端绘制；
 *   4. `.worldtown.json` 下载与本地文件读取。
 */

import { getActivePalette } from './state_and_schema.js';
import { renderSceneToCanvas } from './canvas_renderer.js';

const BASE_EXPORT_PX = 1600;

/* ------------------------------------------------------------------------------------------------
 * 一、通用格式化
 * ---------------------------------------------------------------------------------------------- */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hexToRgba(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function safeFileBaseName(name) {
  const raw = String(name || 'worldtown').replace(/[\\/:*?"<>|]/g, '_').trim();
  return raw.length > 0 ? raw : 'worldtown';
}

function paletteOf(project) {
  return getActivePalette(project);
}

/* ------------------------------------------------------------------------------------------------
 * 二、SVG 基础元素
 * ---------------------------------------------------------------------------------------------- */

function svgPolyline(points, attrs) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const d = points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ');
  return `<polyline points="${d}" ${attrs}/>`;
}

function svgPolygon(points, attrs) {
  if (!Array.isArray(points) || points.length < 3) return '';
  const d = points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ');
  return `<polygon points="${d}" ${attrs}/>`;
}

function svgPath(points, closed, attrs) {
  if (!Array.isArray(points) || points.length < 2) return '';
  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
  }
  if (closed) d += ' Z';
  return `<path d="${d}" ${attrs}/>`;
}

function svgText(x, y, content, opts) {
  if (content === undefined || content === null || content === '') return '';
  const o = opts || {};
  let attrs = `x="${fmt(x)}" y="${fmt(y)}" font-family="${esc(o.font || 'sans-serif')}" font-size="${fmt(o.size || 12)}" fill="${o.fill || '#2b2520'}" text-anchor="${o.anchor || 'start'}"`;
  if (o.weight) attrs += ` font-weight="${o.weight}"`;
  if (o.italic) attrs += ` font-style="italic"`;
  if (o.halo) attrs += ` stroke="${o.halo}" stroke-width="${fmt(o.haloW || 1.4)}" paint-order="stroke" stroke-linejoin="round"`;
  attrs += ` dominant-baseline="${o.baseline || 'middle'}"`;
  return `<text ${attrs}>${esc(content)}</text>`;
}

/* ------------------------------------------------------------------------------------------------
 * 三、SVG 图例徽记（28×18 微缩真图形）
 * ---------------------------------------------------------------------------------------------- */

function glyphColorOf(item, palette) {
  if (item && typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)) return item.color;
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

function glyphStrokeOf(item, palette) {
  if (item && typeof item.strokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.strokeColor)) {
    return item.strokeColor;
  }
  return palette.inkDark;
}

export function buildLegendGlyphSVG(legendItem, x, y, w, h, palette) {
  const item = legendItem || {};
  const pal = palette || getActivePalette(null);
  const glyph = item.glyphType || 'building_town';
  const main = glyphColorOf(item, pal);
  const ink = glyphStrokeOf(item, pal);
  const boxW = Math.max(8, num(w, 28));
  const boxH = Math.max(6, num(h, 18));
  const sx = boxW / 28;
  const sy = boxH / 18;
  const parts = [];

  const line = (x1, y1, x2, y2, color, width, extra) =>
    `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round"${extra || ''}/>`;
  const rect = (rx, ry, rw, rh, fillColor, strokeColor, sw) =>
    `<rect x="${fmt(rx)}" y="${fmt(ry)}" width="${fmt(rw)}" height="${fmt(rh)}" fill="${fillColor}"${strokeColor ? ` stroke="${strokeColor}" stroke-width="${fmt(sw || 0.8)}"` : ''}/>`;
  const circle = (ccx, ccy, r, fillColor, strokeColor, sw) =>
    `<circle cx="${fmt(ccx)}" cy="${fmt(ccy)}" r="${fmt(r)}" fill="${fillColor}"${strokeColor ? ` stroke="${strokeColor}" stroke-width="${fmt(sw || 0.8)}"` : ''}/>`;

  if (glyph === 'building_inner') {
    parts.push(rect(5.6, 6.4, 16.4, 8.2, 'rgba(43,37,32,0.18)'));
    parts.push(rect(4, 5, 12, 8, main, ink, 0.8));
    parts.push(rect(17, 8.4, 7, 5.2, main, ink, 0.8));
    parts.push(line(10, 5, 10, 13, ink, 0.5));
    parts.push(line(20.5, 8.4, 20.5, 13.6, ink, 0.5));
  } else if (glyph === 'building_town') {
    parts.push('<path d="M 4.4 6.4 L 12.4 6.4 L 12.4 9.4 L 16.4 9.4 L 16.4 13.6 L 4.4 13.6 Z" fill="rgba(43,37,32,0.16)"/>');
    parts.push(`<path d="M 3 5 L 11 5 L 11 8 L 15 8 L 15 13 L 3 13 Z" fill="${main}" stroke="${ink}" stroke-width="0.8"/>`);
    parts.push(rect(16.2, 9.2, 6, 3.8, main, ink, 0.8));
    parts.push(circle(21.6, 5.6, 2.2, pal.treeFill, pal.treeOutline, 0.5));
  } else if (glyph === 'city_wall') {
    parts.push(rect(1.6, 7.4, 24.8, 3.6, main, ink, 0.7));
    parts.push(circle(6.2, 9.2, 2.5, main, ink, 0.7));
    parts.push(circle(21.8, 9.2, 2.5, main, ink, 0.7));
    parts.push(rect(13.2, 7.0, 2.6, 4.4, pal.paperBg, ink, 0.6));
    parts.push(line(13.2, 7.0, 13.2, 11.4, ink, 0.6));
    parts.push(line(15.8, 7.0, 15.8, 11.4, ink, 0.6));
  } else if (glyph === 'road_main') {
    parts.push(rect(1, 6, 26, 6, main, '#5b4a38', 1));
    parts.push(line(1, 6, 27, 6, '#5b4a38', 1.2));
    parts.push(line(1, 12, 27, 12, '#5b4a38', 1.2));
    parts.push(line(2, 9, 26, 9, hexToRgba('#5b4a38', 0.45), 0.5, ' stroke-dasharray="2 2"'));
  } else if (glyph === 'bridge') {
    parts.push(rect(10, 1.4, 8, 15.2, pal.waterFill));
    parts.push(line(11.2, 2.4, 11.2, 15.6, pal.waterRipple, 0.8));
    parts.push(line(16.8, 2.4, 16.8, 15.6, pal.waterRipple, 0.8));
    parts.push(rect(1.6, 6.8, 24.8, 4.4, main, ink, 1));
    parts.push(line(1.6, 6.8, 26.4, 6.8, ink, 1.8));
    parts.push(line(1.6, 11.2, 26.4, 11.2, ink, 1.8));
    parts.push(line(1.6, 11.2, 0.2, 13.6, ink, 0.9));
    parts.push(line(1.6, 6.8, 0.2, 4.4, ink, 0.9));
    parts.push(line(26.4, 11.2, 27.8, 13.6, ink, 0.9));
    parts.push(line(26.4, 6.8, 27.8, 4.4, ink, 0.9));
  } else if (glyph === 'river') {
    parts.push('<path d="M 0.8 12.4 C 8 8.4 16 14.4 27.2 6.2" fill="none" stroke="' + main + '" stroke-width="6.4" stroke-linecap="round"/>');
    parts.push('<path d="M 1.2 10.6 C 8 6.8 16 12.6 27 4.6" fill="none" stroke="' + pal.waterRipple + '" stroke-width="0.9" stroke-linecap="round"/>');
    parts.push('<path d="M 1.4 14.2 C 8 10.4 16 16.2 27 8.2" fill="none" stroke="' + pal.waterRipple + '" stroke-width="0.9" stroke-linecap="round"/>');
  } else if (glyph === 'water_body') {
    parts.push(`<path d="M 5.2 3 L 22.8 3 Q 26 3 26 6.2 L 26 11.8 Q 26 15 22.8 15 L 5.2 15 Q 2 15 2 11.8 L 2 6.2 Q 2 3 5.2 3 Z" fill="${main}" stroke="${hexToRgba(ink, 0.75)}" stroke-width="0.8"/>`);
    parts.push('<path d="M 4.4 5.2 L 23.6 5.2 L 23.6 12.8 L 4.4 12.8 Z" fill="none" stroke="' + pal.waterRipple + '" stroke-width="0.85"/>');
    parts.push('<path d="M 6.6 7.4 L 21.4 7.4 L 21.4 10.6 L 6.6 10.6 Z" fill="none" stroke="' + pal.waterRipple + '" stroke-width="0.85"/>');
  } else if (glyph === 'canal') {
    parts.push(rect(2, 3.6, 24, 3.4, main, hexToRgba(ink, 0.7), 0.7));
    parts.push(line(3.4, 5.3, 24.6, 5.3, pal.waterRipple, 0.7));
    parts.push(line(2, 12.4, 26, 12.4, '#3d6a74', 1, ' stroke-dasharray="3 2"'));
    parts.push(circle(9, 12.4, 2.1, pal.paperBg, '#3d6a74', 0.9));
    parts.push(circle(20, 12.4, 2.1, pal.paperBg, '#3d6a74', 0.9));
  } else if (glyph === 'contour') {
    parts.push('<path d="M 1.6 5.4 C 9 3.6 18 7.2 26.4 5.2" fill="none" stroke="' + main + '" stroke-width="1.6"/>');
    parts.push('<path d="M 1.6 10.4 C 9 8.6 18 12.2 26.4 10.2" fill="none" stroke="' + hexToRgba(main, 0.5) + '" stroke-width="0.75"/>');
    parts.push('<path d="M 1.6 14.4 C 9 12.6 18 16.2 26.4 14.2" fill="none" stroke="' + hexToRgba(main, 0.5) + '" stroke-width="0.75"/>');
  } else if (glyph === 'scarp_tick') {
    parts.push('<path d="M 1.6 6.2 C 9 4.8 18 7.8 26.4 6.0" fill="none" stroke="' + main + '" stroke-width="1.5"/>');
    for (let i = 0; i < 4; i += 1) {
      const tx = 6.4 + i * 4.6;
      const ty = 6.2 + Math.sin(tx * 0.22) * 0.6;
      parts.push(line(tx, ty, tx, ty + 4.2, main, 0.7));
    }
  } else if (glyph === 'farmland') {
    parts.push(`<path d="M 2.6 3.6 L 25.4 3.6 L 22.4 14.4 L 5.6 14.4 Z" fill="${main}" stroke="#8a7a52" stroke-width="0.8"/>`);
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const x1 = 2.6 + (25.4 - 2.6) * t;
      const x2 = 5.6 + (22.4 - 5.6) * t;
      parts.push(line(x1, 3.6, x2, 14.4, hexToRgba('#8a7a52', 0.75), 0.6));
    }
  } else if (glyph === 'saltpan') {
    const cells = [
      [3, 3.2, 0.96], [14.6, 3.2, 0.74],
      [3, 9.6, 0.74], [14.6, 9.6, 0.96]
    ];
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      parts.push(`<rect x="${fmt(cell[0])}" y="${fmt(cell[1])}" width="10.4" height="5.2" fill="${main}" fill-opacity="${fmt(cell[2])}" stroke="rgba(255,255,255,0.82)" stroke-width="0.9"/>`);
    }
  } else if (glyph === 'tree_cluster') {
    const circles = [[9.6, 10.2, 5.0], [16.8, 8.4, 4.6], [14.2, 12.6, 4.7]];
    for (let i = 0; i < circles.length; i += 1) {
      const c = circles[i];
      parts.push(circle(c[0], c[1], c[2] + 1.2, pal.treeOutline));
    }
    for (let i = 0; i < circles.length; i += 1) {
      const c = circles[i];
      parts.push(circle(c[0], c[1], c[2], main));
    }
  } else if (glyph === 'reef') {
    parts.push(rect(0.8, 2.4, 26.4, 13.2, hexToRgba(pal.waterFill, 0.55)));
    parts.push(`<polygon points="7.6,5.2 12.6,4.4 14.6,8.2 11.2,12.4 7.2,10.4" fill="${main}" stroke="${ink}" stroke-width="0.8"/>`);
    parts.push(`<polygon points="17.4,6.6 22.4,6.0 23.6,10.2 19.8,12.6 17.0,9.8" fill="${main}" stroke="${ink}" stroke-width="0.8"/>`);
    parts.push(`<path d="M 3.6 8 A 11.2 11.2 0 0 1 25.4 8" fill="none" stroke="${pal.waterRipple}" stroke-width="0.8" stroke-dasharray="2.4 2.2"/>`);
  } else if (glyph === 'star_fort') {
    const pts = [];
    for (let i = 0; i < 16; i += 1) {
      const ang = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 === 0 ? 7.4 : 3.4;
      pts.push([14 + Math.cos(ang) * r, 9 + Math.sin(ang) * r]);
    }
    parts.push(svgPolygon(pts, `fill="${hexToRgba(main, 0.22)}" stroke="${main}" stroke-width="1.1"`));
    parts.push(circle(14, 9, 1.3, ink));
  } else if (glyph === 'tower') {
    parts.push(rect(9.4, 8.4, 9.2, 7.4, main, ink, 0.9));
    parts.push(`<path d="M 9.4 8.4 L 9.4 5.2 L 11.4 5.2 L 11.4 3.4 L 13.4 3.4 L 13.4 5.2 L 15.2 5.2 L 15.2 3.4 L 17.2 3.4 L 17.2 5.2 L 18.6 5.2 L 18.6 8.4 Z" fill="${main}" stroke="${ink}" stroke-width="0.9"/>`);
    parts.push(rect(12.9, 11.4, 2.2, 4.4, pal.paperBg));
  } else if (glyph === 'well_shrine') {
    parts.push(circle(14, 9.4, 6.2, hexToRgba(pal.waterFill, 0.5), main, 1.3));
    parts.push(circle(14, 9.4, 3.6, 'none', main, 0.9));
    parts.push(`<path d="M 14 4.6 C 16.6 7.4 16.8 9.4 14 10.4 C 11.2 9.4 11.4 7.4 14 4.6 Z" fill="${main}"/>`);
  } else if (glyph === 'ferry_anchor') {
    parts.push(line(14, 3.4, 14, 14.6, main, 1.4));
    parts.push(line(9, 6.6, 19, 6.6, main, 1.4));
    parts.push(`<path d="M 9.4 12.2 A 4.6 4.6 0 0 0 18.6 12.2" fill="none" stroke="${main}" stroke-width="1.2"/>`);
    parts.push(circle(14, 3.4, 1.4, main));
  } else if (glyph === 'gate_arch') {
    parts.push(rect(5.2, 7.2, 3.2, 8.4, main, ink, 0.8));
    parts.push(rect(19.6, 7.2, 3.2, 8.4, main, ink, 0.8));
    parts.push(rect(4.2, 5.2, 19.6, 2.6, main, ink, 0.8));
    parts.push(`<path d="M 3.2 5.2 L 14 2.2 L 24.8 5.2 Z" fill="${main}" stroke="${ink}" stroke-width="0.8"/>`);
    parts.push(line(7, 15.6, 21, 15.6, ink, 0.6));
  } else if (glyph === 'market_tent') {
    parts.push(`<path d="M 6.2 6.6 L 16.4 6.6 L 11.3 15.2 Z" fill="${main}" stroke="${ink}" stroke-width="0.8"/>`);
    parts.push(line(16.4, 6.6, 16.4, 15.4, ink, 1));
    parts.push(`<path d="M 16.4 3.2 L 23.4 4.8 L 16.4 6.4 Z" fill="${pal.roofInner}" stroke="${ink}" stroke-width="0.6"/>`);
  } else if (glyph === 'mine_hammer') {
    parts.push(line(6.4, 14.2, 19.6, 4.4, main, 1.5));
    parts.push(line(21.4, 13.8, 9.2, 4.6, main, 1.5));
    parts.push(rect(18.4, 2.6, 6.2, 3.2, main, ink, 0.7));
    parts.push(`<path d="M 5.2 12.6 L 8.6 15.6 L 6.2 16.6 L 3.6 14.2 Z" fill="${main}" stroke="${ink}" stroke-width="0.7"/>`);
  } else if (glyph === 'stele') {
    parts.push(`<path d="M 9.6 15.2 L 9.6 6.4 Q 9.6 3.2 14 3.2 Q 18.4 3.2 18.4 6.4 L 18.4 15.2 Z" fill="${main}" stroke="${ink}" stroke-width="0.9"/>`);
    parts.push(line(11.8, 7.2, 16.2, 7.2, ink, 0.55));
    parts.push(line(11.8, 9.6, 16.2, 9.6, ink, 0.55));
    parts.push(line(11.8, 12.0, 15.0, 12.0, ink, 0.55));
    parts.push(line(6.6, 15.8, 21.4, 15.8, ink, 1.1));
  } else {
    parts.push(rect(5, 5.5, 18, 8, main, ink, 0.8));
    parts.push(line(14, 5.5, 14, 13.5, ink, 0.5));
  }

  return `<g class="legend-glyph" transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(sx)},${fmt(sy)})">${parts.join('')}</g>`;
}

/* ------------------------------------------------------------------------------------------------
 * 四、离屏 PNG 导出
 * ---------------------------------------------------------------------------------------------- */

function buildExportViewport(worldSizeM, scale) {
  const base = BASE_EXPORT_PX;
  return {
    widthPx: base,
    heightPx: base,
    dpr: scale,
    panX: 0,
    panY: 0,
    zoom: base / Math.max(600, worldSizeM),
    worldSizeM: Math.max(600, worldSizeM)
  };
}

export function renderOffscreenPNGCanvas(project, compiledScene, options) {
  const opts = options || {};
  const scale = Math.max(1, Math.min(3, Math.round(num(opts.scale, 2))));
  const mode = opts.mode === 'clean' ? 'clean' : 'full';
  const worldSizeM = Math.max(600, num(project && project.meta && project.meta.worldSizeM, 2400));
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('renderOffscreenPNGCanvas 需要浏览器 DOM 环境');
  }
  const canvas = document.createElement('canvas');
  const base = BASE_EXPORT_PX;
  canvas.width = Math.round(base * scale);
  canvas.height = Math.round(base * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建离屏 Canvas 2D 上下文');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const viewport = buildExportViewport(worldSizeM, scale);
  renderSceneToCanvas(ctx, project, compiledScene, viewport, {
    isExport: true,
    includeCartouche: mode === 'full',
    mode,
    scale
  });
  return canvas;
}

export function exportPNGDataURL(project, compiledScene, options) {
  const canvas = renderOffscreenPNGCanvas(project, compiledScene, options);
  return canvas.toDataURL('image/png');
}

export function downloadPNG(project, compiledScene, options) {
  const opts = options || {};
  const scale = Math.max(1, Math.min(3, Math.round(num(opts.scale, 2))));
  const mode = opts.mode === 'clean' ? 'clean' : 'full';
  const canvas = renderOffscreenPNGCanvas(project, compiledScene, opts);
  const name = `${safeFileBaseName(project && project.meta && project.meta.name)}_${scale}x_${mode}.png`;
  const dataUrl = canvas.toDataURL('image/png');
  triggerDownload(dataUrl, name);
  return { filename: name, width: canvas.width, height: canvas.height };
}

function triggerDownload(href, filename) {
  if (typeof document === 'undefined') return false;
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  if (document.body) document.body.appendChild(a);
  a.click();
  if (document.body) document.body.removeChild(a);
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * 五、独立矢量 SVG 序列化（零 DOM）
 * ---------------------------------------------------------------------------------------------- */

export function buildSVGString(project, compiledScene, options) {
  const opts = options || {};
  const mode = opts.mode === 'clean' ? 'clean' : 'full';
  const width = Math.max(200, Math.round(num(opts.width, 1600)));
  const height = Math.max(200, Math.round(num(opts.height, 1600)));
  const p = (project && typeof project === 'object') ? project : {};
  const scene = (compiledScene && typeof compiledScene === 'object') ? compiledScene : {};
  const palette = paletteOf(p);
  const worldSizeM = Math.max(600, num(p.meta && p.meta.worldSizeM, 2400));
  const unit = worldSizeM / 1600;
  const px = (v) => v * unit;
  const meta = p.meta || {};
  const hydro = scene.hydro || {};
  const terrain = scene.terrain || {};

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${fmt(worldSizeM)} ${fmt(worldSizeM)}" role="img" aria-label="${esc(meta.name || '聚落测绘图')}">`);
  out.push('<defs>');
  out.push(`<radialGradient id="paper-vignette" cx="50%" cy="50%" r="72%"><stop offset="28%" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="100%" stop-color="#786444" stop-opacity="0.10"/></radialGradient>`);
  out.push('</defs>');
  out.push(`<style>
    text { font-kerning: normal; }
    .map-title { font-family: "Palatino Linotype", "Book Antiqua", "Songti SC", serif; }
    .map-label { font-family: "Palatino Linotype", "Songti SC", serif; font-style: italic; }
    .map-ui { font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif; }
  </style>`);
  out.push(`<rect x="0" y="0" width="${fmt(worldSizeM)}" height="${fmt(worldSizeM)}" fill="${palette.paperBg}"/>`);
  out.push(`<rect x="0" y="0" width="${fmt(worldSizeM)}" height="${fmt(worldSizeM)}" fill="url(#paper-vignette)"/>`);

  /* 农田 / 盐池 / 集场铺装 */
  out.push('<g id="layer-02-farmland">');
  const plots = Array.isArray(scene.farmlandPlots) ? scene.farmlandPlots : [];
  for (let i = 0; i < plots.length; i += 1) {
    const plot = plots[i];
    const poly = plot.innerPolygon || plot.polygon;
    out.push(svgPolygon(poly, `fill="${palette.farmlandFill}" fill-opacity="0.92" stroke="#8a7a52" stroke-opacity="0.55" stroke-width="${fmt(px(0.8))}"`));
    const furrows = Array.isArray(plot.furrows) ? plot.furrows : [];
    for (let f = 0; f < furrows.length; f += 1) {
      out.push(svgPolyline(furrows[f], `fill="none" stroke="${palette.contourLine}" stroke-opacity="0.42" stroke-width="${fmt(px(0.7))}"`));
    }
  }
  const salts = Array.isArray(scene.saltpanCells) ? scene.saltpanCells : [];
  for (let i = 0; i < salts.length; i += 1) {
    const cell = salts[i];
    out.push(svgPolygon(cell.polygon, `fill="${palette.saltpanFill}" fill-opacity="${fmt(num(cell.opacity, 0.9))}" stroke="#ffffff" stroke-opacity="0.78" stroke-width="${fmt(px(0.9))}"`));
  }
  const aprons = Array.isArray(scene.marketAprons) ? scene.marketAprons : [];
  for (let i = 0; i < aprons.length; i += 1) {
    const apron = aprons[i];
    const fillOpacity = apron.kind === 'parade_ground' ? 0.55 : 0.52;
    out.push(svgPolygon(apron.points, `fill="${palette.farmlandFill}" fill-opacity="${fmt(fillOpacity)}" stroke="${palette.inkDark}" stroke-opacity="0.3" stroke-width="${fmt(px(0.9))}" stroke-dasharray="${apron.kind === 'parade_ground' ? 'none' : `${fmt(px(5))} ${fmt(px(4))}`}"`));
  }
  out.push('</g>');

  /* 等高线 */
  out.push('<g id="layer-03-contours">');
  const contours = Array.isArray(terrain.contours) ? terrain.contours : [];
  for (let i = 0; i < contours.length; i += 1) {
    const contour = contours[i];
    const attrs = contour.isIndex
      ? `fill="none" stroke="${palette.contourLine}" stroke-opacity="0.82" stroke-width="${fmt(px(1.45))}"`
      : `fill="none" stroke="${palette.contourLine}" stroke-opacity="0.48" stroke-width="${fmt(px(0.75))}"`;
    out.push(svgPath(contour.points, contour.closed === true, attrs));
  }
  const ticks = Array.isArray(terrain.scarpTicks) ? terrain.scarpTicks : [];
  for (let i = 0; i < ticks.length; i += 1) {
    const tk = ticks[i];
    out.push(`<line x1="${fmt(tk.x1)}" y1="${fmt(tk.y1)}" x2="${fmt(tk.x2)}" y2="${fmt(tk.y2)}" stroke="${palette.contourLine}" stroke-opacity="0.95" stroke-width="${fmt(px(0.8))}"/>`);
  }
  // 计曲线高程数字（沿折线中段打断留白后标注）
  for (let i = 0; i < contours.length; i += 1) {
    const contour = contours[i];
    if (!contour.isIndex || !Array.isArray(contour.points) || contour.points.length < 8) continue;
    if (!Number.isFinite(contour.elev)) continue;
    const anchor = contour.points[Math.floor(contour.points.length * 0.36)];
    out.push(svgText(anchor[0], anchor[1] - 1.6 * unit, String(Math.round(contour.elev)), {
      font: '"Palatino Linotype", "Songti SC", serif',
      size: 9 * unit,
      fill: hexToRgba(palette.inkDark, 0.72),
      anchor: 'middle',
      italic: true,
      halo: hexToRgba(palette.paperBg, 0.95),
      haloW: 3.2 * unit
    }));
  }
  out.push('</g>');

  /* 水体 */
  out.push('<g id="layer-04-water">');
  const waterBodies = Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [];
  for (let i = 0; i < waterBodies.length; i += 1) {
    const wb = waterBodies[i];
    out.push(svgPolygon(wb.shorePoly, `fill="${palette.waterFill}" stroke="${palette.inkDark}" stroke-opacity="0.55" stroke-width="${fmt(px(1.1))}"`));
    const ripples = Array.isArray(wb.ripples) ? wb.ripples : [];
    for (let r = 0; r < ripples.length; r += 1) {
      out.push(svgPolygon(ripples[r], `fill="none" stroke="${palette.waterRipple}" stroke-opacity="${fmt(0.85 - r * 0.18)}" stroke-width="${fmt(px(0.9))}"`));
    }
  }
  const rivers = Array.isArray(hydro.rivers) ? hydro.rivers : [];
  for (let i = 0; i < rivers.length; i += 1) {
    const river = rivers[i];
    out.push(svgPolygon(river.bankPolygon, `fill="${palette.waterFill}" stroke="${palette.inkDark}" stroke-opacity="0.5" stroke-width="${fmt(px(1.1))}"`));
    const ripples = Array.isArray(river.ripples) ? river.ripples : [];
    for (let r = 0; r < ripples.length; r += 1) {
      out.push(svgPolyline(ripples[r], `fill="none" stroke="${palette.waterRipple}" stroke-opacity="0.8" stroke-width="${fmt(px(0.9))}"`));
    }
    if (river.name && Array.isArray(river.centerline) && river.centerline.length > 3) {
      const anchor = river.centerline[Math.floor(river.centerline.length * 0.5)];
      out.push(svgText(anchor[0], anchor[1] - 2.2 * unit, String(river.name), {
        font: '"Palatino Linotype", "Songti SC", serif',
        size: 11 * unit,
        fill: hexToRgba(palette.inkDark, 0.74),
        anchor: 'middle',
        italic: true,
        halo: hexToRgba(palette.paperBg, 0.9),
        haloW: 3.4 * unit
      }));
    }
  }
  const lakes = Array.isArray(hydro.waterBodies) ? hydro.waterBodies : [];
  for (let i = 0; i < lakes.length; i += 1) {
    const lake = lakes[i];
    if (!lake || !lake.name || !Array.isArray(lake.shorePoly) || lake.shorePoly.length < 3) continue;
    const c = svgCentroid(lake.shorePoly);
    if (!c) continue;
    out.push(svgText(c[0], c[1], String(lake.name), {
      font: '"Palatino Linotype", "Songti SC", serif',
      size: 11 * unit,
      fill: hexToRgba(palette.inkDark, 0.7),
      anchor: 'middle',
      italic: true,
      halo: hexToRgba(palette.paperBg, 0.88),
      haloW: 3.4 * unit
    }));
  }
  out.push('</g>');

  /* 礁石与渡口 */
  out.push('<g id="layer-05-reef">');
  const reefs = Array.isArray(hydro.reefs) ? hydro.reefs : [];
  for (let i = 0; i < reefs.length; i += 1) {
    const reef = reefs[i];
    const rocks = Array.isArray(reef.rocks) ? reef.rocks : [];
    for (let r = 0; r < rocks.length; r += 1) {
      out.push(svgPolygon(rocks[r].points, `fill="#585550" stroke="${palette.inkDark}" stroke-width="${fmt(px(0.9))}"`));
    }
    out.push(svgPolygon(reef.foamRing, `fill="none" stroke="${palette.waterRipple}" stroke-width="${fmt(px(1))}" stroke-dasharray="${fmt(px(3.2))} ${fmt(px(2.6))}"`));
  }
  const fords = Array.isArray(hydro.fordCrossings) ? hydro.fordCrossings : [];
  for (let i = 0; i < fords.length; i += 1) {
    const ford = fords[i];
    const tx = num(ford.tangent && ford.tangent[0], 0);
    const ty = num(ford.tangent && ford.tangent[1], 1);
    const half = num(ford.riverWidthM, 30) * 0.5 + 2;
    out.push(`<line x1="${fmt(ford.x - ty * half)}" y1="${fmt(ford.y + tx * half)}" x2="${fmt(ford.x + ty * half)}" y2="${fmt(ford.y - tx * half)}" stroke="${palette.waterRipple}" stroke-width="${fmt(px(0.8))}" stroke-dasharray="${fmt(px(2.4))} ${fmt(px(2.4))}"/>`);
    for (let side = -1; side <= 1; side += 2) {
      for (let k = -1; k <= 1; k += 1) {
        const along = k * 3.2;
        const cx = ford.x + tx * along - ty * side * 2.2;
        const cy = ford.y + ty * along + tx * side * 2.2;
        out.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(px(1.5))}" fill="${palette.inkDark}" fill-opacity="0.72"/>`);
      }
    }
  }
  out.push('</g>');

  /* 明渠 / 暗渠 */
  out.push('<g id="layer-06-canal">');
  const canals = Array.isArray(hydro.canals) ? hydro.canals : [];
  for (let i = 0; i < canals.length; i += 1) {
    const canal = canals[i];
    if (canal.style === 'qanat') {
      out.push(svgPolyline(canal.centerline, `fill="none" stroke="#2f6a72" stroke-width="${fmt(px(1.7))}" stroke-dasharray="${fmt(px(8))} ${fmt(px(6))}"`));
      const shafts = Array.isArray(canal.shaftPoints) ? canal.shaftPoints : [];
      for (let s = 0; s < shafts.length; s += 1) {
        out.push(`<circle cx="${fmt(shafts[s].x)}" cy="${fmt(shafts[s].y)}" r="${fmt(num(shafts[s].radiusM, 3.2))}" fill="${palette.paperBg}" stroke="#2f6a72" stroke-width="${fmt(px(1.1))}"/>`);
      }
    } else {
      out.push(svgPolygon(canal.bankPolygon, `fill="${palette.waterFill}" stroke="${palette.inkDark}" stroke-opacity="0.5" stroke-width="${fmt(px(0.9))}"`));
    }
  }
  out.push('</g>');

  /* 菜畦（虚线园圃） */
  out.push('<g id="layer-06b-garden">');
  const fences = Array.isArray(scene.gardenFences) ? scene.gardenFences : [];
  for (let i = 0; i < fences.length; i += 1) {
    const fence = fences[i];
    const ring = fence && Array.isArray(fence.points) ? fence.points : null;
    if (!ring || ring.length < 3) continue;
    out.push(svgPolygon(ring, `fill="${hexToRgba(palette.farmlandFill, 0.3)}" stroke="${hexToRgba(palette.inkDark, 0.34)}" stroke-width="${fmt(px(0.8))}" stroke-dasharray="${fmt(3 * unit)},${fmt(3 * unit)}"`));
  }
  out.push('</g>');

  /* 街巷与道路：严格两遍（先全部路缘、再全部路面），杜绝交叉口黑叉 */
  out.push('<g id="layer-07-roads">');
  const internal = Array.isArray(scene.internalStreets) ? scene.internalStreets : [];
  const lanes = Array.isArray(scene.lanes) ? scene.lanes : [];
  const roads = Array.isArray(hydro.roads) ? hydro.roads : [];
  const internalW = px(4.2);
  const laneW = px(4.5);
  // Pass 1 — 深色路缘
  for (let i = 0; i < internal.length; i += 1) {
    const seg = internal[i];
    if (!Array.isArray(seg) || seg.length < 2) continue;
    out.push(`<line x1="${fmt(seg[0][0])}" y1="${fmt(seg[0][1])}" x2="${fmt(seg[1][0])}" y2="${fmt(seg[1][1])}" stroke="${hexToRgba(palette.inkDark, 0.3)}" stroke-width="${fmt(internalW + 1.6 * unit)}" stroke-linecap="round"/>`);
  }
  for (let i = 0; i < lanes.length; i += 1) {
    out.push(svgPolyline(lanes[i], `fill="none" stroke="${hexToRgba(palette.inkDark, 0.26)}" stroke-width="${fmt(laneW + 2.2 * unit)}" stroke-linecap="round"`));
  }
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    const w = road.widthM;
    const casing = road.tier === 'lane' ? hexToRgba(palette.inkDark, 0.22) : '#5b4a38';
    out.push(svgPolyline(road.centerline, `fill="none" stroke="${casing}" stroke-width="${fmt(w + 2 * unit)}" stroke-linecap="round"`));
  }
  // Pass 2 — 亮色路面
  for (let i = 0; i < internal.length; i += 1) {
    const seg = internal[i];
    if (!Array.isArray(seg) || seg.length < 2) continue;
    out.push(`<line x1="${fmt(seg[0][0])}" y1="${fmt(seg[0][1])}" x2="${fmt(seg[1][0])}" y2="${fmt(seg[1][1])}" stroke="${palette.roadFill}" stroke-width="${fmt(internalW)}" stroke-linecap="round"/>`);
  }
  for (let i = 0; i < lanes.length; i += 1) {
    out.push(svgPolyline(lanes[i], `fill="none" stroke="${palette.roadFill}" stroke-width="${fmt(laneW)}" stroke-linecap="round"`));
  }
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    out.push(svgPolyline(road.centerline, `fill="none" stroke="${palette.roadFill}" stroke-width="${fmt(road.widthM)}" stroke-linecap="round"`));
  }
  out.push('</g>');

  /* 桥梁 */
  out.push('<g id="layer-08-bridges">');
  const bridges = Array.isArray(hydro.bridges) ? hydro.bridges : [];
  for (let i = 0; i < bridges.length; i += 1) {
    const bridge = bridges[i];
    out.push(svgPolygon(bridge.corners, `fill="${palette.roadFill}" stroke="${palette.inkDark}" stroke-width="${fmt(px(1.1))}"`));
    out.push(`<line x1="${fmt(bridge.parapetLeft[0][0])}" y1="${fmt(bridge.parapetLeft[0][1])}" x2="${fmt(bridge.parapetLeft[1][0])}" y2="${fmt(bridge.parapetLeft[1][1])}" stroke="${palette.inkDark}" stroke-width="${fmt(px(2.2))}"/>`);
    out.push(`<line x1="${fmt(bridge.parapetRight[0][0])}" y1="${fmt(bridge.parapetRight[0][1])}" x2="${fmt(bridge.parapetRight[1][0])}" y2="${fmt(bridge.parapetRight[1][1])}" stroke="${palette.inkDark}" stroke-width="${fmt(px(2.2))}"/>`);
    const abutments = Array.isArray(bridge.abutments) ? bridge.abutments : [];
    for (let a = 0; a < abutments.length; a += 1) {
      const wing = abutments[a];
      out.push(`<line x1="${fmt(wing[0][0])}" y1="${fmt(wing[0][1])}" x2="${fmt(wing[1][0])}" y2="${fmt(wing[1][1])}" stroke="${palette.inkDark}" stroke-width="${fmt(px(0.9))}"/>`);
    }
  }
  out.push('</g>');

  /* 屋宇 */
  out.push('<g id="layer-09-buildings">');
  const buildings = Array.isArray(scene.buildings) ? scene.buildings : [];
  const shadowOff = 1.8;
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    const shifted = b.points.map((pt) => [pt[0] + shadowOff, pt[1] + shadowOff]);
    out.push(svgPolygon(shifted, 'fill="rgba(43,37,32,0.18)"'));
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const roofKind = pass === 0 ? 'inner' : 'town';
    const fillColor = roofKind === 'inner' ? palette.roofInner : palette.roofTown;
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      const kind = b.roofKind === 'inner' ? 'inner' : 'town';
      if (kind !== roofKind) continue;
      out.push(svgPolygon(b.points, `fill="${fillColor}" stroke="${palette.inkDark}" stroke-width="${fmt(px(1.05))}" stroke-linejoin="round"`));
    }
  }
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    if (!b.ridge) continue;
    out.push(`<line x1="${fmt(b.ridge[0][0])}" y1="${fmt(b.ridge[0][1])}" x2="${fmt(b.ridge[1][0])}" y2="${fmt(b.ridge[1][1])}" stroke="${palette.inkDark}" stroke-opacity="0.55" stroke-width="${fmt(px(0.65))}"/>`);
  }
  out.push('</g>');

  /* 城垣 */
  out.push('<g id="layer-10-walls">');
  const walls = Array.isArray(scene.walls) ? scene.walls : [];
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    out.push(svgPolyline(wall.polyline, `fill="none" stroke="#504233" stroke-width="${fmt(wall.thicknessM)}" stroke-linecap="round" stroke-linejoin="round"${wall.closed ? '' : ''}`));
    const towers = Array.isArray(wall.towers) ? wall.towers : [];
    for (let t = 0; t < towers.length; t += 1) {
      out.push(`<circle cx="${fmt(towers[t].x)}" cy="${fmt(towers[t].y)}" r="${fmt(num(towers[t].radiusM, 5.2))}" fill="#504233" stroke="${palette.inkDark}" stroke-width="${fmt(px(1.1))}"/>`);
    }
    const gates = Array.isArray(wall.gates) ? wall.gates : [];
    for (let g = 0; g < gates.length; g += 1) {
      const gate = gates[g];
      const ang = (num(gate.angleDeg, 0) * Math.PI) / 180;
      const tx = Math.cos(ang);
      const ty = Math.sin(ang);
      const half = Math.max(3, num(gate.gapHalf, 10));
      const halfThickness = Math.max(2.4, 0.5 * num(wall.thicknessM, 5));
      const nx = -ty;
      const ny = tx;
      const pts = [
        [gate.x - tx * half - nx * halfThickness, gate.y - ty * half - ny * halfThickness],
        [gate.x + tx * half - nx * halfThickness, gate.y + ty * half - ny * halfThickness],
        [gate.x + tx * half + nx * halfThickness, gate.y + ty * half + ny * halfThickness],
        [gate.x - tx * half + nx * halfThickness, gate.y - ty * half + ny * halfThickness]
      ];
      out.push(svgPolygon(pts, `fill="${palette.roadFill}" stroke="${palette.inkDark}" stroke-width="${fmt(px(1))}"`));
    }
  }
  out.push('</g>');

  /* 市集水井 */
  out.push('<g id="layer-10b-wells">');
  const wells = Array.isArray(scene.wells) ? scene.wells : [];
  for (let i = 0; i < wells.length; i += 1) {
    const well = wells[i];
    if (!well) continue;
    const wr = Math.max(1.4, num(well.radiusM, 2.2));
    out.push(`<circle cx="${fmt(well.x)}" cy="${fmt(well.y)}" r="${fmt(wr)}" fill="${palette.waterFill}" stroke="${hexToRgba(palette.inkDark, 0.72)}" stroke-width="${fmt(px(1))}"/>`);
    out.push(`<circle cx="${fmt(well.x)}" cy="${fmt(well.y)}" r="${fmt(Math.max(0.8, wr * 0.42))}" fill="none" stroke="${hexToRgba(palette.inkDark, 0.45)}" stroke-width="${fmt(px(0.7))}"/>`);
  }
  out.push('</g>');

  /* 双遍融合树冠 */
  const trees = Array.isArray(scene.trees) ? scene.trees : [];
  out.push('<g id="trees-shadow">');
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    out.push(`<circle cx="${fmt(tr.x + 2.2)}" cy="${fmt(tr.y + 2.2)}" r="${fmt(tr.r + 1.0)}" fill="rgba(43,37,32,0.15)"/>`);
  }
  out.push('</g>');
  out.push('<g id="trees-outline">');
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    out.push(`<circle cx="${fmt(tr.x)}" cy="${fmt(tr.y)}" r="${fmt(tr.r + 1.8)}" fill="${palette.treeOutline}"/>`);
  }
  out.push('</g>');
  out.push('<g id="trees-fill">');
  for (let i = 0; i < trees.length; i += 1) {
    const tr = trees[i];
    out.push(`<circle cx="${fmt(tr.x)}" cy="${fmt(tr.y)}" r="${fmt(tr.r)}" fill="${palette.treeFill}"/>`);
  }
  out.push('</g>');

  /* 地标与注记 */
  out.push('<g id="layer-12-landmarks">');
  const landmarks = Array.isArray(p.landmarks) ? p.landmarks : [];
  const legendItems = (p.legend && Array.isArray(p.legend.items)) ? p.legend.items : [];
  for (let i = 0; i < landmarks.length; i += 1) {
    const lm = landmarks[i];
    const item = legendItems.find((it) => it && it.key === lm.legendKey) || { glyphType: lm.glyphType, color: palette.inkDark };
    const size = Math.max(8, num(lm.sizePx, 15)) * unit;
    out.push(`<circle cx="${fmt(lm.x)}" cy="${fmt(lm.y)}" r="${fmt(size * 0.62)}" fill="${palette.paperBg}" fill-opacity="0.92" stroke="${palette.inkDark}" stroke-opacity="0.35" stroke-width="${fmt(px(0.9))}"/>`);
    out.push(buildLegendGlyphSVG(item, lm.x - size * 0.5, lm.y - size * 0.32, size, size * 0.64, palette));
    if (lm.showLabel !== false && lm.label) {
      out.push(svgText(lm.x + size * 0.62, lm.y + size * 0.62 + 9 * unit, lm.label, {
        font: '"Palatino Linotype", "Songti SC", serif',
        size: 12 * unit,
        fill: palette.inkDark,
        anchor: 'start',
        weight: '600',
        halo: hexToRgba(palette.paperBg, 0.95),
        haloW: 3 * unit
      }));
    }
  }
  const zones = Array.isArray(scene.zones) ? scene.zones : [];
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i];
    if (!zone || !zone.name || !Array.isArray(zone.points) || zone.points.length < 3) continue;
    const c = svgCentroid(zone.points);
    if (!c) continue;
    out.push(svgText(c[0], c[1], zone.name, {
      font: '"Palatino Linotype", "Songti SC", serif',
      size: 14 * unit,
      fill: hexToRgba(palette.inkDark, 0.62),
      anchor: 'middle',
      italic: true,
      halo: hexToRgba(palette.paperBg, 0.82),
      haloW: 3 * unit
    }));
  }
  out.push('</g>');

  /* 图饰层 */
  if (mode === 'full') {
    out.push('<g id="layer-13-cartouche">');
    out.push(`<rect x="${fmt(16.5 * unit)}" y="${fmt(16.5 * unit)}" width="${fmt(worldSizeM - 33 * unit)}" height="${fmt(worldSizeM - 33 * unit)}" fill="none" stroke="${hexToRgba(palette.inkDark, 0.55)}" stroke-width="${fmt(px(1.4))}"/>`);
    out.push(`<rect x="${fmt(22.5 * unit)}" y="${fmt(22.5 * unit)}" width="${fmt(worldSizeM - 45 * unit)}" height="${fmt(worldSizeM - 45 * unit)}" fill="none" stroke="${hexToRgba(palette.inkDark, 0.3)}" stroke-width="${fmt(px(0.7))}"/>`);

    const title = String(meta.name || '未命名聚落测绘图');
    const subtitle = String(meta.subtitle || '');
    const plateW = Math.min(worldSizeM * 0.5, Math.max(title.length * 26 * unit, subtitle.length * 13 * unit) + 34 * unit);
    const plateH = subtitle ? 62 * unit : 44 * unit;
    out.push(`<rect x="${fmt(30 * unit)}" y="${fmt(28 * unit)}" width="${fmt(plateW)}" height="${fmt(plateH)}" fill="${hexToRgba(palette.paperBg, 0.82)}" stroke="${hexToRgba(palette.inkDark, 0.38)}" stroke-width="${fmt(px(0.9))}"/>`);
    out.push(`<rect x="${fmt(30 * unit)}" y="${fmt(28 * unit)}" width="${fmt(4 * unit)}" height="${fmt(plateH)}" fill="${hexToRgba(palette.inkDark, 0.72)}"/>`);
    out.push(svgText(46 * unit, 28 * unit + (subtitle ? 24 * unit : plateH * 0.5), title, {
      font: '"Palatino Linotype", "Songti SC", serif',
      size: 26 * unit,
      fill: palette.inkDark,
      weight: '600'
    }));
    if (subtitle) {
      out.push(svgText(46 * unit, 28 * unit + 45 * unit, subtitle, {
        font: '"Avenir Next", "PingFang SC", sans-serif',
        size: 13 * unit,
        fill: hexToRgba(palette.inkDark, 0.7)
      }));
    }

    const compassX = worldSizeM - 58 * unit;
    const compassY = 58 * unit;
    out.push(`<circle cx="${fmt(compassX)}" cy="${fmt(compassY)}" r="${fmt(19 * unit)}" fill="${hexToRgba(palette.paperBg, 0.8)}" stroke="${hexToRgba(palette.inkDark, 0.45)}" stroke-width="${fmt(px(0.9))}"/>`);
    out.push(`<polygon points="${fmt(compassX)},${fmt(compassY - 14 * unit)} ${fmt(compassX + 5.2 * unit)},${fmt(compassY + 3 * unit)} ${fmt(compassX)},${fmt(compassY + 0.5 * unit)} ${fmt(compassX - 5.2 * unit)},${fmt(compassY + 3 * unit)}" fill="${hexToRgba(palette.inkDark, 0.88)}"/>`);
    out.push(svgText(compassX, compassY + 13 * unit, 'N', {
      font: '"Palatino Linotype", serif',
      size: 10 * unit,
      fill: hexToRgba(palette.inkDark, 0.75),
      anchor: 'middle',
      weight: '600'
    }));

    const meters = niceScale(180 * unit);
    const barLen = meters;
    const barX = 34 * unit;
    const barY = worldSizeM - 44 * unit;
    out.push(`<rect x="${fmt(barX - 8 * unit)}" y="${fmt(barY - 22 * unit)}" width="${fmt(barLen + 16 * unit)}" height="${fmt(40 * unit)}" fill="${hexToRgba(palette.paperBg, 0.86)}" stroke="${hexToRgba(palette.inkDark, 0.32)}" stroke-width="${fmt(px(0.7))}"/>`);
    const seg = 4;
    for (let i = 0; i < seg; i += 1) {
      out.push(`<rect x="${fmt(barX + (barLen / seg) * i)}" y="${fmt(barY)}" width="${fmt(barLen / seg)}" height="${fmt(7 * unit)}" fill="${i % 2 === 0 ? hexToRgba(palette.inkDark, 0.8) : hexToRgba(palette.paperBg, 0.95)}"/>`);
    }
    out.push(`<rect x="${fmt(barX)}" y="${fmt(barY)}" width="${fmt(barLen)}" height="${fmt(7 * unit)}" fill="none" stroke="${hexToRgba(palette.inkDark, 0.65)}" stroke-width="${fmt(px(0.8))}"/>`);
    out.push(svgText(barX, barY + 16 * unit, '0', { font: '"SF Mono", Menlo, monospace', size: 10 * unit, fill: hexToRgba(palette.inkDark, 0.78), anchor: 'middle' }));
    out.push(svgText(barX + barLen, barY + 16 * unit, `${meters} m`, { font: '"SF Mono", Menlo, monospace', size: 10 * unit, fill: hexToRgba(palette.inkDark, 0.78), anchor: 'middle' }));

    const legend = p.legend || {};
    if (legend.visible !== false) {
      const items = legendItems.filter((it) => it && it.visible !== false && it.autoPresent !== false);
      if (items.length > 0) {
        const columns = legend.columns === 1 ? 1 : 2;
        const colW = 168 * unit;
        const rowH = 22 * unit;
        const pad = 12 * unit;
        const titleH = (legend.title ? 24 : 6) * unit;
        const rows = Math.ceil(items.length / columns);
        const boxW = columns * colW + pad * 2;
        const boxH = titleH + rows * rowH + pad;
        const margin = 30 * unit;
        let boxX = worldSizeM - boxW - margin;
        let boxY = worldSizeM - boxH - margin;
        const pos = legend.position || 'bottom-right';
        // 与 Canvas 同构的四角避让
        if (pos === 'bottom-left') {
          boxX = margin;
          boxY = worldSizeM - boxH - margin - 46 * unit;
        } else if (pos === 'top-right') {
          boxX = worldSizeM - boxW - margin;
          boxY = margin + 76 * unit;
        } else if (pos === 'top-left') {
          boxX = margin;
          boxY = margin + 78 * unit;
        } else {
          boxX = worldSizeM - boxW - margin;
          boxY = worldSizeM - boxH - margin - 46 * unit;
        }
        boxX = Math.max(margin, Math.min(worldSizeM - boxW - margin, boxX));
        boxY = Math.max(margin, Math.min(worldSizeM - boxH - margin, boxY));
        out.push(`<rect x="${fmt(boxX)}" y="${fmt(boxY)}" width="${fmt(boxW)}" height="${fmt(boxH)}" fill="${hexToRgba(palette.paperBg, 0.93)}" stroke="${hexToRgba(palette.inkDark, 0.5)}" stroke-width="${fmt(px(1.1))}"/>`);
        out.push(`<rect x="${fmt(boxX + 3.5 * unit)}" y="${fmt(boxY + 3.5 * unit)}" width="${fmt(boxW - 7 * unit)}" height="${fmt(boxH - 7 * unit)}" fill="none" stroke="${hexToRgba(palette.inkDark, 0.25)}" stroke-width="${fmt(px(0.6))}"/>`);
        if (legend.title) {
          out.push(svgText(boxX + pad, boxY + 14 * unit, String(legend.title), {
            font: '"Palatino Linotype", "Songti SC", serif',
            size: 12 * unit,
            fill: hexToRgba(palette.inkDark, 0.9),
            weight: '600'
          }));
        }
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const col = Math.floor(i / rows);
          const row = i % rows;
          const gx = boxX + pad + col * colW;
          const gy = boxY + titleH + row * rowH;
          out.push(buildLegendGlyphSVG(item, gx, gy + 2 * unit, 28 * unit, 18 * unit, palette));
          out.push(svgText(gx + 34 * unit, gy + 11 * unit, String(item.label || item.key || ''), {
            font: '"Avenir Next", "PingFang SC", sans-serif',
            size: 11 * unit,
            fill: hexToRgba(palette.inkDark, 0.88)
          }));
        }
      }
    }
    out.push('</g>');
  }

  out.push('</svg>');
  return out.join('\n');
}

function svgCentroid(points) {
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
  if (Math.abs(area2) < 1e-9) return null;
  return [cx / (3 * area2), cy / (3 * area2)];
}

function niceScale(target) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let best = steps[0];
  let diff = Infinity;
  for (let i = 0; i < steps.length; i += 1) {
    const d = Math.abs(steps[i] - target);
    if (d < diff) {
      diff = d;
      best = steps[i];
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * 六、下载与本地文件读取
 * ---------------------------------------------------------------------------------------------- */

export function downloadSVG(project, compiledScene, options) {
  const svg = buildSVGString(project, compiledScene, options);
  const name = `${safeFileBaseName(project && project.meta && project.meta.name)}.svg`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename: name, bytes: svg.length };
}

export function downloadProjectJSON(project) {
  const payload = {
    ...project,
    schemaVersion: '1.2.0',
    meta: {
      ...(project && project.meta ? project.meta : {}),
      updatedAt: new Date().toISOString()
    }
  };
  const text = JSON.stringify(payload, null, 2);
  const name = `${safeFileBaseName(project && project.meta && project.meta.name)}.worldtown.json`;
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename: name, bytes: text.length };
}

export function readProjectJSONFile(fileObj) {
  return new Promise((resolve, reject) => {
    if (!fileObj) {
      reject(new Error('readProjectJSONFile: 未提供文件对象'));
      return;
    }
    if (typeof FileReader === 'undefined') {
      reject(new Error('readProjectJSONFile: 当前环境不支持 FileReader'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        resolve({ text, filename: fileObj.name || 'project.worldtown.json' });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('readProjectJSONFile: 文件读取失败'));
    reader.readAsText(fileObj, 'utf-8');
  });
}
