import type { SculptBrushMode, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import { paintSelectionHandles } from './paintHandles';
import { type RenderBackend, type TextStyle, worldToScreen } from './RenderBackend';

const SERIF = '"Palatino Linotype", "Book Antiqua", "Songti SC", serif';
const MODE_LABEL: Readonly<Record<SculptBrushMode, string>> = {
  raise: '隆起',
  lower: '下压',
  smooth: '平滑',
  flatten: '推平',
  terrace: '阶地',
  ramp: '斜坡',
  erase: '擦除微雕',
};

export interface RampPreview {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly startElev: number;
  readonly endElev: number;
}

export interface BrushCursorInput {
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly hardness: number;
  readonly mode: SculptBrushMode;
  readonly kind: 'terrain' | 'tree' | 'contour';
  readonly elevM: number | null;
  readonly flattenTargetElev?: number;
  readonly terraceStepM?: number;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly treeErase?: boolean;
  readonly ramp?: RampPreview | null;
}

export interface OverlayInput {
  readonly selection: SelectionTarget | null;
  readonly draftPoints: ReadonlyArray<Vec2>;
  readonly brushCursor: BrushCursorInput | null;
  readonly measureSegment: readonly [Vec2, Vec2] | null;
  readonly measureLabel?: string | null;
  /** 悬停等高线：改由浮层高亮，静态底图缓存不再因 hover 失效 */
  readonly hoverContour?: { readonly points: ReadonlyArray<Vec2>; readonly isIndex: boolean } | null;
}

function text(size: number, fill: string, extra?: Partial<TextStyle>): TextStyle {
  return { fontFamily: SERIF, fontSizePx: size, fill, baseline: 'middle', ...extra };
}

function chipText(cursor: BrushCursorInput): string {
  if (cursor.shift) return `${MODE_LABEL[cursor.mode]} → 平滑`;
  if (cursor.kind === 'tree') return cursor.treeErase ? '擦除林木' : '涂抹林木';
  if (cursor.alt && (cursor.mode === 'raise' || cursor.mode === 'lower')) {
    return cursor.mode === 'raise' ? '下压 lower' : '隆起 raise';
  }
  const elev = cursor.elevM === null ? '--' : cursor.elevM.toFixed(1);
  if (cursor.mode === 'flatten') return `→ ${Math.round(cursor.flattenTargetElev ?? 0)} m · ${elev} m`;
  if (cursor.mode === 'terrace') return `阶地 ${Math.round(cursor.terraceStepM ?? 8)} m · ${elev} m`;
  if (cursor.mode === 'ramp') return cursor.ramp ? `${cursor.ramp.startElev.toFixed(0)} → ${cursor.ramp.endElev.toFixed(0)} m` : '斜坡拉道 · 拖拽拉出';
  return `${elev} m · ${MODE_LABEL[cursor.mode]}`;
}

function paintChip(
  backend: RenderBackend,
  x: number,
  y: number,
  label: string,
  pal: ResolvedPalette,
): void {
  const w = Math.max(54, backend.measureTextWidth(label, 9.5) + 14);
  const h = 17;
  backend.drawRoundedRect(x, y, w, h, 3, {
    fill: pal.paperBg,
    fillOpacity: 0.95,
    stroke: pal.inkDark,
    lineWidth: 0.8,
  });
  backend.drawText(label, x + 7, y + h * 0.5 + 0.5, text(9.5, pal.inkDark));
}

function paintRampPreview(
  backend: RenderBackend,
  ramp: RampPreview,
  cursor: BrushCursorInput,
  vp: ViewportState,
  pal: ResolvedPalette,
): void {
  const a = worldToScreen(ramp.ax, ramp.ay, vp);
  const b = worldToScreen(ramp.bx, ramp.by, vp);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = len > 1e-6 ? -(b[1] - a[1]) / len : 0;
  const ny = len > 1e-6 ? (b[0] - a[0]) / len : 1;
  const half = cursor.radiusM * vp.zoom;
  backend.drawPolygon(
    [
      [a[0] + nx * half, a[1] + ny * half],
      [b[0] + nx * half, b[1] + ny * half],
      [b[0] - nx * half, b[1] - ny * half],
      [a[0] - nx * half, a[1] - ny * half],
    ],
    { fill: pal.accentTerracotta, fillOpacity: 0.08 },
  );
  backend.drawSegments([[a, b]], { stroke: pal.accentTerracotta, lineWidth: 1.3, dash: [6, 5] });
  backend.drawCircle(a[0], a[1], 3.6, { fill: pal.paperBg, stroke: pal.accentTerracotta, lineWidth: 1.1 });
  backend.drawCircle(b[0], b[1], 3.6, { fill: pal.paperBg, stroke: pal.accentTerracotta, lineWidth: 1.1 });
  const distM = Math.hypot(ramp.bx - ramp.ax, ramp.by - ramp.ay);
  const dz = ramp.endElev - ramp.startElev;
  const slope = distM > 1e-6 ? (Math.atan2(dz, distM) * 180) / Math.PI : 0;
  const label = `起点 ${ramp.startElev.toFixed(0)} → 终点 ${ramp.endElev.toFixed(0)} m（${slope.toFixed(1)}°）`;
  paintChip(backend, (a[0] + b[0]) * 0.5 - 60, (a[1] + b[1]) * 0.5 - 26, label, pal);
}

/** 第 14 层交互浮层：选择手柄、草稿虚线、双圈笔刷光标与实时读数芯片、斜坡预览、测距卡 */
export function paintOverlay(
  backend: RenderBackend,
  project: TownProject,
  vp: ViewportState,
  pal: ResolvedPalette,
  input: OverlayInput,
): void {
  const hover = input.hoverContour;
  if (hover && hover.points.length >= 2) {
    backend.drawPolyline(hover.points.map((p) => worldToScreen(p[0], p[1], vp)), {
      stroke: pal.waterFill,
      lineWidth: hover.isIndex ? 2.1 : 1.5,
      opacity: 0.95,
    });
  }
  paintSelectionHandles(backend, project, input.selection, pal, vp);
  if (input.draftPoints.length >= 2) {
    backend.drawPolyline(input.draftPoints.map((p) => worldToScreen(p[0], p[1], vp)), {
      stroke: pal.accentTerracotta,
      lineWidth: 1.6,
      dash: [6, 4],
    });
  }
  const cursor = input.brushCursor;
  if (cursor) {
    const c = worldToScreen(cursor.x, cursor.y, vp);
    const outer = Math.max(2, cursor.radiusM * vp.zoom);
    const inner = outer * Math.max(0, Math.min(0.95, cursor.hardness));
    backend.drawCircle(c[0], c[1], outer, {
      stroke: pal.accentTerracotta,
      lineWidth: 1.2,
      dash: [5, 4],
    });
    if (cursor.kind === 'terrain' && inner > 1.5) {
      backend.drawCircle(c[0], c[1], inner, {
        stroke: pal.accentTerracotta,
        lineWidth: 0.9,
        opacity: 0.65,
      });
    }
    backend.drawCircle(c[0], c[1], 1.6, { fill: pal.accentTerracotta });
    paintChip(backend, c[0] + outer * 0.62, c[1] + outer * 0.62 + 8, chipText(cursor), pal);
    if (cursor.ramp) paintRampPreview(backend, cursor.ramp, cursor, vp, pal);
  }
  if (input.measureSegment) {
    const [a, b] = input.measureSegment;
    const sa = worldToScreen(a[0], a[1], vp);
    const sb = worldToScreen(b[0], b[1], vp);
    backend.drawSegments([[sa, sb]], { stroke: pal.accentTerracotta, lineWidth: 1.4, dash: [7, 5] });
    const distM = Math.hypot(b[0] - a[0], b[1] - a[1]);
    paintChip(
      backend,
      (sa[0] + sb[0]) * 0.5 - 40,
      (sa[1] + sb[1]) * 0.5 - 24,
      input.measureLabel ?? `${distM.toFixed(0)} m`,
      pal,
    );
  }
}
