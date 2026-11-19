import { describe, expect, it } from 'vitest';
import { buildElevationField, sampleElevation, sampleGradient } from '../src/core/terrain/elevationField';
import { extractContours, extractScarpTicks } from '../src/core/terrain/marchingSquares';
import { applyContourWarpDrag, applySculptBrush } from '../src/core/terrain/terrainSculpt';
import { buildCanalGeometry, buildRiverGeometry } from '../src/core/hydro/riverCanal';
import { buildHydroRoadPackage, solveOrthogonalBridges } from '../src/core/hydro/reefRoadBridge';
import { buildObstacleGrid, sampleObstacleClearance } from '../src/core/obstacles/obstacleSdf';
import {
  type ObstacleContext,
  type SafeBuilding,
  guardSafeBuilding,
  guardSafeFence,
  guardSafeTree,
} from '../src/core/obstacles/guardSafe';
import { SpatialHash, pointToPolylineDist } from '../src/core/obstacles/collisionAudit';
import { createRng } from '../src/core/math/rng';
import { minDistPolyToPolyline } from '../src/core/math/polygon';
import { hitTestActiveHandles } from '../src/core/hitTest';
import type { Polygon, Polyline, Vec2 } from '../src/schema/geometry.types';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';

function makeFieldProject(): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 800, name: '微雕压测' },
    terrain: {
      baseElev: 300,
      slopeMagM: 0,
      slopeDirDeg: 0,
      contourStep: 10,
      indexEvery: 5,
      minContourElev: 280,
      maxContourElev: 400,
      shapes: [
        {
          id: 'h1',
          type: 'hill',
          cx: 400,
          cy: 400,
          rx: 220,
          ry: 180,
          angleDeg: 20,
          deltaElev: 70,
          focusX: 0.3,
          focusY: -0.1,
        },
      ],
    },
  });
}

function selfIntersects(poly: Polyline): boolean {
  const n = poly.length;
  if (n < 8) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    if (!a1 || !a2) continue;
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (!b1 || !b2) continue;
      const d1x = a2[0] - a1[0];
      const d1y = a2[1] - a1[1];
      const d2x = b2[0] - b1[0];
      const d2y = b2[1] - b1[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
      const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
      if (t > 1e-7 && t < 1 - 1e-7 && u > 1e-7 && u < 1 - 1e-7) return true;
    }
  }
  return false;
}

function pointInPoly(px: number, py: number, poly: Polyline): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

describe('M2 · 偏心核与交互微雕', () => {
  it('偏心山包顶点无尖刺且盆地反向', () => {
    const project = makeFieldProject();
    const field = buildElevationField(project);
    const rad = (20 * Math.PI) / 180;
    const peakX = 400 + (0.3 * 220 * Math.cos(rad) - -0.1 * 180 * Math.sin(rad));
    const peakY = 400 + (0.3 * 220 * Math.sin(rad) + -0.1 * 180 * Math.cos(rad));
    const gPeak = sampleGradient(field, peakX, peakY);
    const gMid = sampleGradient(field, peakX + 90, peakY);
    expect(Math.hypot(gPeak.dzdx, gPeak.dzdy)).toBeLessThan(
      Math.hypot(gMid.dzdx, gMid.dzdy) * 0.2,
    );
    expect(sampleElevation(field, peakX, peakY)).toBeGreaterThan(
      sampleElevation(field, peakX + 150, peakY),
    );

    const basin = normalizeProject({
      meta: { worldSizeM: 800 },
      terrain: {
        baseElev: 300,
        slopeMagM: 0,
        shapes: [
          {
            id: 'b1',
            type: 'basin',
            cx: 400,
            cy: 400,
            rx: 200,
            ry: 200,
            deltaElev: -60,
            focusX: 0,
            focusY: 0,
          },
        ],
      },
    });
    expect(sampleElevation(buildElevationField(basin), 400, 400)).toBeLessThan(245);
  });

  it('100 次推拉 + 四模式笔刷后高程零 NaN、等高线零自交', () => {
    const project = makeFieldProject();
    const field = buildElevationField(project);
    const rng = createRng('warp-100');
    const modes = ['raise', 'lower', 'smooth', 'flatten'] as const;
    for (let i = 0; i < 100; i += 1) {
      const x = 240 + rng() * 320;
      const y = 240 + rng() * 320;
      if (i % 5 === 0) {
        applySculptBrush(field, project.terrain, {
          x,
          y,
          radiusM: 30 + rng() * 30,
          strength: 0.7,
          mode: modes[i % 4] ?? 'raise',
          flattenTargetElev: 330,
        });
      } else {
        applyContourWarpDrag(field, project.terrain, {
          prevX: x,
          prevY: y,
          currX: x + (rng() - 0.5) * 50,
          currY: y + (rng() - 0.5) * 50,
          lockedElev: sampleElevation(field, x, y),
          radiusM: 55,
          strength: 0.85,
        });
      }
    }
    let finite = true;
    for (let i = 0; i < field.elevation.length; i += 1) {
      if (!Number.isFinite(field.elevation[i])) finite = false;
    }
    expect(finite).toBe(true);

    const contours = extractContours(field, project.terrain);
    expect(contours.length).toBeGreaterThan(0);
    let checked = 0;
    for (const contour of contours) {
      for (const p of contour.points) expect(Number.isFinite(p[0])).toBe(true);
      if (contour.closed && contour.points.length > 8 && checked < 12) {
        expect(selfIntersects(contour.points)).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('陡坎齿线默认关闭，开启后实长严格 4.0m 且指向下坡', () => {
    const scarp = normalizeProject({
      meta: { worldSizeM: 1600 },
      terrain: {
        baseElev: 300,
        slopeMagM: 0,
        contourStep: 5,
        indexEvery: 5,
        minContourElev: 250,
        maxContourElev: 360,
        showScarpTicks: true,
        scarpSlopeThresholdDeg: 26,
        shapes: [
          {
            id: 's1',
            type: 'scarp',
            points: [
              [200, 800],
              [1400, 800],
            ],
            deltaElev: 40,
            widthLeft: 120,
            widthRight: 60,
          },
        ],
      },
    });
    const field = buildElevationField(scarp);
    const contours = extractContours(field, scarp.terrain);
    const ticks = extractScarpTicks(contours, field, scarp.terrain);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks.slice(0, 60)) {
      expect(Math.abs(Math.hypot(tick.x2 - tick.x1, tick.y2 - tick.y1) - 4.0)).toBeLessThanOrEqual(0.01);
      const g = sampleGradient(field, tick.x1, tick.y1);
      expect((tick.x2 - tick.x1) * g.dzdx + (tick.y2 - tick.y1) * g.dzdy).toBeLessThan(0);
    }
    const off = normalizeProject(scarp);
    off.terrain.showScarpTicks = false;
    expect(extractScarpTicks(contours, field, off.terrain)).toEqual([]);
  });
});

describe('M2 · 纯净水文与斜交桥', () => {
  it('零河心岛且贴岸水纹为二维点列数组', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      rivers: [
        {
          id: 'riv',
          name: '干流',
          points: [
            [150, 500],
            [800, 780],
            [1450, 520],
          ],
          widthStartM: 40,
          widthEndM: 60,
          rippleLines: 3,
        },
      ],
    });
    const built = buildRiverGeometry(project.rivers[0]!);
    expect(built.islands).toEqual([]);
    expect(built.islands.length).toBe(0);
    expect(built.halfWidths.length).toBe(built.centerline.length);
    expect(built.ripples.length).toBeGreaterThan(0);
    for (const ripple of built.ripples) {
      expect(Array.isArray(ripple)).toBe(true);
      expect(Array.isArray(ripple[0])).toBe(true);
      expect(typeof ripple[0]?.[0]).toBe('number');
    }
    expect(selfIntersects([...built.bankPolygon, built.bankPolygon[0]!])).toBe(false);
  });

  it('90 / 120 / 150 度急折角水渠零自交且竖井每 45m 一串', () => {
    for (const turn of [90, 120, 150]) {
      const rad = ((180 - turn) * Math.PI) / 180;
      const project = normalizeProject({
        meta: { worldSizeM: 1600 },
        canals: [
          {
            id: `can_${turn}`,
            name: `急折${turn}`,
            style: 'qanat',
            points: [
              [300, 800],
              [800, 800],
              [800 + 500 * Math.cos(rad), 800 + 500 * Math.sin(rad)],
            ],
            widthM: 8,
          },
        ],
      });
      const built = buildCanalGeometry(project.canals[0]!);
      expect(built.halfWidths.length).toBe(built.centerline.length);
      expect(selfIntersects([...built.bankPolygon, built.bankPolygon[0]!])).toBe(false);
      expect(built.shaftPoints.length).toBeGreaterThan(3);
      for (let i = 1; i < built.shaftPoints.length; i += 1) {
        const a = built.shaftPoints[i - 1];
        const b = built.shaftPoints[i];
        if (!a || !b) continue;
        const delta = (b.sAlong - a.sAlong) * built.totalLen;
        expect(Math.abs(delta - 45)).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('斜交桥四角全部落在两岸陆地外 >= 4m 且桥长严格符合公式', () => {
    for (const angle of [90, 60, 30]) {
      const a = (angle * Math.PI) / 180;
      const project = normalizeProject({
        meta: { worldSizeM: 1600 },
        terrain: { baseElev: 300, slopeMagM: 0 },
        rivers: [
          {
            id: 'riv_bridge',
            name: '宽河',
            points: [
              [200, 800],
              [1400, 800],
            ],
            widthStartM: 80,
            widthEndM: 80,
          },
        ],
        roads: [
          {
            id: 'rd_bridge',
            name: '斜道',
            tier: 'highway',
            widthM: 14,
            points: [
              [800 - 500 * Math.cos(a), 800 - 500 * Math.sin(a)],
              [800 + 500 * Math.cos(a), 800 + 500 * Math.sin(a)],
            ],
          },
        ],
      });
      const hydro = buildHydroRoadPackage(project);
      const bridge = hydro.bridges[0];
      expect(bridge).toBeDefined();
      if (!bridge) continue;
      const expected =
        (80 + 8.0 + (14 + 3.0) * Math.abs(Math.cos(a))) / Math.max(0.35, Math.abs(Math.sin(a)));
      expect(bridge.lengthM).toBeCloseTo(expected, 6);
      const river = hydro.rivers[0];
      expect(river).toBeDefined();
      if (!river) continue;
      for (const corner of bridge.corners) {
        expect(pointInPoly(corner[0], corner[1], river.bankPolygon)).toBe(false);
        const dist = pointToPolylineDist(corner[0], corner[1], [
          ...river.bankPolygon,
          river.bankPolygon[0] ?? [0, 0],
        ]);
        expect(dist).toBeGreaterThanOrEqual(3.9);
      }
    }
  });

  it('fords 浅滩豁免不架桥且 35m 内不重复架桥', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      rivers: [
        {
          id: 'riv_f',
          name: '浅溪',
          points: [
            [200, 800],
            [1400, 800],
          ],
          widthStartM: 40,
          widthEndM: 40,
        },
      ],
      roads: [
        {
          id: 'rd_f',
          name: '渡道',
          tier: 'street',
          widthM: 9,
          points: [
            [800, 200],
            [800, 1400],
          ],
        },
      ],
      fords: [{ id: 'ford_1', x: 800, y: 800, radiusM: 30, name: '暗梁渡口' }],
    });
    const hydro = buildHydroRoadPackage(project);
    expect(hydro.bridges.length).toBe(0);
    expect(hydro.fordCrossings.length).toBe(1);
    expect(hydro.fordCrossings[0]?.fordId).toBe('ford_1');

    const noFord = { ...project, fords: [] };
    const built = buildHydroRoadPackage(noFord);
    const solve = solveOrthogonalBridges(built.roads, built.rivers, []);
    expect(solve.bridges.length).toBe(1);
  });
});

describe('M2 · SDF 与 Safe* 品牌守卫', () => {
  function makeContext(): {
    project: TownProject;
    ctx: ObstacleContext;
    field: ReturnType<typeof buildElevationField>;
  } {
    const project = normalizeProject({
      meta: { worldSizeM: 1200, name: '守卫压测' },
      terrain: { baseElev: 300, slopeMagM: 0, contourStep: 10, minContourElev: 280, maxContourElev: 360 },
      rivers: [
        {
          id: 'riv_g',
          name: '河',
          points: [
            [100, 900],
            [1100, 900],
          ],
          widthStartM: 50,
          widthEndM: 50,
        },
      ],
      roads: [
        {
          id: 'rd_g',
          name: '路',
          tier: 'highway',
          widthM: 14,
          points: [
            [600, 100],
            [600, 1100],
          ],
        },
      ],
      zones: [
        {
          id: 'zn_ex',
          name: '禁建',
          contentType: 'exclusion',
          points: [
            [850, 200],
            [1050, 200],
            [1050, 400],
            [850, 400],
          ],
        },
        {
          id: 'zn_ok',
          name: '可用',
          contentType: 'town_blocks',
          points: [
            [80, 80],
            [1120, 80],
            [1120, 1120],
            [80, 1120],
          ],
          maxSlopeDeg: 30,
        },
      ],
    });
    const field = buildElevationField(project);
    const hydro = buildHydroRoadPackage(project);
    const ctx: ObstacleContext = {
      worldSizeM: project.meta.worldSizeM,
      elevationField: field,
      maxSlopeDeg: 30,
      riversBuilt: hydro.rivers,
      waterBodiesBuilt: hydro.waterBodies,
      canalsBuilt: hydro.canals,
      roadsBuilt: hydro.roads,
      wallsBuilt: [],
      exclusionPolys: project.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
      spatialHash: new SpatialHash<SafeBuilding>(32),
      grid: buildObstacleGrid({
        worldSizeM: project.meta.worldSizeM,
        elevationField: field,
        globalMaxSlope: 36,
        rivers: hydro.rivers,
        waterBodies: hydro.waterBodies,
        canals: hydro.canals,
        roads: hydro.roads,
        walls: [],
        exclusionPolys: project.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
      }),
      buildingSeq: 0,
      treeSeq: 0,
    };
    return { project, ctx, field };
  }

  it('SDF 河心/路面/禁建圈内净空为 0 且向岸外单调递增', () => {
    const { ctx } = makeContext();
    const grid = ctx.grid;
    expect(grid).not.toBeNull();
    if (!grid) return;
    const world = ctx.worldSizeM;
    expect(sampleObstacleClearance(grid, world, 600, 900)).toBe(0);
    expect(sampleObstacleClearance(grid, world, 600, 500)).toBe(0);
    expect(sampleObstacleClearance(grid, world, 950, 300)).toBe(0);
    const near = sampleObstacleClearance(grid, world, 300, 940);
    const far = sampleObstacleClearance(grid, world, 300, 1010);
    expect(far).toBeGreaterThan(near);
    expect(sampleObstacleClearance(grid, world, 100, 100)).toBeGreaterThan(20);
  });

  it('SDF 热态构建 < 20ms', () => {
    const { ctx, field, project } = makeContext();
    const hydro = buildHydroRoadPackage(project);
    const build = (): ReturnType<typeof buildObstacleGrid> =>
      buildObstacleGrid({
        worldSizeM: project.meta.worldSizeM,
        elevationField: field,
        globalMaxSlope: 36,
        rivers: hydro.rivers,
        waterBodies: hydro.waterBodies,
        canals: hydro.canals,
        roads: hydro.roads,
        walls: [],
        exclusionPolys: ctx.exclusionPolys,
      });
    build();
    let elapsed = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      build();
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    expect(elapsed).toBeLessThan(20);
    console.log(`[M2] SDF 512² 热态 ${elapsed.toFixed(2)}ms`);
  });

  it('guardSafeBuilding 拒绝河心/路面，接受空地并返回带品牌符号的安全屋', () => {
    const { project, ctx } = makeContext();
    const zone = project.zones[1];
    expect(zone).toBeDefined();
    if (!zone) return;
    const riverHit = guardSafeBuilding(
      rect(600, 900, 12, 8),
      zone,
      { roofKind: 'town', kind: 'house' },
      ctx,
    );
    expect(riverHit).toBeNull();
    const roadHit = guardSafeBuilding(
      rect(600, 500, 12, 8),
      zone,
      { roofKind: 'town', kind: 'house' },
      ctx,
    );
    expect(roadHit).toBeNull();
    const ok = guardSafeBuilding(
      rect(200, 300, 14, 10),
      zone,
      { roofKind: 'town', kind: 'house' },
      ctx,
    );
    expect(ok).not.toBeNull();
    if (ok) {
      expect(ok.areaM2).toBeGreaterThan(18);
      expect(Object.getOwnPropertySymbols(ok).length).toBeGreaterThan(0);
    }
    const fence = guardSafeFence(rect(600, 500, 18, 14), zone, ctx);
    expect(fence).toBeNull();
    const treeInExclusion = guardSafeTree(950, 300, 5, 'woodland', zone, ctx);
    expect(treeInExclusion).toBeNull();
    const treeOk = guardSafeTree(320, 300, 5, 'garden', zone, ctx);
    expect(treeOk).not.toBeNull();
    if (treeOk) expect(Object.getOwnPropertySymbols(treeOk).length).toBeGreaterThan(0);
  });

  it('V2.0.3 grid 缺失时 guardSafeTree 仍拒绝落水/压路/撞墙树木', () => {
    const { project, ctx } = makeContext();
    const zone = project.zones[1];
    if (!zone) return;
    ctx.grid = null;
    ctx.wallsBuilt.push({ id: 'w_g', thicknessM: 6, polyline: [[300, 200], [500, 200]] });
    expect(guardSafeTree(400, 200, 6, 'woodland', zone, ctx)).toBeNull();
    expect(guardSafeTree(400, 900, 6, 'woodland', zone, ctx)).toBeNull();
    expect(guardSafeTree(600, 300, 6, 'woodland', zone, ctx)).toBeNull();
    expect(guardSafeTree(200, 200, 6, 'woodland', zone, ctx)).not.toBeNull();
  });

  it('R2-P2 grid 缺失时仍执行解析水/路/墙净空检测', () => {
    const { project, ctx } = makeContext();
    const zone = project.zones[1];
    if (!zone) return;
    ctx.grid = null;
    expect(guardSafeBuilding(rect(600, 500, 12, 8), zone, { roofKind: 'town', kind: 'house' }, ctx)).toBeNull();
    expect(guardSafeBuilding(rect(600, 900, 12, 8), zone, { roofKind: 'town', kind: 'house' }, ctx)).toBeNull();
  });
});

function rect(cx: number, cy: number, w: number, h: number): Polygon {
  const hw = 0.5 * w;
  const hh = 0.5 * h;
  const pts: Vec2[] = [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
  return pts;
}


describe('V2.0.1 · 水文与开放折线对抗回归', () => {
  it('双急弯大幅变宽河道 repairBank 双向收缩后零自交', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 2000 },
      rivers: [
        {
          id: 'riv_double_bend',
          name: '双急弯宽河',
          points: [
            [180, 1000],
            [480, 1000],
            [660, 690],
            [860, 1010],
            [1080, 690],
            [1420, 690],
          ],
          widthStartM: 180,
          widthEndM: 60,
          rippleLines: 3,
        },
      ],
    });
    const built = buildRiverGeometry(project.rivers[0]!);
    expect(built.islands.length).toBe(0);
    expect(selfIntersects([...built.bankPolygon, built.bankPolygon[0]!])).toBe(false);
    expect(built.halfWidths.length).toBe(built.centerline.length);
  });

  it('开放折线距离不再被强转多边形误判为 0', () => {
    const poly: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const openLine: Polyline = [[-5, -5], [25, -5], [25, 15], [-5, 15]];
    const dist = minDistPolyToPolyline(poly, openLine);
    expect(dist).toBeGreaterThan(4.9);
    expect(dist).toBeLessThan(5.1);
  });

  it('斜交桥取跨度两端较大河宽，桥角不再悬水', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      roads: [{ id: 'rd_cross', name: '跨河干道', tier: 'highway', widthM: 14, points: [[800, 120], [800, 1500]] }],
      rivers: [
        {
          id: 'riv_taper',
          name: '剧变宽河',
          points: [[600, 800], [1000, 800]],
          widthStartM: 12,
          widthEndM: 90,
          rippleLines: 2,
        },
      ],
    });
    const pkg = buildHydroRoadPackage(project);
    const river = pkg.rivers[0];
    expect(river).toBeDefined();
    expect(pkg.bridges.length).toBe(1);
    const bridge = pkg.bridges[0]!;
    const atCrossing = river?.widthAtU(0.5) ?? 0;
    expect(bridge.riverWidthM).toBeGreaterThan(atCrossing + 2);
  });
});


describe('V2.0.2 · 坡宽法向 / 焦点优先 / 窄渠岸线对抗回归', () => {
  it('R2-5 朝东陡坎左侧坡宽柄位于 -Y 侧', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      terrain: {
        baseElev: 300,
        shapes: [
          { id: 'rdg', type: 'ridge', points: [[100, 500], [400, 500], [700, 500]], deltaElev: 20, widthLeft: 80, widthRight: 40 },
        ],
      },
    });
    const selection = { type: 'terrainShape' as const, id: 'rdg' };
    const left = hitTestActiveHandles(project, selection, 400, 420, null);
    expect(left?.kind).toBe('shape_width_left');
    const right = hitTestActiveHandles(project, selection, 400, 540, null);
    expect(right?.kind).toBe('shape_width_right');
  });

  it('R2-5 居中丘陵中心优先命中偏心焦点柄', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      terrain: {
        baseElev: 300,
        shapes: [
          { id: 'hill0', type: 'hill', cx: 600, cy: 600, rx: 220, ry: 160, angleDeg: 0, deltaElev: 45, focusX: 0, focusY: 0 },
        ],
      },
    });
    const hit = hitTestActiveHandles(project, { type: 'terrainShape', id: 'hill0' }, 600, 600, null);
    expect(hit?.kind).toBe('shape_focus');
  });

  it('R2-9 1.6m 窄水渠急弯零自交且半宽不被反向撑大', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600 },
      canals: [
        { id: 'cn_narrow', name: '窄渠', style: 'open', points: [[200, 300], [500, 800], [800, 300]], widthM: 1.6 },
      ],
    });
    const built = buildCanalGeometry(project.canals[0]!);
    expect(selfIntersects([...built.bankPolygon, built.bankPolygon[0]!])).toBe(false);
    const minHalf = Math.min(...built.halfWidths);
    expect(minHalf).toBeLessThanOrEqual(0.81);
    expect(minHalf).toBeGreaterThanOrEqual(0.25);
  });
});
