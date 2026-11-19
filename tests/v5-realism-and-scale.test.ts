import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { createPresetProject } from '../src/schema/presets';
import { compileSettlementScene, rerollZoneScene } from '../src/core/compileScene';
import {
  buildElevationField,
  sampleElevation,
  sampleSlopeDeg,
} from '../src/core/terrain/elevationField';
import {
  createMacroReliefEvaluator,
  resolveMacroReliefAmp,
  resolveValleyCarveRatio,
} from '../src/core/terrain/terrainNoise';
import { evalBaseSlope, evalRiverCarve } from '../src/core/terrain/terrainPrimitives';
import { extractSupplementaryContours } from '../src/core/terrain/supplementaryContours';
import { computePolygonAreaSigned, computePolygonCentroid, pointInPolygon } from '../src/core/math/polygon';
import { clearsPolyline, pointToPolylineDist, polygonRadiusOf } from '../src/core/obstacles/collisionAudit';
import { subdivideFarmlandStrips } from '../src/core/generators/farmlandStrips';
import { createRng } from '../src/core/math/rng';
import { buildSpatialRadar } from '../src/ai/spatialBrief';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';

type Pt = readonly [number, number];

/** 确定性正多边形选区：ryFactor 压扁成略有机的椭圆，phase 避免轴对齐 */
function ring(cx: number, cy: number, r: number, sides: number, ryFactor = 0.94): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < sides; i += 1) {
    const ang = Math.PI / sides + (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * ryFactor]);
  }
  return out;
}

/** 按目标公顷数反解正多边形外接半径（含 ryFactor 压扁），保证选区面积精确可预期 */
function ringForArea(cx: number, cy: number, areaHa: number, sides: number, ryFactor = 0.94): Pt[] {
  const target = areaHa * 10000;
  const r = Math.sqrt(target / (0.5 * sides * Math.sin((2 * Math.PI) / sides) * ryFactor));
  return ring(cx, cy, r, sides, ryFactor);
}

function polygonAreaHa(points: ReadonlyArray<Pt>): number {
  return Math.abs(computePolygonAreaSigned(points.map(([x, y]) => [x, y] as [number, number]))) / 10000;
}

/** 条田四重守卫生效性：顶点 + 边中点逐点复检（不依赖生成器内部缓存） */
function plotSamplePoints(poly: ReadonlyArray<Pt>): Pt[] {
  const out: Pt[] = [...poly];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a && b) out.push([(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]);
  }
  return out;
}

function walkFiles(dir: string, ext: ReadonlyArray<string>, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, ext, out);
    else if (ext.some((suffix) => entry.name.endsWith(suffix))) out.push(full);
  }
  return out;
}

describe('T1 · 纯解析地形零漂移（V5-BG-01）', () => {
  const project = normalizeProject({
    meta: { worldSizeM: 2400, name: '纯斜坡' },
    terrain: { baseElev: 420, slopeMagM: 16, slopeDirDeg: 315, terrainNoiseAmpM: 0, contourStep: 5 },
    rivers: [{ id: 'r1', points: [[0, 1200], [2400, 1200]], widthStartM: 60, widthEndM: 60, carveDepthM: 8 }],
  });

  it('terrainNoiseAmpM: 0 且未显式赋值时两解析器归零', () => {
    expect(resolveMacroReliefAmp(project.terrain)).toBe(0);
    expect(resolveValleyCarveRatio(project.terrain)).toBe(0);
    expect(project.terrain.macroReliefAmpM).toBeUndefined();
    expect(project.terrain.valleyCarveRatio).toBeUndefined();
  });

  it('纯斜坡高程与 baseElev + evalBaseSlope 逐格 float32 精确一致', () => {
    const field = buildElevationField(project);
    const world = project.meta.worldSizeM;
    let maxErr = 0;
    for (let gy = 0; gy < field.gridN; gy += 5) {
      const y = gy * field.cellSizeM;
      // 河床 2.2×halfW（66m）内允许下切，纯解析对比只取干河床影响域之外
      if (Math.abs(y - 1200) < 90) continue;
      for (let gx = 0; gx < field.gridN; gx += 5) {
        const x = gx * field.cellSizeM;
        const expected = Math.fround(420 + evalBaseSlope(x, y, world, 16, 315));
        const actual = field.elevation[gy * field.gridN + gx] ?? Number.NaN;
        maxErr = Math.max(maxErr, Math.abs(actual - expected));
      }
    }
    expect(maxErr).toBeLessThan(1e-6);
    expect(field.maxElev - field.minElev).toBeGreaterThan(10);
  });

  it('evalRiverCarve 默认 valleyRatio = 0：3×halfW 处精确返回 0', () => {
    const halfW = 0.5 * 60;
    expect(evalRiverCarve(project.rivers, 1200, 1200)).toBeGreaterThan(7.9);
    expect(evalRiverCarve(project.rivers, 1200, 1200 - 3 * halfW)).toBe(0);
    expect(evalRiverCarve(project.rivers, 1200, 1200 - 2.2 * halfW)).toBe(0);
  });
});

describe('T2 · 全幅连续起伏与宽河谷（V5-BG-02）', () => {
  const project = normalizeProject({
    meta: { worldSizeM: 2400, name: '平原长波' },
    terrain: { baseElev: 420, slopeMagM: 8, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.6 },
    rivers: [
      { id: 'r_main', points: [[-120, 1450], [1200, 1390], [2520, 1460]], widthStartM: 64, widthEndM: 76, carveDepthM: 9 },
    ],
  });

  it('宏观起伏项本身附加坡度 < 2°', () => {
    const macro = createMacroReliefEvaluator(resolveMacroReliefAmp(project.terrain), 2400, project.terrain.terrainSeed);
    const h = 12;
    let maxSlope = 0;
    for (let y = 0; y <= 2400; y += 48) {
      for (let x = 0; x <= 2400; x += 48) {
        const gx = (macro(x + h, y) - macro(x - h, y)) / (2 * h);
        const gy = (macro(x, y + h) - macro(x, y - h)) / (2 * h);
        maxSlope = Math.max(maxSlope, (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI);
      }
    }
    expect(maxSlope).toBeLessThan(2);
  });

  it('远离河谷的平原采样点坡度全部 < 3.5°', () => {
    const field = buildElevationField(project);
    let samples = 0;
    for (let y = 80; y < 2400; y += 137) {
      for (let x = 80; x < 2400; x += 149) {
        if (pointToPolylineDist(x, y, project.rivers[0]?.points ?? []) < 420) continue;
        samples += 1;
        expect(sampleSlopeDeg(field, x, y), `(${x},${y})`).toBeLessThan(3.5);
      }
    }
    expect(samples).toBeGreaterThan(40);
  });

  it('合并等高线覆盖全幅 4 象限', () => {
    const scene = compileSettlementScene(project);
    const quadrants = new Set<string>();
    for (const contour of scene.terrain.contours) {
      for (const p of contour.points) quadrants.add(`${p[0] < 1200 ? 'W' : 'E'}${p[1] < 1200 ? 'N' : 'S'}`);
    }
    expect([...quadrants].sort()).toEqual(['EN', 'ES', 'WN', 'WS']);
    expect(scene.terrain.contours.length).toBeGreaterThan(8);
  });

  it('河岸外 1.5×width 处显著低于 6×width 外平原（宽河谷汇水微凹）', () => {
    const field = buildElevationField(project);
    const width = 70;
    const near = sampleElevation(field, 1200, 1390 + 1.5 * width);
    const far = sampleElevation(field, 1200, 1390 + 6 * width);
    expect(far - near).toBeGreaterThan(2);
  });

  it('水文峡谷下切：河流穿过正山脊时彻底切穿河道核心，河心严低于两岸山坡', () => {
    const gorge = normalizeProject({
      meta: { worldSizeM: 1800, name: '峡口验证' },
      terrain: {
        baseElev: 450,
        slopeMagM: 12,
        slopeDirDeg: 90,
        contourStep: 4,
        terrainNoiseAmpM: 1.6,
        valleyCarveRatio: 6,
        shapes: [
          {
            id: 'r_cross',
            type: 'ridge',
            points: [[900, 100], [900, 1700]],
            deltaElev: 80,
            widthLeft: 260,
            widthRight: 260,
          },
        ],
      },
      rivers: [
        { id: 'rv', points: [[0, 900], [1800, 900]], widthStartM: 48, widthEndM: 52, carveDepthM: 9 },
      ],
    });
    const field = buildElevationField(gorge);
    const bed = sampleElevation(field, 900, 900);
    const northSlope = sampleElevation(field, 900, 900 - 140);
    const southSlope = sampleElevation(field, 900, 900 + 140);
    expect(northSlope - bed).toBeGreaterThan(25);
    expect(southSlope - bed).toBeGreaterThan(25);
    expect(bed).toBeLessThan(460);
  });
});

describe('T3 · 缓坡间曲线与裁水（V5-BG-03）', () => {
  const build = (patch: Record<string, unknown> = {}): TownProject =>
    normalizeProject({
      meta: { worldSizeM: 1800, name: '平原陡山' },
      terrain: {
        baseElev: 380, slopeMagM: 4, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.4,
        shapes: [{ id: 'hill', type: 'hill', cx: 980, cy: 900, rx: 320, ry: 290, angleDeg: 12, deltaElev: 95, focusX: 0.2, focusY: -0.2 }],
        ...patch,
      },
      rivers: [{ id: 'r1', points: [[-80, 620], [1800, 700]], widthStartM: 44, widthEndM: 44, carveDepthM: 6 }],
    });

  it('缓坡保留间曲线、陡山（> 20°）零间曲线，关闭开关后归零', () => {
    const project = build();
    const scene = compileSettlementScene(project);
    const field = scene.terrain.terrainData;
    const supp = scene.terrain.contours.filter((c) => c.isSupplementary);
    expect(supp.length).toBeGreaterThan(0);
    expect(extractSupplementaryContours(field, project.terrain).length).toBeGreaterThan(0);
    let steepPts = 0;
    for (const contour of supp) {
      expect(contour.isIndex).toBe(false);
      for (const p of contour.points) {
        const slope = sampleSlopeDeg(field, p[0], p[1]);
        expect(slope).toBeLessThanOrEqual(project.terrain.supplementaryMaxSlopeDeg + 1.0);
        if (slope > 20) steepPts += 1;
      }
    }
    expect(steepPts).toBe(0);
    const off = compileSettlementScene(build({ showSupplementaryContours: false }));
    expect(off.terrain.contours.filter((c) => c.isSupplementary)).toHaveLength(0);
  });

  it('SVG 含细虚线间曲线、无额外高程字、河面内零穿越', () => {
    const project = build();
    const scene = compileSettlementScene(project);
    const basePx = 1000;
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx });
    const block = svg.slice(svg.indexOf('<g id="layer-contours">'), svg.indexOf('<g id="layer-landmarks-labels">'));
    expect(block.match(/stroke-dasharray="5 4"/g)?.length ?? 0).toBeGreaterThan(0);
    const bank = scene.hydro.rivers[0]?.bankPolygon;
    expect(bank).toBeDefined();
    if (!bank) return;
    const scale = project.meta.worldSizeM / basePx;
    let total = 0;
    for (const m of block.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)) {
      total += 1;
      const wx = Number(m[1]) * scale;
      const wy = Number(m[2]) * scale;
      expect(pointInPolygon(wx, wy, bank), `(${wx.toFixed(0)},${wy.toFixed(0)}) 落水`).toBe(false);
    }
    expect(total).toBeGreaterThan(60);
    for (const m of block.matchAll(/<text[^>]*x="([\d.-]+)" y="([\d.-]+)"/g)) {
      expect(pointInPolygon(Number(m[1]) * scale, Number(m[2]) * scale, bank)).toBe(false);
    }
  });
});

describe('T4 · 自然条田去 Voronoi 与零侵障（V5-BG-04）', () => {
  const zonesFor = (frayOuter: boolean): Array<Record<string, unknown>> => [
    { id: 'farm', name: '河阶条田', contentType: 'farmland', points: [[420, 300], [1180, 340], [1210, 900], [900, 1010], [430, 940]], seed: 17, frayOuter, maxSlopeDeg: 20 },
    { id: 'ex_camp', name: '环石空地', contentType: 'exclusion', points: ring(1000, 520, 46, 8), seed: 3, exclusionStyle: 'plague_stones' },
  ];
  const build = (frayOuter: boolean): TownProject =>
    normalizeProject({
      meta: { worldSizeM: 1600, name: '条田试作' },
      terrain: { baseElev: 420, slopeMagM: 5, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.5 },
      rivers: [{ id: 'r1', points: [[520, -80], [700, 420], [820, 900], [980, 1620]], widthStartM: 26, widthEndM: 34, carveDepthM: 5 }],
      canals: [{ id: 'c1', name: '灌渠', style: 'irrigation', points: [[430, 620], [1180, 660]], widthM: 5 }],
      roads: [{ id: 'rd1', name: '沿河官道', tier: 'highway', points: [[400, 880], [1200, 820]], widthM: 11 }],
      zones: zonesFor(frayOuter),
    });

  it('条田合法面积/四阶色差/多向耕垄，且顶点与边中点零压水压路压渠压禁建圈', () => {
    const project = build(true);
    expect(polygonAreaHa(project.zones[0]?.points ?? [])).toBeGreaterThan(30);
    const scene = compileSettlementScene(project);
    const plots = scene.farmlandPlots;
    expect(plots.length).toBeGreaterThan(30);
    expect(scene.collisionReport.passed).toBe(true);
    const tones = new Set<number>();
    const angles = new Set<number>();
    const river = scene.hydro.rivers[0]?.bankPolygon;
    const banks = [
      ...(river ? [river] : []),
      ...scene.hydro.waterBodies.map((body) => body.shorePoly),
    ];
    for (const plot of plots) {
      const tone = plot.toneShift ?? 0;
      expect(tone).toBeGreaterThanOrEqual(-1);
      expect(tone).toBeLessThanOrEqual(1);
      tones.add(tone < -0.35 ? 0 : tone < 0.15 ? 1 : tone < 0.55 ? 2 : 3);
      angles.add(Math.round(plot.angleDeg / 15));
      const ha = Math.abs(computePolygonAreaSigned(plot.innerPolygon)) / 10000;
      expect(ha).toBeGreaterThanOrEqual(0.09);
      expect(ha).toBeLessThanOrEqual(1.2);
      expect(plot.furrows.length).toBeGreaterThan(0);
      for (const [x, y] of plotSamplePoints(plot.innerPolygon)) {
        for (const bank of banks) expect(pointInPolygon(x, y, bank)).toBe(false);
        for (const poly of scene.exclusionPolys) expect(pointInPolygon(x, y, poly)).toBe(false);
      }
      // 整边几何硬校验（严防 60–90m 长边在顶点与中点间被窄路/明渠横穿）
      const c = computePolygonCentroid(plot.innerPolygon);
      const r = polygonRadiusOf(plot.innerPolygon, c);
      for (const road of scene.hydro.roads) {
        expect(clearsPolyline(plot.innerPolygon, c, r, road.centerline, 0.5 * road.widthM)).toBe(true);
      }
      for (const canal of scene.hydro.canals) {
        expect(clearsPolyline(plot.innerPolygon, c, r, canal.centerline, 0.5 * canal.widthM)).toBe(true);
      }
    }
    expect(tones.size).toBe(4);
    expect(angles.size).toBeGreaterThan(3);
  });

  it('frayOuter 凸边界真实内缩退让（retreatFromBoundary 生效）且外缘条田更疏朗', () => {
    const frayed = compileSettlementScene(build(true));
    const solid = compileSettlementScene(build(false));
    const sum = (items: ReadonlyArray<{ innerPolygon: ReadonlyArray<Pt> }>): number =>
      items.reduce((acc, item) => acc + Math.abs(computePolygonAreaSigned(item.innerPolygon.map(([x, y]) => [x, y] as [number, number]))), 0);
    expect(frayed.farmlandPlots.length).toBeLessThanOrEqual(solid.farmlandPlots.length);
    expect(sum(frayed.farmlandPlots)).toBeLessThan(sum(solid.farmlandPlots));
    // 矩形凸边界专项验证：被标为 perimeter 的外缘块中必须有实际退离外框 >= 3.5m 的块
    const rectZone: [number, number][] = [[200, 200], [1000, 200], [1000, 800], [200, 800]];
    const ring = [...rectZone, rectZone[0]!];
    const field = buildElevationField(build(true));
    const { strips } = subdivideFarmlandStrips({
      zonePolygon: rectZone,
      frayOuter: true,
      rng: createRng(17),
      elevationField: field,
      roads: [],
      canals: [],
    });
    const perim = strips.filter((s) => s.isPerimeter);
    const retreated = perim.filter((s) =>
      s.polygon.every((p) => pointToPolylineDist(p[0], p[1], ring) >= 3.5),
    );
    expect(perim.length).toBeGreaterThan(10);
    expect(retreated.length).toBeGreaterThan(0);
  });

  it('farmland.ts 源码零 computeVoronoiCells 引用', () => {
    const source = readFileSync(join(process.cwd(), 'src/core/generators/farmland.ts'), 'utf8');
    expect(source.includes('computeVoronoiCells')).toBe(false);
    expect(source.includes('subdivideFarmlandStrips')).toBe(true);
  });
});

describe('T5 · 城镇真实人类比例与重抽性能（V5-BG-05）', () => {
  const build = (scale: number): TownProject =>
    normalizeProject({
      meta: { worldSizeM: 1800, name: '边镇' },
      terrain: { baseElev: 400, slopeMagM: 4, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.4 },
      roads: [{ id: 'rh', name: '官道', tier: 'highway', points: [[80, 900], [1720, 900]], widthM: 12 }],
      zones: [
        { id: 'zw', name: '边镇', contentType: 'walled_city', points: ringForArea(900, 900, 20, 13), seed: 21, density: 0.88, streetWidthM: 8, wallThicknessM: 6, buildingScale: scale },
      ],
    });

  it('20 ha walled_city 产出 240–520 栋、均面积 80–260 m²、零穿模', () => {
    const project = build(1);
    expect(polygonAreaHa(project.zones[0]?.points ?? [])).toBeGreaterThanOrEqual(19.5);
    expect(polygonAreaHa(project.zones[0]?.points ?? [])).toBeLessThanOrEqual(21);
    const scene = compileSettlementScene(project);
    const buildings = scene.zones[0]?.buildings ?? [];
    expect(buildings.length).toBeGreaterThanOrEqual(240);
    expect(buildings.length).toBeLessThanOrEqual(520);
    const mean = buildings.reduce((acc, b) => acc + b.areaM2, 0) / buildings.length;
    expect(mean).toBeGreaterThanOrEqual(80);
    expect(mean).toBeLessThanOrEqual(260);
    expect(scene.collisionReport.totalHits).toBe(0);
    expect(scene.collisionReport.passed).toBe(true);
  });

  it('buildingScale 0.7 后单栋平均占地显著缩小，且单区重抽 < 250 ms', () => {
    const base = build(1);
    const baseScene = compileSettlementScene(base);
    const big = baseScene.zones[0]?.buildings ?? [];
    const meanBig = big.reduce((acc, b) => acc + b.areaM2, 0) / big.length;
    const smallScene = compileSettlementScene(build(0.7));
    const small = smallScene.zones[0]?.buildings ?? [];
    const meanSmall = small.reduce((acc, b) => acc + b.areaM2, 0) / Math.max(1, small.length);
    expect(meanSmall).toBeLessThan(meanBig * 0.72);
    rerollZoneScene(base, 'zw', baseScene);
    let best = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 2; round += 1) {
      const started = performance.now();
      const result = rerollZoneScene(base, 'zw', baseScene);
      best = Math.min(best, performance.now() - started);
      expect(result.scene.zones[0]?.buildings.length).toBeGreaterThan(200);
    }
    console.log(`[T5] 20 ha 边镇重抽 ${best.toFixed(1)}ms（实机目标 < 80ms）`);
    expect(best).toBeLessThan(250);
  });
});

describe('T6 · 迷你营地紧凑排布（V5-BG-06）', () => {
  const project = normalizeProject({
    meta: { worldSizeM: 900, name: '猎人营地' },
    terrain: { baseElev: 400, slopeMagM: 2, slopeDirDeg: 300, contourStep: 5, terrainNoiseAmpM: 1.2 },
    zones: [
      { id: 'zc', name: '猎人营舍', contentType: 'village', points: ringForArea(450, 450, 0.55, 9), seed: 7, buildingScale: 0.72 },
      { id: 'zx', name: '环石空地', contentType: 'exclusion', points: ringForArea(450, 450, 0.16, 8, 1), seed: 1, exclusionStyle: 'plague_stones' },
    ],
  });

  it('0.55 ha 营地 + 0.16 ha 空地稳定产出 6–14 栋小木屋且零穿模', () => {
    const campHa = polygonAreaHa(project.zones[0]?.points ?? []);
    expect(campHa).toBeGreaterThanOrEqual(0.4);
    expect(campHa).toBeLessThanOrEqual(0.7);
    expect(polygonAreaHa(project.zones[1]?.points ?? [])).toBeGreaterThanOrEqual(0.14);
    const scene = compileSettlementScene(project);
    const buildings = scene.zones[0]?.buildings ?? [];
    expect(buildings.length).toBeGreaterThanOrEqual(6);
    expect(buildings.length).toBeLessThanOrEqual(14);
    const exclusion = scene.exclusionPolys[0];
    for (const building of buildings) {
      expect(building.areaM2).toBeGreaterThanOrEqual(25);
      expect(building.areaM2).toBeLessThanOrEqual(90);
      if (exclusion) expect(pointInPolygon(building.centroid[0], building.centroid[1], exclusion)).toBe(false);
    }
    expect(scene.collisionReport.totalHits).toBe(0);
    const brief = buildSpatialRadar(project, scene);
    expect(brief.zones.filter((zone) => zone.status === 'empty_warning')).toHaveLength(0);
    // 营地院树树冠严禁压盖任何营地木屋
    const campTrees = scene.zones[0]?.trees ?? [];
    for (const tree of campTrees) {
      for (const b of buildings) {
        const ring = b.points[0] ? [...b.points, b.points[0]] : b.points;
        expect(pointToPolylineDist(tree.x, tree.y, ring)).toBeGreaterThanOrEqual(tree.r);
      }
    }
  });

  it('迷你营地 buildingScale ∈ [0.45, 0.90) 真实单调生效，无死区', () => {
    const make = (scale: number) =>
      compileSettlementScene(
        normalizeProject({
          meta: { worldSizeM: 900, name: '尺度单调' },
          terrain: { baseElev: 400, slopeMagM: 2, contourStep: 5, terrainNoiseAmpM: 1.2 },
          zones: [
            { id: 'zc', name: '营舍', contentType: 'village', points: ringForArea(450, 450, 0.56, 9), seed: 7, buildingScale: scale },
          ],
        }),
      );
    const meanOf = (s: ReturnType<typeof make>) => {
      const bs = s.zones[0]?.buildings ?? [];
      return bs.reduce((acc, b) => acc + b.areaM2, 0) / Math.max(1, bs.length);
    };
    expect(meanOf(make(0.55))).toBeLessThan(meanOf(make(0.9)) * 0.72);
  });
});

describe('T7 · 通用比例告警与工程静态守卫（V5-BG-07）', () => {
  it('40 ha 单片农田触发拆分建议告警', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '大田告警' },
      terrain: { baseElev: 400, slopeMagM: 3, terrainNoiseAmpM: 1.2 },
      zones: [
        { id: 'big', name: '大片农田', contentType: 'farmland', points: [[100, 100], [1100, 120], [1120, 1080], [120, 1060]], seed: 3 },
      ],
    });
    const scene = compileSettlementScene(project);
    const brief = buildSpatialRadar(project, scene);
    expect(brief.warnings.some((line) => line.includes('农田') && line.includes('拆'))).toBe(true);
  });

  it('src 全量 <= 320 行、零 any 零 Math.random，且 AI/CLI/MCP/Skills 零世界观专名', () => {
    const root = process.cwd();
    const srcFiles = walkFiles(join(root, 'src'), ['.ts', '.tsx']);
    expect(srcFiles.length).toBeGreaterThan(120);
    let maxLines = 0;
    let maxFile = '';
    for (const file of srcFiles) {
      const lines = readFileSync(file, 'utf8').split('\n').length;
      if (lines > maxLines) {
        maxLines = lines;
        maxFile = file;
      }
      const text = readFileSync(file, 'utf8');
      expect(text.includes(': any'), `${file}`).toBe(false);
      expect(text.includes('as any'), `${file}`).toBe(false);
      expect(text.includes('@ts-ignore'), `${file}`).toBe(false);
      expect(text.includes('TODO'), `${file}`).toBe(false);
      expect(text.includes('FIXME'), `${file}`).toBe(false);
      if (file.includes('/core/') || file.includes('/ai/')) {
        expect(text.includes('Math.random('), `${file}`).toBe(false);
      }
    }
    expect(maxLines, `${maxFile} 超 320 行`).toBeLessThanOrEqual(320);
    expect(statSync(join(root, 'src/core/terrain/supplementaryContours.ts')).isFile()).toBe(true);
    const banned = ['设定/', '地图/', 'worldbuilding', 'TERRAX', 'Lōsrūmūra', '长湖', '帕隆', '灰山口', '囚禁魔', 'server.py'];
    const presetPattern = /losrumura|changhu|palong/i;
    const guardFiles = [
      ...walkFiles(join(root, 'src/ai'), ['.ts']),
      ...walkFiles(join(root, 'src/cli'), ['.ts']),
      ...walkFiles(join(root, 'src/mcp'), ['.ts']),
      ...walkFiles(join(root, '.agents/skills'), ['.md']),
    ];
    expect(guardFiles.length).toBeGreaterThan(20);
    for (const file of guardFiles) {
      const text = readFileSync(file, 'utf8');
      for (const token of banned) expect(text.includes(token), `${file} 含 ${token}`).toBe(false);
      expect(presetPattern.test(text), `${file} 含世界观预设名`).toBe(false);
    }
  });
});

describe('T8 · 三预设零回归与 D2-03 硬指标（V5-BG-08）', () => {
  it('三套受保护预设零穿模、屋宇/林木/等高线非空', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const scene = compileSettlementScene(createPresetProject(key));
      expect(scene.collisionReport.totalHits, key).toBe(0);
      expect(scene.collisionReport.passed, key).toBe(true);
      expect(scene.buildings.length, key).toBeGreaterThan(60);
      expect(scene.trees.length, key).toBeGreaterThan(80);
      expect(scene.terrain.contours.length, key).toBeGreaterThan(20);
    }
  });

  it('D2-03 重制工程达标：营地/环石/边镇/条田/间曲线/零告警', () => {
    const path = join(process.cwd(), 'projects/D203_灰山口与囚禁魔营地.worldtown.json');
    const project = normalizeProject(JSON.parse(readFileSync(path, 'utf8')));
    const scene = compileSettlementScene(project);
    const camp = project.zones.find((zone) => zone.id === 'zone_hunter_camp');
    const symbol = project.zones.find((zone) => zone.id === 'zone_camp_symbol');
    const town = project.zones.find((zone) => zone.id === 'zone_town_wall');
    expect(camp).toBeDefined();
    expect(symbol).toBeDefined();
    expect(town).toBeDefined();
    expect(polygonAreaHa(camp?.points ?? [])).toBeGreaterThanOrEqual(0.4);
    expect(polygonAreaHa(camp?.points ?? [])).toBeLessThanOrEqual(0.7);
    expect(polygonAreaHa(symbol?.points ?? [])).toBeGreaterThanOrEqual(0.14);
    expect(polygonAreaHa(symbol?.points ?? [])).toBeLessThanOrEqual(0.22);
    expect(town?.buildingScale ?? 1).toBe(1);
    expect(polygonAreaHa(town?.points ?? [])).toBeGreaterThanOrEqual(18);
    expect(polygonAreaHa(town?.points ?? [])).toBeLessThanOrEqual(22);
    const townZone = scene.zones.find((zone) => zone.id === 'zone_town_wall');
    expect(townZone?.buildings.length ?? 0).toBeGreaterThanOrEqual(260);
    const campZone = scene.zones.find((zone) => zone.id === 'zone_hunter_camp');
    expect(campZone?.buildings.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(campZone?.buildings.length ?? 0).toBeLessThanOrEqual(14);
    expect(project.terrain.showSupplementaryContours).toBe(true);
    expect(project.terrain.macroReliefAmpM ?? 0).toBeGreaterThanOrEqual(10);
    expect(project.terrain.valleyCarveRatio ?? 0).toBeGreaterThanOrEqual(5);
    expect(scene.terrain.contours.some((contour) => contour.isSupplementary)).toBe(true);
    for (const zone of project.zones) {
      if (zone.contentType !== 'farmland') continue;
      expect(polygonAreaHa(zone.points), zone.id).toBeLessThanOrEqual(30);
    }
    expect(scene.collisionReport.totalHits).toBe(0);
    expect(scene.collisionReport.riverIslands).toBe(0);
    const brief = buildSpatialRadar(project, scene);
    expect(brief.warnings).toHaveLength(0);
    expect(brief.zones.filter((zone) => zone.status === 'empty_warning')).toHaveLength(0);
    // 整边零压路/零压渠复检（D2-03 与起点城双工程）
    for (const plot of scene.farmlandPlots) {
      const c = computePolygonCentroid(plot.innerPolygon);
      const r = polygonRadiusOf(plot.innerPolygon, c);
      for (const road of scene.hydro.roads) {
        expect(clearsPolyline(plot.innerPolygon, c, r, road.centerline, 0.5 * road.widthM)).toBe(true);
      }
      for (const canal of scene.hydro.canals) {
        expect(clearsPolyline(plot.innerPolygon, c, r, canal.centerline, 0.5 * canal.widthM)).toBe(true);
      }
    }
    const losScene = compileSettlementScene(createPresetProject('losrumura'));
    for (const plot of losScene.farmlandPlots) {
      const c = computePolygonCentroid(plot.innerPolygon);
      const r = polygonRadiusOf(plot.innerPolygon, c);
      for (const road of losScene.hydro.roads) {
        expect(clearsPolyline(plot.innerPolygon, c, r, road.centerline, 0.5 * road.widthM)).toBe(true);
      }
      for (const canal of losScene.hydro.canals) {
        expect(clearsPolyline(plot.innerPolygon, c, r, canal.centerline, 0.5 * canal.widthM)).toBe(true);
      }
    }
    console.log(
      `[T8] D2-03 边镇 ${townZone?.buildings.length} 栋 / 营地 ${campZone?.buildings.length} 栋 / 条田 ${scene.farmlandPlots.length} 块 / 间曲线 ${scene.terrain.contours.filter((c) => c.isSupplementary).length} 段`,
    );
  });
});
