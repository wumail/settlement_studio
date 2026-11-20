import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { compileSettlementScene } from '../src/core/compileScene';
import { buildStructureFootprint, buildCustomStructures } from '../src/core/generators/customStructures';
import { buildSpatialRadar } from '../src/ai/spatialBrief';
import { createPresetProject } from '../src/schema/presets';
import { canopyLobes } from '../src/renderer/canopyLobes';
import { mixHex } from '../src/renderer/paintContext';
import { getActivePalette } from '../src/schema/palette.schema';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import { paintScene } from '../src/renderer/paintScene';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';
import { createViewport } from '../src/renderer/RenderBackend';
import { computePolygonAreaSigned, pointInPolygon } from '../src/core/math/polygon';

type Pt = readonly [number, number];

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, out);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function ring(cx: number, cy: number, r: number, sides: number, ry = 0.94): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = Math.PI / sides + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * ry] as const;
  });
}

function skewedTown(): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: '斜交关厢' },
    terrain: { baseElev: 410, slopeMagM: 4, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.2 },
    roads: [{ id: 'rh', name: '斜官道', tier: 'highway', points: [[120, 1180], [1480, 620]], widthM: 11 }],
    zones: [{
      id: 'town', name: '斜交关厢', contentType: 'town_blocks', seed: 5, density: 0.8,
      points: [[420, 420], [1180, 340], [1320, 760], [1080, 1180], [460, 1080]],
    }],
  });
}

function isSkewedFootprint(points: ReadonlyArray<Pt>): boolean {
  return points.some((a, i) => {
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    if (!b || !c) return false;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    return Math.abs((ux * vx + uy * vy) / Math.max(1e-9, Math.hypot(ux, uy) * Math.hypot(vx, vy))) > 0.12;
  });
}

function obbAspect(pts: ReadonlyArray<Pt>): number {
  let minAspect = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [px, py] of pts) {
      const u = px * ux + py * uy;
      const v = -px * uy + py * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const w = maxU - minU;
    const h = maxV - minV;
    if (w > 1e-6 && h > 1e-6) minAspect = Math.min(minAspect, Math.max(w, h) / Math.min(w, h));
  }
  return minAspect;
}

describe('V6-1 · Watabou 有机街区肌理与零 Voronoi 负空间巷道', () => {
  it('斜交关厢产出三档重尾屋面、街角梯形/楔形贴角，且零穿模', () => {
    const project = skewedTown();
    const scene = compileSettlementScene(project);
    const buildings = scene.zones[0]?.buildings ?? [];
    expect(buildings.length).toBeGreaterThan(120);
    const areas = buildings.map((b) => Math.abs(computePolygonAreaSigned(b.points)));
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(2.6);
    expect(areas.some((a) => a < 85)).toBe(true);
    expect(areas.some((a) => a > 145)).toBe(true);
    expect(buildings.filter((b) => isSkewedFootprint(b.points)).length).toBeGreaterThan(10);
    expect(buildings.filter((b) => b.points.length >= 5).length).toBeGreaterThan(3);
    expect(scene.collisionReport.totalHits).toBe(0);
  });

  it('losrumura 满足零 Voronoi、反火柴棍、S/M/L 面积层级与稀疏庭院树', () => {
    const townBlocksSrc = readFileSync(join(process.cwd(), 'src/core/generators/townBlocks.ts'), 'utf8');
    expect(townBlocksSrc.includes('computeVoronoiCells')).toBe(false);
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    const urbanZones = scene.zones.filter((z) => z.contentType === 'walled_city' || z.contentType === 'residential');
    const urbanBuildings = urbanZones.flatMap((z) => z.buildings);
    expect(urbanBuildings.length).toBeGreaterThan(400);
    const compactCount = urbanBuildings.filter((b) => obbAspect(b.points) <= 2.4).length;
    expect(compactCount / urbanBuildings.length).toBeGreaterThanOrEqual(0.93);
    const inner = scene.zones.find((z) => z.contentType === 'walled_city');
    expect(inner).toBeTruthy();
    if (!inner) return;
    const innerAreas = inner.buildings.map((b) => Math.abs(computePolygonAreaSigned(b.points))).sort((a, b) => a - b);
    const p10 = innerAreas[Math.floor(innerAreas.length * 0.1)] ?? 1;
    const p90 = innerAreas[Math.floor(innerAreas.length * 0.9)] ?? 1;
    expect(p90 / p10).toBeGreaterThanOrEqual(2.4);
    expect(inner.buildings.filter((b) => b.points.length >= 5).length).toBeGreaterThan(15);
    expect(inner.trees.length).toBeLessThan(0.3 * inner.buildings.length);
  });
});

describe('V6-2 · 合院原语与翼楼物理进深硬约束', () => {
  it('60×48 courtyard 产出院坪/院墙/正堂/多栋厢房，且民房零侵入', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '客舍大院' },
      terrain: { baseElev: 400, slopeMagM: 3, terrainNoiseAmpM: 1.2 },
      zones: [{ id: 'town', name: '关厢', contentType: 'town_blocks', seed: 9, points: [[260, 260], [1340, 260], [1340, 1340], [260, 1340]] }],
      structures: [{ id: 'inn', name: '客舍大院', x: 800, y: 800, angleDeg: 18, widthM: 60, depthM: 48, kind: 'courtyard', roofKind: 'citadel' }],
    });
    const built = buildCustomStructures(project)[0];
    expect(built).toBeTruthy();
    if (!built) return;
    expect(built.yardPolygon).toBeTruthy();
    expect(built.wallPolylines?.length).toBe(1);
    expect(built.extraPolygons?.length ?? 0).toBeGreaterThanOrEqual(2);
    for (const pts of [built.polygon, ...(built.extraPolygons ?? []).map((item) => item.polygon)]) {
      const shortest = Math.min(...pts.map((a, i) => {
        const b = pts[(i + 1) % pts.length];
        return b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Infinity;
      }));
      expect(shortest).toBeLessThanOrEqual(13.5);
    }
    const scene = compileSettlementScene(project);
    const yard = built.yardPolygon ?? [];
    for (const building of scene.buildings) expect(pointInPolygon(building.centroid[0], building.centroid[1], yard)).toBe(false);
    expect(scene.collisionReport.totalHits).toBe(0);
  });

  it('80×64 u_court 翼楼厚度 <= 12.5m，且雷达告警建议改用 courtyard', () => {
    const footprint = buildStructureFootprint('u_court', 800, 800, 80, 64, 0);
    const xs = [...new Set(footprint.map((p) => Math.round(p[0] * 1000) / 1000))].sort((a, b) => a - b);
    const thickness = (xs[xs.length - 1] ?? 0) - (xs[xs.length - 2] ?? 0);
    expect(thickness).toBeGreaterThan(0);
    expect(thickness).toBeLessThanOrEqual(12.5);
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '巨型三合院' },
      terrain: { baseElev: 400, slopeMagM: 3, terrainNoiseAmpM: 1.2 },
      zones: [{ id: 'keep', name: '堡寨', contentType: 'citadel', seed: 4, points: [[420, 420], [1180, 420], [1180, 1180], [420, 1180]] }],
      structures: [{ id: 'hall', name: '议事大堂', x: 800, y: 800, angleDeg: 0, widthM: 80, depthM: 64, kind: 'u_court', roofKind: 'citadel' }],
    });
    const brief = buildSpatialRadar(project, compileSettlementScene(project));
    expect(brief.warnings.some((line) => line.includes('courtyard'))).toBe(true);
  });
});

describe('V6-3 · 场坪 plain / enclosure 导出态', () => {
  const build = (plainStyle: 'plain' | 'enclosure'): TownProject => normalizeProject({
    meta: { worldSizeM: 1200, name: '场坪' },
    terrain: { baseElev: 400, slopeMagM: 2, terrainNoiseAmpM: 0 },
    zones: [{ id: 'yard', name: '候装坪', contentType: 'exclusion', points: ring(600, 600, 150, 9), seed: 2, exclusionStyle: plainStyle }],
  });
  const landLayer = (svg: string): string =>
    svg.slice(svg.indexOf('<g id="layer-land-plots">'), svg.indexOf('<g id="layer-water-bodies">'));

  it('plain 导出态彻底无痕；编辑态仅 0.28 极淡辅助虚线', () => {
    const project = build('plain');
    const scene = compileSettlementScene(project);
    const exported = landLayer(renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 }));
    expect(exported.includes('stroke-dasharray="7 6"')).toBe(false);
    const backend = new SvgStringBackend(900, 900);
    paintScene(backend, project, scene, createViewport(900, 900, project.meta.worldSizeM, 1), {});
    const editing = landLayer(backend.toSvgString());
    expect(editing.includes('stroke-dasharray="7 6"')).toBe(true);
    expect(editing.includes('opacity="0.28"')).toBe(true);
  });

  it('enclosure 输出淡暖土铺地 + 细实线矮墙边（零虚线）', () => {
    const project = build('enclosure');
    const pal = getActivePalette(project.palette);
    const scene = compileSettlementScene(project);
    const exported = landLayer(renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 }));
    expect(exported).toContain(mixHex(pal.roadFill, pal.farmlandFill, 0.45));
    expect(exported.includes('stroke-dasharray')).toBe(false);
  });
});

describe('V6-4 · 多瓣云朵树冠与林地团簇', () => {
  const lone = normalizeProject({
    meta: { worldSizeM: 1200, name: '独木' },
    terrain: { baseElev: 400, slopeMagM: 2, terrainNoiseAmpM: 0 },
    paintedTrees: [{ id: 't1', x: 600, y: 600, r: 5.5, kind: 'woodland' }],
  });

  const treeLayer = (svg: string): string =>
    svg.slice(svg.indexOf('<g id="layer-trees-canopy">'), svg.indexOf('<g id="layer-landmarks-labels">'));

  it('单棵 r=5.5m 树展开为 1 核 + 4 瓣（≥5 段圆弧基元）且三遍同批', () => {
    const scene = compileSettlementScene(lone);
    expect(scene.trees).toHaveLength(1);
    const svg = renderSceneToSvgString(lone, scene, { mode: 'clean', basePx: 900 });
    const block = treeLayer(svg);
    expect(block.match(/<g fill="/g)?.length).toBe(3);
    const arcs = block.match(/<circle /g)?.length ?? 0;
    expect(arcs % 3).toBe(0);
    // 1 核 + 4 瓣 = 5 段圆弧基元/遍，远超旧版单圆
    expect(arcs / 3).toBeGreaterThanOrEqual(5);
  });

  it('树冠展开确定性：同坐标两次渲染逐字一致，不同坐标必然分瓣不同', () => {
    const a = canopyLobes({ x: 600, y: 600, r: 5.5 });
    const b = canopyLobes({ x: 600, y: 600, r: 5.5 });
    const c = canopyLobes({ x: 640, y: 600, r: 5.5 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThanOrEqual(5);
    for (const lobe of a) {
      const off = Math.hypot(lobe.x - 600, lobe.y - 600);
      expect(off + lobe.r).toBeLessThanOrEqual(5.5 * 1.08 + 1e-6);
    }
    expect(canopyLobes({ x: 600, y: 600, r: 2.4 }).length).toBeGreaterThanOrEqual(3);
  });

  it('woodland 选区输出林下底色多边形且树冠成簇交叠', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1200, name: '林团' },
      terrain: { baseElev: 400, slopeMagM: 2, terrainNoiseAmpM: 0 },
      zones: [{ id: 'wd', name: '南坡疏林', contentType: 'woodland', points: ring(600, 600, 220, 9), seed: 4 }],
    });
    const pal = getActivePalette(project.palette);
    const scene = compileSettlementScene(project);
    const trees = scene.zones[0]?.trees ?? [];
    expect(trees.length).toBeGreaterThan(120);
    const fused = trees.filter((tree) =>
      trees.some((other) => other !== tree && Math.hypot(other.x - tree.x, other.y - tree.y) < 0.85 * (tree.r + other.r)),
    ).length;
    expect(fused / trees.length).toBeGreaterThan(0.7);
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 });
    const land = svg.slice(svg.indexOf('<g id="layer-land-plots">'), svg.indexOf('<g id="layer-water-bodies">'));
    expect(land).toContain(mixHex(pal.treeFill, pal.paperBg, 0.72));
  });
});

describe('V6-5 · 分级字标排版', () => {
  it('plain 留白区导出态不出选区名，编辑态仍保留', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1200, name: '留白' },
      terrain: { baseElev: 400, slopeMagM: 2, terrainNoiseAmpM: 0 },
      zones: [{ id: 'blank', name: '素地留白', contentType: 'exclusion', points: ring(600, 600, 160, 8), seed: 2, exclusionStyle: 'plain' }],
    });
    const scene = compileSettlementScene(project);
    expect(renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 })).not.toContain('素地留白');
    const backend = new SvgStringBackend(900, 900);
    paintScene(backend, project, scene, createViewport(900, 900, project.meta.worldSizeM, 1), {});
    expect(backend.toSvgString()).toContain('素地留白');
  });

  it('>=1.8ha 大街区用 12–14.5px 宽字距暗标，小选区仍是 10.5px 小注', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 2400, name: '字标' },
      terrain: { baseElev: 400, slopeMagM: 2, terrainNoiseAmpM: 0 },
      zones: [
        { id: 'big', name: '东街铺宅', contentType: 'town_blocks', points: ring(700, 700, 260, 10), seed: 6 },
        { id: 'hut', name: '南阜小集', contentType: 'market', points: ring(1700, 1700, 60, 8), seed: 3 },
      ],
    });
    const pal = getActivePalette(project.palette);
    const svg = renderSceneToSvgString(project, compileSettlementScene(project), { mode: 'clean', basePx: 1200 });
    expect(svg).toContain('东\u2009街\u2009铺\u2009宅');
    const size = Number(svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>东\u2009街/)?.[1] ?? 0);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(size).toBeLessThanOrEqual(14.5);
    expect(svg).toContain(mixHex(pal.inkDark, pal.paperBg, 0.32));
    expect(svg).toContain('>南阜小集</text>');
  });
});

describe('V6 · 全栈回归与行数门禁', () => {
  it('三套预设与 D203 零穿模零回归', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const scene = compileSettlementScene(createPresetProject(key));
      expect(scene.collisionReport.totalHits, key).toBe(0);
      expect(scene.buildings.length, key).toBeGreaterThan(60);
      expect(scene.trees.length, key).toBeGreaterThan(80);
    }
    const d203 = normalizeProject(
      JSON.parse(readFileSync(join(process.cwd(), 'projects/D203_灰山口与囚禁魔营地.worldtown.json'), 'utf8')),
    );
    const scene = compileSettlementScene(d203);
    expect(scene.collisionReport.totalHits).toBe(0);
    expect(buildSpatialRadar(d203, scene).warnings).toHaveLength(0);
  });

  it('src 全量单文件 <= 320 行，关键模块无 any / TODO / Math.random', () => {
    const files = walkSources(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(120);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.split('\n').length, `${file} 超 320 行`).toBeLessThanOrEqual(320);
      for (const bad of [': any', 'as any', '@ts-ignore', 'TODO', 'FIXME']) {
        expect(text.includes(bad), `${file} 含 ${bad}`).toBe(false);
      }
    }
    const renderer = readFileSync(join(process.cwd(), 'src/renderer/paintLand.ts'), 'utf8');
    expect(renderer.includes('Math.random(')).toBe(false);
  });
});
