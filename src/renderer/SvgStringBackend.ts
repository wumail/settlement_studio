import type { Polygon, Polyline, Vec2 } from '../schema/geometry.types';
import type {
  MergedCircleItem,
  RenderBackend,
  ShapeStyle,
  StrokeStyle,
  TextStyle,
} from './RenderBackend';

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1000) / 1000);
}

function pathOf(points: Polyline, closed: boolean): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (!p) continue;
    parts.push(`${i === 0 ? 'M' : 'L'} ${num(p[0])} ${num(p[1])}`);
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

function shapeAttrs(style: ShapeStyle): string {
  const parts: string[] = [];
  if (style.fill) {
    parts.push(`fill="${style.fill}"`);
    if (style.fillOpacity !== undefined) parts.push(`fill-opacity="${num(style.fillOpacity)}"`);
  } else {
    parts.push('fill="none"');
  }
  if (style.stroke) {
    parts.push(`stroke="${style.stroke}"`);
    parts.push(`stroke-width="${num(style.lineWidth ?? 1)}"`);
    if (style.dash && style.dash.length > 0) {
      parts.push(`stroke-dasharray="${style.dash.map(num).join(' ')}"`);
    }
  }
  if (style.opacity !== undefined) parts.push(`opacity="${num(style.opacity)}"`);
  return parts.join(' ');
}

function strokeAttrs(style: StrokeStyle): string {
  const parts = [
    'fill="none"',
    `stroke="${style.stroke}"`,
    `stroke-width="${num(style.lineWidth)}"`,
    `stroke-linecap="${style.lineCap ?? 'round'}"`,
    `stroke-linejoin="${style.lineJoin ?? 'round'}"`,
  ];
  if (style.dash && style.dash.length > 0) {
    parts.push(`stroke-dasharray="${style.dash.map(num).join(' ')}"`);
  }
  if (style.opacity !== undefined) parts.push(`opacity="${num(style.opacity)}"`);
  return parts.join(' ');
}

/** 纯字符串零 DOM 分层矢量后端：Node / Vitest 可直接运行，无 window / document 依赖 */
export class SvgStringBackend implements RenderBackend {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly layerIds: string[] = [];

  private readonly buf: string[] = [];
  private clipSeq = 0;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = Math.max(1, widthPx);
    this.heightPx = Math.max(1, heightPx);
  }

  beginLayer(layerId: string): void {
    this.layerIds.push(layerId);
    this.buf.push(`<g id="layer-${escapeXml(layerId)}">`);
  }

  endLayer(): void {
    this.buf.push('</g>');
  }

  pushClipRect(x: number, y: number, w: number, h: number): void {
    this.clipSeq += 1;
    const id = `clip-${this.clipSeq}`;
    this.buf.push(
      `<defs><clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/></clipPath></defs>`,
    );
    this.buf.push(`<g clip-path="url(#${id})">`);
  }

  popClip(): void {
    this.buf.push('</g>');
  }

  pushTransform(tx: number, ty: number, scaleX: number, scaleY: number): void {
    this.buf.push(`<g transform="translate(${num(tx)} ${num(ty)}) scale(${num(scaleX)} ${num(scaleY)})">`);
  }

  popTransform(): void {
    this.buf.push('</g>');
  }

  drawPaperBackground(paperHex: string, withVignette: boolean): void {
    this.buf.push(
      `<rect x="0" y="0" width="${num(this.widthPx)}" height="${num(this.heightPx)}" fill="${paperHex}"/>`,
    );
    if (!withVignette) return;
    this.buf.push(
      `<defs><radialGradient id="paper-vignette" cx="50%" cy="50%" r="72%"><stop offset="60%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.16"/></radialGradient></defs>`,
    );
    this.buf.push(
      `<rect x="0" y="0" width="${num(this.widthPx)}" height="${num(this.heightPx)}" fill="url(#paper-vignette)"/>`,
    );
  }

  drawRect(x: number, y: number, w: number, h: number, style: ShapeStyle): void {
    this.buf.push(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${shapeAttrs(style)}/>`,
    );
  }

  drawRoundedRect(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void {
    this.buf.push(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}" ${shapeAttrs(style)}/>`,
    );
  }

  drawPolygon(points: Polygon, style: ShapeStyle): void {
    this.buf.push(`<path d="${pathOf(points, true)}" ${shapeAttrs(style)}/>`);
  }

  drawPolygonWithHoles(outer: Polygon, holes: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    const d = [pathOf(outer, true), ...holes.map((hole) => pathOf(hole, true))].join(' ');
    this.buf.push(`<path d="${d}" fill-rule="evenodd" ${shapeAttrs(style)}/>`);
  }

  drawBatchPolygons(polygons: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    if (polygons.length === 0) return;
    const d = polygons.map((poly) => pathOf(poly, true)).join(' ');
    this.buf.push(`<path d="${d}" ${shapeAttrs(style)}/>`);
  }

  drawPolyline(points: Polyline, style: StrokeStyle, closed = false): void {
    if (points.length < 2) return;
    this.buf.push(`<path d="${pathOf(points, closed)}" ${strokeAttrs(style)}/>`);
  }

  drawSegments(segments: ReadonlyArray<readonly [Vec2, Vec2]>, style: StrokeStyle): void {
    if (segments.length === 0) return;
    const d = segments
      .map((seg) => `M ${num(seg[0][0])} ${num(seg[0][1])} L ${num(seg[1][0])} ${num(seg[1][1])}`)
      .join(' ');
    this.buf.push(`<path d="${d}" ${strokeAttrs(style)}/>`);
  }

  drawBezier(p0: Vec2, cp1: Vec2, cp2: Vec2, p3: Vec2, style: ShapeStyle, closed = false): void {
    const d = `M ${num(p0[0])} ${num(p0[1])} C ${num(cp1[0])} ${num(cp1[1])}, ${num(cp2[0])} ${num(cp2[1])}, ${num(p3[0])} ${num(p3[1])}${closed ? ' Z' : ''}`;
    this.buf.push(`<path d="${d}" ${shapeAttrs(style)}/>`);
  }

  drawCircle(cx: number, cy: number, r: number, style: ShapeStyle): void {
    this.buf.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" ${shapeAttrs(style)}/>`);
  }

  drawArc(cx: number, cy: number, r: number, startRad: number, endRad: number, style: StrokeStyle): void {
    const x0 = cx + r * Math.cos(startRad);
    const y0 = cy + r * Math.sin(startRad);
    const x1 = cx + r * Math.cos(endRad);
    const y1 = cy + r * Math.sin(endRad);
    const largeArc = Math.abs(endRad - startRad) > Math.PI ? 1 : 0;
    const sweep = endRad >= startRad ? 1 : 0;
    const d = `M ${num(x0)} ${num(y0)} A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(x1)} ${num(y1)}`;
    this.buf.push(`<path d="${d}" ${strokeAttrs(style)}/>`);
  }

  drawCirclesMergedPass(circles: ReadonlyArray<MergedCircleItem>, fillStyle: string): void {
    if (circles.length === 0) return;
    this.buf.push(`<g fill="${fillStyle}">`);
    for (const c of circles) {
      this.buf.push(`<circle cx="${num(c.cx)}" cy="${num(c.cy)}" r="${num(c.r)}"/>`);
    }
    this.buf.push('</g>');
  }

  drawText(text: string, x: number, y: number, style: TextStyle): void {
    const anchor = style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start';
    const baseline =
      style.baseline === 'top' ? 'hanging' : style.baseline === 'middle' ? 'central' : 'auto';
    const parts = [
      `x="${num(x)}"`,
      `y="${num(y)}"`,
      `font-family="${escapeXml(style.fontFamily)}"`,
      `font-size="${num(style.fontSizePx)}"`,
      `fill="${style.fill}"`,
      `text-anchor="${anchor}"`,
      `dominant-baseline="${baseline}"`,
    ];
    if (style.fontWeight !== undefined) parts.push(`font-weight="${num(Number(style.fontWeight) || 400)}"`);
    if (style.italic) parts.push('font-style="italic"');
    if (style.haloColor && (style.haloWidthPx ?? 0) > 0) {
      parts.push(`stroke="${style.haloColor}"`);
      parts.push(`stroke-width="${num((style.haloWidthPx ?? 0) * 2)}"`);
      parts.push('paint-order="stroke"');
      parts.push('stroke-linejoin="round"');
    }
    this.buf.push(`<text ${parts.join(' ')}>${escapeXml(text)}</text>`);
  }

  /** 确定性中日韩宽字符感知宽度估算（CJK 1.0 / 大写拉丁 0.64 / 其余 ASCII 0.54） */
  measureTextWidth(text: string, fontSizePx: number): number {
    let units = 0;
    for (const ch of text) {
      if (CJK.test(ch)) units += 1.0;
      else if (ch >= 'A' && ch <= 'Z') units += 0.64;
      else units += 0.54;
    }
    return units * fontSizePx;
  }

  toSvgString(): string {
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.widthPx)}" height="${num(this.heightPx)}" viewBox="0 0 ${num(this.widthPx)} ${num(this.heightPx)}">`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n${head}${this.buf.join('')}</svg>`;
  }
}
