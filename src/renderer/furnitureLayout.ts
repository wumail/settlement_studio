import type { LegendConfig } from '../schema/legend.schema';

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
  /** 整刻度比例尺：吸附后的米数与准确像素宽度 */
  readonly scaleMeters: number;
  readonly scaleBarWidthPx: number;
}

export interface FurnitureLayoutInput {
  readonly widthPx: number;
  readonly heightPx: number;
  /** 地图纸框像素矩形：导出成图态全部图饰锚定在 frame ∩ viewport 内缩 14px */
  readonly frame: LayoutRect;
  readonly legend: LegendConfig;
  readonly hasZoneSelection?: boolean;
  readonly zoom?: number;
  /**
   * frame（默认）= 导出成图态，图饰排入地图纸框；
   * viewport = 交互编辑态，图饰固定在画布视口四角，绝不随地图平移缩放挤成一团。
   */
  readonly boundsMode?: 'frame' | 'viewport';
  readonly title?: string;
  readonly subtitle?: string;
}

const PAD = 14;
const GAP = 10;
const TITLE_H = 46;
const COMPASS_W = 52;
const SCALE_H = 40;

export function rectsOverlap(a: LayoutRect, b: LayoutRect, gap = 0): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/** 无 DOM 环境的保守字宽估算：CJK 全角按 1em、ASCII 按 0.56em */
export function estimateTextWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20) em += 0.3;
    else if (code < 0x2e80) em += 0.56;
    else em += 1;
  }
  return em * fontPx;
}

/** 标题牌宽度：按主/副标题实测撑宽，clamp(220, 440, 可用宽度 52%) */
export function titlePlateWidth(area: LayoutRect, title: string, subtitle: string): number {
  const cap = Math.max(120, Math.min(440, area.w * 0.52));
  const measured = Math.max(estimateTextWidth(title, 15), estimateTextWidth(subtitle, 10)) + 34;
  return Math.max(Math.min(220, cap), Math.min(cap, measured));
}

function intersectRect(a: LayoutRect, b: LayoutRect): LayoutRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

function insetRect(rect: LayoutRect, pad: number): LayoutRect {
  const w = Math.max(1, rect.w - pad * 2);
  const h = Math.max(1, rect.h - pad * 2);
  return { x: rect.x + pad, y: rect.y + pad, w, h };
}

export function legendVisibleRows(legend: LegendConfig): number {
  return legend.items.filter((item) => item.visible !== false && item.autoPresent !== false).length;
}

export function legendBoxSize(columns: 1 | 2, rows: number): { w: number; h: number } {
  const rowCount = Math.max(1, Math.ceil(rows / columns));
  return { w: columns === 2 ? 252 : 158, h: 34 + rowCount * 23 + 10 };
}

/** 比例尺整刻度吸附：1 / 2 / 5 × 10^n，彻底消灭 717m 类业余读数 */
export function niceScaleMeters(rawMeters: number): number {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) return 1;
  const exp = Math.floor(Math.log10(rawMeters));
  const base = Math.pow(10, exp);
  const norm = rawMeters / base;
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return Math.max(1, Math.round(mult * base));
}

/** 在给定停靠角内放置图例，冲突时沿垂直轴推开；推不动则换角 */
function placeAtCorner(
  position: LegendConfig['position'],
  area: LayoutRect,
  box: { w: number; h: number },
  blockers: ReadonlyArray<LayoutRect>,
): LayoutRect | null {
  if (box.w > area.w || box.h > area.h) return null;
  const left = position.endsWith('left');
  const top = position.startsWith('top');
  const x = left ? area.x : area.x + area.w - box.w;
  let y = top ? area.y : area.y + area.h - box.h;
  for (let iter = 0; iter < 10; iter += 1) {
    const rect: LayoutRect = { x, y, w: box.w, h: box.h };
    const hit = blockers.find((blocker) => rectsOverlap(rect, blocker, GAP));
    if (!hit) return rect;
    const nextY = top ? hit.y + hit.h + GAP : hit.y - box.h - GAP;
    if (nextY === y) return null;
    y = nextY;
    if (y < area.y - 1e-6 || y + box.h > area.y + area.h + 1e-6) return null;
  }
  return null;
}

/**
 * 图廓图饰排版：标题牌（左上）、指北针（右上）、比例尺（左下）、图例（配置角）全部
 * 严格锚定在 frame ∩ viewport 内缩 14px，双向避让后零重叠，绝不穿框。
 */
export function computeFurnitureLayout(input: FurnitureLayoutInput): FurnitureLayout {
  const viewport: LayoutRect = { x: 0, y: 0, w: Math.max(1, input.widthPx), h: Math.max(1, input.heightPx) };
  const boundary = input.boundsMode === 'viewport' ? viewport : intersectRect(viewport, input.frame);
  const area = insetRect(boundary, PAD);
  const compassX = area.x + area.w - COMPASS_W;
  const wanted = titlePlateWidth(area, input.title ?? '', input.subtitle ?? '');
  const titleW = Math.max(80, Math.min(wanted, Math.max(80, compassX - GAP - area.x)));
  const titlePlateRect: LayoutRect = { x: area.x, y: area.y, w: titleW, h: TITLE_H };
  const compassRect: LayoutRect = { x: compassX, y: area.y, w: COMPASS_W, h: COMPASS_W };
  const scaleBarRect: LayoutRect = {
    x: area.x,
    y: area.y + area.h - SCALE_H,
    w: Math.min(200, area.w),
    h: SCALE_H,
  };
  const hudW = Math.min(460, Math.max(1, area.w - 2 * GAP));
  const hudH = 44;
  const hudY = area.y + COMPASS_W + 2 * GAP;
  const zoneHudRect: LayoutRect | null =
    input.hasZoneSelection && hudY + hudH <= scaleBarRect.y - GAP
      ? { x: area.x + (area.w - hudW) * 0.5, y: hudY, w: hudW, h: hudH }
      : null;

  const rows = Math.max(1, legendVisibleRows(input.legend));
  let columns: 1 | 2 = input.legend.columns;
  let box = legendBoxSize(columns, rows);
  if (box.h > area.h * 0.72 && columns === 1) {
    columns = 2;
    box = legendBoxSize(columns, rows);
  }
  const blockers: LayoutRect[] = [titlePlateRect, compassRect, scaleBarRect];
  if (zoneHudRect) blockers.push(zoneHudRect);
  const order: ReadonlyArray<LegendConfig['position']> = [
    input.legend.position,
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ];
  let legendRect: LayoutRect | null = null;
  for (const position of order) {
    legendRect = placeAtCorner(position, area, box, blockers);
    if (legendRect) break;
  }
  if (!legendRect) {
    const bandTop = area.y + TITLE_H + GAP;
    const bandBottom = scaleBarRect.y - GAP;
    const rowsFit = Math.max(1, Math.floor((bandBottom - bandTop - 44) / 23));
    const fit = legendBoxSize(2, rowsFit * 2);
    columns = 2;
    legendRect = {
      x: area.x + area.w - fit.w,
      y: Math.max(area.y, bandBottom - fit.h),
      w: fit.w,
      h: fit.h,
    };
  }

  const zoom = input.zoom && input.zoom > 1e-6 ? input.zoom : 1;
  const availPx = Math.max(24, Math.min(scaleBarRect.w - 16, 176));
  let scaleMeters = niceScaleMeters(availPx / zoom);
  while (scaleMeters * zoom > availPx && scaleMeters > 1) {
    scaleMeters = niceScaleMeters(scaleMeters * 0.7);
  }
  const scaleBarWidthPx = Math.max(8, scaleMeters * zoom);

  return {
    titlePlateRect,
    compassRect,
    scaleBarRect,
    legendRect,
    zoneHudRect,
    legendColumns: columns,
    scaleMeters,
    scaleBarWidthPx,
  };
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

export { paintFurniture } from './paintFurniture';
export type { FurniturePaintInput } from './paintFurniture';
