import type { LegendDisplayMode } from '../schema/legend.schema';
import { computePolygonCentroid } from '../core/math/polygon';
import { estimateTextWidth } from './furnitureLayout';
import { ellipsize } from './paintFurniture';
import { paintLegendGlyph } from './paintLegendGlyph';
import { mixHex, SERIF_FONT, type PaintContext } from './paintContext';

type Box = readonly [number, number, number, number];
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** 大街区暗标适用内容类型与最小面积（1.8 ha） */
const MAJOR_ZONE_KINDS = new Set(['walled_city', 'citadel', 'town_blocks', 'market']);
const MIN_WATERMARK_HA = 1.8;
const CJK_ONLY = /^[\u4e00-\u9fa5]+$/;

/** 古图刻本宽字距：<= 6 字纯中文名逐字插入窄空格，拉丁/长名保持原样 */
function districtLabel(name: string): string {
  if (name.length > 6 || !CJK_ONLY.test(name)) return name;
  return [...name].join('\u2009');
}

function overlaps(a: Box, b: Box, gap = 4): boolean {
  return !(a[2] + gap < b[0] || b[2] + gap < a[0] || a[3] + gap < b[1] || b[3] + gap < a[1]);
}

function glyphItemFor(ctx: PaintContext, key: string, glyphType: string, label: string) {
  const found = ctx.project.legend.items.find((item) => item.key === key);
  if (found) return found;
  return {
    key, isCustom: true, glyphType, label, color: '', colorLocked: false,
    strokeColor: '', visible: true, autoPresent: true, order: 999,
  };
}

/**
 * 大街区宽字距暗标：最先铺底，只与其它暗标互斥；地标与具体小注后绘，自然压在暗标之上。
 * 字号 12–14.5px 随选区跨度平滑插值，纸色淡墨 + 3.0 光晕，与 10.5px 带徽记地标拉开层级。
 */
function paintDistrictWatermarks(
  ctx: PaintContext,
  clampX: (x: number, w: number) => number,
  clampY: (y: number) => number,
  placed: Box[],
  opacity: number,
): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const zone of scene.zones) {
    if (zone.areaHa < MIN_WATERMARK_HA || !MAJOR_ZONE_KINDS.has(zone.contentType)) continue;
    const c = ctx.pt(computePolygonCentroid(zone.points));
    const span = ctx.px(Math.sqrt(zone.areaHa * 10000));
    const size = Math.max(12, Math.min(14.5, 12 + span / 160));
    const text = districtLabel(zone.name);
    const w = Math.max(40, estimateTextWidth(text, size));
    const x = clampX(c[0] - w * 0.5, w);
    const y = clampY(c[1]);
    const box: Box = [x - 2, y - size * 0.62, x + w + 2, y + size * 0.62];
    if (placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    backend.drawText(text, x + w * 0.5, y, {
      fontFamily: SERIF_FONT,
      fontSizePx: size,
      fill: mixHex(pal.inkDark, pal.paperBg, 0.32),
      align: 'center',
      baseline: 'middle',
      haloColor: pal.paperBg,
      haloWidthPx: 3.0,
      opacity: opacity * 0.76,
    });
  }
}

/**
 * 地标 + 选区名 + 河名：任意缩放可读，带半透明纸晕与碰撞避让；
 * guided 模式只留编号圆标与河名（大面积选区名一律隐去）。
 * 全部文字按 bounds 右/下边界夹紧，绝不裁字。
 */
export function paintAnnotations(ctx: PaintContext, mode: LegendDisplayMode, bounds: Rect): void {
  const { backend, pal, project, scene, vp } = ctx;
  if (!scene) return;
  const pure = mode === 'pure';
  const guided = mode === 'guided';
  const opacity = ctx.labelOpacity;
  if (opacity <= 0) return;
  const right = bounds.x + bounds.w - 4;
  const bottom = bounds.y + bounds.h - 4;
  const clampX = (x: number, w: number): number => Math.min(x, Math.max(bounds.x + 4, right - w));
  const clampY = (y: number): number => Math.max(bounds.y + 10, Math.min(y, bottom - 6));
  const placed: Box[] = [];
  const landmarkMarks: Array<readonly [number, number, string]> = [];
  // 核心建筑群名（由 paintStructures 先行绘制）同样占位：选区名不得压在其上
  for (const item of project.structures) {
    if (ctx.px(item.widthM) < 46) continue;
    const c = ctx.pt([item.x, item.y]);
    landmarkMarks.push([c[0], c[1], item.name]);
  }
  const tryPlace = (box: Box): boolean => {
    if (placed.some((other) => overlaps(box, other))) return false;
    placed.push(box);
    return true;
  };

  // 暗标先于地标：作为街区衬底，地标圆标与具体小注后绘叠在其上
  if (!pure && !guided && vp.zoom >= 0.12) {
    paintDistrictWatermarks(ctx, clampX, clampY, placed, opacity);
  }

  for (const landmark of project.landmarks) {
    const c = ctx.pt([landmark.x, landmark.y]);
    const r = ctx.px(9);
    backend.drawCircle(c[0], c[1], r, {
      fill: pal.paperBg,
      stroke: pal.inkDark,
      lineWidth: 0.8,
      opacity: 0.95 * opacity,
    });
    const item = glyphItemFor(ctx, landmark.legendKey, landmark.glyphType, landmark.label);
    paintLegendGlyph(backend, item, c[0] - ctx.px(7), c[1] - ctx.px(4.5), ctx.px(14), ctx.px(9), pal);
    landmarkMarks.push([c[0], c[1], landmark.label]);
    if (guided && landmark.badgeNum !== undefined) {
      backend.drawCircle(c[0] + 7, c[1] - 7, 8, {
        fill: '#3a2b1d',
        stroke: pal.paperBg,
        lineWidth: 1.1,
        opacity,
      });
      backend.drawText(String(landmark.badgeNum), c[0] + 7, c[1] - 6.5, {
        fontFamily: SERIF_FONT, fontSizePx: 9.5, fill: '#f7f1e4',
        align: 'center', baseline: 'middle', opacity,
      });
      continue;
    }
    if (pure || guided || !landmark.showLabel) continue;
    const w = Math.max(18, estimateTextWidth(landmark.label, 10.5));
    const tx = clampX(c[0] + 12, w);
    const ty = clampY(c[1]);
    const box: Box = [tx - 1, ty - 7, tx + w, ty + 7];
    if (!tryPlace(box)) continue;
    backend.drawText(landmark.label, tx, ty, {
      fontFamily: SERIF_FONT,
      fontSizePx: 10.5,
      fill: pal.labelInk,
      baseline: 'middle',
      haloColor: pal.paperBg,
      haloWidthPx: 2.6,
      opacity,
    });
  }

  if (pure || guided || vp.zoom < 0.12) return;
  for (const zone of scene.zones) {
    const meta = project.zones.find((item) => item.id === zone.id);
    // 无痕留白选区：导出态不自动落选区名（需标注请改用 enclosure / market 或地标）
    if (ctx.isExport && meta?.contentType === 'exclusion' && meta.exclusionStyle === 'plain') continue;
    const c = ctx.pt(computePolygonCentroid(zone.points));
    // 地标图标附近不再压选区名：同名 60px 内、或任何地标 45px 内一律让位
    const crowded = landmarkMarks.some(([lx, ly, label]) => {
      const d = Math.hypot(lx - c[0], ly - c[1]);
      return (label === zone.name && d < 60) || d < 45;
    });
    if (crowded) continue;
    // 大街区已由前置暗标承载，此处只补小选区名，避免同区双标
    if (zone.areaHa >= MIN_WATERMARK_HA && MAJOR_ZONE_KINDS.has(zone.contentType)) continue;
    const w = Math.max(30, estimateTextWidth(zone.name, 10.5));
    const x = clampX(c[0] - w * 0.5, w);
    // 主位在下方 18px，被地标/河名占了就翻到上方，仍占则弃字（宁缺不叠）
    let y = clampY(c[1] + 20);
    let box: Box = [x, y - 8, x + w, y + 8];
    if (!tryPlace(box)) {
      y = clampY(c[1] - 22);
      box = [x, y - 8, x + w, y + 8];
      if (!tryPlace(box)) continue;
    }
    backend.drawText(zone.name, x + w * 0.5, y, {
      fontFamily: SERIF_FONT,
      fontSizePx: vp.zoom < 0.2 ? 9.5 : 10.5,
      fill: pal.inkMuted,
      italic: true,
      align: 'center',
      baseline: 'middle',
      haloColor: pal.paperBg,
      haloWidthPx: 2.4,
      opacity: opacity * 0.92,
    });
  }
  for (const river of scene.hydro.rivers) {
    const mid = river.centerline[Math.floor(river.centerline.length / 2)];
    if (!mid || river.name.length === 0) continue;
    const c = ctx.pt([mid[0], mid[1]]);
    const w = Math.max(24, estimateTextWidth(river.name, 11));
    const x = clampX(c[0] - w * 0.5, w);
    const y = clampY(c[1] - 10);
    const box: Box = [x, y - 8, x + w, y + 8];
    if (!tryPlace(box)) continue;
    backend.drawText(river.name, x + w * 0.5, y, {
      fontFamily: SERIF_FONT,
      fontSizePx: 11,
      fill: pal.waterFill,
      italic: true,
      align: 'center',
      baseline: 'middle',
      haloColor: pal.paperBg,
      haloWidthPx: 2.6,
      opacity,
    });
  }
}

/** guided 导览目录：自动避让图例所在角（默认停靠左下比例尺上方），超宽条目优雅省略绝不穿框 */
export function paintGuidedDirectory(ctx: PaintContext, bounds: Rect): void {
  const { backend, pal, project, labelOpacity } = ctx;
  const opacity = ctx.furnitureOpacity;
  const entries = project.landmarks.filter((item) => item.badgeNum !== undefined);
  if (entries.length === 0 || labelOpacity <= 0) return;
  const sorted = [...entries].sort((a, b) => (a.badgeNum ?? 0) - (b.badgeNum ?? 0));
  const rowH = 16;
  let textW = 140;
  for (const item of sorted) {
    const label = item.subtitle.length > 0 ? `${item.label} · ${item.subtitle}` : item.label;
    textW = Math.max(textW, estimateTextWidth(label, 9.5));
  }
  const maxW = Math.min(420, Math.max(268, bounds.w * 0.42));
  const w = Math.max(268, Math.min(maxW, textW + 44));
  const h = 30 + sorted.length * rowH;
  const legendOnRight = project.legend.visible && project.legend.position.endsWith('right');
  const x = legendOnRight
    ? bounds.x + 14
    : Math.max(bounds.x + 14, bounds.x + bounds.w - w - 14);
  const bottomMargin = legendOnRight ? 66 : 14;
  const y = Math.max(bounds.y + 70, bounds.y + bounds.h - h - bottomMargin);
  backend.drawRoundedRect(x, y, w, h, 4, {
    fill: pal.paperBg,
    fillOpacity: 0.94 * opacity,
    stroke: pal.inkDark,
    lineWidth: 0.9,
    opacity,
  });
  backend.drawText('方志导览 · INDEX', x + 12, y + 16, {
    fontFamily: SERIF_FONT, fontSizePx: 10.5, fill: pal.inkDark, baseline: 'middle', opacity,
  });
  const textRoom = w - 40;
  sorted.forEach((item, index) => {
    const rowY = y + 34 + index * rowH;
    backend.drawText(String(item.badgeNum), x + 16, rowY, {
      fontFamily: SERIF_FONT, fontSizePx: 9.5, fill: pal.accentTerracotta,
      align: 'center', baseline: 'middle', opacity,
    });
    const label = item.subtitle.length > 0 ? `${item.label} · ${item.subtitle}` : item.label;
    backend.drawText(ellipsize(label, textRoom, 9.5), x + 30, rowY, {
      fontFamily: SERIF_FONT, fontSizePx: 9.5, fill: pal.inkSecondary,
      baseline: 'middle', opacity,
    });
  });
}
