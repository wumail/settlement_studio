import type { SelectionTarget } from '../schema/geometry.types';
import type { LegendConfig } from '../schema/legend.schema';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import { paintLegendGlyph } from './paintLegendGlyph';
import type { RenderBackend, TextStyle } from './RenderBackend';

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FurnitureLayout {
  readonly titlePlateRect: LayoutRect;
  readonly compassRect: LayoutRect;
  readonly scaleBarRect: LayoutRect;
  readonly legendRect: LayoutRect;
  readonly zoneHudRect: LayoutRect | null;
  readonly legendColumns: 1 | 2;
}

export interface FurnitureLayoutInput {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly legend: LegendConfig;
  readonly hasZoneSelection?: boolean;
}

const MARGIN = 16;
const SAFE_GAP = 10;

export function rectsOverlap(a: LayoutRect, b: LayoutRect, gap = 0): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

export function legendVisibleRows(legend: LegendConfig): number {
  return legend.items.filter((item) => item.visible !== false && item.autoPresent !== false).length;
}

export function legendBoxSize(columns: 1 | 2, rows: number): { w: number; h: number } {
  const rowCount = Math.max(1, Math.ceil(rows / columns));
  return { w: columns === 2 ? 252 : 158, h: 34 + rowCount * 23 + 10 };
}

/**
 * 图廓四角智能避让：标题牌匾（左上）、指北针（右上）、比例尺（左下）、
 * 选区悬浮胶囊（顶部居中）与图例框之间做带 10px 安全间距的双向 AABB 推出；
 * 单列图例净高溢出时自动切双列紧凑网格，最后夹紧于画布内边距。
 */
function solveCorner(
  position: LegendConfig['position'],
  w: number,
  h: number,
  box: { w: number; h: number },
  title: LayoutRect,
  compass: LayoutRect,
  scale: LayoutRect,
  obstacles: ReadonlyArray<LayoutRect>,
): LayoutRect | null {
  const left = position === 'top-left' || position === 'bottom-left';
  const top = position === 'top-left' || position === 'top-right';
  const x = left ? MARGIN : w - MARGIN - box.w;
  const minY = MARGIN;
  const maxY = h - MARGIN - box.h;
  let y = top
    ? (position === 'top-left' ? title.y + title.h + 12 : compass.y + compass.h + 12)
    : (position === 'bottom-left' ? scale.y - box.h - 12 : maxY);
  y = Math.max(minY, Math.min(maxY, y));
  for (let iter = 0; iter < 8; iter += 1) {
    const rect: LayoutRect = { x, y, w: box.w, h: box.h };
    const hits = obstacles.filter((obstacle) => rectsOverlap(rect, obstacle, SAFE_GAP));
    if (hits.length === 0) return rect;
    const next = top
      ? Math.max(...hits.map((obstacle) => obstacle.y + obstacle.h + 12))
      : Math.min(...hits.map((obstacle) => obstacle.y - box.h - 12));
    if (top ? next <= y : next >= y) return null;
    y = next;
    if (y < minY || y > maxY) return null;
  }
  return null;
}

/**
 * 图廓四角智能避让：每个停靠角以自身固定图饰为基准净空定位
 * （左上让标题牌、右上让指北针、左下让比例尺、右下贴角），
 * 冲突时按「原角 -> 其余三角 -> 切换列数」顺序寻找零重叠解。
 */
export function computeFurnitureLayout(input: FurnitureLayoutInput): FurnitureLayout {
  const w = Math.max(1, input.widthPx);
  const h = Math.max(1, input.heightPx);
  const rows = legendVisibleRows(input.legend);
  const titlePlateRect: LayoutRect = { x: 30, y: 28, w: Math.min(360, w * 0.42), h: 46 };
  const compassRect: LayoutRect = { x: Math.max(40, w - 84), y: 32, w: 52, h: 52 };
  const scaleBarRect: LayoutRect = { x: 26, y: Math.max(60, h - 66), w: 196, h: 40 };
  const zoneHudRect: LayoutRect | null = input.hasZoneSelection
    ? { x: w * 0.5 - 230, y: 12, w: Math.min(460, w - 2 * MARGIN), h: 44 }
    : null;

  if (zoneHudRect && rectsOverlap(titlePlateRect, zoneHudRect, SAFE_GAP)) {
    const shifted = zoneHudRect.y + zoneHudRect.h + 12;
    titlePlateRect.y = Math.min(shifted, Math.max(MARGIN, h - titlePlateRect.h - MARGIN));
  }

  const obstacles: LayoutRect[] = [titlePlateRect, compassRect, scaleBarRect];
  if (zoneHudRect) obstacles.push(zoneHudRect);
  const blocked = (rect: LayoutRect): boolean =>
    obstacles.some((obstacle) => rectsOverlap(rect, obstacle, SAFE_GAP));

  const order: ReadonlyArray<LegendConfig['position']> = [
    input.legend.position, 'top-left', 'top-right', 'bottom-left', 'bottom-right',
  ];
  let legendRect: LayoutRect | null = null;
  let chosenColumns: 1 | 2 = input.legend.columns;
  const columnOptions: ReadonlyArray<1 | 2> = input.legend.columns === 2 ? [2, 1] : [1, 2];
  for (const position of order) {
    for (const columnOption of columnOptions) {
      const box = legendBoxSize(columnOption, rows);
      const candidate = solveCorner(position, w, h, box, titlePlateRect, compassRect, scaleBarRect, obstacles);
      if (!candidate || blocked(candidate)) continue;
      legendRect = candidate;
      chosenColumns = columnOption;
      break;
    }
    if (legendRect) break;
  }
  if (!legendRect) {
    const fallbackBox = legendBoxSize(chosenColumns, rows);
    legendRect = {
      x: input.legend.position.endsWith('left') ? MARGIN : Math.max(MARGIN, w - MARGIN - fallbackBox.w),
      y: MARGIN,
      w: fallbackBox.w,
      h: fallbackBox.h,
    };
  }

  return { titlePlateRect, compassRect, scaleBarRect, legendRect, zoneHudRect, legendColumns: chosenColumns };
}

/** 图例框内第 index 行的屏幕矩形（供绘制与命中复用，双端严格同源） */
export function legendItemRect(
  legendRect: LayoutRect,
  columns: 1 | 2,
  index: number,
): LayoutRect {
  const col = columns === 2 ? index % 2 : 0;
  const row = columns === 2 ? Math.floor(index / 2) : index;
  const colW = (legendRect.w - 20) / columns;
  return {
    x: legendRect.x + 10 + col * colW,
    y: legendRect.y + 34 + row * 23,
    w: colW - 6,
    h: 18,
  };
}

export interface FurniturePaintInput {
  readonly project: TownProject;
  readonly palette: ResolvedPalette;
  readonly selection?: SelectionTarget | null;
  readonly legend?: LegendConfig;
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly widthPx: number;
  readonly heightPx: number;
  readonly zoom: number;
}

/** 第 13 层图饰：双细线内图框 + 标题牌匾 + 古典指北针 + 公制比例尺 + 微缩真图形图例框 */
export function paintFurniture(backend: RenderBackend, input: FurniturePaintInput): void {
  const pal = input.palette;
  const frame = input.frame;
  const legendConfig = input.legend ?? input.project.legend;
  const layout = computeFurnitureLayout({
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    legend: legendConfig,
    hasZoneSelection: input.selection?.type === 'zone',
  });
  const serif = (size: number, fill: string, extra?: Partial<TextStyle>): TextStyle => ({
    fontFamily: '"Palatino Linotype", "Book Antiqua", "Songti SC", serif',
    fontSizePx: size,
    fill,
    baseline: 'middle',
    ...extra,
  });

  backend.drawRect(frame.x, frame.y, frame.w, frame.h, { stroke: pal.inkDark, lineWidth: 1.5 });
  backend.drawRect(frame.x + 6, frame.y + 6, frame.w - 12, frame.h - 12, {
    stroke: pal.inkDark,
    lineWidth: 0.6,
    opacity: 0.55,
  });

  const t = layout.titlePlateRect;
  backend.drawRoundedRect(t.x, t.y, t.w, t.h, 3, {
    fill: pal.paperBg,
    fillOpacity: 0.94,
    stroke: pal.inkDark,
    lineWidth: 0.9,
  });
  backend.drawText(input.project.meta.name, t.x + 14, t.y + 18, serif(15, pal.inkDark));
  backend.drawText(input.project.meta.subtitle || 'TERRAX 聚落测绘平面图', t.x + 14, t.y + 34, serif(10, pal.inkMuted));

  const cp = layout.compassRect;
  const ccx = cp.x + cp.w * 0.5;
  const ccy = cp.y + cp.h * 0.5 + 5;
  backend.drawCircle(ccx, ccy, 20, { fill: pal.paperBg, fillOpacity: 0.9, stroke: pal.inkDark, lineWidth: 0.9 });
  backend.drawPolygon(
    [[ccx, ccy - 16], [ccx + 5, ccy], [ccx, ccy + 16], [ccx - 5, ccy]],
    { fill: pal.inkDark, fillOpacity: 0.85 },
  );
  backend.drawText('N', ccx, cp.y + 8, serif(10, pal.inkDark, { align: 'center' }));

  const sb = layout.scaleBarRect;
  const barW = Math.min(sb.w - 16, 160);
  for (let i = 0; i < 4; i += 1) {
    backend.drawRect(sb.x + 8 + (barW / 4) * i, sb.y + 18, barW / 4, 7, {
      fill: i % 2 === 0 ? pal.inkDark : pal.paperBg,
      stroke: pal.inkDark,
      lineWidth: 0.6,
    });
  }
  const meters = Math.max(1, Math.round(barW / Math.max(1e-6, input.zoom)));
  backend.drawText(`0 — ${meters} m`, sb.x + 8, sb.y + 34, serif(9, pal.inkMuted));

  if (!legendConfig.visible) return;
  const legend = layout.legendRect;
  backend.drawRoundedRect(legend.x, legend.y, legend.w, legend.h, 4, {
    fill: pal.paperBg,
    fillOpacity: 0.95,
    stroke: pal.inkDark,
    lineWidth: 1,
  });
  backend.drawText(legendConfig.title, legend.x + 10, legend.y + 18, serif(11, pal.inkDark, { fontWeight: 600 }));
  const items = legendConfig.items.filter((item) => item.visible !== false && item.autoPresent !== false);
  items.forEach((item, index) => {
    const r = legendItemRect(legend, layout.legendColumns, index);
    paintLegendGlyph(backend, item, r.x, r.y, 24, 15, pal);
    backend.drawText(item.label, r.x + 30, r.y + 8, serif(9.5, pal.inkSecondary));
  });
}
