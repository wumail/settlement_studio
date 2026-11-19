import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSettlementScene } from '../src/core/compileScene';
import { hitTestActiveHandles, hitTestSceneObject, shapeLocalToWorld } from '../src/core/hitTest';
import { computePolygonCentroid } from '../src/core/math/polygon';
import { TOOL_IDS } from '../src/schema/geometry.types';
import { TOOL_GROUPS, TOOL_HOTKEYS, TOOL_LABELS, resolveToolHotkey } from '../src/ui/toolCatalog';
import {
  BUILTIN_GLYPH_TYPES,
  BUILTIN_LEGEND_CATALOG,
  CUSTOM_GLYPH_TYPES,
  type LegendConfig,
  type LegendItem,
} from '../src/schema/legend.schema';
import { getActivePalette } from '../src/schema/palette.schema';
import { createPresetProject } from '../src/schema/presets';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { Canvas2DBackend } from '../src/renderer/Canvas2DBackend';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import { computeFurnitureLayout, niceScaleMeters, paintFurniture, rectsOverlap, type LayoutRect } from '../src/renderer/furnitureLayout';
import { paintLegendGlyph } from '../src/renderer/paintLegendGlyph';
import { paintScene } from '../src/renderer/paintScene';
import {
  createViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtScreenPoint,
} from '../src/renderer/RenderBackend';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';
import {
  StageBitmapCache,
  buildStageCacheKey,
  isStageCacheSupported,
} from '../src/renderer/stageCache';

interface RecordedCall {
  readonly op: string;
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly text?: string;
  readonly x?: number;
  readonly y?: number;
}

function createMockContext(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[]; invalidFills: string[] } {
  const calls: RecordedCall[] = [];
  const invalidFills: string[] = [];
  const target: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  const push = (op: string, text?: string, x?: number, y?: number): void => {
    calls.push({
      op,
      fillStyle: String(target.fillStyle ?? ''),
      strokeStyle: String(target.strokeStyle ?? ''),
      text,
      x,
      y,
    });
  };
  let fillValue = '#000000';
  Object.defineProperty(target, 'fillStyle', {
    get: () => fillValue,
    set: (value: string) => {
      const text = String(value);
      // 模拟浏览器：非法 CSS 颜色被静默忽略，绝不允许 'none' / 'transparent' 进入绘制状态
      if (text === 'none' || text === 'transparent') {
        invalidFills.push(text);
        return;
      }
      fillValue = text;
    },
  });
  const noop = (op: string) => (): void => push(op);
  Object.assign(target, {
    setTransform: noop('setTransform'),
    save: noop('save'),
    restore: noop('restore'),
    translate: noop('translate'),
    scale: noop('scale'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    bezierCurveTo: noop('bezierCurveTo'),
    arc: noop('arc'),
    arcTo: noop('arcTo'),
    rect: noop('rect'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    clip: noop('clip'),
    setLineDash: noop('setLineDash'),
    strokeText: noop('strokeText'),
    fillText: (text: string, x: number, y: number): void => push('fillText', text, x, y),
    measureText: (text: string): { width: number } => ({ width: text.length * 6 }),
    createRadialGradient: (): { addColorStop: () => void } => ({ addColorStop: () => undefined }),
  });
  return { ctx: target as unknown as CanvasRenderingContext2D, calls, invalidFills };
}

let cachedProject: TownProject | null = null;
function project(): TownProject {
  if (!cachedProject) cachedProject = createPresetProject('losrumura');
  return cachedProject;
}

let cachedScene: ReturnType<typeof compileSettlementScene> | null = null;
function scene(): ReturnType<typeof compileSettlementScene> {
  if (!cachedScene) cachedScene = compileSettlementScene(project());
  return cachedScene;
}

function countLines(text: string): number {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walkTs(full, out);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function frameOf(width: number, height: number, inset = 0): LayoutRect {
  return { x: inset, y: inset, w: width - inset * 2, h: height - inset * 2 };
}

function legendItems(count: number): LegendItem[] {
  const items: LegendItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const basis = BUILTIN_LEGEND_CATALOG[i % BUILTIN_LEGEND_CATALOG.length];
    items.push({
      key: `lg_${i}`,
      isCustom: i >= 14,
      glyphType: basis?.glyphType ?? 'building_town',
      label: `图例 ${i + 1}`,
      color: '',
      colorLocked: false,
      strokeColor: '#2b2520',
      visible: true,
      autoPresent: true,
      order: i * 10,
    });
  }
  return items;
}

function inside(rect: LayoutRect, area: LayoutRect, tol = 0.001): boolean {
  return (
    rect.x >= area.x - tol &&
    rect.y >= area.y - tol &&
    rect.x + rect.w <= area.x + area.w + tol &&
    rect.y + rect.h <= area.y + area.h + tol
  );
}

describe('M4 · 同源双端渲染一致性', () => {
  it('Canvas 与 SVG 图层序列完全一致且共 17 层', () => {
    const proj = project();
    const compiled = scene();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    const canvasBackend = new Canvas2DBackend(ctx, 1200, 900, 1);
    paintScene(canvasBackend, proj, compiled, vp, {});
    const svgBackend = new SvgStringBackend(1200, 900);
    paintScene(svgBackend, proj, compiled, vp, {});
    const svg = svgBackend.toSvgString();

    expect(canvasBackend.layerIds.length).toBe(17);
    expect(canvasBackend.layerIds).toEqual(svgBackend.layerIds);
    expect(canvasBackend.layerIds[0]).toBe('paper-bg');
    expect(canvasBackend.layerIds[1]).toBe('terrain-tint');
    expect(canvasBackend.layerIds[6]).toBe('hydraulic-works');
    // 等高线固定压在全部地图对象之上、文字标注之下（等效 z=9999）
    expect(canvasBackend.layerIds[13]).toBe('contours');
    expect(canvasBackend.layerIds[14]).toBe('landmarks-labels');
    expect(canvasBackend.layerIds[16]).toBe('ui-overlay');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<g id="layer-trees-canopy">');
    expect(svg).toContain('</svg>');
    for (const id of canvasBackend.layerIds) expect(svg).toContain(`<g id="layer-${id}">`);
    console.log(`[M4] 17 层双端对拍通过，Canvas 指令 ${calls.length} 条，SVG ${svg.length} 字符`);
  });

  it('overlayOnly 只绘制浮层：默认连同屏上图饰，关图饰时仅第 14 层', () => {
    const proj = project();
    const compiled = scene();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const withChrome = new SvgStringBackend(1200, 900);
    paintScene(withChrome, proj, compiled, vp, { overlayOnly: true, selection: null });
    expect(withChrome.layerIds).toEqual(['cartouche', 'ui-overlay']);
    expect(withChrome.toSvgString()).not.toContain('layer-buildings');
    const overlayOnlyBackend = new SvgStringBackend(1200, 900);
    paintScene(overlayOnlyBackend, proj, compiled, vp, {
      overlayOnly: true,
      includeCartouche: false,
      selection: null,
    });
    expect(overlayOnlyBackend.layerIds).toEqual(['ui-overlay']);
  });

  it('第 7 层双遍道路：全部路缘先于全部路面（零黑叉）', () => {
    const proj = project();
    const compiled = scene();
    const pal = getActivePalette(proj.palette);
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), proj, compiled, vp, {});
    const strokes = calls.filter((c) => c.op === 'stroke').map((c) => c.strokeStyle);
    const n = compiled.hydro.roads.length;
    const pattern = [...Array(n).fill('#5b4a38'), ...Array(n).fill(pal.roadFill)];
    let found = -1;
    for (let i = 0; i + pattern.length <= strokes.length; i += 1) {
      if (pattern.every((color, k) => strokes[i + k] === color)) {
        found = i;
        break;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(found).toBeGreaterThanOrEqual(0);
  });

  it('第 11 层三步融合树冠：唯一图层内三次合并圆遍且半径递增', () => {
    const proj = project();
    const compiled = scene();
    const pal = getActivePalette(proj.palette);
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), proj, compiled, vp, {});
    const treeFills = calls.filter((c) => c.op === 'fill' && c.fillStyle === pal.treeFill).length;
    const outlineFills = calls.filter((c) => c.op === 'fill' && c.fillStyle === pal.treeOutline).length;
    const shadowFills = calls.filter((c) => c.op === 'fill' && c.fillStyle === 'rgba(43, 37, 32, 0.15)').length;
    expect(treeFills).toBeGreaterThanOrEqual(1);
    expect(outlineFills).toBeGreaterThanOrEqual(1);
    expect(shadowFills).toBeGreaterThanOrEqual(1);

    const svgBackend = new SvgStringBackend(1200, 900);
    paintScene(svgBackend, proj, compiled, vp, {});
    const svg = svgBackend.toSvgString();
    const start = svg.indexOf('<g id="layer-trees-canopy">');
    const stop = svg.indexOf('<g id="layer-landmarks-labels">');
    expect(start).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(start);
    const block = svg.slice(start, stop);
    expect(block.match(/<g fill="/g)?.length).toBe(3);
    expect(block.match(/<circle /g)?.length).toBe(compiled.trees.length * 3);
  });

  it('paintedTrees 并入树冠层同步渲染（Canvas 圆数随涂抹树增长）', () => {
    const base = project();
    const painted: TownProject = {
      ...base,
      paintedTrees: [
        { id: 'ptr_a', x: 1200, y: 1200, r: 6.4, kind: 'woodland' },
        { id: 'ptr_b', x: 1230, y: 1210, r: 5.2, kind: 'garden' },
        { id: 'ptr_c', x: 1260, y: 1190, r: 7.1, kind: 'plaza' },
      ],
    };
    const compiled = scene();
    const vp = createViewport(1200, 900, base.meta.worldSizeM, 1);
    const backend = new SvgStringBackend(1200, 900);
    paintScene(backend, painted, compiled, vp, {});
    const svg = backend.toSvgString();
    const start = svg.indexOf('<g id="layer-trees-canopy">');
    const stop = svg.indexOf('<g id="layer-landmarks-labels">');
    const block = svg.slice(start, stop);
    const zoneTrees = compiled.trees.filter((tree) => tree.zoneId !== '__painted__').length;
    expect(block.match(/<circle /g)?.length).toBe((zoneTrees + 3) * 3);
  });

  it('22 类图例赋 #ff11aa 后 Canvas 与 SVG 22/22 双端变色且每类 >= 2 基元', () => {
    const pal = getActivePalette({ themeId: 'watabou_classic', overrides: {} });
    const all = [...BUILTIN_GLYPH_TYPES, ...CUSTOM_GLYPH_TYPES];
    expect(all.length).toBe(22);
    for (const glyphType of all) {
      const item: LegendItem = {
        key: `k_${glyphType}`,
        isCustom: false,
        glyphType,
        label: glyphType,
        color: '#ff11aa',
        colorLocked: true,
        strokeColor: '#2b2520',
        visible: true,
        autoPresent: true,
        order: 1,
      };
      const { ctx, calls } = createMockContext();
      paintLegendGlyph(new Canvas2DBackend(ctx, 100, 100, 1), item, 0, 0, 28, 18, pal);
      const primitives = calls.filter((c) =>
        ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText'].includes(c.op),
      ).length;
      expect(primitives, glyphType).toBeGreaterThanOrEqual(2);
      const canvasHit = calls.some((c) => c.fillStyle === '#ff11aa' || c.strokeStyle === '#ff11aa');
      expect(canvasHit, `${glyphType} canvas`).toBe(true);

      const svgBackend = new SvgStringBackend(100, 100);
      paintLegendGlyph(svgBackend, item, 0, 0, 28, 18, pal);
      expect(svgBackend.toSvgString().includes('#ff11aa'), `${glyphType} svg`).toBe(true);
    }
  });

  it('full 含第 13 图饰层，clean 剥离图饰；两者均不含第 14 交互层', () => {
    const proj = project();
    const compiled = scene();
    const full = renderSceneToSvgString(proj, compiled, { mode: 'full' });
    const clean = renderSceneToSvgString(proj, compiled, { mode: 'clean' });
    expect(full).toContain('layer-cartouche');
    expect(full).not.toContain('layer-ui-overlay');
    expect(clean).not.toContain('layer-cartouche');
    expect(clean).not.toContain('layer-ui-overlay');
    expect(clean).toContain('layer-trees-canopy');
    expect(clean).toContain('layer-buildings');
    expect(full.length).toBeGreaterThan(clean.length);
  });
});

describe('V3 · 图饰 frame 锚定与整刻度比例尺', () => {
  it('niceScaleMeters 吸附 1 / 2 / 5 × 10^n', () => {
    expect(niceScaleMeters(717)).toBe(500);
    expect(niceScaleMeters(500)).toBe(500);
    expect(niceScaleMeters(430)).toBe(200);
    expect(niceScaleMeters(90)).toBe(50);
    expect(niceScaleMeters(21)).toBe(20);
    expect(niceScaleMeters(9.4)).toBe(5);
    expect(niceScaleMeters(1.2)).toBe(1);
    expect(niceScaleMeters(0)).toBe(1);
    for (const raw of [3, 17, 66, 140, 260, 980, 3200]) {
      const snapped = niceScaleMeters(raw);
      const mantissa = snapped / Math.pow(10, Math.floor(Math.log10(snapped)));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
      expect(snapped).toBeLessThanOrEqual(raw);
    }
  });

  it('1440×800 宽屏与 1:1 图幅：四件图饰全部落于 frame 内缩 14px 且两两零重叠', () => {
    const items = legendItems(22);
    const cases: ReadonlyArray<readonly [number, number, number]> = [
      [1440, 800, 0],
      [1440, 800, 40],
      [1600, 1600, 0],
      [1280, 800, 24],
      [960, 640, 0],
      [1024, 768, 32],
    ];
    for (const [widthPx, heightPx, inset] of cases) {
      const frame = frameOf(widthPx, heightPx, inset);
      const area: LayoutRect = { x: frame.x + 14, y: frame.y + 14, w: frame.w - 28, h: frame.h - 28 };
      for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
        for (const columns of [1, 2] as const) {
          for (const hud of [false, true]) {
            const legend: LegendConfig = {
              visible: true, title: '图例 · 测试', position, columns,
              displayMode: 'standard', furnitureOpacity: 0.72, labelOpacity: 0.78, items,
            };
            const layout = computeFurnitureLayout({ widthPx, heightPx, frame, legend, hasZoneSelection: hud, zoom: 0.4 });
            const rects: LayoutRect[] = [layout.titlePlateRect, layout.compassRect, layout.scaleBarRect, layout.legendRect];
            if (layout.zoneHudRect) rects.push(layout.zoneHudRect);
            for (const rect of rects) {
              expect(inside(rect, area), `${widthPx}x${heightPx}@${inset} ${position}/${columns}/${hud}`).toBe(true);
            }
            for (let i = 0; i < rects.length; i += 1) {
              for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i];
                const b = rects[j];
                if (a && b) expect(rectsOverlap(a, b, 0)).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('比例尺文字为整刻度且像素宽度 = 米数 × zoom，绝不出现 717 m', () => {
    const proj = project();
    const pal = getActivePalette(proj.palette);
    const legend: LegendConfig = { ...scene().legend, position: 'bottom-left', columns: 2 };
    for (const [widthPx, heightPx, zoom] of [[1440, 800, 0.31], [1200, 900, 0.62], [900, 700, 1.4]] as const) {
      const frame = frameOf(widthPx, heightPx);
      const { ctx, calls } = createMockContext();
      paintFurniture(new Canvas2DBackend(ctx, widthPx, heightPx, 1), {
        project: proj, palette: pal, frame, widthPx, heightPx, zoom, legend,
      });
      const layout = computeFurnitureLayout({ widthPx, heightPx, frame, legend, hasZoneSelection: false, zoom });
      const scaleText = calls.find((call) => call.op === 'fillText' && String(call.text).includes(' m'));
      expect(scaleText, `${widthPx}`).toBeDefined();
      const meters = Number(String(scaleText?.text).replace(/[^0-9]/g, ''));
      expect(meters).toBe(layout.scaleMeters);
      const mantissa = meters / Math.pow(10, Math.floor(Math.log10(meters)));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
      expect(Math.abs(layout.scaleBarWidthPx - meters * zoom)).toBeLessThan(1e-6);
      expect(layout.scaleBarWidthPx).toBeLessThanOrEqual(176);
      expect(scaleText?.y).toBeGreaterThanOrEqual(layout.scaleBarRect.y);
      expect(scaleText?.y).toBeLessThanOrEqual(layout.scaleBarRect.y + layout.scaleBarRect.h);
    }
  });

  it('指北针 N 落于包络框内，标题牌不越图框', () => {
    const proj = project();
    const pal = getActivePalette(proj.palette);
    const legend: LegendConfig = { ...scene().legend, position: 'top-right', columns: 2 };
    const frame = frameOf(1200, 900, 30);
    const { ctx, calls } = createMockContext();
    paintFurniture(new Canvas2DBackend(ctx, 1200, 900, 1), {
      project: proj, palette: pal, frame, widthPx: 1200, heightPx: 900, zoom: 0.5, legend,
    });
    const layout = computeFurnitureLayout({ widthPx: 1200, heightPx: 900, frame, legend, hasZoneSelection: false, zoom: 0.5 });
    const nText = calls.find((call) => call.op === 'fillText' && call.text === 'N');
    expect(nText?.y).toBeGreaterThanOrEqual(layout.compassRect.y);
    expect(nText?.y).toBeLessThanOrEqual(layout.compassRect.y + layout.compassRect.h);
    expect(layout.titlePlateRect.x).toBeGreaterThanOrEqual(frame.x + 14);
    expect(layout.titlePlateRect.x + layout.titlePlateRect.w).toBeLessThanOrEqual(frame.x + frame.w - 14);
  });
});

describe('V3 · 笔刷双圈光标与斜坡预览', () => {
  it('sculpt 光标绘制外虚线圈 + 硬度内圈 + 读数芯片', () => {
    const proj = project();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), proj, scene(), vp, {
      brushCursor: {
        x: 1200, y: 1100, radiusM: 90, hardness: 0.45, mode: 'raise',
        kind: 'terrain', elevM: 484.2,
      },
    });
    expect(calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(3);
    const chip = calls.find((c) => c.op === 'fillText' && String(c.text).includes('484.2 m'));
    expect(chip).toBeDefined();
    expect(String(chip?.text)).toContain('隆起');
  });

  it('ramp 拖拽中绘制起止虚线带与坡度读数', () => {
    const proj = project();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), proj, scene(), vp, {
      brushCursor: {
        x: 1300, y: 1200, radiusM: 70, hardness: 0.4, mode: 'ramp', kind: 'terrain', elevM: 402,
        ramp: { ax: 1100, ay: 1050, bx: 1300, by: 1200, startElev: 380, endElev: 412 },
      },
    });
    const label = calls.find((c) => c.op === 'fillText' && String(c.text).includes('起点 380'));
    expect(label).toBeDefined();
    expect(String(label?.text)).toContain('终点 412');
    expect(calls.filter((c) => c.op === 'stroke').length).toBeGreaterThan(0);
  });

  it('Alt / Shift 临时模式在芯片上显示徽标', () => {
    const proj = project();
    const vp = createViewport(800, 800, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 800, 800, 1), proj, scene(), vp, {
      brushCursor: {
        x: 800, y: 800, radiusM: 60, hardness: 0.4, mode: 'raise', kind: 'terrain', elevM: 400, shift: true,
      },
    });
    expect(calls.some((c) => c.op === 'fillText' && String(c.text).includes('平滑'))).toBe(true);
  });
});

describe('V2.0.1 · 旋转山包手柄拾取回归', () => {
  it('旋转山包偏心焦点柄与旋转连杆柄按旋转变换精确拾取', () => {
    const proj = normalizeProject({
      meta: { id: 'proj_rot_hill', name: '旋柄山包', worldSizeM: 1600 },
      terrain: {
        baseElev: 400,
        shapes: [
          { id: 'hill_rot', type: 'hill', cx: 700, cy: 620, rx: 300, ry: 180, angleDeg: 37, deltaElev: 42, focusX: 0.3, focusY: -0.2 },
        ],
      },
    });
    const shape = proj.terrain.shapes[0];
    expect(shape).toBeDefined();
    if (!shape || 'points' in shape) return;
    const selection = { type: 'terrainShape' as const, id: 'hill_rot' };
    const focus = shapeLocalToWorld(shape, 0.3 * 300, -0.2 * 180);
    expect(hitTestActiveHandles(proj, selection, focus[0], focus[1], null)?.kind).toBe('shape_focus');
    const rotate = shapeLocalToWorld(shape, 0, -(300 + 18));
    expect(hitTestActiveHandles(proj, selection, rotate[0], rotate[1], null)?.kind).toBe('shape_rotate');
    const axisX = shapeLocalToWorld(shape, 300, 0);
    expect(hitTestActiveHandles(proj, selection, axisX[0], axisX[1], null)?.kind).toBe('shape_scale_x');
    expect(shapeLocalToWorld(shape, 0, -(300 + 18))[1]).not.toBeCloseTo(shape.cy - 318, 3);
  });
});

describe('V3 · 水工结构件与核心建筑群同源足印', () => {
  it('weir / dock / watermill 在第 10 层、structures 在第 9 层真实出图', () => {
    const base = project();
    const enriched: TownProject = {
      ...base,
      weirs: [{ zIndex: 0, id: 'w1', name: '东关分水堰', pStart: [1400, 1200], pEnd: [1480, 1200], sluices: 3, widthM: 8 }],
      docks: [{ zIndex: 0, id: 'd1', name: '北埠滑道坞', x: 1380, y: 1420, angleDeg: 90, kind: 'slipway', slips: 4, spacingM: 18, lengthM: 42, widthM: 9 }],
      watermills: [{ zIndex: 0, id: 'm1', name: '水力锻锤', x: 1500, y: 1350, angleDeg: 0, wheelSide: 'left', widthM: 18, depthM: 12 }],
      structures: [{ zIndex: 0, id: 's1', name: '司辰官坛', x: 1250, y: 1250, angleDeg: 0, widthM: 64, depthM: 48, kind: 'round_altar', roofKind: 'citadel' }],
    };
    const vp = createViewport(1200, 900, base.meta.worldSizeM, 1);
    const plainBackend = new SvgStringBackend(1200, 900);
    paintScene(plainBackend, base, scene(), vp, {});
    const enrichedScene = compileSettlementScene(enriched);
    const enrichedBackend = new SvgStringBackend(1200, 900);
    paintScene(enrichedBackend, enriched, enrichedScene, vp, {});
    const plain = plainBackend.toSvgString();
    const withWorks = enrichedBackend.toSvgString();
    expect(withWorks.length).toBeGreaterThan(plain.length);
    expect(withWorks).toContain('layer-structures');
    expect(withWorks).toContain('#cbb582');

    const { ctx, calls } = createMockContext();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), enriched, enrichedScene, vp, {});
    const canvasPlain = createMockContext();
    paintScene(new Canvas2DBackend(canvasPlain.ctx, 1200, 900, 1), base, scene(), vp, {});
    expect(calls.length).toBeGreaterThan(canvasPlain.calls.length);
  });
});

describe('M4 · 视口变换与拾取优先级', () => {
  it('worldToScreen / screenToWorld 往返误差 < 1e-6，滚轮缩放光标不动点', () => {
    const vp = createViewport(1200, 800, 2400, 2);
    for (const point of [[0, 0], [123.456, 789.012], [2400, 2400]] as const) {
      const s = worldToScreen(point[0], point[1], vp);
      const w = screenToWorld(s[0], s[1], vp);
      expect(Math.abs(w[0] - point[0])).toBeLessThan(1e-6);
      expect(Math.abs(w[1] - point[1])).toBeLessThan(1e-6);
    }
    const before = screenToWorld(640, 400, vp);
    const zoomed = zoomViewportAtScreenPoint(vp, 640, 400, 1.35);
    const after = screenToWorld(640, 400, zoomed);
    expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-6);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-6);
    expect(zoomed.zoom).toBeGreaterThan(vp.zoom);
  });

  it('水工结构件与核心建筑群拾取先于选区；桥梁覆写可点选', () => {
    const proj = normalizeProject({
      meta: { worldSizeM: 1600, name: '水工拾取' },
      zones: [{ id: 'zn_big', name: '大选区', contentType: 'town_blocks', points: [[600, 600], [1400, 600], [1400, 1400], [600, 1400]] }],
      weirs: [{ id: 'weir_1', name: '分水堰', pStart: [1000, 900], pEnd: [1080, 900], sluices: 3, widthM: 8 }],
      structures: [{ id: 'str_1', name: '议事厅', x: 1200, y: 1200, angleDeg: 0, widthM: 60, depthM: 40, kind: 'l_hall', roofKind: 'citadel' }],
      docks: [{ id: 'dock_1', name: '滑道坞', x: 800, y: 800, angleDeg: 0, kind: 'slipway', slips: 4, spacingM: 18, lengthM: 42, widthM: 9 }],
      bridgeOverrides: [{ id: 'bo_1', x: 1300, y: 700, style: 'fortified_twin', fortSizeM: 26 }],
    });
    const compiled = compileSettlementScene(proj);
    expect(hitTestSceneObject(proj, compiled, 1040, 900)?.type).toBe('weir');
    expect(hitTestSceneObject(proj, compiled, 1200, 1200)?.type).toBe('structure');
    expect(hitTestSceneObject(proj, compiled, 800, 800)?.type).toBe('dock');
    expect(hitTestSceneObject(proj, compiled, 1300, 700)?.type).toBe('bridge');
    expect(hitTestSceneObject(proj, compiled, 700, 700)?.type).toBe('zone');
  });

  it('巨型地形椭圆上叠加选区时点击 100% 命中 zone', () => {
    const proj = normalizeProject({
      meta: { worldSizeM: 1600, name: '拾取优先级' },
      terrain: {
        baseElev: 400,
        slopeMagM: 0,
        shapes: [
          { id: 'huge_hill', type: 'hill', cx: 800, cy: 800, rx: 980, ry: 720, angleDeg: 0, deltaElev: 60, focusX: 0, focusY: 0 },
        ],
      },
      zones: [
        { id: 'zn_over_hill', name: '台地内城', contentType: 'walled_city', points: [[700, 700], [900, 700], [900, 900], [700, 900]], seed: 7 },
      ],
    });
    const compiled = compileSettlementScene(proj);
    const zone = proj.zones[0];
    expect(zone).toBeDefined();
    if (!zone) return;
    const c = computePolygonCentroid(zone.points);
    const hit = hitTestSceneObject(proj, compiled, c[0], c[1], null);
    expect(hit?.type).toBe('zone');
    expect(hit?.id).toBe('zn_over_hill');
    const outer = hitTestSceneObject(proj, compiled, 800, 300, null);
    expect(outer?.type).toBe('terrainShape');
  });
});

describe('M5 · 组件树与 V3 七组工具栏契约', () => {
  it('App 静态渲染含 36px 选项栏、7 组工具槽与画布', async () => {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { App } = await import('../src/ui/App');
    const html = renderToString(createElement(App));
    expect(html).toContain('flex h-screen w-screen flex-col');
    expect(html).toContain('<canvas');
    expect(html).toContain('核验中');
    expect(html).toContain('离线独立模式');
    expect(html).toContain('地形');
    expect(html).toContain('配色');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('选择与变换手柄');
    for (const group of TOOL_GROUPS) {
      expect(html).toContain(`title="${group.label} (${group.hotkey})"`);
    }
    const buttons = html.match(/aria-label="(选择与编辑|地形塑造|水系与水工|道路与城防|城坊与建筑群|植被与地被|标注与测绘)"/g) ?? [];
    expect(buttons.length).toBe(7);
  });

  it('16 工具 7 组聚合：组键唯一、单键别名直达、无单栋房屋入口', () => {
    expect(TOOL_IDS.length).toBe(16);
    expect(TOOL_GROUPS.length).toBe(7);
    expect([...TOOL_IDS]).toEqual([
      'select', 'reroll_stamp',
      'sculpt_brush', 'contour_drag', 'add_hill', 'add_ridge',
      'draw_river', 'draw_water_area', 'place_hydraulic',
      'draw_road', 'edit_crossing',
      'draw_zone', 'place_structure',
      'tree_brush',
      'place_landmark', 'measure',
    ]);
    const groupHotkeys = TOOL_GROUPS.map((group) => group.hotkey);
    expect(new Set(groupHotkeys).size).toBe(7);
    const covered = new Set(TOOL_GROUPS.flatMap((group) => [...group.tools]));
    expect(covered.size).toBe(16);
    for (const tool of TOOL_IDS) expect(TOOL_LABELS[tool].length).toBeGreaterThan(1);
    for (const alias of ['V', 'B', 'C', 'H', 'G', 'W', 'L', 'K', 'D', 'Z', 'X', 'T', 'M', 'U']) {
      const direct = TOOL_IDS.find((tool) => TOOL_HOTKEYS[tool] === alias);
      expect(direct, alias).toBeDefined();
    }
    for (const tool of TOOL_IDS) {
      expect(tool.toLowerCase().includes('building')).toBe(false);
      expect(tool.toLowerCase().includes('house')).toBe(false);
    }
  });

  it('组键轮换：同组重复按循环，Shift 强制轮换，跨组回到记忆工具', () => {
    const lastToolInGroup = {
      select_edit: 'select', terrain: 'add_ridge', hydro: 'draw_river', road: 'draw_road',
      urban: 'draw_zone', vegetation: 'tree_brush', annotate: 'place_landmark',
    } as const;
    expect(resolveToolHotkey('B', { activeTool: 'add_ridge', lastToolInGroup, shift: false })).toBe('sculpt_brush');
    expect(resolveToolHotkey('B', { activeTool: 'sculpt_brush', lastToolInGroup, shift: true })).toBe('contour_drag');
    expect(resolveToolHotkey('B', { activeTool: 'select', lastToolInGroup, shift: false })).toBe('add_ridge');
    expect(resolveToolHotkey('T', { activeTool: 'select', lastToolInGroup, shift: false })).toBe('tree_brush');
    expect(resolveToolHotkey('U', { activeTool: 'select', lastToolInGroup, shift: false })).toBe('measure');
    expect(resolveToolHotkey('Escape', { activeTool: 'select', lastToolInGroup: { ...lastToolInGroup }, shift: false })).toBeNull();
  });
});

describe('V3 · 三层离屏缓存键与 Node 降级', () => {
  it('缓存键随视口/调色板/显示模式/修订号变化，重复输入稳定', () => {
    const base = {
      layer: 'static' as const,
      sceneRef: { id: 1 },
      projectRef: { id: 2 },
      paletteKey: 'watabou_classic|{}',
      displayMode: 'standard', furnitureOpacity: 0.72, labelOpacity: 0.78,
      zoom: 0.42,
      panX: 12,
      panY: 8,
      widthPx: 1200,
      heightPx: 900,
      dpr: 2,
      revision: 1,
    };
    const key = buildStageCacheKey(base);
    expect(buildStageCacheKey({ ...base })).toBe(key);
    expect(buildStageCacheKey({ ...base, zoom: 0.43 })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, panX: 13 })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, paletteKey: 'gazetteer_ink|{}' })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, displayMode: 'pure' })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, revision: 2 })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, layer: 'terrain' })).not.toBe(key);
    const nextScene = { id: 1 };
    expect(buildStageCacheKey({ ...base, sceneRef: nextScene })).not.toBe(key);
    expect(buildStageCacheKey({ ...base, sceneRef: nextScene })).toBe(
      buildStageCacheKey({ ...base, sceneRef: nextScene }),
    );
  });

  it('无 DOM 环境透明降级：不支持时 acquire 恒返回 null', () => {
    expect(isStageCacheSupported()).toBe(false);
    const cache = new StageBitmapCache();
    let drew = 0;
    const image = cache.acquire('static', 'k', 400, 300, 1, () => { drew += 1; }, () => {
      throw new Error('backend factory should not run without DOM');
    });
    expect(image).toBeNull();
    expect(drew).toBe(0);
    expect(cache.size).toBe(0);
    cache.clear();
  });
});

describe('M5 · 代码洁净度与 320 行红线', () => {
  it('src 全部微模块 <= 320 行，零占位注释与隐式随机源', () => {
    const forbidden = ['TO' + 'DO', 'FIX' + 'ME', 'Math.' + 'random('];
    const files = walkTs('src');
    expect(files.length).toBeGreaterThanOrEqual(79);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = countLines(text);
      if (lines > 320) offenders.push(`${file}:${lines}`);
      expect(text.includes(forbidden[0] ?? '')).toBe(false);
      expect(text.includes(forbidden[1] ?? '')).toBe(false);
      if (file.includes('/core/')) expect(text.includes(forbidden[2] ?? '')).toBe(false);
      expect(text.includes('@ts-' + 'ignore')).toBe(false);
      expect(text.includes(' as ' + 'any')).toBe(false);
    }
    expect(offenders).toEqual([]);
    const maxLines = Math.max(...files.map((f) => countLines(readFileSync(f, 'utf8'))));
    console.log(`[M5] ${files.length} 个微模块行数扫描通过，最大 ${maxLines} 行`);
  });
});
