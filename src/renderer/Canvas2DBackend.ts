import type { Polygon, Polyline, Vec2 } from '../schema/geometry.types';
import type {
  MergedCircleItem,
  RenderBackend,
  ShapeStyle,
  StrokeStyle,
  TextStyle,
} from './RenderBackend';

/** 非法/透明填充色守卫：'none' 赋给 ctx.fillStyle 会被浏览器静默忽略并保留上一次颜色（常为 #000000） */
export function hasVisibleFill(fill?: string): fill is string {
  if (!fill) return false;
  const value = fill.trim().toLowerCase();
  return value !== '' && value !== 'none' && value !== 'transparent';
}

/** 描边色守卫：'none' / 'transparent' 不得写入 ctx.strokeStyle */
export function hasVisibleStroke(stroke?: string): stroke is string {
  return hasVisibleFill(stroke);
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: Polyline, closed: boolean): void {
  if (points.length === 0) return;
  const first = points[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (!p) continue;
    ctx.lineTo(p[0], p[1]);
  }
  if (closed) ctx.closePath();
}

/** 高清 DPR Canvas 2D 后端：仅调用标准 Context 方法，可被轻量 Spy 对象完整对拍 */
export class Canvas2DBackend implements RenderBackend {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly layerIds: string[] = [];

  private readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number, dpr = 1) {
    this.ctx = ctx;
    this.widthPx = Math.max(1, widthPx);
    this.heightPx = Math.max(1, heightPx);
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  beginLayer(layerId: string): void {
    this.layerIds.push(layerId);
    this.ctx.save();
  }

  endLayer(): void {
    this.ctx.restore();
  }

  pushClipRect(x: number, y: number, w: number, h: number): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
  }

  popClip(): void {
    this.ctx.restore();
  }

  pushTransform(tx: number, ty: number, scaleX: number, scaleY: number): void {
    this.ctx.save();
    this.ctx.translate(tx, ty);
    this.ctx.scale(scaleX, scaleY);
  }

  popTransform(): void {
    this.ctx.restore();
  }

  drawPaperBackground(paperHex: string, withVignette: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = paperHex;
    ctx.fillRect(0, 0, this.widthPx, this.heightPx);
    if (withVignette) {
      const gradient = ctx.createRadialGradient(
        this.widthPx * 0.5,
        this.heightPx * 0.5,
        Math.min(this.widthPx, this.heightPx) * 0.32,
        this.widthPx * 0.5,
        this.heightPx * 0.5,
        Math.max(this.widthPx, this.heightPx) * 0.72,
      );
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.widthPx, this.heightPx);
    }
    ctx.restore();
  }

  private fillAndStroke(style: ShapeStyle, fillPath: () => void, strokePath: () => void): void {
    const ctx = this.ctx;
    if (hasVisibleFill(style.fill)) {
      ctx.save();
      ctx.globalAlpha = (style.opacity ?? 1) * (style.fillOpacity ?? 1);
      ctx.fillStyle = style.fill;
      fillPath();
      ctx.restore();
    }
    if (hasVisibleStroke(style.stroke)) {
      ctx.save();
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth ?? 1;
      ctx.setLineDash(style.dash ? [...style.dash] : []);
      strokePath();
      ctx.restore();
    }
  }

  drawRect(x: number, y: number, w: number, h: number, style: ShapeStyle): void {
    if (hasVisibleFill(style.fill)) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = (style.opacity ?? 1) * (style.fillOpacity ?? 1);
      ctx.fillStyle = style.fill;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    if (hasVisibleStroke(style.stroke)) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth ?? 1;
      ctx.setLineDash(style.dash ? [...style.dash] : []);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }

  drawRoundedRect(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void {
    const ctx = this.ctx;
    const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
    const build = (): void => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.arcTo(x + w, y, x + w, y + radius, radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
      ctx.lineTo(x + radius, y + h);
      ctx.arcTo(x, y + h, x, y + h - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.closePath();
    };
    this.fillAndStroke(style, () => { build(); ctx.fill(); }, () => { build(); ctx.stroke(); });
  }

  drawPolygon(points: Polygon, style: ShapeStyle): void {
    const ctx = this.ctx;
    this.fillAndStroke(
      style,
      () => { ctx.beginPath(); tracePolyline(ctx, points, true); ctx.fill(); },
      () => { ctx.beginPath(); tracePolyline(ctx, points, true); ctx.stroke(); },
    );
  }

  drawPolygonWithHoles(outer: Polygon, holes: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    const ctx = this.ctx;
    const build = (): void => {
      ctx.beginPath();
      tracePolyline(ctx, outer, true);
      for (const hole of holes) tracePolyline(ctx, hole, true);
    };
    this.fillAndStroke(style, () => { build(); ctx.fill('evenodd'); }, () => { build(); ctx.stroke(); });
  }

  drawBatchPolygons(polygons: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    if (polygons.length === 0) return;
    const ctx = this.ctx;
    const build = (): void => {
      ctx.beginPath();
      for (const poly of polygons) tracePolyline(ctx, poly, true);
    };
    this.fillAndStroke(style, () => { build(); ctx.fill(); }, () => { build(); ctx.stroke(); });
  }

  drawPolyline(points: Polyline, style: StrokeStyle, closed = false): void {
    if (points.length < 2 || !hasVisibleStroke(style.stroke)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = style.lineCap ?? 'round';
    ctx.lineJoin = style.lineJoin ?? 'round';
    ctx.setLineDash(style.dash ? [...style.dash] : []);
    ctx.beginPath();
    tracePolyline(ctx, points, closed);
    ctx.stroke();
    ctx.restore();
  }

  drawSegments(segments: ReadonlyArray<readonly [Vec2, Vec2]>, style: StrokeStyle): void {
    if (segments.length === 0 || !hasVisibleStroke(style.stroke)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = style.lineCap ?? 'round';
    ctx.setLineDash(style.dash ? [...style.dash] : []);
    ctx.beginPath();
    for (const seg of segments) {
      ctx.moveTo(seg[0][0], seg[0][1]);
      ctx.lineTo(seg[1][0], seg[1][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBezier(p0: Vec2, cp1: Vec2, cp2: Vec2, p3: Vec2, style: ShapeStyle, closed = false): void {
    const ctx = this.ctx;
    const build = (): void => {
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], p3[0], p3[1]);
      if (closed) ctx.closePath();
    };
    this.fillAndStroke(style, () => { build(); ctx.fill(); }, () => { build(); ctx.stroke(); });
  }

  drawCircle(cx: number, cy: number, r: number, style: ShapeStyle): void {
    const ctx = this.ctx;
    const build = (): void => {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.01, r), 0, Math.PI * 2);
    };
    this.fillAndStroke(style, () => { build(); ctx.fill(); }, () => { build(); ctx.stroke(); });
  }

  drawArc(cx: number, cy: number, r: number, startRad: number, endRad: number, style: StrokeStyle): void {
    if (!hasVisibleStroke(style.stroke)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash(style.dash ? [...style.dash] : []);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.01, r), startRad, endRad);
    ctx.stroke();
    ctx.restore();
  }

  /** 单次 beginPath + 单次 fill：数千棵树仅 1 次光栅提交，相邻圆内部零交界黑线 */
  drawCirclesMergedPass(circles: ReadonlyArray<MergedCircleItem>, fillStyle: string): void {
    if (circles.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    for (const c of circles) {
      ctx.moveTo(c.cx + c.r, c.cy);
      ctx.arc(c.cx, c.cy, Math.max(0.01, c.r), 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  drawText(text: string, x: number, y: number, style: TextStyle): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight ?? 400} ${style.fontSizePx}px ${style.fontFamily}`;
    ctx.textAlign = style.align === 'center' ? 'center' : style.align === 'right' ? 'right' : 'left';
    ctx.textBaseline =
      style.baseline === 'top' ? 'top' : style.baseline === 'middle' ? 'middle' : 'alphabetic';
    if (style.haloColor && (style.haloWidthPx ?? 0) > 0) {
      ctx.strokeStyle = style.haloColor;
      ctx.lineWidth = (style.haloWidthPx ?? 0) * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = style.fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  measureTextWidth(text: string, fontSizePx: number): number {
    if (typeof this.ctx.measureText === 'function') {
      const metrics = this.ctx.measureText(text);
      if (metrics && Number.isFinite(metrics.width)) return metrics.width;
    }
    return text.length * fontSizePx * 0.56;
  }
}
