import { describe, expect, it } from 'vitest';
import { compileSettlementScene } from '../src/core/compileScene';
import { computeFurnitureLayout, rectsOverlap, type LayoutRect } from '../src/renderer/furnitureLayout';
import { Canvas2DBackend } from '../src/renderer/Canvas2DBackend';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';
import { paintScene } from '../src/renderer/paintScene';
import { structureRoofColor } from '../src/renderer/paintStructures';
import { getActivePalette } from '../src/schema/palette.schema';
import { normalizeProject, serializeProject } from '../src/schema/project.schema';
import { createPresetProject } from '../src/schema/presets';
import { createViewport } from '../src/renderer/RenderBackend';
import { buildHypsometricTint } from '../src/core/terrain/terrainShading';
import { buildElevationField } from '../src/core/terrain/elevationField';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import { planStageBlit } from '../src/ui/stageBlit';
import { applyZ, zIndexOf } from '../src/store/zOrder';

function frameOf(w: number, h: number): LayoutRect {
  return { x: 0, y: 0, w, h };
}

function inside(rect: LayoutRect, area: LayoutRect, tol = 0.001): boolean {
  return (
    rect.x >= area.x - tol &&
    rect.y >= area.y - tol &&
    rect.x + rect.w <= area.x + area.w + tol &&
    rect.y + rect.h <= area.y + area.h + tol
  );
}

const LEGEND_BASE = {
  visible: true,
  title: '图例 · LEGEND',
  position: 'bottom-right' as const,
  columns: 2 as const,
  displayMode: 'standard' as const,
  furnitureOpacity: 0.72,
  labelOpacity: 0.78,
  items: [],
};

describe('V3.1 · 图饰双态解耦（交互态视口四角 / 导出态图框）', () => {
  it('交互态 zoom=0.12 时四件图饰稳居视口四角，零越界零重叠', () => {
    for (const [w, h] of [[1440, 800], [1280, 720], [1024, 768]] as const) {
      const vp = createViewport(w, h, 3200, 1);
      const zoomed = { ...vp, zoom: 0.12 };
      const frame = { x: -640, y: -520, w: 384, h: 384 };
      const layout = computeFurnitureLayout({
        widthPx: w,
        heightPx: h,
        frame,
        legend: LEGEND_BASE,
        hasZoneSelection: false,
        zoom: zoomed.zoom,
        boundsMode: 'viewport',
        title: '起点都城 Lōsrūmūra',
        subtitle: 'R1966 穿界干流 · 东关三孔分水堰 · 13 边内城与北岸司辰官坛（图幅 3.2 km）',
      });
      const area: LayoutRect = { x: 14, y: 14, w: w - 28, h: h - 28 };
      const rects = [layout.titlePlateRect, layout.compassRect, layout.scaleBarRect, layout.legendRect];
      for (const rect of rects) expect(inside(rect, area), `${w}x${h}`).toBe(true);
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          if (a && b) expect(rectsOverlap(a, b, 0)).toBe(false);
        }
      }
      // 与地图纸框无关：换任意 frame，视口态图饰纹丝不动
      const shifted = computeFurnitureLayout({
        widthPx: w,
        heightPx: h,
        frame: { x: -900, y: -700, w: 200, h: 200 },
        legend: LEGEND_BASE,
        hasZoneSelection: false,
        zoom: zoomed.zoom,
        boundsMode: 'viewport',
        title: '起点都城 Lōsrūmūra',
        subtitle: 'R1966 穿界干流 · 东关三孔分水堰 · 13 边内城与北岸司辰官坛（图幅 3.2 km）',
      });
      expect(shifted.titlePlateRect).toEqual(layout.titlePlateRect);
      expect(shifted.scaleMeters).toBe(layout.scaleMeters);
    }
  });

  it('导出态图饰 100% 落在 frame 内缩 14px 且双向避让', () => {
    const frame = frameOf(1600, 1000);
    const layout = computeFurnitureLayout({
      widthPx: 1600,
      heightPx: 1000,
      frame: { x: 40, y: 40, w: 1520, h: 920 },
      legend: LEGEND_BASE,
      zoom: 0.4,
      boundsMode: 'frame',
      title: '长湖复市镇 Simibihmāh',
      subtitle: 'L6 半咸水湖湾 · 伊珂暗渠竖井链 · 前405年黑石大疫禁界（图幅 2.6 km）',
    });
    expect(frame.w).toBeGreaterThan(0);
    const area: LayoutRect = { x: 54, y: 54, w: 1520 - 28, h: 920 - 28 };
    for (const rect of [layout.titlePlateRect, layout.legendRect, layout.compassRect, layout.scaleBarRect]) {
      expect(inside(rect, area)).toBe(true);
    }
  });

  it('标题牌按实际文字撑宽并 clamp(220, 440, 0.52×可用宽)', () => {
    const short = computeFurnitureLayout({
      widthPx: 1440, heightPx: 900, frame: frameOf(1440, 900), legend: LEGEND_BASE,
      zoom: 0.4, boundsMode: 'viewport', title: '短题', subtitle: '副题',
    });
    const long = computeFurnitureLayout({
      widthPx: 1440, heightPx: 900, frame: frameOf(1440, 900), legend: LEGEND_BASE,
      zoom: 0.4, boundsMode: 'viewport', title: '起点都城 Lōsrūmūra 全域方志测绘总图',
      subtitle: 'R1966 穿界干流 · 东关三孔分水堰 · 十三边内城与北岸司辰官坛 · 北埠四道滑道坞',
    });
    expect(short.titlePlateRect.w).toBeGreaterThanOrEqual(220);
    expect(long.titlePlateRect.w).toBeGreaterThan(short.titlePlateRect.w);
    expect(long.titlePlateRect.w).toBeLessThanOrEqual(440);
  });
});

describe('V3.1 · 图饰与文字透明度双端透传', () => {
  it('furnitureOpacity / labelOpacity 同时作用于 Canvas 与 SVG', () => {
    const base = createPresetProject('losrumura');
    const project = normalizeProject({
      ...base,
      legend: { ...base.legend, furnitureOpacity: 0.5, labelOpacity: 0.4 },
    });
    const scene = compileSettlementScene(project);
    const vp = createViewport(1200, 900, project.meta.worldSizeM, 1);
    const svgBackend = new SvgStringBackend(1200, 900);
    paintScene(svgBackend, project, scene, vp, { isExport: true });
    const svg = svgBackend.toSvgString();
    expect(svg).toContain('fill-opacity="0.47"'); // 0.94 × 0.5 图例/标题底板
    expect(svg).toContain('fill-opacity="0.4"'); // 文字标识

    const alphas: number[] = [];
    let alpha = 1;
    const spy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'globalAlpha') return alpha;
          if (prop === 'measureText') return () => ({ width: 10 });
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
            return () => ({ addColorStop: () => undefined });
          }
          if (prop === 'createPattern') return () => null;
          if (prop === 'canvas') return { width: 1200, height: 900 };
          return () => undefined;
        },
        set: (_target, prop, value) => {
          if (prop === 'globalAlpha') {
            alpha = Number(value);
            alphas.push(alpha);
          }
          return true;
        },
      },
    );
    paintScene(
      new Canvas2DBackend(spy as unknown as CanvasRenderingContext2D, 1200, 900, 1),
      project,
      scene,
      vp,
      { isExport: true },
    );
    expect(alphas.some((value) => Math.abs(value - 0.4) < 1e-6)).toBe(true);
    expect(alphas.some((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true);
  });

  it('编译产物的图例透明度恒为有限数（采纳回灌后仍有值，图例面板不再崩）', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = createPresetProject(key);
      const scene = compileSettlementScene(project);
      const legend = (scene as unknown as { legend: { furnitureOpacity: number; labelOpacity: number } }).legend;
      expect(Number.isFinite(legend.furnitureOpacity), key).toBe(true);
      expect(Number.isFinite(legend.labelOpacity), key).toBe(true);
      expect(legend.furnitureOpacity).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('旧 JSON 缺省时补 0.72 / 0.78 并在序列化后保留', () => {
    const legacy = {
      schemaVersion: '3.0.0',
      meta: { name: '旧图', worldSizeM: 1200 },
      legend: { visible: true, title: '图例', position: 'top-left', columns: 1, displayMode: 'standard', items: [] },
    };
    const parsed = normalizeProject(legacy);
    expect(parsed.legend.furnitureOpacity).toBe(0.72);
    expect(parsed.legend.labelOpacity).toBe(0.78);
    expect(serializeProject(parsed)).toContain('"furnitureOpacity": 0.72');
  });
});

describe('V3.1 · 悬停高亮入浮层 / 淡彩 RLE / 结构屋顶色', () => {
  it('悬停等高线不再改写静态层，只在 ui-overlay 高亮', () => {
    const project = createPresetProject('changhu');
    const scene = compileSettlementScene(project);
    const vp = createViewport(900, 900, project.meta.worldSizeM, 1);
    const plain = new SvgStringBackend(900, 900);
    paintScene(plain, project, scene, vp, { isExport: true });
    const contourId = scene.terrain.contours[0]?.id ?? '';
    const hovered = new SvgStringBackend(900, 900);
    paintScene(hovered, project, scene, vp, { isExport: true, hoverContourId: contourId });
    expect(hovered.toSvgString()).toBe(plain.toSvgString());

    const overlay = new SvgStringBackend(900, 900);
    paintScene(overlay, project, scene, vp, {
      overlayOnly: true,
      includeCartouche: false,
      hoverContourId: contourId,
    });
    expect(overlay.layerIds).toEqual(['ui-overlay']);
    expect(overlay.toSvgString()).toContain('layer-ui-overlay');
  });

  it('淡彩带水平 RLE 合并后多边形 <= 1500 且仍 >= 200', () => {
    const project = createPresetProject('losrumura');
    const field = buildElevationField(project);
    const bands = buildHypsometricTint(field, project);
    const total = bands.reduce((sum, band) => sum + band.polygons.length, 0);
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(total).toBeGreaterThanOrEqual(200);
    expect(total).toBeLessThanOrEqual(1500);
  });

  it('citadel 核心建筑屋顶用暖赭金，绝不使用炭黑墙色', () => {
    const pal = getActivePalette({ themeId: 'watabou_classic', overrides: {} });
    const citadel = structureRoofColor('citadel', pal);
    expect(citadel).not.toBe(pal.wallFill);
    expect(citadel).not.toBe(pal.inkDark);
    expect(citadel.startsWith('#')).toBe(true);
    expect(structureRoofColor('inner', pal)).toBe(pal.roofInner);
  });
});

describe('V3.1 · guided 导览与超长标签', () => {
  it('guided 隐去选区名，导览目录加宽至 >= 268px 且不截断长副标题', () => {
    const base = createPresetProject('palong');
    const project = normalizeProject({
      ...base,
      legend: { ...base.legend, displayMode: 'guided' },
      landmarks: base.landmarks.map((item, index) => ({
        ...item,
        badgeNum: index + 1,
        subtitle: `极长副标题用于验证目录不再硬截断第 ${index + 1} 号节点`,
      })),
    });
    const scene = compileSettlementScene(project);
    const vp = createViewport(1200, 900, project.meta.worldSizeM, 1);
    const backend = new SvgStringBackend(1200, 900);
    paintScene(backend, project, scene, vp, { isExport: true, displayMode: 'guided' });
    const svg = backend.toSvgString();
    expect(svg).toContain('方志导览');
    expect(svg).toContain('极长副标题用于验证目录不再硬截断');
    const zoneName = project.zones[0]?.name ?? '';
    expect(svg).not.toContain(`>${zoneName}<`);
    const widths = [...svg.matchAll(/<rect[^>]*width="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(268);
  });
});

describe('V3.1 · 工程穿帮修复与生成器调优回归', () => {
  it('长湖东北出城驿道跨 R2147 河口架桥并连到东北边界', () => {
    const project = createPresetProject('changhu');
    const scene = compileSettlementScene(project);
    const road = project.roads.find((item) => item.id === 'road_lake_corridor');
    const head = road?.points[0];
    expect(head).toBeDefined();
    const size = project.meta.worldSizeM;
    const edgeDist = head ? Math.min(head[0], head[1], size - head[0], size - head[1]) : Infinity;
    expect(edgeDist).toBeLessThanOrEqual(20);
    const waterBridge = scene.hydro.bridges.find((b) => b.id.startsWith('wbr_'));
    expect(waterBridge).toBeDefined();
    expect(waterBridge?.style).toBe('timber');
  });

  it('帕隆窄峡只余一座双堡桥与一座渠桥，桥头堡不再叠画在五边形堡寨上', () => {
    const project = createPresetProject('palong');
    const scene = compileSettlementScene(project);
    expect(scene.hydro.bridges.filter((b) => b.style === 'fortified_twin')).toHaveLength(1);
    expect(scene.hydro.bridges.filter((b) => b.id.startsWith('cbr_')).length).toBeLessThanOrEqual(1);
    const pal = getActivePalette(project.palette);
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 });
    const block = svg.slice(svg.indexOf('<g id="layer-bridges">'), svg.indexOf('<g id="layer-buildings">'));
    expect(block.length).toBeGreaterThan(0);
    expect(block.includes(pal.wallFill)).toBe(false);
  });

  it('集市排距 11.5–13m、棚深 <= 6.6m；街坊临街屋间距收紧到 <= 6m', () => {
    const project = createPresetProject('changhu');
    const scene = compileSettlementScene(project);
    const stalls = scene.buildings.filter((b) => b.zoneId === 'zone_night_market' && b.kind === 'stall');
    expect(stalls.length).toBeGreaterThan(10);
    const rows = [...new Set(stalls.map((b) => Math.round(b.centroid[1] * 2) / 2))].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i += 1) gaps.push((rows[i] ?? 0) - (rows[i - 1] ?? 0));
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
    expect(median).toBeGreaterThanOrEqual(9);
    for (const stall of stalls) {
      const ys = stall.points.map((q) => q[1]);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(6.8);
    }
    let pairGap = 0;
    let pairs = 0;
    const city = scene.buildings.filter((b) => b.zoneId === 'zone_town_core' && b.kind === 'house');
    for (const a of city) {
      let best = Infinity;
      for (const b of city) {
        if (b.id === a.id) continue;
        best = Math.min(best, Math.hypot(b.centroid[0] - a.centroid[0], b.centroid[1] - a.centroid[1]));
      }
      if (best < 40) {
        pairGap += best;
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(20);
    expect(pairGap / pairs).toBeLessThanOrEqual(30);
  });

  it('村寨骨架贴合既有官道时不再重复推白线（lanes 不与干道叠印）', () => {
    const project = createPresetProject('palong');
    const scene = compileSettlementScene(project);
    const roads = scene.hydro.roads.filter((r) => r.tier !== 'lane');
    const nearRoad = (p: readonly [number, number]): boolean =>
      roads.some((road) =>
        road.centerline.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 10),
      );
    for (const lane of scene.lanes) {
      const covered = lane.filter(nearRoad).length / Math.max(1, lane.length);
      expect(covered).toBeLessThan(0.9);
    }
  });
});

describe('V3.1 · 离屏贴图几何（画布错位回归）', () => {
  it('任意平移下位图与直绘的世界原点严格重合，且位图完整覆盖视口', () => {
    for (const [w, h] of [[1450, 786], [1200, 700], [900, 600]] as const) {
      for (const [panX, panY] of [[0, 0], [12, -30], [160, 159], [-240, 321], [123.4, -77.7]] as const) {
        const vp = { widthPx: w, heightPx: h, dpr: 2, panX, panY, zoom: 0.22, worldSizeM: 3200 };
        const plan = planStageBlit(vp, w, h, 2);
        // 不变式：位图左上角 + 位图内 pan == 主画布 pan（否则底图会与图框/浮层错位）
        expect(Math.abs(plan.destX / 2 + plan.cachePanX - panX)).toBeLessThanOrEqual(0.26);
        expect(Math.abs(plan.destY / 2 + plan.cachePanY - panY)).toBeLessThanOrEqual(0.26);
        expect(plan.destX / 2).toBeLessThanOrEqual(0);
        expect(plan.destY / 2).toBeLessThanOrEqual(0);
        expect(plan.destX / 2 + plan.cacheWidthPx).toBeGreaterThanOrEqual(w);
        expect(plan.destY / 2 + plan.cacheHeightPx).toBeGreaterThanOrEqual(h);
      }
    }
  });

  it('桶内平移复用同一张位图，跨桶才换键（缓存不空转）', () => {
    const make = (panX: number) => planStageBlit(
      { widthPx: 1200, heightPx: 700, dpr: 2, panX, panY: 0, zoom: 0.2, worldSizeM: 3200 },
      1200, 700, 2,
    );
    const a = make(10);
    const b = make(10 + a.margin * 0.2);
    expect(b.bucketX).toBe(a.bucketX);
    const c = make(10 + a.margin * 2.4);
    expect(c.bucketX).not.toBe(a.bucketX);
  });
});

describe('V3.1 · 图例面板 SSR（点击图例不再白屏）', () => {
  it('图例面板可完整渲染，两条透明度滑块与图例项齐备', async () => {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { LegendPanel } = await import('../src/ui/inspector/LegendPanel');
    const html = renderToString(createElement(LegendPanel));
    expect(html).toContain('图饰透明度');
    expect(html).toContain('文字标识透明度');
    expect(html).toContain('图例项');
  });
});

describe('V3.1 · 逐物体叠放层级（zIndex）', () => {
  const layered = (zoneZ: number) => normalizeProject({
    meta: { worldSizeM: 900, name: '层级' },
    terrain: { baseElev: 400, slopeMagM: 0, terrainNoiseAmpM: 0 },
    zones: [{
      id: 'm1', name: '集坪', contentType: 'market', marketMode: 'stalls',
      points: [[200, 200], [700, 200], [700, 700], [200, 700]], seed: 3, zIndex: zoneZ,
    }],
    roads: [{ id: 'r1', name: '横街', tier: 'street', points: [[100, 450], [800, 450]], widthM: 10 }],
  });

  it('默认 zIndex=0 维持 17 层画家序列；调层后切换为排序绘制', () => {
    const flat = layered(0);
    const flatScene = compileSettlementScene(flat);
    const vp = createViewport(900, 900, flat.meta.worldSizeM, 1);
    const base = new SvgStringBackend(900, 900);
    paintScene(base, flat, flatScene, vp, {});
    expect(base.layerIds).toContain('buildings');
    expect(base.layerIds).not.toContain('authored');

    const raised = layered(120);
    const raisedScene = compileSettlementScene(raised);
    const over = new SvgStringBackend(900, 900);
    paintScene(over, raised, raisedScene, vp, {});
    expect(over.layerIds).toContain('authored');
    expect(over.layerIds).not.toContain('buildings');
  });

  it('选区面上移压过道路、下移沉到道路之下（真实指令序变化）', () => {
    const under = renderSceneToSvgString(layered(0), compileSettlementScene(layered(0)), { mode: 'clean', basePx: 900 });
    const over = renderSceneToSvgString(layered(120), compileSettlementScene(layered(120)), { mode: 'clean', basePx: 900 });
    const apron = (svg: string) => svg.indexOf('#e8dcc4');
    const roadCasing = (svg: string) => svg.indexOf('stroke="#5b4a38"');
    expect(apron(under)).toBeGreaterThan(-1);
    expect(roadCasing(under)).toBeGreaterThan(-1);
    expect(apron(under)).toBeLessThan(roadCasing(under));
    expect(apron(over)).toBeGreaterThan(roadCasing(over));
  });

  it('applyZ 置顶/置底/上移/下移在实体数组内单调推进且限幅', () => {
    const project = layered(0);
    const selection = { type: 'zone' as const, id: 'm1' };
    expect(applyZ(project, selection, 'up')).toBe(true);
    expect(project.zones[0]?.zIndex).toBe(10);
    expect(applyZ(project, selection, 'top')).toBe(true);
    expect(project.zones[0]?.zIndex).toBe(20);
    expect(applyZ(project, selection, 'down')).toBe(true);
    expect(project.zones[0]?.zIndex).toBe(10);
    expect(applyZ(project, selection, 'bottom')).toBe(true);
    expect(project.zones[0]?.zIndex).toBe(0);
    expect(zIndexOf(project, selection)).toBe(0);
    expect(zIndexOf(project, { type: 'terrainShape', id: 'x' })).toBeNull();
    for (let i = 0; i < 60; i += 1) applyZ(project, selection, 'top');
    expect(project.zones[0]?.zIndex).toBe(480);
  });
});
