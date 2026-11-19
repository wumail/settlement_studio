import type { SelectionTarget } from '../schema/geometry.types';
import type { LegendConfig } from '../schema/legend.schema';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import {
  computeFurnitureLayout,
  estimateTextWidth,
  legendItemRect,
  type LayoutRect,
} from './furnitureLayout';
import { paintLegendGlyph } from './paintLegendGlyph';
import type { RenderBackend, ShapeStyle, StrokeStyle, TextStyle } from './RenderBackend';

/** 透明度透传包装：让图例微缩图标与图例底板/文字共享 furnitureOpacity，双端同源 */
function withGlyphOpacity(backend: RenderBackend, alpha: number): RenderBackend {
  if (alpha >= 0.999) return backend;
  const shape = (s: ShapeStyle): ShapeStyle => ({ ...s, opacity: (s.opacity ?? 1) * alpha });
  const stroke = (s: StrokeStyle): StrokeStyle => ({ ...s, opacity: (s.opacity ?? 1) * alpha });
  return {
    get widthPx() { return backend.widthPx; },
    get heightPx() { return backend.heightPx; },
    beginLayer: (id) => backend.beginLayer(id),
    endLayer: () => backend.endLayer(),
    pushClipRect: (x, y, w, h) => backend.pushClipRect(x, y, w, h),
    popClip: () => backend.popClip(),
    pushTransform: (tx, ty, sx, sy) => backend.pushTransform(tx, ty, sx, sy),
    popTransform: () => backend.popTransform(),
    drawPaperBackground: (hex, vig) => backend.drawPaperBackground(hex, vig),
    drawRect: (x, y, w, h, s) => backend.drawRect(x, y, w, h, shape(s)),
    drawRoundedRect: (x, y, w, h, r, s) => backend.drawRoundedRect(x, y, w, h, r, shape(s)),
    drawPolygon: (pts, s) => backend.drawPolygon(pts, shape(s)),
    drawPolygonWithHoles: (o, h, s) => backend.drawPolygonWithHoles(o, h, shape(s)),
    drawBatchPolygons: (polys, s) => backend.drawBatchPolygons(polys, shape(s)),
    drawPolyline: (pts, s, c) => backend.drawPolyline(pts, stroke(s), c),
    drawSegments: (segs, s) => backend.drawSegments(segs, stroke(s)),
    drawBezier: (p0, cp1, cp2, p3, s, c) => backend.drawBezier(p0, cp1, cp2, p3, shape(s), c),
    drawCircle: (cx, cy, r, s) => backend.drawCircle(cx, cy, r, shape(s)),
    drawArc: (cx, cy, r, sr, er, s) => backend.drawArc(cx, cy, r, sr, er, stroke(s)),
    drawCirclesMergedPass: (circles, fill) => backend.drawCirclesMergedPass(circles, fill),
    drawText: (text, x, y, s) => backend.drawText(text, x, y, { ...s, opacity: (s.opacity ?? 1) * alpha }),
    measureTextWidth: (text, px) => backend.measureTextWidth(text, px),
  };
}

export interface FurniturePaintInput {
  readonly project: TownProject;
  readonly palette: ResolvedPalette;
  readonly selection?: SelectionTarget | null;
  readonly legend?: LegendConfig;
  readonly frame: LayoutRect;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly zoom: number;
  /** frame = 导出成图；viewport = 交互编辑态（图饰钉在视口四角） */
  readonly boundsMode?: 'frame' | 'viewport';
  /** 图饰统一半透明度，默认取 legend.furnitureOpacity */
  readonly opacity?: number;
}

const SERIF_FONT = '"Palatino Linotype", "Book Antiqua", "Songti SC", serif';

/** 按可用像素宽度优雅截断（超宽补省略号），杜绝长副标题溢出右边框 */
export function ellipsize(text: string, maxPx: number, fontPx: number): string {
  if (estimateTextWidth(text, fontPx) <= maxPx) return text;
  const chars = [...text];
  let out = '';
  for (const ch of chars) {
    if (estimateTextWidth(`${out}${ch}…`, fontPx) > maxPx) break;
    out += ch;
  }
  return out.length > 0 ? `${out}…` : '';
}

/** 第 13 层图饰：双细线内图框 + 标题牌匾 + 古典指北针 + 整刻度比例尺 + 微缩真图形图例框 */
export function paintFurniture(backend: RenderBackend, input: FurniturePaintInput): void {
  const pal = input.palette;
  const frame = input.frame;
  const legendConfig = input.legend ?? input.project.legend;
  const opacity = Math.max(0.05, Math.min(1, input.opacity ?? legendConfig.furnitureOpacity ?? 0.72));
  const layout = computeFurnitureLayout({
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    frame,
    legend: legendConfig,
    hasZoneSelection: input.selection?.type === 'zone',
    zoom: input.zoom,
    boundsMode: input.boundsMode ?? 'frame',
    title: input.project.meta.name,
    subtitle: input.project.meta.subtitle,
  });
  const serif = (size: number, fill: string, extra?: Partial<TextStyle>): TextStyle => ({
    fontFamily: SERIF_FONT,
    fontSizePx: size,
    fill,
    baseline: 'middle',
    opacity,
    ...extra,
  });

  backend.drawRect(frame.x, frame.y, frame.w, frame.h, {
    stroke: pal.inkDark,
    lineWidth: 1.5,
    opacity,
  });
  backend.drawRect(frame.x + 6, frame.y + 6, frame.w - 12, frame.h - 12, {
    stroke: pal.inkDark,
    lineWidth: 0.6,
    opacity: 0.55 * opacity,
  });

  const t = layout.titlePlateRect;
  backend.drawRoundedRect(t.x, t.y, t.w, t.h, 3, {
    fill: pal.paperBg,
    fillOpacity: 0.94 * opacity,
    stroke: pal.inkDark,
    lineWidth: 0.9,
    opacity,
  });
  const textRoom = t.w - 26;
  backend.drawText(ellipsize(input.project.meta.name, textRoom, 15), t.x + 14, t.y + 18, serif(15, pal.inkDark));
  backend.drawText(
    ellipsize(input.project.meta.subtitle || 'TERRAX 聚落测绘平面图', textRoom, 10),
    t.x + 14,
    t.y + 34,
    serif(10, pal.inkMuted),
  );

  const cp = layout.compassRect;
  const ccx = cp.x + cp.w * 0.5;
  const ccy = cp.y + cp.h * 0.5 + 5;
  backend.drawCircle(ccx, ccy, 20, {
    fill: pal.paperBg,
    fillOpacity: 0.9 * opacity,
    stroke: pal.inkDark,
    lineWidth: 0.9,
    opacity,
  });
  backend.drawPolygon(
    [[ccx, ccy - 16], [ccx + 5, ccy], [ccx, ccy + 16], [ccx - 5, ccy]],
    { fill: pal.inkDark, fillOpacity: 0.85 * opacity, opacity },
  );
  backend.drawText('N', ccx, cp.y + 8, serif(10, pal.inkDark, { align: 'center' }));

  const sb = layout.scaleBarRect;
  const barW = layout.scaleBarWidthPx;
  const segments = 4;
  for (let i = 0; i < segments; i += 1) {
    backend.drawRect(sb.x + 8 + (barW / segments) * i, sb.y + 18, barW / segments, 7, {
      fill: i % 2 === 0 ? pal.inkDark : pal.paperBg,
      stroke: pal.inkDark,
      lineWidth: 0.6,
      opacity,
    });
  }
  backend.drawText(`0 — ${layout.scaleMeters} m`, sb.x + 8, sb.y + 34, serif(9, pal.inkMuted));

  if (!legendConfig.visible) return;
  const legend = layout.legendRect;
  backend.drawRoundedRect(legend.x, legend.y, legend.w, legend.h, 4, {
    fill: pal.paperBg,
    fillOpacity: 0.95 * opacity,
    stroke: pal.inkDark,
    lineWidth: 1,
    opacity,
  });
  backend.drawText(legendConfig.title, legend.x + 10, legend.y + 18, serif(11, pal.inkDark, { fontWeight: 600 }));
  const glyphBackend = withGlyphOpacity(backend, opacity);
  const items = legendConfig.items.filter((item) => item.visible !== false && item.autoPresent !== false);
  items.forEach((item, index) => {
    const r = legendItemRect(legend, layout.legendColumns, index);
    if (r.y + r.h > legend.y + legend.h - 6) return;
    paintLegendGlyph(glyphBackend, item, r.x, r.y, 24, 15, pal);
    backend.drawText(ellipsize(item.label, r.w - 30, 9.5), r.x + 30, r.y + 8, serif(9.5, pal.inkSecondary));
  });
}
