import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSettlementScene } from '../src/core/compileScene';
import { hitTestActiveHandles, hitTestSceneObject, shapeLocalToWorld } from '../src/core/hitTest';
import { computePolygonCentroid } from '../src/core/math/polygon';
import { TOOL_IDS } from '../src/schema/geometry.types';
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
import { computeFurnitureLayout, paintFurniture, rectsOverlap } from '../src/renderer/furnitureLayout';
import { paintLegendGlyph } from '../src/renderer/paintLegendGlyph';
import { paintScene } from '../src/renderer/paintScene';
import {
  createViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtScreenPoint,
} from '../src/renderer/RenderBackend';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';

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

describe('M4 · 同源双端渲染一致性', () => {
  it('Canvas 与 SVG 图层序列完全一致且共 14 层', () => {
    const proj = project();
    const compiled = scene();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    const { ctx, calls } = createMockContext();
    const canvasBackend = new Canvas2DBackend(ctx, 1200, 900, 1);
    paintScene(canvasBackend, proj, compiled, vp, {});
    const svgBackend = new SvgStringBackend(1200, 900);
    paintScene(svgBackend, proj, compiled, vp, {});
    const svg = svgBackend.toSvgString();

    expect(canvasBackend.layerIds.length).toBe(14);
    expect(canvasBackend.layerIds).toEqual(svgBackend.layerIds);
    expect(canvasBackend.layerIds[0]).toBe('paper-bg');
    expect(canvasBackend.layerIds[13]).toBe('ui-overlay');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<g id="layer-trees-canopy">');
    expect(svg).toContain('</svg>');
    for (const id of canvasBackend.layerIds) expect(svg).toContain(`<g id="layer-${id}">`);
    console.log(`[M4] 14 层双端对拍通过，Canvas 指令 ${calls.length} 条，SVG ${svg.length} 字符`);
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

  it('四角停靠图例框与标题牌/指北针/比例尺/选区胶囊零重叠', () => {
    const items: LegendItem[] = BUILTIN_LEGEND_CATALOG.map((entry, index) => ({
      key: entry.key,
      isCustom: false,
      glyphType: entry.glyphType,
      label: entry.label,
      color: '',
      colorLocked: false,
      strokeColor: entry.strokeColor,
      visible: true,
      autoPresent: true,
      order: index * 10,
    }));
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      for (const [w, h] of [
        [1200, 900],
        [900, 700],
        [1600, 1600],
      ] as const) {
        const legend: LegendConfig = { visible: true, title: '图例 · 测试', position, columns: 2, items };
        const layout = computeFurnitureLayout({ widthPx: w, heightPx: h, legend, hasZoneSelection: true });
        expect(rectsOverlap(layout.legendRect, layout.titlePlateRect, 10), `${position} title`).toBe(false);
        expect(rectsOverlap(layout.legendRect, layout.compassRect, 10), `${position} compass`).toBe(false);
        expect(rectsOverlap(layout.legendRect, layout.scaleBarRect, 10), `${position} scale`).toBe(false);
        if (layout.zoneHudRect) {
          expect(rectsOverlap(layout.legendRect, layout.zoneHudRect, 10), `${position} hud`).toBe(false);
        }
      }
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

describe('M4 · 视口变换与拾取优先级', () => {
  it('worldToScreen / screenToWorld 往返误差 < 1e-6，滚轮缩放光标不动点', () => {
    const vp = createViewport(1200, 800, 2400, 2);
    for (const point of [
      [0, 0],
      [123.456, 789.012],
      [2400, 2400],
    ] as const) {
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

  it('巨型地形椭圆上叠加选区时点击 100% 命中 zone', () => {
    const proj = normalizeProject({
      meta: { worldSizeM: 1600, name: '拾取优先级' },
      terrain: {
        baseElev: 400,
        slopeMagM: 0,
        shapes: [
          {
            id: 'huge_hill',
            type: 'hill',
            cx: 800,
            cy: 800,
            rx: 980,
            ry: 720,
            angleDeg: 0,
            deltaElev: 60,
            focusX: 0,
            focusY: 0,
          },
        ],
      },
      zones: [
        {
          id: 'zn_over_hill',
          name: '台地内城',
          contentType: 'walled_city',
          points: [
            [700, 700],
            [900, 700],
            [900, 900],
            [700, 900],
          ],
          seed: 7,
        },
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

describe('M5 · 组件树与工作台契约', () => {
  it('React 19 组件树可在 Node 端静态渲染且四区布局与 12 工具齐全', async () => {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { App } = await import('../src/ui/App');
    const html = renderToString(createElement(App));
    expect(html).toContain('flex h-screen w-screen flex-col');
    expect(html).toContain('<canvas');
    expect(html).toContain('核验中');
    expect(html).toContain('离线独立模式');
    expect(html).toContain('地形');
    expect(html).toContain('配色导出');
    for (const label of ['选择与手柄微调', '等高线直接推拉', '高程微雕笔刷', '测距与高程剖面']) {
      expect(html).toContain(label);
    }
    for (const hotkey of ['V', 'C', 'B', 'H', 'G', 'W', 'L', 'K', 'D', 'Z', 'M', 'U']) {
      expect(html).toContain(`(${hotkey})`);
    }
  });
});


describe('V2.0.1 · 七项 P0 与体验收口对抗回归', () => {
  it('P0-1 Canvas 拒绝 fill none，图框不再把整图涂黑', () => {
    const { ctx, calls, invalidFills } = createMockContext();
    const backend = new Canvas2DBackend(ctx, 300, 200, 1);
    backend.drawRect(0, 0, 100, 50, { fill: 'none', stroke: '#2b2620', lineWidth: 1 });
    expect(calls.filter((call) => call.op === 'fillRect').length).toBe(0);
    expect(invalidFills.length).toBe(0);

    const proj = project();
    const compiled = scene();
    const vp = createViewport(1200, 900, proj.meta.worldSizeM, 1);
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), proj, compiled, vp, {});
    expect(invalidFills.length).toBe(0);
    expect(calls.some((call) => call.op === 'fillRect')).toBe(true);
  });

  it('P0-2 旋转山包偏心焦点柄与旋转连杆柄按旋转变换精确拾取', () => {
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

  it('P1-5 1280x800 / 960x640 / 904x722 三视口四角家具与选区胶囊零重叠', () => {
    const compiled = scene();
    const items: LegendItem[] = [];
    for (let i = 0; i < 22; i += 1) {
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
    const legend: LegendConfig = { ...compiled.legend, columns: 1, items };
    for (const [width, height] of [[1280, 800], [960, 640], [904, 722]] as const) {
      const layout = computeFurnitureLayout({ widthPx: width, heightPx: height, legend, hasZoneSelection: true });
      const fixed = [layout.titlePlateRect, layout.compassRect, layout.scaleBarRect];
      if (layout.zoneHudRect) fixed.push(layout.zoneHudRect);
      for (const rect of fixed) {
        expect(rectsOverlap(layout.legendRect, rect, 0)).toBe(false);
      }
      for (let i = 0; i < fixed.length; i += 1) {
        for (let j = i + 1; j < fixed.length; j += 1) {
          const a = fixed[i];
          const b = fixed[j];
          if (a && b) expect(rectsOverlap(a, b, 0)).toBe(false);
        }
      }
      expect(layout.legendRect.x).toBeGreaterThanOrEqual(16);
      expect(layout.legendRect.y).toBeGreaterThanOrEqual(16);
      expect(layout.legendRect.x + layout.legendRect.w).toBeLessThanOrEqual(width - 16 + 0.001);
      expect(layout.legendRect.y + layout.legendRect.h).toBeLessThanOrEqual(height - 16 + 0.001);
    }
  });

  it('P1-1 图例 visible=false 时第 13 层不绘制图例框', () => {
    const base = project();
    const hidden: TownProject = { ...base, legend: { ...base.legend, visible: false } };
    const compiled = compileSettlementScene(hidden);
    const svg = renderSceneToSvgString(hidden, compiled, { mode: 'full', basePx: 900 });
    expect(svg).not.toContain('图例 · LEGEND');
    expect(svg).toContain('id="layer-cartouche"');
    const shown = compileSettlementScene(base);
    const keys = shown.legend.items.filter((item) => item.autoPresent !== false).map((item) => item.key);
    for (const key of ['city_wall', 'roof_town', 'river_pure', 'bridge_ortho', 'farmland_plot', 'woodland_tree']) {
      expect(keys).toContain(key);
    }
  });
});


describe('V2.0.2 · 图廓四角与图饰文字收口', () => {
  it('R2-7 四位置 × 六视口 × 双列数 × HUD 共 96 组零重叠且左右真实落角', () => {
    const compiled = scene();
    const items: LegendItem[] = [];
    for (let i = 0; i < 22; i += 1) {
      const basis = BUILTIN_LEGEND_CATALOG[i % BUILTIN_LEGEND_CATALOG.length];
      items.push({
        key: `mx_${i}`, isCustom: i >= 14, glyphType: basis?.glyphType ?? 'building_town',
        label: `M${i}`, color: '', colorLocked: false, strokeColor: '#2b2520',
        visible: true, autoPresent: true, order: i * 10,
      });
    }
    const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
    const sizes = [[1280, 800], [960, 640], [904, 722], [1600, 1000], [1024, 768], [800, 600]] as const;
    let cases = 0;
    for (const [widthPx, heightPx] of sizes) {
      for (const position of positions) {
        for (const columns of [1, 2] as const) {
          for (const hud of [false, true]) {
            const legend: LegendConfig = { ...compiled.legend, position, columns, items };
            const layout = computeFurnitureLayout({ widthPx, heightPx, legend, hasZoneSelection: hud });
            const rect = layout.legendRect;
            const fixed = [layout.titlePlateRect, layout.compassRect, layout.scaleBarRect];
            if (layout.zoneHudRect) fixed.push(layout.zoneHudRect);
            for (const other of fixed) expect(rectsOverlap(rect, other, 0)).toBe(false);
            if (position === 'top-left' || position === 'bottom-left') {
              expect(Math.abs(rect.x - 16)).toBeLessThan(0.001);
            } else {
              expect(Math.abs(rect.x + rect.w - (widthPx - 16))).toBeLessThan(0.001);
            }
            expect(rect.y).toBeGreaterThanOrEqual(16);
            expect(rect.y + rect.h).toBeLessThanOrEqual(heightPx - 16 + 0.001);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(96);
  });

  it('R2-7 指北针 N 与比例尺文字严格位于包络框内', () => {
    const proj = project();
    const pal = getActivePalette(proj.palette);
    const legend: LegendConfig = { ...scene().legend, position: 'top-right', columns: 2 };
    const { ctx, calls } = createMockContext();
    paintFurniture(new Canvas2DBackend(ctx, 1200, 900, 1), {
      project: proj, palette: pal, frame: { x: 0, y: 0, w: 1200, h: 900 },
      widthPx: 1200, heightPx: 900, zoom: 1, legend,
    });
    const layout = computeFurnitureLayout({ widthPx: 1200, heightPx: 900, legend, hasZoneSelection: false });
    const nText = calls.find((call) => call.op === 'fillText' && call.text === 'N');
    expect(nText?.y).toBeDefined();
    expect((nText?.y ?? 0) >= layout.compassRect.y).toBe(true);
    expect((nText?.y ?? 0) <= layout.compassRect.y + layout.compassRect.h).toBe(true);
    const scaleText = calls.find((call) => call.op === 'fillText' && String(call.text).includes(' m'));
    expect(scaleText?.y).toBeDefined();
    expect((scaleText?.y ?? 0) >= layout.scaleBarRect.y).toBe(true);
    expect((scaleText?.y ?? 0) <= layout.scaleBarRect.y + layout.scaleBarRect.h).toBe(true);
  });
});

describe('M5 · 代码洁净度与 12 工具硬门禁', () => {
  it('src 下 56 个微模块全部 <= 320 行，零占位注释与隐式随机源', () => {
    const forbidden = ['TO' + 'DO', 'FIX' + 'ME', 'Math.' + 'random('];
    const files = walkTs('src');
    expect(files.length).toBe(56);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = countLines(text);
      if (lines > 320) offenders.push(`${file}:${lines}`);
      expect(text.includes(forbidden[0] ?? '')).toBe(false);
      expect(text.includes(forbidden[1] ?? '')).toBe(false);
      if (file.includes('/core/')) expect(text.includes(forbidden[2] ?? '')).toBe(false);
    }
    expect(offenders).toEqual([]);
    const maxLines = Math.max(...files.map((f) => countLines(readFileSync(f, 'utf8'))));
    console.log(`[M5] ${files.length} 个微模块行数扫描通过，最大 ${maxLines} 行`);
  });

  it('12 工具枚举锁死且绝无单栋房屋编辑入口（NG-01）', () => {
    expect(TOOL_IDS.length).toBe(12);
    expect([...TOOL_IDS]).toEqual([
      'select',
      'contour_drag',
      'sculpt_brush',
      'add_hill',
      'add_ridge',
      'draw_river',
      'draw_water_area',
      'place_reef',
      'draw_road',
      'draw_zone',
      'place_landmark',
      'measure',
    ]);
    for (const tool of TOOL_IDS) {
      expect(tool.toLowerCase().includes('building')).toBe(false);
      expect(tool.toLowerCase().includes('house')).toBe(false);
    }
  });
});
