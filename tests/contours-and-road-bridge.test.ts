import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../src/schema/project.schema';
import { createPresetProject } from '../src/schema/presets';
import { compileSettlementScene } from '../src/core/compileScene';
import { pointInPolygon } from '../src/core/math/polygon';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import { Z_BASE } from '../src/renderer/drawOrder';
import { getActivePalette } from '../src/schema/palette.schema';
import { createViewport } from '../src/renderer/RenderBackend';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';
import { paintScene } from '../src/renderer/paintScene';
import { structureRoofColor } from '../src/renderer/paintStructures';

/** 东西向 80m 宽河 + 南北向 14m 干道：桥心 (800, 800) */
function crossingProject(extraTerrain: Record<string, unknown> = {}) {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: '路即桥' },
    terrain: { baseElev: 300, slopeMagM: 24, terrainNoiseAmpM: 0, ...extraTerrain },
    rivers: [
      { id: 'riv_x', name: '宽河', points: [[100, 800], [1500, 800]], widthStartM: 80, widthEndM: 80 },
    ],
    roads: [
      { id: 'rd_y', name: '南北道', tier: 'highway', widthM: 14, points: [[800, 100], [800, 1500]] },
    ],
  });
}

describe('V3.2 · 路即桥与等高线置顶', () => {
  it('桥梁不再单独绘制桥面：桥层无任何路径，路面保持一条连续折线直接跨水', () => {
    const project = crossingProject();
    const scene = compileSettlementScene(project);
    expect(scene.hydro.bridges.length).toBe(1);
    const svg = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 1000 });
    const bridgeBlock = svg.slice(svg.indexOf('<g id="layer-bridges">'), svg.indexOf('<g id="layer-buildings">'));
    expect(bridgeBlock).toContain('layer-bridges');
    expect(bridgeBlock).not.toContain('<path');
    const roadBlock = svg.slice(svg.indexOf('<g id="layer-roads-streets">'), svg.indexOf('<g id="layer-bridges">'));
    expect(roadBlock.match(/<path /g)?.length).toBe(2);
    // 每条路面只保留一个 M 起点：没有被桥位断口切成两段
    for (const path of roadBlock.match(/<path d="[^"]+"/g) ?? []) {
      expect(path.match(/M /g)?.length).toBe(1);
    }
  });

  it('等高线恒在全部地图对象之上、文字标注之下（等效 z=9999）', () => {
    const project = crossingProject();
    const svg = renderSceneToSvgString(project, compileSettlementScene(project), { mode: 'full', basePx: 1000 });
    const trees = svg.indexOf('<g id="layer-trees-canopy">');
    const contours = svg.indexOf('<g id="layer-contours">');
    const labels = svg.indexOf('<g id="layer-landmarks-labels">');
    expect(trees).toBeGreaterThan(-1);
    expect(contours).toBeGreaterThan(trees);
    expect(labels).toBeGreaterThan(contours);
    // 物体 zIndex 上限 500 + 最高基准层 70 也远低于 9999
    expect(Math.max(...Object.values(Z_BASE)) + 500).toBeLessThan(9999);
  });

  it('等高线透明度可调且默认低透明：0.2 时线稿 opacity 全部 <= 0.2', () => {
    const project = crossingProject({ contourOpacity: 0.2 });
    const svg = renderSceneToSvgString(project, compileSettlementScene(project), { mode: 'full', basePx: 1000 });
    const block = svg.slice(svg.indexOf('<g id="layer-contours">'), svg.indexOf('<g id="layer-landmarks-labels">'));
    const values = [...block.matchAll(/<path[^>]*opacity="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(values.length).toBeGreaterThan(4);
    expect(Math.max(...values)).toBeLessThanOrEqual(0.2);
    expect(normalizeProject({ meta: { worldSizeM: 800 } }).terrain.contourOpacity).toBe(0.35);
  });

  it('置顶等高线自动裁出河湖水域，河面内部零等高线点与高程数字', () => {
    const project = crossingProject({ slopeMagM: 48, contourStep: 4, slopeDirDeg: 0 });
    const scene = compileSettlementScene(project);
    const bank = scene.hydro.rivers[0]?.bankPolygon;
    expect(bank).toBeDefined();
    if (!bank) return;
    const basePx = 1000;
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx });
    const block = svg.slice(svg.indexOf('<g id="layer-contours">'), svg.indexOf('<g id="layer-landmarks-labels">'));
    const scale = project.meta.worldSizeM / basePx;
    let totalPts = 0;
    let wetPts = 0;
    for (const m of block.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)) {
      totalPts += 1;
      const wx = Number(m[1]) * scale;
      const wy = Number(m[2]) * scale;
      if (pointInPolygon(wx, wy, bank)) wetPts += 1;
    }
    expect(totalPts).toBeGreaterThan(20);
    expect(wetPts).toBe(0);
    for (const m of block.matchAll(/<text[^>]*x="([\d.-]+)" y="([\d.-]+)"/g)) {
      expect(pointInPolygon(Number(m[1]) * scale, Number(m[2]) * scale, bank)).toBe(false);
    }
  });

  it('guided 导览目录避开右下角图例（零重叠）并自动省略超长文本', () => {
    const base = createPresetProject('losrumura');
    const project = normalizeProject({
      ...base,
      legend: { ...base.legend, displayMode: 'guided', visible: true, position: 'bottom-right' },
      landmarks: base.landmarks.map((lm, i) =>
        i === 0 ? { ...lm, subtitle: '超长说明文字'.repeat(25) } : lm,
      ),
    });
    const scene = compileSettlementScene(project);
    const vp = createViewport(1200, 900, project.meta.worldSizeM, 1);
    const backend = new SvgStringBackend(1200, 900);
    paintScene(backend, project, scene, vp, { isExport: true, displayMode: 'guided' });
    const svg = backend.toSvgString();
    const cartouche = svg.slice(svg.indexOf('<g id="layer-cartouche">'));
    const rects = [...cartouche.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }))
      .filter((r) => r.w >= 160 && r.w < 500 && r.h >= 80);
    // 图例框在右侧，方志导览框在左侧，两框水平无交集
    expect(rects.length).toBeGreaterThanOrEqual(2);
    const leftBox = rects.reduce((a, b) => (a.x < b.x ? a : b));
    const rightBox = rects.reduce((a, b) => (a.x > b.x ? a : b));
    expect(leftBox.x + leftBox.w).toBeLessThan(rightBox.x);
    expect(cartouche).toContain('…');
  });

  it('自定义 zIndex 排序：同层交叉路保持两遍无黑叉，选区升温带动屋宇同步抬升', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1200, name: '叠层回归' },
      terrain: { baseElev: 300, slopeMagM: 4, terrainNoiseAmpM: 0 },
      roads: [
        { id: 'r1', zIndex: 0, name: '东西道', tier: 'highway', widthM: 14, points: [[100, 600], [1100, 600]] },
        { id: 'r2', zIndex: 0, name: '南北道', tier: 'highway', widthM: 14, points: [[600, 100], [600, 1100]] },
      ],
      zones: [
        {
          id: 'zn_up', zIndex: 100, name: '抬升坊', contentType: 'town_blocks', seed: 7,
          points: [[180, 180], [480, 180], [480, 480], [180, 480]],
        },
      ],
      structures: [
        { id: 'st_mid', zIndex: 0, name: '中层建筑', x: 330, y: 330, widthM: 28, depthM: 20, kind: 'rect', roofKind: 'citadel' },
      ],
    });
    const scene = compileSettlementScene(project);
    const pal = getActivePalette(project.palette);
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 });
    const authored = svg.slice(svg.indexOf('<g id="layer-authored">'), svg.indexOf('<g id="layer-contours">'));
    const strokes = [...authored.matchAll(/<path[^>]*stroke="([^"]+)"/g)].map((m) => m[1]);
    const casingIdx = strokes.lastIndexOf(pal.roadCasing);
    const fillIdx = strokes.indexOf(pal.roadFill);
    expect(casingIdx).toBeGreaterThan(-1);
    expect(fillIdx).toBeGreaterThan(casingIdx);
    // 选区 zIndex=100 使屋宇（base 60+100=160）晚于中层核心建筑（base 65+0=65）绘制
    const structurePos = authored.indexOf(structureRoofColor('citadel', pal));
    const townRoofPos = authored.indexOf(pal.roofTown);
    expect(structurePos).toBeGreaterThan(-1);
    expect(townRoofPos).toBeGreaterThan(structurePos);
  });

  it('图例小图标同步响应 furnitureOpacity 半透明度', () => {
    const base = createPresetProject('losrumura');
    const project = normalizeProject({
      ...base,
      legend: { ...base.legend, visible: true, furnitureOpacity: 0.4 },
    });
    const scene = compileSettlementScene(project);
    const svg = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 1000 });
    const legendBlock = svg.slice(svg.indexOf('图例'));
    const glyphOps = [...legendBlock.matchAll(/<(?:path|rect|circle)[^>]*opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(glyphOps.length).toBeGreaterThan(5);
    expect(Math.max(...glyphOps)).toBeLessThanOrEqual(0.401);
  });
});
