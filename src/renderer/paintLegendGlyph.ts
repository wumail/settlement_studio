import type { LegendItem } from '../schema/legend.schema';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { Vec2 } from '../schema/geometry.types';
import type { RenderBackend } from './RenderBackend';

const SHADOW = 'rgba(43, 37, 32, 0.16)';

function p(x: number, y: number): Vec2 {
  return [x, y];
}

export function resolveDefaultGlyphColor(glyphType: string, palette: ResolvedPalette): string {
  switch (glyphType) {
    case 'building_inner':
      return palette.roofInner;
    case 'building_town':
      return palette.roofTown;
    case 'city_wall':
      return palette.wallFill;
    case 'road_main':
      return palette.roadCasing;
    case 'bridge':
      return palette.bridgeDeck;
    case 'river':
    case 'water_body':
      return palette.waterFill;
    case 'canal':
      return palette.waterRipple;
    case 'contour':
    case 'scarp_tick':
      return palette.contourLine;
    case 'farmland':
      return palette.farmlandFill;
    case 'saltpan':
      return palette.saltpanFill;
    case 'tree_cluster':
      return palette.treeFill;
    case 'reef':
      return palette.reefFill;
    default:
      return palette.contourLine;
  }
}

function starPoints(cx: number, cy: number, outer: number, inner: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 16; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / 16) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return pts;
}

function drawGlyph(
  backend: RenderBackend,
  glyphType: string,
  main: string,
  ink: string,
  palette: ResolvedPalette,
): void {
  switch (glyphType) {
    case 'building_inner':
      backend.drawRect(7.5, 6.5, 13, 9, { fill: SHADOW });
      backend.drawRect(4.2, 4.6, 12, 8.2, { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawRect(17.4, 9.6, 7, 5.4, { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawSegments([[p(10.2, 4.6), p(10.2, 12.8)]], { stroke: ink, lineWidth: 0.5 });
      break;
    case 'building_town':
      backend.drawRect(6.6, 7.2, 13.4, 9.2, { fill: SHADOW });
      backend.drawPolygon([p(3.4, 12.4), p(3.4, 5.2), p(14.2, 5.2), p(14.2, 12.4), p(9.4, 12.4), p(9.4, 15.4), p(3.4, 15.4)], {
        fill: main,
        stroke: ink,
        lineWidth: 0.8,
      });
      backend.drawRect(16.4, 10.4, 8.2, 5.4, { fill: main, stroke: ink, lineWidth: 0.7 });
      backend.drawCircle(22.4, 4.8, 2.4, { fill: palette.treeFill, stroke: palette.treeOutline, lineWidth: 0.5 });
      break;
    case 'city_wall':
      backend.drawRect(1.4, 7.1, 25.2, 3.8, { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawCircle(4.2, 9, 2.6, { fill: main, stroke: ink, lineWidth: 0.7 });
      backend.drawCircle(23.8, 9, 2.6, { fill: main, stroke: ink, lineWidth: 0.7 });
      backend.drawRect(12.2, 7.1, 3.6, 3.8, { fill: palette.paperBg, stroke: ink, lineWidth: 0.4 });
      break;
    case 'road_main':
      backend.drawRect(1, 6, 26, 6, { fill: main });
      backend.drawSegments([[p(1, 6), p(27, 6)], [p(1, 12), p(27, 12)]], { stroke: ink, lineWidth: 1.2 });
      backend.drawSegments([[p(2.4, 9), p(25.6, 9)]], {
        stroke: palette.paperBg,
        lineWidth: 0.7,
        dash: [1.6, 1.6],
      });
      break;
    case 'bridge':
      backend.drawRect(9.6, 1.4, 8.8, 15.2, { fill: palette.waterFill });
      backend.drawSegments([[p(10.4, 4), p(17.6, 4)], [p(10.4, 14), p(17.6, 14)]], {
        stroke: palette.waterRipple,
        lineWidth: 0.6,
      });
      backend.drawRect(1.6, 6.9, 24.8, 4.2, { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawSegments([[p(1.6, 6.4), p(26.4, 6.4)], [p(1.6, 11.6), p(26.4, 11.6)]], {
        stroke: ink,
        lineWidth: 1.4,
      });
      backend.drawSegments(
        [[p(1.6, 6.9), p(0.2, 5.4)], [p(26.4, 6.9), p(27.8, 5.4)], [p(1.6, 11.1), p(0.2, 12.6)], [p(26.4, 11.1), p(27.8, 12.6)]],
        { stroke: ink, lineWidth: 0.7 },
      );
      break;
    case 'river':
      backend.drawBezier(p(1, 10), p(8, 2), p(18, 16), p(27, 8), { stroke: main, lineWidth: 6.4 });
      backend.drawBezier(p(1, 8), p(8, 1), p(18, 14), p(27, 6), {
        stroke: palette.waterRipple,
        lineWidth: 0.9,
      });
      backend.drawBezier(p(1, 12), p(8, 3.4), p(18, 17.4), p(27, 10), {
        stroke: palette.waterRipple,
        lineWidth: 0.9,
      });
      break;
    case 'water_body':
      backend.drawRoundedRect(1.4, 3.2, 25.2, 11.6, 3.4, { fill: main });
      backend.drawRoundedRect(4.2, 5.4, 19.6, 7.2, 2.4, {
        stroke: palette.waterRipple,
        lineWidth: 0.7,
      });
      backend.drawRoundedRect(7.6, 7.4, 12.8, 3.2, 1.4, {
        stroke: palette.waterRipple,
        lineWidth: 0.6,
      });
      break;
    case 'canal':
      backend.drawRect(2, 2.6, 24, 4.6, { fill: main, stroke: ink, lineWidth: 0.6 });
      backend.drawSegments([[p(2, 11.4), p(26, 11.4)]], { stroke: main, lineWidth: 1.2, dash: [2, 1.6] });
      backend.drawCircle(8, 11.4, 2.2, { fill: palette.paperBg, stroke: main, lineWidth: 1 });
      backend.drawCircle(18.6, 11.4, 2.2, { fill: palette.paperBg, stroke: main, lineWidth: 1 });
      backend.drawSegments([[p(2, 15.6), p(26, 15.6)]], { stroke: main, lineWidth: 0.8 });
      break;
    case 'contour':
      backend.drawPolyline([p(1, 6.4), p(9, 4), p(18, 6.8), p(27, 4.6)], { stroke: main, lineWidth: 1.6 });
      backend.drawPolyline([p(1, 10.4), p(9, 8.2), p(18, 10.8), p(27, 8.6)], {
        stroke: main,
        lineWidth: 0.75,
        opacity: 0.5,
      });
      backend.drawPolyline([p(1, 14.4), p(9, 12.4), p(18, 14.8), p(27, 12.8)], {
        stroke: main,
        lineWidth: 0.75,
        opacity: 0.5,
      });
      break;
    case 'scarp_tick':
      backend.drawSegments([[p(1.4, 5.4), p(26.6, 5.4)]], { stroke: main, lineWidth: 1.5 });
      backend.drawSegments(
        [[p(4, 5.4), p(4, 9.6)], [p(10, 5.4), p(10, 9.6)], [p(17, 5.4), p(17, 9.6)], [p(23, 5.4), p(23, 9.6)]],
        { stroke: main, lineWidth: 0.9 },
      );
      backend.drawSegments([[p(1.4, 13.4), p(26.6, 13.4)]], { stroke: main, lineWidth: 0.7, opacity: 0.45 });
      break;
    case 'farmland':
      backend.drawPolygon([p(1.6, 4), p(26.4, 4), p(24.2, 14.8), p(3.8, 14.8)], {
        fill: main,
        fillOpacity: 0.6,
        stroke: ink,
        lineWidth: 0.7,
      });
      backend.drawSegments(
        [[p(4.6, 13.2), p(8.4, 5.6)], [p(9.8, 13.2), p(13.2, 5.6)], [p(15, 13.2), p(18, 5.6)], [p(20.2, 13.2), p(22.8, 5.6)]],
        { stroke: ink, lineWidth: 0.35, opacity: 0.8 },
      );
      break;
    case 'saltpan':
      backend.drawRect(2, 2.6, 11.4, 6.2, { fill: main, fillOpacity: 0.96, stroke: palette.paperBg, lineWidth: 0.6 });
      backend.drawRect(14.6, 2.6, 11.4, 6.2, { fill: main, fillOpacity: 0.74, stroke: palette.paperBg, lineWidth: 0.6 });
      backend.drawRect(2, 10, 11.4, 6.2, { fill: main, fillOpacity: 0.74, stroke: palette.paperBg, lineWidth: 0.6 });
      backend.drawRect(14.6, 10, 11.4, 6.2, { fill: main, fillOpacity: 0.96, stroke: palette.paperBg, lineWidth: 0.6 });
      break;
    case 'tree_cluster':
      backend.drawCirclesMergedPass(
        [{ cx: 9, cy: 9.4, r: 4.8 }, { cx: 14.4, cy: 7.4, r: 4.8 }, { cx: 18.4, cy: 10.6, r: 4.4 }],
        palette.treeOutline,
      );
      backend.drawCirclesMergedPass(
        [{ cx: 9, cy: 9.4, r: 3.9 }, { cx: 14.4, cy: 7.4, r: 3.9 }, { cx: 18.4, cy: 10.6, r: 3.5 }],
        main,
      );
      break;
    case 'reef':
      backend.drawRect(2, 3.4, 23.6, 11.4, { fill: palette.waterFill, fillOpacity: 0.35 });
      backend.drawPolygon([p(7.4, 6), p(11.8, 5.2), p(13.4, 8.4), p(10.6, 11.6), p(6.8, 10.2)], {
        fill: main,
        stroke: ink,
        lineWidth: 0.7,
      });
      backend.drawPolygon([p(16.4, 7.4), p(21.2, 6.4), p(22.6, 9.6), p(19.8, 12.4), p(16, 10.8)], {
        fill: main,
        stroke: ink,
        lineWidth: 0.7,
      });
      backend.drawArc(14, 9, 11.4, -0.4, 1.2, { stroke: palette.waterRipple, lineWidth: 0.7, dash: [2, 1.4] });
      break;
    case 'star_fort':
      backend.drawPolygon(starPoints(14, 9, 7.4, 3.4), { fill: main, fillOpacity: 0.5, stroke: main, lineWidth: 1.1 });
      backend.drawCircle(14, 9, 1.3, { fill: ink });
      break;
    case 'tower':
      backend.drawPolygon([p(8.4, 15.4), p(8.4, 6.4), p(10, 6.4), p(10, 4.2), p(12, 4.2), p(12, 6.4), p(13.6, 6.4), p(13.6, 4.2), p(15.6, 4.2), p(15.6, 6.4), p(18, 6.4), p(18, 15.4)], {
        fill: main,
        stroke: ink,
        lineWidth: 0.8,
      });
      backend.drawRoundedRect(11.6, 10.8, 3.2, 4.6, 1.4, { fill: palette.paperBg, stroke: ink, lineWidth: 0.5 });
      break;
    case 'well_shrine':
      backend.drawCircle(14, 9, 6.6, { stroke: main, lineWidth: 1.2 });
      backend.drawCircle(14, 9, 4.2, { stroke: main, lineWidth: 0.8 });
      backend.drawPolygon([p(14, 5.6), p(16.4, 9.4), p(14, 12.2), p(11.6, 9.4)], { fill: main });
      break;
    case 'ferry_anchor':
      backend.drawSegments([[p(14, 2.6), p(14, 13.4)], [p(9.4, 6.2), p(18.6, 6.2)]], { stroke: main, lineWidth: 1.6 });
      backend.drawArc(14, 11.2, 4.4, 0.3, Math.PI - 0.3, { stroke: main, lineWidth: 1.6 });
      backend.drawCircle(14, 2.8, 1.4, { stroke: main, lineWidth: 1 });
      break;
    case 'gate_arch':
      backend.drawRect(6.2, 7.4, 2.6, 8.2, { fill: main, stroke: ink, lineWidth: 0.6 });
      backend.drawRect(19.2, 7.4, 2.6, 8.2, { fill: main, stroke: ink, lineWidth: 0.6 });
      backend.drawRect(6.2, 5.6, 15.6, 2.2, { fill: main, stroke: ink, lineWidth: 0.6 });
      backend.drawPolygon([p(4.6, 5.6), p(14, 1.8), p(23.4, 5.6)], { fill: main, stroke: ink, lineWidth: 0.6 });
      break;
    case 'market_tent':
      backend.drawPolygon([p(3.4, 13.4), p(14, 3.4), p(24.6, 13.4)], { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawSegments([[p(14, 3.4), p(14, 1.2)]], { stroke: ink, lineWidth: 0.9 });
      backend.drawPolygon([p(14.2, 1.4), p(20.4, 2.6), p(14.2, 4.2)], { fill: main });
      break;
    case 'mine_hammer':
      backend.drawSegments([[p(5.6, 14.4), p(19.4, 3.6)], [p(8.4, 3.6), p(20.6, 14.4)]], {
        stroke: main,
        lineWidth: 1.8,
      });
      backend.drawRect(16.4, 2.4, 5.6, 3.4, { fill: main, stroke: ink, lineWidth: 0.7 });
      backend.drawPolygon([p(4.2, 13), p(7.6, 15.8), p(6.2, 16.4), p(3.4, 14.2)], { fill: main, stroke: ink, lineWidth: 0.6 });
      break;
    case 'stele':
      backend.drawPolygon([p(10, 14.6), p(10, 6.6), p(14, 3.2), p(18, 6.6), p(18, 14.6)], {
        fill: main,
        stroke: ink,
        lineWidth: 0.8,
      });
      backend.drawSegments([[p(11.4, 8.4), p(16.6, 8.4)], [p(11.4, 10.6), p(16.6, 10.6)], [p(11.4, 12.6), p(16.6, 12.6)]], {
        stroke: ink,
        lineWidth: 0.45,
      });
      backend.drawSegments([[p(8.4, 16), p(19.6, 16)]], { stroke: ink, lineWidth: 1.4 });
      break;
    default:
      backend.drawPolygon([p(14, 3.4), p(24, 9), p(14, 14.6), p(4, 9)], { fill: main, stroke: ink, lineWidth: 0.8 });
      backend.drawCircle(14, 9, 1.2, { fill: ink });
      break;
  }
}

/**
 * 22 类微缩真图形图例唯一绘制源。入口锁死主色 `main` 并贯穿全部 22 个分支，
 * 自定义改色在 Canvas 与 SVG 双端 22/22 同步生效。
 */
export function paintLegendGlyph(
  backend: RenderBackend,
  item: LegendItem,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: ResolvedPalette,
): void {
  const defaultColor = resolveDefaultGlyphColor(item.glyphType, palette);
  const itemColorOverride = item.color;
  const main = itemColorOverride?.trim() ? itemColorOverride.trim() : defaultColor;
  const ink = item.strokeColor?.trim() ? item.strokeColor.trim() : palette.inkDark;

  backend.pushTransform(x, y, w / 28, h / 18);
  try {
    drawGlyph(backend, item.glyphType, main, ink, palette);
  } finally {
    backend.popTransform();
  }
}
