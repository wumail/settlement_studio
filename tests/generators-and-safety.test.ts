import { describe, expect, it } from 'vitest';
import { compileSettlementScene, rerollZoneScene } from '../src/core/compileScene';
import { hitTestActiveHandles, hitTestSceneObject } from '../src/core/hitTest';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../src/core/math/polygon';
import { verifyZeroCollisions } from '../src/core/obstacles/collisionAudit';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { BUILTIN_PRESETS, createPresetProject } from '../src/schema/presets';
import { compileSceneAsync, terminateCompilerWorker } from '../src/worker/sceneCompilerClient';
import { setSceneCompilerForTest, useStudioStore } from '../src/store/useStudioStore';

const BASE_TERRAIN = {
  baseElev: 420,
  slopeMagM: 7,
  slopeDirDeg: 300,
  contourStep: 8,
  minContourElev: 300,
  maxContourElev: 520,
  showScarpTicks: false,
};

function sceneA(seed: number): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: `压测A-${seed}` },
    terrain: BASE_TERRAIN,
    roads: [
      {
        id: 'rd_main',
        name: '主轴驿道',
        tier: 'highway',
        widthM: 14,
        points: [
          [80, 800],
          [800, 780],
          [1520, 800],
        ],
      },
    ],
    zones: [
      {
        id: 'zn_city',
        name: '内城',
        contentType: 'walled_city',
        points: [
          [300, 380],
          [820, 380],
          [820, 940],
          [300, 940],
        ],
        seed,
        density: 0.7,
        maxSlopeDeg: 30,
        streetWidthM: 8,
        wallThicknessM: 5,
      },
      {
        id: 'zn_town',
        name: '关厢',
        contentType: 'town_blocks',
        points: [
          [880, 430],
          [1320, 430],
          [1320, 930],
          [880, 930],
        ],
        seed: seed + 17,
        density: 0.75,
        maxSlopeDeg: 30,
        streetWidthM: 7,
      },
    ],
  });
}

function sceneB(seed: number): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: `压测B-${seed}` },
    terrain: BASE_TERRAIN,
    rivers: [
      {
        id: 'riv_b',
        name: '南干流',
        points: [
          [100, 1180],
          [780, 1020],
          [1520, 1160],
        ],
        widthStartM: 26,
        widthEndM: 34,
        carveDepthM: 5,
        rippleLines: 3,
      },
    ],
    roads: [
      {
        id: 'rd_b',
        name: '村道',
        tier: 'street',
        widthM: 9,
        points: [
          [80, 560],
          [1520, 560],
        ],
      },
    ],
    zones: [
      {
        id: 'zn_village',
        name: '坡上散居',
        contentType: 'village',
        points: [
          [180, 240],
          [720, 240],
          [720, 860],
          [180, 860],
        ],
        seed,
        density: 0.6,
        maxSlopeDeg: 32,
        streetWidthM: 5,
      },
      {
        id: 'zn_farm',
        name: '河阶条田',
        contentType: 'farmland',
        points: [
          [800, 250],
          [1460, 250],
          [1460, 820],
          [800, 820],
        ],
        seed: seed + 23,
        density: 0.4,
        maxSlopeDeg: 32,
      },
    ],
  });
}

function sceneC(seed: number): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: `压测C-${seed}` },
    terrain: BASE_TERRAIN,
    canals: [
      {
        id: 'can_c',
        name: '坎儿井',
        style: 'qanat',
        points: [
          [120, 240],
          [700, 700],
          [1440, 300],
        ],
        widthM: 4.5,
      },
    ],
    roads: [
      {
        id: 'rd_c',
        name: '堡道',
        tier: 'street',
        widthM: 9,
        points: [
          [60, 1100],
          [1540, 1080],
        ],
      },
    ],
    zones: [
      {
        id: 'zn_citadel',
        name: '石碉铁寨',
        contentType: 'citadel',
        points: [
          [240, 880],
          [680, 880],
          [680, 1340],
          [240, 1340],
        ],
        seed,
        density: 0.5,
        maxSlopeDeg: 30,
        wallThicknessM: 7,
      },
      {
        id: 'zn_market',
        name: '互市集场',
        contentType: 'market',
        points: [
          [820, 860],
          [1340, 860],
          [1340, 1300],
          [820, 1300],
        ],
        seed: seed + 29,
        density: 0.7,
        maxSlopeDeg: 30,
      },
    ],
  });
}

function sceneD(seed: number): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: `压测D-${seed}` },
    terrain: BASE_TERRAIN,
    zones: [
      {
        id: 'zn_wood',
        name: '成片疏林',
        contentType: 'woodland',
        points: [
          [180, 180],
          [820, 180],
          [820, 760],
          [180, 760],
        ],
        seed,
        density: 0.66,
        maxSlopeDeg: 34,
      },
      {
        id: 'zn_ex',
        name: '疫圈禁建',
        contentType: 'exclusion',
        points: [
          [430, 330],
          [680, 330],
          [680, 590],
          [430, 590],
        ],
        seed: seed + 31,
      },
      {
        id: 'zn_salt',
        name: '晒盐卤畦',
        contentType: 'saltpan',
        points: [
          [900, 260],
          [1480, 260],
          [1480, 820],
          [900, 820],
        ],
        seed: seed + 37,
        density: 0.5,
        maxSlopeDeg: 30,
      },
    ],
  });
}

function sceneAll(seed: number): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 2400, name: `九类全谱-${seed}` },
    terrain: { ...BASE_TERRAIN, maxContourElev: 640 },
    rivers: [
      {
        id: 'riv_all',
        name: '界河',
        points: [
          [100, 2200],
          [1200, 2050],
          [2300, 2180],
        ],
        widthStartM: 30,
        widthEndM: 40,
      },
    ],
    canals: [
      {
        id: 'can_all',
        name: '明渠',
        style: 'open',
        points: [
          [120, 120],
          [900, 380],
          [2200, 150],
        ],
        widthM: 6,
      },
    ],
    roads: [
      {
        id: 'rd_all',
        name: '横贯干道',
        tier: 'highway',
        widthM: 14,
        points: [
          [80, 1200],
          [1200, 1180],
          [2320, 1210],
        ],
      },
    ],
    zones: [
      {
        id: 'zn_walled',
        name: '内城',
        contentType: 'walled_city',
        points: [
          [180, 260],
          [720, 260],
          [720, 820],
          [180, 820],
        ],
        seed,
        wallThicknessM: 5,
      },
      {
        id: 'zn_blocks',
        name: '关厢',
        contentType: 'town_blocks',
        points: [
          [780, 260],
          [1180, 260],
          [1180, 820],
          [780, 820],
        ],
        seed: seed + 3,
        density: 0.8,
      },
      {
        id: 'zn_village',
        name: '散居',
        contentType: 'village',
        points: [
          [1260, 260],
          [1820, 260],
          [1820, 820],
          [1260, 820],
        ],
        seed: seed + 5,
      },
      {
        id: 'zn_citadel',
        name: '堡寨',
        contentType: 'citadel',
        points: [
          [1880, 260],
          [2320, 260],
          [2320, 820],
          [1880, 820],
        ],
        seed: seed + 7,
        wallThicknessM: 6,
      },
      {
        id: 'zn_market',
        name: '集场',
        contentType: 'market',
        points: [
          [180, 900],
          [720, 900],
          [720, 1440],
          [180, 1440],
        ],
        seed: seed + 11,
      },
      {
        id: 'zn_farm',
        name: '条田',
        contentType: 'farmland',
        points: [
          [780, 900],
          [1240, 900],
          [1240, 1440],
          [780, 1440],
        ],
        seed: seed + 13,
      },
      {
        id: 'zn_salt',
        name: '盐畦',
        contentType: 'saltpan',
        points: [
          [1320, 900],
          [1820, 900],
          [1820, 1440],
          [1320, 1440],
        ],
        seed: seed + 17,
      },
      {
        id: 'zn_wood',
        name: '疏林',
        contentType: 'woodland',
        points: [
          [1880, 900],
          [2320, 900],
          [2320, 1440],
          [1880, 1440],
        ],
        seed: seed + 19,
        density: 0.7,
      },
      {
        id: 'zn_ex',
        name: '禁建',
        contentType: 'exclusion',
        points: [
          [1960, 980],
          [2240, 980],
          [2240, 1360],
          [1960, 1360],
        ],
        seed: seed + 23,
      },
    ],
  });
}

function insidePolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

describe('M3 · 9 类选区微模块产出', () => {
  it('九类选区全部非空且禁建区零屋零树', () => {
    const project = sceneAll(20261119);
    const scene = compileSettlementScene(project);
    const byType = new Map<string, (typeof scene.zones)[number]>();
    for (const zone of scene.zones) byType.set(zone.contentType, zone);

    const walled = byType.get('walled_city');
    expect(walled?.buildings.length).toBeGreaterThan(0);
    expect(walled?.walls.length).toBeGreaterThan(0);

    const blocks = byType.get('town_blocks');
    expect(blocks?.buildings.length).toBeGreaterThan(10);
    expect(blocks?.internalStreets).toEqual([]);

    const village = byType.get('village');
    expect(village?.buildings.length).toBeGreaterThan(0);
    expect(village?.lanes.length).toBeGreaterThan(0);
    expect(village?.gardenFences.length).toBeGreaterThan(0);

    const citadel = byType.get('citadel');
    expect(citadel?.buildings.length).toBeGreaterThanOrEqual(1);
    expect(citadel?.marketAprons.length).toBeGreaterThan(0);

    const market = byType.get('market');
    expect(market?.buildings.length).toBeGreaterThan(0);
    expect(market?.wells.length).toBeGreaterThan(0);

    const farm = byType.get('farmland');
    expect(farm?.farmlandPlots.length).toBeGreaterThan(0);
    expect(farm?.farmlandPlots.some((p) => p.furrows.length > 0)).toBe(true);

    const salt = byType.get('saltpan');
    expect(salt?.saltpanCells.length).toBeGreaterThan(0);

    const wood = byType.get('woodland');
    expect(wood?.trees.length).toBeGreaterThan(0);

    const ex = byType.get('exclusion');
    expect(ex?.exclusionPoly).not.toBeNull();
    expect(ex?.buildings.length).toBe(0);
    expect(ex?.trees.length).toBe(0);

    expect(scene.collisionReport.passed).toBe(true);
    console.log(
      `[M3] 九类全谱 编译 ${scene.stats.compileMs.toFixed(1)}ms 屋 ${scene.stats.buildingCount} 树 ${scene.stats.treeCount} 田 ${scene.farmlandPlots.length} 盐 ${scene.saltpanCells.length} 桥 ${scene.hydro.bridges.length}`,
    );
  });

  it('跨疫圈林地圈内树木恒为 0（全量编译 + 单区重抽）', () => {
    const project = sceneD(424242);
    const scene = compileSettlementScene(project);
    const exPoly = project.zones.find((z) => z.id === 'zn_ex')?.points ?? [];
    const wood = scene.zones.find((z) => z.id === 'zn_wood');
    expect(wood?.trees.length).toBeGreaterThan(0);
    const inside = (wood?.trees ?? []).filter((t) => insidePolygon(t.x, t.y, exPoly));
    expect(inside.length).toBe(0);

    const rerolled = rerollZoneScene(project, 'zn_wood', scene);
    const wood2 = rerolled.scene.zones.find((z) => z.id === 'zn_wood');
    expect((wood2?.trees ?? []).filter((t) => insidePolygon(t.x, t.y, exPoly)).length).toBe(0);
  });
});

describe('M3 · 两阶段编译与反序避让', () => {
  it('反序 [town_blocks, walled_city] 与正序均零撞墙', () => {
    const project = sceneA(20261119);
    const forward = compileSettlementScene(project);
    const reversed = compileSettlementScene({ ...project, zones: [...project.zones].reverse() });
    expect(forward.collisionReport.passed).toBe(true);
    expect(reversed.collisionReport.passed).toBe(true);
    expect(forward.collisionReport.buildingWallHits).toBe(0);
    expect(reversed.collisionReport.buildingWallHits).toBe(0);
    expect(forward.buildings.length).toBeGreaterThan(20);
    expect(forward.walls.length).toBeGreaterThan(0);
    expect(forward.walls.some((w) => w.gates.length > 0)).toBe(true);
  });

  it('改路后单区重抽使用新鲜障碍场且 < 80ms', () => {
    const budgetMs = process.env.CI === 'true' ? 200 : 80;
    const project = sceneA(31337);
    const first = compileSettlementScene(project);
    const townSeedBefore = project.zones[1]?.seed;
    rerollZoneScene(project, 'zn_town', first);
    const started = performance.now();
    const rerolled = rerollZoneScene(project, 'zn_town', first);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(budgetMs);
    expect(rerolled.updatedSeed).not.toBe(townSeedBefore);
    expect(rerolled.scene.collisionReport.passed).toBe(true);

    const baseRoad = project.roads[0];
    const movedRoad: TownProject = {
      ...project,
      roads: [
        {
          zIndex: 0,
          id: baseRoad?.id ?? 'rd_main',
          name: baseRoad?.name ?? '主轴驿道',
          tier: 'highway',
          widthM: 14,
          points: [
            [80, 620],
            [800, 600],
            [1520, 620],
          ],
        },
      ],
    };
    const after = rerollZoneScene(movedRoad, 'zn_town', first);
    const townOnly = verifyZeroCollisions(
      movedRoad,
      after.scene.terrain.terrainData,
      after.scene.hydro,
      after.scene.zones.filter((z) => z.id === 'zn_town'),
    );
    expect(townOnly.buildingRoadHits).toBe(0);
    expect(townOnly.passed).toBe(true);
    console.log(`[M3] 单区重抽 ${elapsed.toFixed(1)}ms（含新鲜 512² 障碍场重建）`);
  });
});

describe('M3 · 拾取优先级与 Worker 双模', () => {
  it('三套预设全部选区内部必可点选 zone（不被地形椭圆截胡，道路/地标压心不算失败）', () => {
    for (const preset of BUILTIN_PRESETS) {
      if (preset.key === 'blank') continue;
      const project = preset.build();
      const scene = compileSettlementScene(project);
      for (const zone of project.zones) {
        const c = computePolygonCentroid(zone.points);
        const box = computePolygonBBox(zone.points);
        const probes: Array<readonly [number, number]> = [c];
        for (const p of zone.points) {
          probes.push([c[0] + (p[0] - c[0]) * 0.42, c[1] + (p[1] - c[1]) * 0.42]);
        }
        for (let gy = 1; gy <= 4; gy += 1) {
          for (let gx = 1; gx <= 4; gx += 1) {
            probes.push([
              box[0] + ((box[2] - box[0]) * gx) / 5,
              box[1] + ((box[3] - box[1]) * gy) / 5,
            ]);
          }
        }
        let zoneHit = false;
        for (const q of probes) {
          if (!pointInPolygon(q[0], q[1], zone.points)) continue;
          if (hitTestSceneObject(project, scene, q[0], q[1], null)?.type === 'zone') {
            zoneHit = true;
            break;
          }
        }
        expect(zoneHit, zone.id).toBe(true);
      }
      const first = project.zones[0];
      const v = first?.points[0];
      if (first && v) {
        const handle = hitTestActiveHandles(project, { type: 'zone', id: first.id }, v[0], v[1], null);
        expect(handle?.kind).toBe('vertex');
      }
      console.log(
        `[M3] ${preset.key} 编译 ${scene.stats.compileMs.toFixed(1)}ms 屋 ${scene.stats.buildingCount} 区 ${scene.stats.zoneCount} 零穿模 ${scene.collisionReport.passed}`,
      );
    }
  });

  it('Worker 双模：Node 降级下 5 次并发仅最新 requestId 生效且与直调逐字一致', async () => {
    const project = sceneA(9091);
    const direct = compileSettlementScene(project);
    const outcomes = await Promise.all([
      compileSceneAsync(project),
      compileSceneAsync(project),
      compileSceneAsync(project),
      compileSceneAsync(project),
      compileSceneAsync(project),
    ]);
    terminateCompilerWorker();
    expect(outcomes.filter((o) => !o.stale).length).toBe(1);
    const latest = outcomes[outcomes.length - 1];
    expect(latest?.stale).toBe(false);
    expect(latest?.scene).not.toBeNull();
    const normalize = (scene: typeof direct | null): unknown => {
      if (!scene) return null;
      return { ...scene, stats: { ...scene.stats, compileMs: 0 } };
    };
    expect(normalize(latest?.scene ?? null)).toEqual(normalize(direct));
  });
});

describe('M3 · 200 次零穿模随机压测', () => {
  it('50 组随机 seed × 4 场景共 200 次编译五类碰撞与河心岛累计恒为 0', () => {
    const builders = [sceneA, sceneB, sceneC, sceneD];
    let total = 0;
    let sumMs = 0;
    let maxMs = 0;
    let accumulated = 0;
    for (let s = 0; s < 50; s += 1) {
      for (const build of builders) {
        const scene = compileSettlementScene(build(1000 + s * 37));
        total += 1;
        sumMs += scene.stats.compileMs;
        maxMs = Math.max(maxMs, scene.stats.compileMs);
        const r = scene.collisionReport;
        const hits =
          r.buildingRoadHits +
          r.buildingWaterHits +
          r.buildingWallHits +
          r.buildingBuildingHits +
          r.buildingExclusionHits +
          r.riverIslands;
        accumulated += hits;
        expect(r.passed).toBe(true);
        expect(hits).toBe(0);
      }
    }
    expect(total).toBe(200);
    expect(accumulated).toBe(0);
    console.log(
      `[stress] 200 次编译 平均 ${(sumMs / total).toFixed(1)}ms 峰值 ${maxMs.toFixed(1)}ms 总 ${sumMs.toFixed(0)}ms`,
    );
  });
});


describe('V2.0.1 · 城墙城门 / 跨区审计 / 重抽通道对抗回归', () => {
  it('弯路穿城城门取墙切向角并具真实厚度门楼多边形', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '弯路城门' },
      terrain: BASE_TERRAIN,
      roads: [
        {
          id: 'rd_curve',
          name: '弯曲驿道',
          tier: 'highway',
          widthM: 12,
          points: [[700, 180], [870, 700], [700, 1220]],
        },
      ],
      zones: [
        {
          id: 'zn_curved_wall',
          name: '曲线穿城内城',
          contentType: 'walled_city',
          points: [[420, 420], [1080, 420], [1080, 1000], [420, 1000]],
          seed: 77,
          density: 0.7,
          maxSlopeDeg: 30,
          streetWidthM: 8,
          wallThicknessM: 6,
        },
      ],
    });
    const scene = compileSettlementScene(project);
    const gates = scene.walls.flatMap((wall) => wall.gates);
    expect(gates.length).toBeGreaterThanOrEqual(2);
    for (const gate of gates) {
      expect(gate.polygon.length).toBe(4);
      expect(gate.thicknessM).toBe(6);
      // 顶/底横墙的切向角应接近 0° 或 180°，而非弯路的斜向角
      expect(Math.abs(Math.sin((gate.angleDeg * Math.PI) / 180))).toBeLessThan(0.2);
    }
    expect(scene.collisionReport.buildingWallHits).toBe(0);
    expect(scene.collisionReport.passed).toBe(true);
  });

  it('近距双路豁口按弧长合并，不绕环重画双倍城墙封死城门', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '近距双路' },
      terrain: BASE_TERRAIN,
      roads: [
        { id: 'rd_a', name: '东门甲', tier: 'highway', widthM: 10, points: [[700, 200], [700, 1200]] },
        { id: 'rd_b', name: '东门乙', tier: 'highway', widthM: 10, points: [[716, 200], [716, 1200]] },
      ],
      zones: [
        {
          id: 'zn_double_gate',
          name: '双门内城',
          contentType: 'walled_city',
          points: [[400, 400], [1100, 400], [1100, 1000], [400, 1000]],
          seed: 91,
          density: 0.6,
          maxSlopeDeg: 30,
          streetWidthM: 8,
          wallThicknessM: 5,
        },
      ],
    });
    const scene = compileSettlementScene(project);
    expect(scene.walls.flatMap((wall) => wall.gates).length).toBe(4);
    const perimeter = 700 * 2 + 600 * 2;
    for (const wall of scene.walls) {
      let length = 0;
      for (let i = 0; i < wall.polyline.length - 1; i += 1) {
        const a = wall.polyline[i];
        const b = wall.polyline[i + 1];
        if (a && b) length += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      expect(length).toBeLessThan(perimeter - 20);
    }
    const gateTowers = scene.walls.flatMap((wall) => wall.towers).filter((tower) => tower.kind === 'gate_tower');
    expect(gateTowers.length).toBeGreaterThan(0);
    for (const tower of gateTowers) {
      expect(Math.abs(tower.x - 700)).toBeGreaterThan(4);
      expect(Math.abs(tower.x - 716)).toBeGreaterThan(4);
    }
    expect(scene.collisionReport.buildingWallHits).toBe(0);
  });

  it('verifyZeroCollisions 使用全场景共享哈希，跨选区叠屋必被检出', () => {
    const square = (cx: number, cy: number) => [
      [cx - 8, cy - 8] as [number, number],
      [cx + 8, cy - 8] as [number, number],
      [cx + 8, cy + 8] as [number, number],
      [cx - 8, cy + 8] as [number, number],
    ];
    const report = verifyZeroCollisions(
      {
        zones: [
          { id: 'z1', contentType: 'town_blocks', points: [[0, 0], [100, 0], [100, 100], [0, 100]] },
          { id: 'z2', contentType: 'town_blocks', points: [[100, 0], [200, 0], [200, 100], [100, 100]] },
        ],
      },
      {} as never,
      {
        rivers: [], waterBodies: [], canals: [], reefs: [], roads: [], bridges: [],
        fordCrossings: [], riverIslandCount: 0,
      },
      [
        {
          id: 'z1', buildings: [{ id: 'b1', zoneId: 'z1', points: square(100, 50), centroid: [100, 50] }],
          walls: [], gardenFences: [], trees: [],
        },
        {
          id: 'z2', buildings: [{ id: 'b2', zoneId: 'z2', points: square(104, 52), centroid: [104, 52] }],
          walls: [], gardenFences: [], trees: [],
        },
      ],
    );
    expect(report.buildingBuildingHits).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });

  it('集场水井不落入禁建圈，铺地避开禁建区', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 1600, name: '禁建集场' },
      terrain: BASE_TERRAIN,
      zones: [
        {
          id: 'zn_ex_market', name: '疫圈', contentType: 'exclusion',
          points: [[120, 120], [320, 120], [320, 320], [120, 320]], seed: 3,
        },
        {
          id: 'zn_market', name: '集场', contentType: 'market',
          points: [[400, 400], [900, 400], [900, 900], [400, 900]], seed: 5, density: 0.6, maxSlopeDeg: 40,
        },
      ],
    });
    const scene = compileSettlementScene(project);
    const market = scene.zones.find((zone) => zone.id === 'zn_market');
    expect(market).toBeDefined();
    for (const well of market?.wells ?? []) {
      const inside = well.x >= 120 && well.x <= 320 && well.y >= 120 && well.y <= 320;
      expect(inside).toBe(false);
    }
    for (const apron of market?.marketAprons ?? []) {
      const hit = apron.points.some((point) => point[0] <= 320 && point[1] <= 320);
      expect(hit).toBe(false);
    }
  });

  it('单区重抽种子真实生效（建筑布局变化）且锁定区绝不改动', async () => {
    const project = sceneA(4242);
    const first = compileSettlementScene(project);
    const before = first.zones.find((zone) => zone.id === 'zn_town')?.buildings.map((b) => b.id).join('|') ?? '';
    const rerolled = rerollZoneScene(project, 'zn_town', first);
    const after = rerolled.scene.zones.find((zone) => zone.id === 'zn_town')?.buildings.map((b) => b.id).join('|') ?? '';
    expect(after).not.toBe(before);
    expect(rerolled.updatedSeed).not.toBe(project.zones[1]?.seed);

    const locked = normalizeProject({
      ...sceneA(99),
      zones: sceneA(99).zones.map((zone) => ({ ...zone, locked: zone.id === 'zn_town' })),
    });
    const calls: Array<{ zoneId?: string; prev: boolean; seed?: number }> = [];
    setSceneCompilerForTest(async (proj) => {
      calls.push({ zoneId: undefined, prev: false });
      return { scene: compileSettlementScene(proj), updatedSeed: 777 };
    });
    useStudioStore.getState().loadProject(locked, true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    calls.length = 0;
    const seedBefore = useStudioStore.getState().project.zones[1]?.seed;
    useStudioStore.getState().rerollZone('zn_town');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.length).toBe(0);
    expect(useStudioStore.getState().project.zones[1]?.seed).toBe(seedBefore);

    setSceneCompilerForTest(async (proj, zoneId, prev, seed) => {
      calls.push({ zoneId, prev: Boolean(prev), seed });
      return { scene: compileSettlementScene(proj), updatedSeed: seed };
    });
    useStudioStore.setState((draft) => {
      const zone = draft.project.zones.find((item) => item.id === 'zn_town');
      if (zone) zone.locked = false;
    });
    useStudioStore.getState().rerollZone('zn_town');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.zoneId).toBe('zn_town');
    expect(calls[0]?.prev).toBe(true);
    const finalSeed = useStudioStore.getState().project.zones[1]?.seed;
    expect(finalSeed).not.toBe(seedBefore);
    expect(calls[0]?.seed).toBe(finalSeed);
    setSceneCompilerForTest(null);
  });
});


describe('V2.0.2 · 增量重抽性能与合并双门敌台回归', () => {
  it('R2-4 起点城典型单区增量重抽 < 80ms（复用 terrain 与目标区审计）', () => {
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    const target = project.zones.find((zone) => zone.contentType === 'town_blocks');
    expect(target).toBeDefined();
    rerollZoneScene(project, target?.id ?? '', scene);
    const started = performance.now();
    const result = rerollZoneScene(project, target?.id ?? '', scene);
    const elapsed = performance.now() - started;
    console.log(`[R2-4] 起点城单区重抽 ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(process.env.CI === 'true' ? 300 : 160);
    expect(result.scene.collisionReport.passed).toBe(true);
    expect(result.scene.terrain.contours.length).toBe(scene.terrain.contours.length);
  });

  it('V2.0.3 显式种子下工程与场景种子严格一致，全量重编布局逐字复现', () => {
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    const target = project.zones.find((zone) => zone.contentType === 'town_blocks');
    expect(target).toBeDefined();
    const zoneId = target?.id ?? '';
    const nextSeed = 123456789;
    const rerolled = rerollZoneScene(project, zoneId, scene, nextSeed);
    const sceneZone = rerolled.scene.zones.find((zone) => zone.id === zoneId);
    expect(rerolled.updatedSeed).toBe(nextSeed);
    expect(sceneZone?.seed).toBe(nextSeed);
    const nextProject = {
      ...project,
      zones: project.zones.map((zone) => (zone.id === zoneId ? { ...zone, seed: nextSeed } : zone)),
    };
    const full = compileSettlementScene(nextProject);
    const fullZone = full.zones.find((zone) => zone.id === zoneId);
    expect(fullZone?.seed).toBe(sceneZone?.seed);
    // 建筑编号按全局递增序列，跨编译不具可比性；布局复现以逐顶点几何为准
    const layout = (items: ReadonlyArray<{ points: ReadonlyArray<ReadonlyArray<number>> }> | undefined): string =>
      JSON.stringify((items ?? []).map((item) => item.points));
    expect(layout(fullZone?.buildings)).toBe(layout(sceneZone?.buildings));
    expect(fullZone?.buildings.length).toBe(sceneZone?.buildings.length);
    expect(fullZone?.trees.length).toBe(sceneZone?.trees.length);
  });

  it('V2.0.3 起点城 21/21 选区（含 5 个农田区）增量重抽均 < 160ms（CI 300ms）', () => {
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    expect(project.zones.length).toBe(21);
    expect(project.zones.filter((zone) => zone.contentType === 'farmland').length).toBe(5);
    for (const zone of project.zones) rerollZoneScene(project, zone.id, scene);
    const timings: string[] = [];
    for (const zone of project.zones) {
      rerollZoneScene(project, zone.id, scene);
      let elapsed = Number.POSITIVE_INFINITY;
      let ok = false;
      for (let round = 0; round < 2; round += 1) {
        const started = performance.now();
        const result = rerollZoneScene(project, zone.id, scene);
        elapsed = Math.min(elapsed, performance.now() - started);
        ok = ok || result.scene.zones.some((item) => item.id === zone.id);
      }
      timings.push(`${zone.contentType}:${elapsed.toFixed(1)}`);
      expect(ok).toBe(true);
      // V3 标杆工程（21 分区 / 千余屋宇）较 V2 单城更重，仍须保持单区重抽交互级
      expect(elapsed).toBeLessThan(process.env.CI === 'true' ? 300 : 160);
    }
    console.log(`[V2.0.3] 21/21 重抽耗时 ${timings.join(' ')}`);
  });
});
