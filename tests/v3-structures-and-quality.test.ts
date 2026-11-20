import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSettlementScene, rerollZoneScene } from '../src/core/compileScene';
import { buildCustomStructures } from '../src/core/generators/customStructures';
import { buildHydraulicWorks } from '../src/core/hydro/hydraulicWorks';
import { hitTestActiveHandles, hitTestSceneObject } from '../src/core/hitTest';
import { entityFrame } from '../src/core/entityHandles';
import { computePolygonCentroid, computePolygonAreaSigned, pointInPolygon } from '../src/core/math/polygon';
import { clearsPolygon } from '../src/core/obstacles/collisionAudit';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { snapPointToWaterBank } from '../src/core/hydro/hydraulicWorks';
import { buildElevationField } from '../src/core/terrain/elevationField';
import { produce } from 'immer';
import { applyEntityHandleDrag } from '../src/core/entityHandles';
import { createPresetProject } from '../src/schema/presets';
import { getActivePalette } from '../src/schema/palette.schema';
import { Canvas2DBackend } from '../src/renderer/Canvas2DBackend';
import { SvgStringBackend } from '../src/renderer/SvgStringBackend';
import { paintScene } from '../src/renderer/paintScene';
import { createViewport } from '../src/renderer/RenderBackend';
import { renderSceneToSvgString } from '../src/renderer/exportUtils';
import type { Polygon } from '../src/schema/geometry.types';

function ring(cx: number, cy: number, r: number, sides = 12, phase = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < sides; i += 1) {
    const ang = phase + (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.86]);
  }
  return out;
}

function flat(worldSizeM: number, extra: Record<string, unknown>): TownProject {
  return normalizeProject({
    meta: { worldSizeM, name: '阶段二核验' },
    terrain: { baseElev: 420, slopeMagM: 0, slopeDirDeg: 0, contourStep: 5, terrainNoiseAmpM: 0 },
    ...extra,
  });
}

interface RecordedCall {
  readonly op: string;
  readonly fill: string;
  readonly stroke: string;
  readonly text?: string;
}

function mockCtx(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const target: Record<string, unknown> = {
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter',
  };
  const push = (op: string, text?: string): void => {
    calls.push({ op, fill: String(target.fillStyle), stroke: String(target.strokeStyle), text });
  };
  const noop = (op: string) => (): void => push(op);
  Object.assign(target, {
    setTransform: noop('setTransform'), save: noop('save'), restore: noop('restore'),
    translate: noop('translate'), scale: noop('scale'), beginPath: noop('beginPath'),
    closePath: noop('closePath'), moveTo: noop('moveTo'), lineTo: noop('lineTo'),
    bezierCurveTo: noop('bezierCurveTo'), arc: noop('arc'), arcTo: noop('arcTo'),
    rect: noop('rect'), fill: noop('fill'), stroke: noop('stroke'), fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'), clip: noop('clip'), setLineDash: noop('setLineDash'),
    strokeText: noop('strokeText'),
    fillText: (text: string): void => push('fillText', text),
    measureText: (text: string): { width: number } => ({ width: text.length * 6 }),
    createRadialGradient: (): { addColorStop: () => void } => ({ addColorStop: () => undefined }),
  });
  return { ctx: target as unknown as CanvasRenderingContext2D, calls };
}

function buildingsOf(scene: ReturnType<typeof compileSettlementScene>): ReadonlyArray<{ id: string; zoneId: string; points: Polygon }> {
  return scene.buildings;
}

function overlapsPoly(poly: Polygon, target: Polygon): boolean {
  const c = computePolygonCentroid(poly);
  let radius = 0;
  for (const p of poly) radius = Math.max(radius, Math.hypot(p[0] - c[0], p[1] - c[1]));
  return !clearsPolygon(poly, c, radius, target, 0);
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

describe('V3-S2.1/S2.2 · 水工与核心建筑群编译、避让与拾取', () => {
  const project = flat(1600, {
    rivers: [
      { id: 'r1', name: '主河', points: [[80, 760], [1500, 760]], widthStartM: 42, widthEndM: 42, carveDepthM: 4 },
    ],
    roads: [{ id: 'rd1', name: '驿道', tier: 'street', points: [[800, 120], [800, 1480]], widthM: 9 }],
    zones: [
      {
        id: 'town', name: '北关厢', contentType: 'town_blocks',
        points: [[420, 900], [1180, 900], [1180, 1420], [420, 1420]], seed: 9,
      },
    ],
    weirs: [{ id: 'weir1', name: '东关分水堰', pStart: [700, 735], pEnd: [700, 785], sluices: 3, widthM: 8 }],
    docks: [{ id: 'dock1', name: '北埠滑道坞', x: 520, y: 735, angleDeg: 0, kind: 'slipway', slips: 4, spacingM: 18, lengthM: 42, widthM: 9 }],
    watermills: [{ id: 'mill1', name: '水力锻锤', x: 1000, y: 730, angleDeg: 0, wheelSide: 'left', widthM: 18, depthM: 12 }],
    structures: [
      { id: 'str1', name: '议事厅', x: 800, y: 1150, angleDeg: 0, widthM: 64, depthM: 44, kind: 'l_hall', roofKind: 'citadel' },
      { id: 'str2', name: '四公仓', x: 950, y: 1150, angleDeg: 0, widthM: 46, depthM: 28, kind: 'rect', roofKind: 'inner' },
      { id: 'str3', name: '官坛', x: 1080, y: 1300, angleDeg: 0, widthM: 56, depthM: 56, kind: 'round_altar', roofKind: 'citadel' },
    ],
    bridgeOverrides: [{ id: 'bo1', x: 800, y: 760, style: 'fortified_twin', fortSizeM: 26 }],
  });

  it('水工与建筑群编译产出真实几何（L 形 6 顶点 / 圆坛 16 边 + 内环）', () => {
    const works = buildHydraulicWorks(project);
    expect(works.weirs).toHaveLength(1);
    expect(works.weirs[0]?.pierPolygons).toHaveLength(3);
    expect(works.weirs[0]?.foamLines.length).toBeGreaterThan(0);
    expect(works.docks[0]?.slipLines).toHaveLength(4);
    expect(works.watermills[0]?.spokes.length).toBe(8);
    const structures = buildCustomStructures(project);
    expect(structures[0]?.polygon.length).toBe(6);
    expect(structures[2]?.polygon.length).toBe(16);
    expect(structures[2]?.innerRing).not.toBeNull();
    expect(structures[1]?.ridge).not.toBeNull();
  });

  it('民居与林木自动避让水工/建筑群足印，全局零穿模', () => {
    const scene = compileSettlementScene(project);
    expect(scene.collisionReport.passed).toBe(true);
    expect(scene.buildings.length).toBeGreaterThan(40);
    const rigid = [
      ...scene.hydraulic.footprints,
      ...scene.structures.map((item) => item.polygon),
    ];
    let overlaps = 0;
    for (const building of scene.buildings) {
      for (const footprint of rigid) {
        if (overlapsPoly(building.points, footprint)) overlaps += 1;
      }
    }
    expect(overlaps).toBe(0);
    for (const tree of scene.trees) {
      for (const footprint of rigid) {
        expect(pointInPolygon(tree.x, tree.y, footprint)).toBe(false);
      }
    }
  });

  it('水工/建筑群拾取先于选区，且四类手柄命中中心/旋转/面宽/进深', () => {
    const scene = compileSettlementScene(project);
    expect(hitTestSceneObject(project, scene, 800, 1150)?.type).toBe('structure');
    expect(hitTestSceneObject(project, scene, 700, 760)?.type).toBe('weir');
    expect(hitTestSceneObject(project, scene, 520, 735)?.type).toBe('dock');
    expect(hitTestSceneObject(project, scene, 1000, 730)?.type).toBe('watermill');
    const selection = { type: 'structure' as const, id: 'str1' };
    const frame = entityFrame(project, selection);
    expect(frame?.widthM).toBe(64);
    expect(hitTestActiveHandles(project, selection, 800, 1150, null)?.kind).toBe('entity_center');
    const widthHandle = frame ? [frame.cx + frame.widthM * 0.5, frame.cy] as const : [0, 0] as const;
    expect(hitTestActiveHandles(project, selection, widthHandle[0], widthHandle[1], null)?.kind)
      .toBe('entity_scale_w');
    const rotate = frame ? [frame.cx, frame.cy - frame.depthM * 0.5 - 20] as const : [0, 0] as const;
    expect(hitTestActiveHandles(project, selection, rotate[0], rotate[1], null)?.kind)
      .toBe('entity_rotate');
  });

  it('桥梁覆写：fortified_twin 生双桥头堡并升级为障碍足印', () => {
    const scene = compileSettlementScene(project);
    const bridge = scene.hydro.bridges.find((item) => item.style === 'fortified_twin');
    expect(bridge).toBeDefined();
    expect(bridge?.forts?.length).toBe(2);
    expect(scene.collisionReport.passed).toBe(true);
  });

  it('Canvas 与 SVG 双端同源绘制水工/建筑群/双桥头堡', () => {
    const scene = compileSettlementScene(project);
    const vp = createViewport(1200, 900, project.meta.worldSizeM, 1);
    const svgBackend = new SvgStringBackend(1200, 900);
    paintScene(svgBackend, project, scene, vp, {});
    const svg = svgBackend.toSvgString();
    expect(svg).toContain('<g id="layer-hydraulic-works">');
    expect(svg).toContain('<g id="layer-structures">');
    const block = svg.slice(svg.indexOf('<g id="layer-hydraulic-works">'), svg.indexOf('<g id="layer-roads-streets">'));
    expect(block.match(/<path/g)?.length ?? 0).toBeGreaterThan(4);
    const { ctx, calls } = mockCtx();
    paintScene(new Canvas2DBackend(ctx, 1200, 900, 1), project, scene, vp, {});
    expect(calls.filter((c) => c.op === 'stroke').length).toBeGreaterThan(10);
    const structBlock = svg.slice(svg.indexOf('<g id="layer-structures">'), svg.indexOf('<g id="layer-trees-canopy">'));
    expect(structBlock.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('V3-S2.1 · 水渠水门 / 明渠小桥 / 城中套城挖空', () => {
  const project = flat(1400, {
    canals: [{ id: 'c1', name: '穿城净水渠', style: 'stone_clean', points: [[100, 600], [1300, 600]], widthM: 6 }],
    roads: [{ id: 'rd1', name: '南北大街', tier: 'street', points: [[600, 120], [600, 1280]], widthM: 9 }],
    zones: [
      { id: 'city', name: '内城', contentType: 'walled_city', points: [[300, 320], [900, 320], [900, 880], [300, 880]], wallThicknessM: 6, seed: 3 },
      { id: 'keep', name: '内嵌堡寨', contentType: 'citadel', points: [[520, 380], [720, 380], [720, 540], [520, 540]], seed: 4 },
    ],
    structures: [{ id: 'h1', name: '议事厅', x: 620, y: 460, angleDeg: 0, widthM: 54, depthM: 34, kind: 'l_hall', roofKind: 'citadel', zoneId: 'keep' }],
  });

  it('明渠穿城墙生成两个拱形水门豁口，宽 = canal.widthM + 2.5m', () => {
    const scene = compileSettlementScene(project);
    const gates = scene.walls.flatMap((wall) => wall.waterGates);
    expect(gates.length).toBeGreaterThanOrEqual(2);
    for (const gate of gates) {
      expect(gate.canalId).toBe('c1');
      expect(Math.abs(gate.gapHalf * 2 - (6 + 2.5))).toBeLessThan(0.01);
      expect(gate.polygon.length).toBeGreaterThan(8);
    }
    const walls = scene.walls.filter((wall) => wall.closed);
    expect(walls.length).toBe(0);
  });

  it('干道跨非 qanat 明渠自动生成小桥，跨 qanat 不架桥', () => {
    const scene = compileSettlementScene(project);
    const canalBridge = scene.hydro.bridges.find((item) => item.canalId === 'c1');
    expect(canalBridge).toBeDefined();
    expect(canalBridge?.x).toBeCloseTo(600, 0);
    const qanat = normalizeProject({ ...project, canals: [{ ...project.canals[0], style: 'qanat' }] });
    const qanatScene = compileSettlementScene(qanat);
    expect(qanatScene.hydro.bridges.some((item) => item.canalId === 'c1')).toBe(false);
  });

  it('walled_city 自动挖空内嵌 citadel：内城屋宇零压占堡寨', () => {
    const scene = compileSettlementScene(project);
    const keep = project.zones.find((zone) => zone.id === 'keep');
    expect(keep).toBeDefined();
    if (!keep) return;
    const cityBuildings = scene.buildings.filter((b) => b.zoneId === 'city');
    expect(cityBuildings.length).toBeGreaterThan(20);
    let inside = 0;
    for (const building of cityBuildings) {
      if (overlapsPoly(building.points, keep.points)) inside += 1;
    }
    expect(inside).toBe(0);
    expect(scene.collisionReport.passed).toBe(true);
  });

  it('单区重抽保持水门与刚性足印，零穿模', () => {
    const scene = compileSettlementScene(project);
    const rerolled = rerollZoneScene(project, 'city', scene, 99);
    expect(rerolled.scene.walls.flatMap((w) => w.waterGates).length).toBeGreaterThanOrEqual(2);
    expect(rerolled.scene.collisionReport.passed).toBe(true);
    expect(rerolled.scene.structures.length).toBeGreaterThan(0);
    expect(rerolled.scene.hydraulic).toBeDefined();
  });
});

describe('V3-S2.4 · 集市货棚铺展率与三种模式', () => {
  it('stalls 货棚面积 >= 45% 集坪包围盒（根治 0.5 挤压 Bug）', () => {
    const project = flat(900, {
      zones: [{ id: 'mk', name: '十字集坪', contentType: 'market', points: [[200, 200], [360, 200], [360, 330], [200, 330]], seed: 5 }],
    });
    const scene = compileSettlementScene(project);
    const stalls = scene.buildings.filter((b) => b.zoneId === 'mk');
    expect(stalls.length).toBeGreaterThan(40);
    let area = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const stall of stalls) {
      area += Math.abs(computePolygonAreaSigned(stall.points));
      for (const p of stall.points) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    const ratio = area / Math.max(1, (maxX - minX) * (maxY - minY));
    const apron = scene.marketAprons[0];
    expect(apron).toBeDefined();
    let axMin = Number.POSITIVE_INFINITY;
    let ayMin = Number.POSITIVE_INFINITY;
    let axMax = Number.NEGATIVE_INFINITY;
    let ayMax = Number.NEGATIVE_INFINITY;
    for (const p of apron?.points ?? []) {
      axMin = Math.min(axMin, p[0]);
      ayMin = Math.min(ayMin, p[1]);
      axMax = Math.max(axMax, p[0]);
      ayMax = Math.max(ayMax, p[1]);
    }
    const apronRatio = area / Math.max(1, (axMax - axMin) * (ayMax - ayMin));
    console.log(`[market] 货棚 ${stalls.length} 顶，摊列占比 ${(ratio * 100).toFixed(1)}% / 集坪占比 ${(apronRatio * 100).toFixed(1)}%`);
    expect(ratio).toBeGreaterThanOrEqual(0.45);
    expect(apronRatio).toBeGreaterThanOrEqual(0.45);
    expect(scene.marketAprons.length).toBeGreaterThan(0);
    expect(scene.wells.length).toBeGreaterThan(0);
  });

  it('timber_yard 生大料堆与账房，port_apron 生沿岸货栈', () => {
    const project = flat(900, {
      zones: [
        { id: 'wood', name: '南门木行', contentType: 'market', points: [[120, 120], [330, 120], [330, 300], [120, 300]], marketMode: 'timber_yard', seed: 2 },
        { id: 'port', name: '北关河埠坊', contentType: 'market', points: [[420, 120], [700, 120], [700, 300], [420, 300]], marketMode: 'port_apron', seed: 6 },
      ],
    });
    const scene = compileSettlementScene(project);
    const yard = scene.buildings.filter((b) => b.zoneId === 'wood');
    const port = scene.buildings.filter((b) => b.zoneId === 'port');
    expect(yard.length).toBeGreaterThan(3);
    expect(port.length).toBeGreaterThan(2);
    const largest = Math.max(...yard.map((b) => Math.abs(computePolygonAreaSigned(b.points))));
    expect(largest).toBeGreaterThan(60);
    expect(scene.collisionReport.passed).toBe(true);
  });
});

describe('V3-S2.4/S2.6 · 村径与禁建圈双端非零绘制', () => {
  const project = flat(1200, {
    zones: [
      {
        id: 'vil', name: '沿溪村寨', contentType: 'village',
        points: [[200, 200], [700, 260], [760, 620], [260, 700]],
        ribbonSpine: [[260, 420], [480, 380], [700, 440]], seed: 8,
      },
      {
        id: 'ex', name: '黑石大疫禁建圈', contentType: 'exclusion',
        points: ring(950, 800, 150, 18), exclusionStyle: 'plague_stones', seed: 1,
      },
    ],
  });

  it('scene.lanes 与 exclusionPolys 均有内容，Canvas/SVG 绘制量随其增加', () => {
    const scene = compileSettlementScene(project);
    expect(scene.lanes.length).toBeGreaterThan(0);
    expect(scene.exclusionPolys.length).toBe(1);
    const vp = createViewport(1000, 800, project.meta.worldSizeM, 1);
    const full = mockCtx();
    paintScene(new Canvas2DBackend(full.ctx, 1000, 800, 1), project, scene, vp, {});
    const strippedScene = { ...scene, lanes: [], exclusionPolys: [] };
    const stripped = mockCtx();
    paintScene(new Canvas2DBackend(stripped.ctx, 1000, 800, 1), project, strippedScene, vp, {});
    expect(full.calls.length - stripped.calls.length).toBeGreaterThan(20);
    const svgFull = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 900 });
    const svgStripped = renderSceneToSvgString(project, strippedScene, { mode: 'full', basePx: 900 });
    expect(svgFull.length).toBeGreaterThan(svgStripped.length);
    const start = svgFull.indexOf('<g id="layer-roads-streets">');
    const stop = svgFull.indexOf('<g id="layer-bridges">');
    const block = svgFull.slice(start, stop);
    expect(block.match(/<path/g)?.length ?? 0).toBeGreaterThan(4);
  });

  it('黑石疫圈绘制界碑圆点串 + 虚线，meadow / marsh 样式可切换', () => {
    const scene = compileSettlementScene(project);
    const vp = createViewport(1000, 800, project.meta.worldSizeM, 1);
    const { ctx, calls } = mockCtx();
    paintScene(new Canvas2DBackend(ctx, 1000, 800, 1), project, scene, vp, {});
    const dashCalls = calls.filter((c) => c.op === 'setLineDash').length;
    expect(dashCalls).toBeGreaterThan(0);
    const marsh = normalizeProject({ ...project, zones: project.zones.map((z) => z.contentType === 'exclusion' ? { ...z, exclusionStyle: 'marsh' } : z) });
    const marshScene = compileSettlementScene(marsh);
    expect(marshScene.exclusionPolys.length).toBe(1);
    const back = new SvgStringBackend(900, 900);
    paintScene(back, marsh, marshScene, createViewport(900, 900, marsh.meta.worldSizeM, 1), {});
    expect(back.toSvgString().length).toBeGreaterThan(1000);
  });
});

describe('V3-S2.3/S2.5 · OBB 街坊、外缘衰减、田块与地形质感', () => {
  const base = {
    roads: [
      { id: 'rd1', name: '东西驿道', tier: 'highway', points: [[420, 700], [1340, 700]], widthM: 14 },
      { id: 'rd2', name: '南北街', tier: 'street', points: [[880, 460], [880, 980]], widthM: 9 },
    ],
    zones: [
      {
        id: 'town', name: '西坡关厢', contentType: 'town_blocks',
        points: [[480, 500], [1300, 500], [1320, 940], [460, 940]], seed: 12,
      },
    ],
  };

  it('城坊产出贴边屋宇（四边为主、街角五边梯形）且带院落留白', () => {
    const project = flat(1600, base);
    const scene = compileSettlementScene(project);
    const buildings = scene.buildings.filter((b) => b.zoneId === 'town');
    expect(buildings.length).toBeGreaterThan(40);
    // V6：宅基地递归剖分 + 平行临街边半平面裁剪后，主体仍是四边，
    // 街角不再被碰撞守卫拔牙，自然长出贴合路口的五边梯形/微楔形屋面。
    const quads = buildings.filter((b) => b.points.length === 4).length;
    expect(quads / buildings.length).toBeGreaterThan(0.6);
    expect(buildings.filter((b) => b.points.length === 5).length).toBeGreaterThan(10);
    expect(buildings.every((b) => b.points.length >= 3 && b.points.length <= 8)).toBe(true);
    const areas = buildings.map((b) => Math.abs(computePolygonAreaSigned(b.points)));
    expect(Math.max(...areas)).toBeLessThan(900);
    const sorted = [...areas].sort((p, q) => p - q);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(40);
    expect(median).toBeLessThan(220);
    expect(scene.collisionReport.totalHits).toBe(0);
  });

  it('frayOuter 外缘稀疏衰减：关闭衰减时屋宇显著更多', () => {
    const frayed = flat(1600, base);
    const solid = normalizeProject({
      ...frayed,
      zones: frayed.zones.map((zone) => ({ ...zone, frayOuter: false })),
    });
    const frayedCount = compileSettlementScene(frayed).buildings.length;
    const solidCount = compileSettlementScene(solid).buildings.length;
    console.log(`[fray] frayOuter ${frayedCount} 栋 vs 满铺 ${solidCount} 栋`);
    expect(frayedCount).toBeLessThan(solidCount);
    expect(frayedCount / solidCount).toBeLessThan(0.95);
  });

  it('农田无重黑外框，田角点植安全田间树', () => {
    const project = flat(900, {
      zones: [{ id: 'farm', name: '南滩条田', contentType: 'farmland', points: [[150, 150], [740, 150], [740, 720], [150, 720]], seed: 7 }],
    });
    const scene = compileSettlementScene(project);
    expect(scene.farmlandPlots.length).toBeGreaterThan(3);
    expect(scene.trees.length).toBeGreaterThan(0);
    const svg = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 900 });
    const start = svg.indexOf('<g id="layer-land-plots">');
    const stop = svg.indexOf('<g id="layer-contours">');
    const block = svg.slice(start, stop);
    expect(block.includes('stroke="#2b2520"')).toBe(false);
  });

  it('高程淡彩带与顺坡晕滃短线非零产出并双端绘制', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '山地质感' },
      terrain: {
        baseElev: 400, slopeMagM: 30, slopeDirDeg: 315, contourStep: 5,
        showHypsometricTint: true, showHachures: true, hachureSlopeMinDeg: 3.5, terrainNoiseAmpM: 2.4,
        shapes: [
          { id: 'hill1', type: 'hill', cx: 700, cy: 700, rx: 380, ry: 300, angleDeg: 20, deltaElev: 120, focusX: 0.2, focusY: -0.15 },
          { id: 'ridge1', type: 'ridge', points: [[200, 1200], [800, 1120], [1400, 1220]], deltaElev: 90, widthLeft: 140, widthRight: 110 },
        ],
      },
    });
    const scene = compileSettlementScene(project);
    expect(scene.shading.bands.length).toBeGreaterThanOrEqual(3);
    const tintPolys = scene.shading.bands.reduce((sum, band) => sum + band.polygons.length, 0);
    expect(tintPolys).toBeGreaterThan(200);
    expect(scene.shading.hachures.length).toBeGreaterThan(30);
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 });
    expect(svg).toContain('<g id="layer-terrain-tint">');
    const tintBlock = svg.slice(svg.indexOf('<g id="layer-terrain-tint">'), svg.indexOf('<g id="layer-land-plots">'));
    expect(tintBlock.match(/<path/g)?.length ?? 0).toBeGreaterThan(0);
    const { ctx, calls } = mockCtx();
    paintScene(new Canvas2DBackend(ctx, 900, 900, 1), project, scene, createViewport(900, 900, 1600, 1), {});
    expect(calls.filter((c) => c.op === 'fill').length).toBeGreaterThan(3);
  });
});

describe('V3-S2.5/S2.6 · 出版三模式与标注可读性', () => {
  const project = normalizeProject({
    ...createPresetProject('losrumura'),
    legend: { ...createPresetProject('losrumura').legend, displayMode: 'guided' },
  });

  it('guided 模式绘制编号角标与导览目录，pure 模式剥离文字图饰', () => {
    const scene = compileSettlementScene(project);
    const full = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 1000 });
    expect(full).toContain('layer-cartouche');
    const pure = renderSceneToSvgString(project, scene, { mode: 'pure', basePx: 1000 });
    expect(pure).not.toContain('layer-cartouche');
    const pureLabels = pure.slice(pure.indexOf('<g id="layer-landmarks-labels">'), pure.indexOf('<g id="layer-ui-overlay">'));
    expect(pureLabels.includes('<text')).toBe(false);
    const standard = renderSceneToSvgString(
      normalizeProject({ ...project, legend: { ...project.legend, displayMode: 'standard' } }),
      scene,
      { mode: 'full', basePx: 1000 },
    );
    expect(standard.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(pure.length);
  });

  it('22% 全图缩放仍绘制选区名与河名（带光晕）', () => {
    const scene = compileSettlementScene(project);
    const { ctx, calls } = mockCtx();
    paintScene(new Canvas2DBackend(ctx, 1400, 900, 1), project, scene, {
      ...createViewport(1400, 900, project.meta.worldSizeM, 1),
      zoom: 0.215,
    }, {});
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.text ?? '');
    expect(texts.length).toBeGreaterThan(3);
    expect(texts.some((text) => text.includes('河') || text.includes('湖'))).toBe(true);
  });
});

describe('V3-BG-08 · 全局零穿模与 320 行红线', () => {
  it('三套预设全部零穿模且水工/建筑群/水门结构自洽', () => {
    for (const key of ['losrumura', 'changhu', 'palong'] as const) {
      const project = createPresetProject(key);
      const scene = compileSettlementScene(project);
      expect(scene.collisionReport.passed, key).toBe(true);
      expect(scene.collisionReport.totalHits, key).toBe(0);
      const dockQuads = scene.hydraulic.docks.reduce(
        (sum, dock) => sum + (dock.deckPolygon ? 2 : 1),
        0,
      );
      expect(scene.hydraulic.footprints.length, key).toBe(
        project.weirs.length + project.watermills.length + dockQuads
          + scene.hydraulic.weirs.reduce((sum, w) => sum + w.pierPolygons.length, 0),
      );
      for (const wall of scene.walls) {
        for (const gate of wall.waterGates) {
          expect(gate.gapHalf * 2 - gate.canalWidthM).toBeGreaterThan(2.0);
        }
      }
    }
  });

  it('src 全部微模块 <= 320 行，零 any / TODO / Math.random', () => {
    const files = walkTs('src');
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      if (lines > 320) offenders.push(`${file}:${lines}`);
      expect(text.includes('TO' + 'DO')).toBe(false);
      expect(text.includes('@ts-' + 'ignore')).toBe(false);
      expect(text.includes(' as ' + 'any')).toBe(false);
      if (file.includes('/core/')) expect(text.includes('Math.' + 'random(')).toBe(false);
    }
    expect(offenders).toEqual([]);
    const maxLines = Math.max(...files.map((f) => {
      const text = readFileSync(f, 'utf8');
      return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    }));
    console.log(`[V3-S2.8] ${files.length} 个模块通过，最大 ${maxLines} 行`);
  });

  it('调色板与图例在 guided/pure 下仍保持 14 类内置项', () => {
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    const keys = scene.legend.items.filter((item) => item.autoPresent !== false).map((item) => item.key);
    for (const key of ['city_wall', 'river_pure', 'bridge_ortho', 'canal_water', 'contour_line']) {
      expect(keys).toContain(key);
    }
    expect(getActivePalette(project.palette).themeId).toBe('watabou_classic');
    expect(buildingsOf(scene).length).toBeGreaterThan(100);
  });
});


describe('V3-S2.2/S2.5 · 吸附、手柄写回、噪声确定性与涂抹树复核', () => {
  it('水工吸附：snapPointToWaterBank 返回岸线点与指向水域法向', () => {
    const project = flat(1200, {
      rivers: [{ id: 'r1', name: '河', points: [[100, 600], [1100, 600]], widthStartM: 36, widthEndM: 36, carveDepthM: 3 }],
    });
    const scene = compileSettlementScene(project);
    const snap = snapPointToWaterBank(scene.hydro.rivers, scene.hydro.waterBodies, scene.hydro.canals, 600, 640, 120);
    expect(snap).not.toBeNull();
    expect(Math.abs((snap?.y ?? 0) - 618)).toBeLessThan(2.5);
    expect(snap?.dist).toBeGreaterThan(0);
    expect(Number.isFinite(snap?.angleDeg)).toBe(true);
  });

  it('实体手柄写回：中心拖拽平移、面宽对拉扩宽、旋转改写角度', () => {
    const project = flat(1200, {
      structures: [{ id: 's1', name: '议事厅', x: 600, y: 600, angleDeg: 0, widthM: 60, depthM: 40, kind: 'rect', roofKind: 'citadel' }],
    });
    const selection = { type: 'structure' as const, id: 's1' };
    const moved = produce(project, (draft) => {
      applyEntityHandleDrag(draft, selection, 'entity_center', [660, 640], project, [0, 0]);
    });
    expect(moved.structures[0]?.x).toBe(660);
    expect(moved.structures[0]?.y).toBe(640);
    const widened = produce(project, (draft) => {
      applyEntityHandleDrag(draft, selection, 'entity_scale_w', [680, 600], project, [0, 0]);
    });
    expect(widened.structures[0]?.widthM).toBe(160);
    const rotated = produce(project, (draft) => {
      applyEntityHandleDrag(draft, selection, 'entity_rotate', [600, 400], project, [0, 0]);
    });
    expect(Math.abs(rotated.structures[0]?.angleDeg ?? 0)).toBeLessThan(1e-6);
    const frame = entityFrame(project, selection);
    expect(frame?.widthM).toBe(60);
  });

  it('微地形噪声确定性：同 seed 逐字一致，改 seed 即变，振幅 0 严格关闭', () => {
    const base = {
      meta: { worldSizeM: 1200 },
      terrain: { baseElev: 400, slopeMagM: 0, terrainNoiseAmpM: 3, terrainSeed: 4242 },
    };
    const a = buildElevationField(normalizeProject(base));
    const b = buildElevationField(normalizeProject(base));
    const c = buildElevationField(normalizeProject({ ...base, terrain: { ...base.terrain, terrainSeed: 909 } }));
    const off = buildElevationField(normalizeProject({ ...base, terrain: { ...base.terrain, terrainNoiseAmpM: 0 } }));
    let same = true;
    let differs = false;
    let flatMax = 0;
    for (let i = 0; i < a.elevation.length; i += 97) {
      if ((a.elevation[i] ?? 0) !== (b.elevation[i] ?? 0)) same = false;
      if (Math.abs((a.elevation[i] ?? 0) - (c.elevation[i] ?? 0)) > 0.2) differs = true;
      flatMax = Math.max(flatMax, Math.abs((off.elevation[i] ?? 0) - 400));
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
    expect(flatMax).toBeLessThan(0.001);
    expect(a.maxElev - a.minElev).toBeGreaterThan(1.5);
  });

  it('涂抹树复核：水面/屋面上的树被剔除，合规树并入编译产物且渲染不双绘', () => {
    const project = flat(1200, {
      rivers: [{ id: 'r1', name: '河', points: [[100, 600], [1100, 600]], widthStartM: 60, widthEndM: 60, carveDepthM: 3 }],
      paintedTrees: [
        { id: 't_water', x: 600, y: 600, r: 6, kind: 'woodland' },
        { id: 't_ok', x: 300, y: 300, r: 6, kind: 'woodland' },
        { id: 't_ok2', x: 920, y: 940, r: 5, kind: 'garden' },
      ],
    });
    const scene = compileSettlementScene(project);
    const painted = scene.trees.filter((tree) => tree.zoneId === '__painted__');
    expect(painted.length).toBe(2);
    expect(painted.every((tree) => tree.x < 500 || tree.x > 700)).toBe(true);
    const vp = createViewport(900, 900, project.meta.worldSizeM, 1);
    const backend = new SvgStringBackend(900, 900);
    paintScene(backend, project, scene, vp, {});
    const svg = backend.toSvgString();
    const block = svg.slice(svg.indexOf('<g id="layer-trees-canopy">'), svg.indexOf('<g id="layer-landmarks-labels">'));
    const circles = block.match(/<circle /g)?.length ?? 0;
    // V6：单树多瓣展开后，三遍仍是同一批叶瓣（遍数整除 + 每棵至少 3 瓣）
    expect(circles % 3).toBe(0);
    expect(circles).toBeGreaterThanOrEqual(painted.length * 3);
  });

  it('5 类水渠样式产出差异化绘制（灌溉虚线 / 排碱无实底 / 坎儿井竖井）', () => {
    const project = flat(1100, {
      canals: [
        { id: 'c1', name: '净水', style: 'stone_clean', points: [[120, 200], [900, 200]], widthM: 6 },
        { id: 'c2', name: '灌渠', style: 'irrigation', points: [[120, 320], [900, 320]], widthM: 5 },
        { id: 'c3', name: '排碱', style: 'drainage_dashed', points: [[120, 440], [900, 440]], widthM: 4 },
        { id: 'c4', name: '污尾', style: 'foul_outfall', points: [[120, 560], [900, 560]], widthM: 4 },
        { id: 'c5', name: '暗渠', style: 'qanat', points: [[120, 680], [900, 680]], widthM: 5 },
      ],
    });
    const scene = compileSettlementScene(project);
    expect(scene.hydro.canals.map((c) => c.style)).toEqual([
      'stone_clean', 'irrigation', 'drainage_dashed', 'foul_outfall', 'qanat',
    ]);
    expect(scene.hydro.canals[4]?.shaftPoints.length).toBeGreaterThan(2);
    const svg = renderSceneToSvgString(project, scene, { mode: 'clean', basePx: 900 });
    const block = svg.slice(svg.indexOf('<g id="layer-canals">'), svg.indexOf('<g id="layer-hydraulic-works">'));
    expect(block.match(/<path/g)?.length ?? 0).toBeGreaterThan(8);
    expect(block.includes('stroke-dasharray')).toBe(true);
  });

  it('guided 模式为带 badgeNum 的地标绘制编号角标与外置导览目录', () => {
    const base = createPresetProject('losrumura');
    const project = normalizeProject({
      ...base,
      legend: { ...base.legend, displayMode: 'guided' },
      landmarks: base.landmarks.map((item, index) => ({ ...item, badgeNum: index + 1, subtitle: `节点 ${index + 1}` })),
    });
    const scene = compileSettlementScene(project);
    const svg = renderSceneToSvgString(project, scene, { mode: 'full', basePx: 1000 });
    expect(svg).toContain('方志导览');
    expect(svg).toContain('INDEX');
    expect(svg.length).toBeGreaterThan(1000);
  });
});
