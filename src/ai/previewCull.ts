import type { MergedCircleItem, ShapeStyle, StrokeStyle, TextStyle } from '../renderer/RenderBackend';
import type { Polygon, Polyline, Vec2 } from '../schema/geometry.types';
import { SvgStringBackend } from '../renderer/SvgStringBackend';

const PAD = 32;

type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

function clipSegment(a: Vec2, b: Vec2, r: Rect): readonly [Vec2, Vec2] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
  for (let i = 0; i < 4; i += 1) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    if (Math.abs(pi) < 1e-12) {
      if (qi < 0) return null;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

function clipPolyline(points: Polyline, r: Rect): Vec2[][] {
  const out: Vec2[][] = [];
  let current: Vec2[] = [];
  const close = (): void => {
    if (current.length >= 2) out.push(current);
    current = [];
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const seg = clipSegment(a, b, r);
    if (!seg) {
      close();
      continue;
    }
    const [ca, cb] = seg;
    const last = current[current.length - 1];
    if (!last) current.push([ca[0], ca[1]]);
    else if (Math.hypot(last[0] - ca[0], last[1] - ca[1]) > 1e-6) {
      close();
      current.push([ca[0], ca[1]]);
    }
    current.push([cb[0], cb[1]]);
    if (Math.hypot(cb[0] - b[0], cb[1] - b[1]) > 1e-6) close();
  }
  close();
  return out;
}

function inside(p: Vec2, edge: number, r: Rect): boolean {
  if (edge === 0) return p[0] >= r.x0;
  if (edge === 1) return p[0] <= r.x1;
  if (edge === 2) return p[1] >= r.y0;
  return p[1] <= r.y1;
}

function intersectEdge(a: Vec2, b: Vec2, edge: number, r: Rect): Vec2 {
  if (edge === 0 || edge === 1) {
    const x = edge === 0 ? r.x0 : r.x1;
    const t = Math.abs(b[0] - a[0]) < 1e-12 ? 0 : (x - a[0]) / (b[0] - a[0]);
    return [x, a[1] + (b[1] - a[1]) * t];
  }
  const y = edge === 2 ? r.y0 : r.y1;
  const t = Math.abs(b[1] - a[1]) < 1e-12 ? 0 : (y - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, y];
}

/** Sutherland–Hodgman：按四条画布边裁剪多边形，避免把 -4000 这类远点交给 resvg */
function clipPolygon(points: Polygon, r: Rect): Polygon | null {
  let output: Vec2[] = points.map(([x, y]) => [x, y]);
  for (let edge = 0; edge < 4; edge += 1) {
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (!cur || !prev) continue;
      const curIn = inside(cur, edge, r);
      const prevIn = inside(prev, edge, r);
      if (curIn) {
        if (!prevIn) output.push(intersectEdge(prev, cur, edge, r));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersectEdge(prev, cur, edge, r));
      }
    }
  }
  return output.length >= 3 ? output : null;
}

function bboxOf(points: ReadonlyArray<Vec2>): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

/**
 * AI 预览专用后端：在 SvgStringBackend 前做一次画布级裁剪/剔除。
 * resvg 对「远离画布且仍被 clipPath 包住」的图元会 panic（fit_to_rect 反向矩形），
 * 这里把所有坐标压回画布附近，既有几何指令与配色保持不变。
 */
export class PreviewCullBackend extends SvgStringBackend {
  private tx = 0;
  private ty = 0;
  private sx = 1;
  private sy = 1;
  private readonly stack: Array<readonly [number, number, number, number]> = [];

  private get clipRect(): Rect {
    return { x0: -PAD, y0: -PAD, x1: this.widthPx + PAD, y1: this.heightPx + PAD };
  }

  private screen(points: ReadonlyArray<Vec2>): Vec2[] {
    return points.map(([x, y]) => [this.tx + this.sx * x, this.ty + this.sy * y] as Vec2);
  }

  private farOutside(box: Rect, pad = PAD): boolean {
    return box.x1 < -pad || box.x0 > this.widthPx + pad || box.y1 < -pad || box.y0 > this.heightPx + pad;
  }

  /**
   * 当前是否处于 pushTransform 形成的 <g transform> 分组内（图例徽记专用）。
   * 此时 super.* 会写入该分组，只能传原始局部坐标；屏幕坐标仅用于离屏剔除。
   */
  private get inTransform(): boolean {
    return this.stack.length > 0;
  }

  private segmentsOutside(segments: ReadonlyArray<readonly [Vec2, Vec2]>): boolean {
    return segments.every(([a, b]) => this.farOutside(bboxOf(this.screen([a, b]))));
  }

  override pushTransform(tx: number, ty: number, scaleX: number, scaleY: number): void {
    this.stack.push([this.tx, this.ty, this.sx, this.sy]);
    const nx = this.tx + this.sx * tx;
    const ny = this.ty + this.sy * ty;
    this.sx *= scaleX;
    this.sy *= scaleY;
    this.tx = nx;
    this.ty = ny;
    super.pushTransform(tx, ty, scaleX, scaleY);
  }

  override popTransform(): void {
    const prev = this.stack.pop();
    if (prev) {
      this.tx = prev[0];
      this.ty = prev[1];
      this.sx = prev[2];
      this.sy = prev[3];
    }
    super.popTransform();
  }

  override drawPolyline(points: Polyline, style: StrokeStyle, closed = false): void {
    if (points.length < 2) return;
    const screen = this.screen(points);
    if (this.farOutside(bboxOf(screen))) return;
    if (this.inTransform) {
      super.drawPolyline(points, style, closed);
      return;
    }
    const ring = closed && screen[0] ? [...screen, screen[0]] : screen;
    for (const span of clipPolyline(ring, this.clipRect)) {
      if (span.length >= 2) super.drawPolyline(span, style, false);
    }
  }

  override drawSegments(segments: ReadonlyArray<readonly [Vec2, Vec2]>, style: StrokeStyle): void {
    if (this.inTransform) {
      if (!this.segmentsOutside(segments)) super.drawSegments(segments, style);
      return;
    }
    const clipped: Array<readonly [Vec2, Vec2]> = [];
    for (const [a, b] of segments) {
      const seg = clipSegment(
        [this.tx + this.sx * a[0], this.ty + this.sy * a[1]],
        [this.tx + this.sx * b[0], this.ty + this.sy * b[1]],
        this.clipRect,
      );
      if (seg) clipped.push(seg);
    }
    if (clipped.length > 0) super.drawSegments(clipped, style);
  }

  override drawPolygon(points: Polygon, style: ShapeStyle): void {
    if (points.length < 3) return;
    const screen = this.screen(points);
    if (this.farOutside(bboxOf(screen))) return;
    if (this.inTransform) {
      super.drawPolygon(points, style);
      return;
    }
    const clipped = clipPolygon(screen, this.clipRect);
    if (clipped) super.drawPolygon(clipped, style);
  }

  override drawPolygonWithHoles(outer: Polygon, holes: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    const screenOuter = this.screen(outer);
    if (this.farOutside(bboxOf(screenOuter))) return;
    if (this.inTransform) {
      super.drawPolygonWithHoles(outer, holes, style);
      return;
    }
    const clippedOuter = clipPolygon(screenOuter, this.clipRect);
    if (!clippedOuter) return;
    const clippedHoles = holes
      .map((hole) => clipPolygon(this.screen(hole), this.clipRect))
      .filter((hole): hole is Polygon => hole !== null);
    super.drawPolygonWithHoles(clippedOuter, clippedHoles, style);
  }

  override drawBatchPolygons(polygons: ReadonlyArray<Polygon>, style: ShapeStyle): void {
    if (this.inTransform) {
      const visible = polygons.filter((poly) => poly.length >= 3 && !this.farOutside(bboxOf(this.screen(poly))));
      if (visible.length > 0) super.drawBatchPolygons(visible, style);
      return;
    }
    const kept: Polygon[] = [];
    for (const poly of polygons) {
      if (poly.length < 3) continue;
      const screen = this.screen(poly);
      if (this.farOutside(bboxOf(screen))) continue;
      const clipped = clipPolygon(screen, this.clipRect);
      if (clipped) kept.push(clipped);
    }
    if (kept.length > 0) super.drawBatchPolygons(kept, style);
  }

  override drawRect(x: number, y: number, w: number, h: number, style: ShapeStyle): void {
    const sx = this.tx + this.sx * x;
    const sy = this.ty + this.sy * y;
    const sw = this.sx * w;
    const sh = this.sy * h;
    if (this.farOutside({ x0: sx, y0: sy, x1: sx + sw, y1: sy + sh })) return;
    super.drawRect(x, y, w, h, style);
  }

  override drawRoundedRect(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void {
    const sx = this.tx + this.sx * x;
    const sy = this.ty + this.sy * y;
    if (this.farOutside({ x0: sx, y0: sy, x1: sx + this.sx * w, y1: sy + this.sy * h })) return;
    super.drawRoundedRect(x, y, w, h, r, style);
  }

  override drawCircle(cx: number, cy: number, r: number, style: ShapeStyle): void {
    const x = this.tx + this.sx * cx;
    const y = this.ty + this.sy * cy;
    const rx = Math.abs(this.sx * r);
    const ry = Math.abs(this.sy * r);
    if (this.farOutside({ x0: x - rx, y0: y - ry, x1: x + rx, y1: y + ry })) return;
    super.drawCircle(cx, cy, r, style);
  }

  override drawArc(cx: number, cy: number, r: number, startRad: number, endRad: number, style: StrokeStyle): void {
    const x = this.tx + this.sx * cx;
    const y = this.ty + this.sy * cy;
    const rr = Math.abs(this.sx * r) + Math.abs(this.sy * r);
    if (this.farOutside({ x0: x - rr, y0: y - rr, x1: x + rr, y1: y + rr })) return;
    super.drawArc(cx, cy, r, startRad, endRad, style);
  }

  override drawBezier(p0: Vec2, cp1: Vec2, cp2: Vec2, p3: Vec2, style: ShapeStyle, closed = false): void {
    const screen = this.screen([p0, cp1, cp2, p3]);
    if (this.farOutside(bboxOf(screen))) return;
    super.drawBezier(p0, cp1, cp2, p3, style, closed);
  }

  override drawCirclesMergedPass(circles: ReadonlyArray<MergedCircleItem>, fillStyle: string): void {
    const kept = circles.filter((c) => {
      const x = this.tx + this.sx * c.cx;
      const y = this.ty + this.sy * c.cy;
      const r = Math.abs(this.sx * c.r) + Math.abs(this.sy * c.r);
      return !this.farOutside({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
    });
    if (kept.length > 0) super.drawCirclesMergedPass(kept, fillStyle);
  }

  override drawText(text: string, x: number, y: number, style: TextStyle): void {
    const sx = this.tx + this.sx * x;
    const sy = this.ty + this.sy * y;
    const w = this.measureTextWidth(text, style.fontSizePx) * Math.abs(this.sx);
    if (this.farOutside({ x0: sx - w, y0: sy - style.fontSizePx * 2, x1: sx + w, y1: sy + style.fontSizePx * 2 }, PAD)) {
      return;
    }
    super.drawText(text, x, y, style);
  }
}
