import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSettlementScene, type CompiledScene } from '../src/core/compileScene';
import { buildElevationField } from '../src/core/terrain/elevationField';
import { computePolygonBBox } from '../src/core/math/polygon';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import { BUILTIN_PRESETS, createPresetProject, type PresetKey } from '../src/schema/presets';
import type { TownProject } from '../src/schema/project.schema';

const WORLD: Readonly<Record<'losrumura' | 'changhu' | 'palong', number>> = {
  losrumura: 3200,
  changhu: 2600,
  palong: 1500,
};

const PREVIEW_DIR = join(process.cwd(), 'previews');

function projectOf(key: 'losrumura' | 'changhu' | 'palong'): TownProject {
  return createPresetProject(key as PresetKey);
}

/** 四顶点"方块选区"占比：方框硬切感的第一量化判据 */
function quadRatio(project: TownProject): number {
  const quads = project.zones.filter((zone) => zone.points.length === 4).length;
  return quads / Math.max(1, project.zones.length);
}

/** 到图幅最近边框的带符号距离：负值为越界，正值为内缩 */
function borderDistance(x: number, y: number, size: number): number {
  return Math.min(x, y, size - x, size - y);
}

function waterExtent(project: TownProject): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const body of project.waterBodies) {
    const box = computePolygonBBox(body.points);
    minX = Math.min(minX, box[0]);
    minY = Math.min(minY, box[1]);
    maxX = Math.max(maxX, box[2]);
    maxY = Math.max(maxY, box[3]);
  }
  return { minX, minY, maxX, maxY };
}

function sceneOf(project: TownProject): CompiledScene {
  return compileSettlementScene(project);
}

describe('V3-S3.4 · 三套方志标杆工程空间硬断言', () => {
  it('预设完整载入三套工程且图幅/主题与方志规格一致', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(4);
    const themes: Record<string, string> = {};
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = projectOf(key);
      themes[key] = project.palette.themeId;
      expect(project.meta.worldSizeM).toBe(WORLD[key]);
      expect(project.zones.length).toBeGreaterThanOrEqual(15);
      expect(project.landmarks.length).toBeGreaterThanOrEqual(8);
      expect(project.landmarks.every((item) => item.badgeNum !== undefined)).toBe(true);
    }
    expect(themes.losrumura).toBe('watabou_classic');
    expect(themes.changhu).toBe('arid_oasis');
    expect(themes.palong).toBe('nordic_fjord');
  });

  it('三套工程全量编译零穿模、零河心岛、屋宇与林木均非空', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = projectOf(key);
      const scene = sceneOf(project);
      expect(scene.collisionReport.totalHits, key).toBe(0);
      expect(scene.collisionReport.riverIslands, key).toBe(0);
      expect(scene.collisionReport.passed, key).toBe(true);
      expect(scene.buildings.length, key).toBeGreaterThan(60);
      expect(scene.trees.length, key).toBeGreaterThan(80);
      expect(scene.shading.bands.length, key).toBeGreaterThan(2);
      expect(scene.shading.hachures.length, key).toBeGreaterThan(80);
      expect(scene.terrain.contours.length, key).toBeGreaterThan(20);
      // 涂抹林木经守门复核后绝大多数保留（个别压水/压屋点被剔除属正常）
      const kept = scene.trees.filter((tree) => tree.zoneId === '__painted__').length;
      expect(kept / Math.max(1, project.paintedTrees.length), key).toBeGreaterThan(0.8);
    }
  });

  it('反丑陋门禁：三套工程 4 顶点方块选区占比全部 < 20%', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = projectOf(key);
      expect(quadRatio(project), key).toBeLessThan(0.2);
      const organic = project.zones.filter((zone) => zone.points.length >= 5).length;
      expect(organic, key).toBeGreaterThanOrEqual(project.zones.length - 3);
    }
  });

  it('主干水系贴合图边：干流端点与湖湾包围盒距边界 <= 20m', () => {
    const los = projectOf('losrumura');
    const losRiver = los.rivers[0];
    expect(losRiver).toBeDefined();
    const first = losRiver?.points[0];
    const last = losRiver?.points.at(-1);
    expect(first && Math.abs(borderDistance(first[0], first[1], WORLD.losrumura)) <= 20).toBe(true);
    expect(last && Math.abs(borderDistance(last[0], last[1], WORLD.losrumura)) <= 20).toBe(true);

    const pal = projectOf('palong');
    const palRiver = pal.rivers[0];
    const palFirst = palRiver?.points[0];
    const palLast = palRiver?.points.at(-1);
    expect(palFirst && Math.abs(borderDistance(palFirst[0], palFirst[1], WORLD.palong)) <= 20).toBe(true);
    expect(palLast && Math.abs(borderDistance(palLast[0], palLast[1], WORLD.palong)) <= 20).toBe(true);

    const chang = projectOf('changhu');
    const extent = waterExtent(chang);
    const touching = [
      Math.abs(extent.minX) <= 20 || extent.minX < 0,
      Math.abs(extent.minY) <= 20 || extent.minY < 0,
      Math.abs(WORLD.changhu - extent.maxX) <= 20 || extent.maxX > WORLD.changhu,
      Math.abs(WORLD.changhu - extent.maxY) <= 20 || extent.maxY > WORLD.changhu,
    ].filter(Boolean).length;
    expect(touching).toBeGreaterThanOrEqual(2);
  });

  it('起点城：四类水渠 + 三孔分水堰 + 北埠滑道 + 议事厅四公仓 + 北岸官坛齐备', () => {
    const project = projectOf('losrumura');
    const styles = new Set(project.canals.map((canal) => canal.style));
    for (const style of ['stone_clean', 'irrigation', 'drainage_dashed', 'foul_outfall']) {
      expect(styles.has(style as never), style).toBe(true);
    }
    expect(project.weirs.length).toBeGreaterThanOrEqual(1);
    expect(project.weirs[0]?.sluices).toBe(3);
    expect(project.docks.length).toBeGreaterThanOrEqual(1);
    expect(project.docks[0]?.kind).toBe('slipway');
    expect(project.docks[0]?.slips).toBe(4);

    const innerCity = project.zones.find((zone) => zone.contentType === 'walled_city');
    expect(innerCity?.points.length).toBe(13);
    expect(project.structures.length).toBeGreaterThanOrEqual(5);
    expect(project.structures.filter((item) => item.kind === 'l_hall').length).toBe(1);
    expect(project.structures.filter((item) => item.kind === 'rect').length).toBe(4);
    expect(project.structures.filter((item) => item.kind === 'round_altar').length).toBe(1);
    const altar = project.zones.find((zone) => zone.id === 'zone_altar_fort');
    expect(altar?.contentType).toBe('citadel');

    const scene = sceneOf(project);
    const waterGates = scene.walls.flatMap((wall) => wall.waterGates);
    expect(waterGates.length).toBeGreaterThanOrEqual(2);
    expect(scene.structures.length).toBe(7);
    expect(scene.hydraulic.weirs[0]?.pierPolygons.length).toBe(3);
    expect(scene.hydro.bridges.length).toBeGreaterThanOrEqual(3);
    // 内城核心建筑群不得被普通民房压占
    const keep = project.structures.filter((item) => item.zoneId === 'zone_citadel_keep');
    expect(keep.length).toBe(5);
  });

  it('长湖：24 边黑石疫圈 + 三座湖港木栈桥 + 伊珂暗渠竖井链 + 分级盐池', () => {
    const project = projectOf('changhu');
    const ring = project.zones.find((zone) => zone.id === 'zone_plague_ring');
    expect(ring?.exclusionStyle).toBe('plague_stones');
    expect(ring?.points.length).toBeGreaterThanOrEqual(20);
    expect(project.docks.length).toBeGreaterThanOrEqual(3);
    expect(project.docks.every((dock) => dock.kind === 'wooden_pier')).toBe(true);
    const qanat = project.canals.find((canal) => canal.style === 'qanat');
    expect(qanat).toBeDefined();
    expect(qanat?.points.length).toBeGreaterThanOrEqual(7);
    expect(project.waterBodies.length).toBeGreaterThanOrEqual(2);
    expect(project.zones.filter((zone) => zone.contentType === 'saltpan').length).toBe(2);
    expect(project.zones.find((zone) => zone.contentType === 'market')?.marketMode).toBe('port_apron');

    const scene = sceneOf(project);
    const shafts = scene.hydro.canals.find((canal) => canal.style === 'qanat')?.shaftPoints ?? [];
    expect(shafts.length).toBeGreaterThanOrEqual(5);
    expect(scene.saltpanCells.length).toBeGreaterThan(100);
    expect(scene.hydraulic.docks.length).toBe(3);
  });

  it('帕隆：深切峡谷 + 七礁 + 暗梁渡口 + 双桥头堡 + 六座以上水力锻锤', () => {
    const project = projectOf('palong');
    expect(project.reefs.length).toBe(7);
    expect(project.fords.length).toBeGreaterThanOrEqual(1);
    expect(project.watermills.length).toBeGreaterThanOrEqual(6);
    const fortified = project.bridgeOverrides.filter((item) => item.style === 'fortified_twin');
    expect(fortified.length).toBeGreaterThanOrEqual(1);

    const field = buildElevationField(project);
    expect(field.maxElev - field.minElev).toBeGreaterThan(120);
    const scene = sceneOf(project);
    const twin = scene.hydro.bridges.find((bridge) => bridge.style === 'fortified_twin');
    expect(twin).toBeDefined();
    expect(twin?.forts?.length).toBe(2);
    expect(scene.hydraulic.watermills.length).toBeGreaterThanOrEqual(6);
    const valleyRibbons = project.zones.filter(
      (zone) => zone.contentType === 'village' && zone.ribbonSpine.length >= 2,
    );
    expect(valleyRibbons.length).toBeGreaterThanOrEqual(6);
  });
});

describe('V3-S3.4 · 9 张无头 SVG 视觉预览落盘', () => {
  it('standard / guided / pure 三模式 × 三工程全部生成且 SVG 合法闭合', () => {
    if (!existsSync(PREVIEW_DIR)) mkdirSync(PREVIEW_DIR, { recursive: true });
    const written: string[] = [];
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = projectOf(key);
      const scene = sceneOf(project);
      for (const mode of ['standard', 'guided', 'pure'] as const) {
        const svg = renderSceneToSvgString(project, scene, {
          mode: mode === 'pure' ? 'pure' : 'full',
          basePx: 1200,
          displayMode: mode,
        });
        const file = join(PREVIEW_DIR, `${key}_${mode}.svg`);
        writeFileSync(file, svg, 'utf8');
        written.push(file);
        const head = svg.trimStart();
        expect(head.startsWith('<svg') || head.startsWith('<?xml'), `${key}/${mode}`).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>'), `${key}/${mode}`).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg.length, `${key}/${mode}`).toBeGreaterThan(20 * 1024);
      }
      const guided = readFileSync(join(PREVIEW_DIR, `${key}_guided.svg`), 'utf8');
      expect(guided).toContain('方志导览');
      const pure = readFileSync(join(PREVIEW_DIR, `${key}_pure.svg`), 'utf8');
      expect(pure.includes('layer-cartouche')).toBe(false);
    }
    expect(written).toHaveLength(9);
    for (const file of written) expect(statSync(file).size).toBeGreaterThan(20 * 1024);
    console.log(`[V3-S3.4] 9 张预览已落盘 ${PREVIEW_DIR}`);
  }, 300000);
});
