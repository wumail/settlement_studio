import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProject, type TownProject } from '../src/schema/project.schema';
import { createPresetProject } from '../src/schema/presets';
import { compileSettlementScene } from '../src/core/compileScene';
import { computePolygonAreaSigned, pointInPolygon } from '../src/core/math/polygon';
import { pointToPolylineDist } from '../src/core/obstacles/collisionAudit';
import { buildSpatialRadar, querySpatialPoint } from '../src/ai/spatialBrief';
import { applySemanticOps } from '../src/ai/semanticOps';
import { buildRelativePolygon, sampleRiverWidthAtT } from '../src/ai/geometrySnap';
import { renderPreviewPng } from '../src/ai/previewRaster';
import { StudioSession, saveProjectAtomic } from '../src/ai/session';
import { createStudioMcpServer } from '../src/mcp/studioMcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BUILTIN_PRESETS } from '../src/schema/presets';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 800m 小世界：横河 + 方湖 + 水渠 + 一块台地选区 */
function fixture(extra: Record<string, unknown> = {}): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 800, name: '几何夹具' },
    terrain: { baseElev: 300, slopeMagM: 0, terrainNoiseAmpM: 0 },
    rivers: [
      { id: 'r1', name: '横河', points: [[100, 400], [700, 400]], widthStartM: 60, widthEndM: 60 },
    ],
    waterBodies: [
      { id: 'lake1', name: '方湖', kind: 'lake', points: [[560, 80], [720, 80], [720, 240], [560, 240]] },
    ],
    canals: [{ id: 'c1', name: '直渠', points: [[120, 650], [680, 650]], widthM: 8, style: 'stone_clean' }],
    zones: [
      { id: 'zt', name: '台地', contentType: 'town_blocks', points: [[240, 480], [360, 480], [360, 600], [240, 600]], seed: 3 },
    ],
    ...extra,
  });
}

function steepProject(): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 800, name: '陡坡' },
    terrain: { baseElev: 300, slopeMagM: 560, slopeDirDeg: 0, terrainNoiseAmpM: 0 },
    zones: [
      { id: 'steep', name: '陡坡镇区', contentType: 'town_blocks', points: [[300, 300], [500, 300], [500, 500], [300, 500]], seed: 2, maxSlopeDeg: 24 },
    ],
  });
}

function areaHa(points: ReadonlyArray<readonly [number, number]>): number {
  return Math.abs(computePolygonAreaSigned(points.map(([x, y]) => [x, y] as const))) / 10000;
}

describe('V4-1 · 选址雷达与编译诊断', () => {
  it('基准工程产出 64 格雷达（prime/steep/water 齐全）、河锚点与 21 区诊断', () => {
    const project = createPresetProject('losrumura');
    const scene = compileSettlementScene(project);
    const brief = buildSpatialRadar(project, scene);
    expect(brief.terrain.grid8x8.length).toBe(64);
    const kinds = new Set(brief.terrain.grid8x8.map((cell) => cell.buildability));
    expect(kinds.has('prime')).toBe(true);
    expect(kinds.has('steep')).toBe(true);
    expect(kinds.has('water')).toBe(true);
    expect(brief.zones.length).toBe(project.zones.length);
    expect(brief.zones.length).toBe(21);
    const longRiver = brief.rivers.find((river) => river.lengthM > 1800);
    expect(longRiver).toBeDefined();
    expect(longRiver?.anchors.length).toBe(9);
    expect(brief.zones.some((zone) => zone.status === 'ok')).toBe(true);
    for (const zone of brief.zones) {
      expect(zone.bbox[2]).toBeGreaterThanOrEqual(zone.bbox[0]);
      expect(zone.buildingCount + zone.treeCount + zone.plotCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('35° 陡坡上的 town_blocks 归因为 steep_slope 并写入 warnings', () => {
    const project = steepProject();
    const scene = compileSettlementScene(project);
    const brief = buildSpatialRadar(project, scene);
    const zone = brief.zones[0];
    expect(zone).toBeDefined();
    expect(zone?.status).toBe('empty_warning');
    expect(zone?.emptyReason).toBe('steep_slope');
    expect(zone?.meanSlopeDeg).toBeGreaterThan(30);
    expect(brief.warnings.some((line) => line.includes('陡坡镇区'))).toBe(true);
  });

  it('点位查询返回海拔/坡度/落水判定与最近河渠投影', () => {
    const project = fixture();
    const scene = compileSettlementScene(project);
    const onRiver = querySpatialPoint(project, scene, 400, 400);
    expect(onRiver.inWater).toBe(true);
    expect(onRiver.nearestRiver?.riverId).toBe('r1');
    expect(onRiver.nearestRiver?.t).toBeCloseTo(0.5, 1);
    expect(onRiver.nearestRiver?.distM).toBeLessThan(1);
    expect(['left', 'right']).toContain(onRiver.nearestRiver?.bank);
    const onLand = querySpatialPoint(project, scene, 400, 500);
    expect(onLand.inWater).toBe(false);
    expect(onLand.elevM).toBeCloseTo(300, 1);
    expect(onLand.nearestCanal?.canalId).toBe('c1');
  });
});

describe('V4-2 · 几何吸附与高层语义操作', () => {
  it('sampleRiverWidthAtT 实测宽表按弧长段内插值，不走等距近似', () => {
    const river = {
      points: [[0, 0], [100, 0], [300, 0]] as Array<[number, number]>,
      widthStartM: 10,
      widthEndM: 10,
      widthsM: [20, 40, 60],
    };
    expect(sampleRiverWidthAtT(river, 0)).toBe(20);
    expect(sampleRiverWidthAtT(river, 0.25)).toBe(35);
    expect(sampleRiverWidthAtT(river, 1 / 3)).toBe(40);
    // 弧长 150m 落在第二段 25% 处 → 40 + 20 × 0.25 = 45（等距近似会错给 40）
    expect(sampleRiverWidthAtT(river, 0.5)).toBeCloseTo(45, 5);
    expect(sampleRiverWidthAtT(river, 1)).toBe(60);
  });

  it('snap_weir 横跨两岸、过河心且与河向夹角 85°–95°', () => {
    const project = fixture();
    const { project: next, scene } = applySemanticOps(project, [
      { op: 'snap_weir', id: 'w1', name: '分水堰', riverId: 'r1', t: 0.5, overhangM: 8 },
    ]);
    const weir = next.weirs[0];
    expect(weir).toBeDefined();
    if (!weir) return;
    expect(pointToPolylineDist(weir.pStart[0], weir.pStart[1], [[100, 400], [700, 400]])).toBeGreaterThan(30);
    expect(pointToPolylineDist(weir.pEnd[0], weir.pEnd[1], [[100, 400], [700, 400]])).toBeGreaterThan(30);
    const mid: readonly [number, number] = [(weir.pStart[0] + weir.pEnd[0]) / 2, (weir.pStart[1] + weir.pEnd[1]) / 2];
    expect(Math.hypot(mid[0] - 400, mid[1] - 400)).toBeLessThan(2);
    const angle = Math.abs(Math.atan2(weir.pEnd[1] - weir.pStart[1], weir.pEnd[0] - weir.pStart[0]) * 180 / Math.PI);
    expect(angle).toBeGreaterThan(85);
    expect(angle).toBeLessThan(95);
    expect(scene.hydro.rivers.length).toBe(1);
  });

  it('snap_dock 栈桥沿 uy 入水：木质桥面质心落水、滑道垂岸下水', () => {
    const project = fixture();
    const { scene } = applySemanticOps(project, [
      { op: 'snap_dock', id: 'd_river', targetId: 'r1', targetKind: 'river', t: 0.5, bank: 'left', kind: 'wooden_pier' },
      { op: 'snap_dock', id: 'd_lake', targetId: 'lake1', targetKind: 'waterBody', t: 0.04, kind: 'wooden_pier' },
      { op: 'snap_dock', id: 'd_slip', targetId: 'r1', targetKind: 'river', t: 0.25, bank: 'left', kind: 'slipway', slips: 3 },
    ]);
    const riverWater = scene.hydro.rivers[0]?.bankPolygon ?? [];
    const lakeWater = project.waterBodies[0]?.points ?? [];
    const centroid = (poly: ReadonlyArray<readonly [number, number]>): [number, number] => {
      const sum = poly.reduce<[number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
      return [sum[0] / poly.length, sum[1] / poly.length];
    };
    const built = (id: string) => scene.hydraulic.docks.find((item) => item.id === id);
    const riverPier = built('d_river');
    const lakePier = built('d_lake');
    expect(riverPier?.deckPolygon).not.toBeNull();
    expect(lakePier?.deckPolygon).not.toBeNull();
    if (!riverPier?.deckPolygon || !lakePier?.deckPolygon) return;
    const riverDeck = centroid(riverPier.deckPolygon);
    const lakeDeck = centroid(lakePier.deckPolygon);
    expect(pointInPolygon(riverDeck[0], riverDeck[1], riverWater)).toBe(true);
    expect(pointInPolygon(lakeDeck[0], lakeDeck[1], lakeWater)).toBe(true);

    // 滑道：每道滑线沿垂岸法向（与河道切线夹角 90°），且一端在水里、一端在岸上
    const slip = built('d_slip');
    expect(slip?.slipLines.length).toBe(3);
    for (const line of slip?.slipLines ?? []) {
      const a = line[0];
      const b = line[1];
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dir: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      expect(Math.abs(dir[0] * 1 + dir[1] * 0)).toBeLessThan(1e-6);
      const aWet = pointInPolygon(a[0], a[1], riverWater);
      const bWet = pointInPolygon(b[0], b[1], riverWater);
      expect(aWet).not.toBe(bWet);
    }
  });

  it('snap_watermill 屋体坐干岸、水轮贴岸临水', () => {
    const project = fixture();
    const { project: next, scene } = applySemanticOps(project, [
      { op: 'snap_watermill', id: 'mill1', targetId: 'r1', targetKind: 'river', t: 0.4, bank: 'right' },
    ]);
    const mill = next.watermills[0];
    expect(mill).toBeDefined();
    const built = scene.hydraulic.watermills.find((item) => item.id === 'mill1');
    expect(built).toBeDefined();
    if (!mill || !built) return;
    expect(mill.wheelSide).toBe('left');
    // +ux 指向水心：横向河道上应为 ±90°（不再是平行水流的 0°）
    expect(Math.abs(Math.abs(mill.angleDeg) - 90)).toBeLessThan(1e-6);
    const riverWater = scene.hydro.rivers[0]?.bankPolygon ?? [];
    for (const corner of built.bodyPolygon) {
      expect(pointInPolygon(corner[0], corner[1], riverWater)).toBe(false);
    }
    const distToCenter = (p: readonly [number, number]): number => Math.abs(p[1] - 400);
    expect(distToCenter(built.wheelCenter)).toBeLessThan(distToCenter([mill.x, mill.y]));
    // 水轮在河岸近水侧：轮心已进入水面带（贴岸），而屋体仍在干岸
    expect(pointInPolygon(built.wheelCenter[0], built.wheelCenter[1], riverWater)).toBe(true);
  });

  it('place_zone 相对定位三种形状面积误差 < 5%，图幅内夹紧', () => {
    const project = fixture();
    const { project: next } = applySemanticOps(project, [
      { op: 'place_zone', id: 'z_rect', name: '矩形', contentType: 'woodland', relative: { anchor: [400, 200], shape: 'rect', areaHa: 1.2, aspectRatio: 1.6, rotationDeg: 12 }, seed: 1 },
      { op: 'place_zone', id: 'z_oct', name: '八边', contentType: 'woodland', relative: { anchor: [200, 250], shape: 'octagonal', areaHa: 0.9, rotationDeg: 0 }, seed: 2 },
      { op: 'place_zone', id: 'z_org', name: '有机', contentType: 'woodland', relative: { anchor: [600, 560], shape: 'organic', areaHa: 1.5, rotationDeg: 30 }, seed: 3 },
    ]);
    for (const [id, target] of [['z_rect', 1.2], ['z_oct', 0.9], ['z_org', 1.5]] as const) {
      const zone = next.zones.find((item) => item.id === id);
      expect(zone).toBeDefined();
      if (!zone) continue;
      expect(Math.abs(areaHa(zone.points) - target) / target).toBeLessThan(0.05);
      for (const [x, y] of zone.points) {
        expect(x).toBeGreaterThanOrEqual(20);
        expect(y).toBeGreaterThanOrEqual(20);
        expect(x).toBeLessThanOrEqual(780);
        expect(y).toBeLessThanOrEqual(780);
      }
    }
    const direct = buildRelativePolygon([200, 200], 'polygon_13', 2, 1, 0, 9, 800);
    expect(Math.abs(areaHa(direct) - 2) / 2).toBeLessThan(0.02);
  });

  it('set_terrain 与 upsert_terrain_shape 正确写入并参与编译', () => {
    const { project: next, scene } = applySemanticOps(fixture(), [
      { op: 'set_terrain', contourStep: 12, contourOpacity: 0.4 },
      { op: 'upsert_terrain_shape', id: 'hill_ai', type: 'hill', cx: 400, cy: 300, rx: 120, ry: 90, deltaElev: 50 },
    ]);
    expect(next.terrain.contourStep).toBe(12);
    expect(next.terrain.contourOpacity).toBe(0.4);
    const hill = next.terrain.shapes.find((item) => item.id === 'hill_ai');
    expect(hill).toBeDefined();
    expect(hill && 'cx' in hill ? hill.cx : 0).toBe(400);
    expect(scene.terrain.maxElev).toBeGreaterThan(300);
  });

  it('connect_road 从选区东边连到图幅东界，端点精确、折线平滑', () => {
    const project = fixture();
    const { project: next } = applySemanticOps(project, [
      {
        op: 'connect_road',
        id: 'rd_conn',
        name: '出城驿道',
        tier: 'highway',
        from: { zoneId: 'zt', side: 'east' },
        to: { edge: 'east', ratio: 0.5 },
        via: [{ zoneId: 'zt', side: 'south' }],
      },
    ]);
    const road = next.roads.find((item) => item.id === 'rd_conn');
    expect(road).toBeDefined();
    if (!road) return;
    expect(road.points[0]?.[0]).toBeCloseTo(360, 5);
    expect(road.points[0]?.[1]).toBeCloseTo(540, 5);
    const end = road.points[road.points.length - 1];
    expect(end?.[0]).toBeCloseTo(800, 5);
    expect(end?.[1]).toBeCloseTo(400, 5);
    expect(road.points.length).toBeGreaterThan(4);
    expect(road.tier).toBe('highway');
    expect(road.widthM).toBeGreaterThan(9);
  });

  it('apply_geo_bootstrap 更新地形/图幅/建议河网并保留确定性', () => {
    const project = fixture();
    const payload = {
      elevM: 910,
      slopeDirDeg: 45,
      slopeMagM: 32,
      query: { lon: 11.2, lat: 32.4, spanM: 1200 },
      regionNote: '台地',
      suggestedRivers: [
        { id: 'geo_r1', label: '建议河', widthStartM: 24, widthEndM: 36, localPoints: [[100, 600], [1100, 600]] as Array<[number, number]> },
      ],
    };
    const { project: next, scene } = applySemanticOps(project, [
      { op: 'apply_geo_bootstrap', payload, importRivers: true, clearExistingRivers: true },
    ]);
    expect(next.meta.worldSizeM).toBe(1200);
    expect(next.terrain.baseElev).toBe(910);
    expect(next.terrain.slopeDirDeg).toBe(45);
    expect(next.terrain.slopeMagM).toBe(32);
    expect(next.rivers.length).toBe(1);
    expect(next.rivers[0]?.id).toBe('geo_r1');
    expect(next.meta.terraxAnchor?.lon).toBe(11.2);
    expect(scene.hydro.rivers.length).toBe(1);
  });
});

describe('V4-3 · 多模态视觉自检渲染', () => {
  it('全图 PNG 魔数正确、>5000 bytes，gridOverlay 严格开关 AI 网格层', () => {
    const project = steepProject();
    const scene = compileSettlementScene(project);
    const plain = renderPreviewPng(project, scene, { widthPx: 480 });
    expect(Array.from(plain.pngBuffer.subarray(0, 8))).toEqual(PNG_MAGIC);
    expect(plain.pngBuffer.length).toBeGreaterThan(5000);
    expect(plain.svg).not.toContain('layer-ai-grid');
    expect(plain.worldBounds).toEqual([0, 0, 800, 800]);

    const grid = renderPreviewPng(project, scene, { widthPx: 480, gridOverlay: true });
    expect(grid.svg).toContain('layer-ai-grid');
    expect(grid.svg).toContain('stroke-dasharray="4 4"');
    expect(grid.pngBuffer.length).toBeGreaterThan(5000);
  });

  it('图例徽记在全图 SVG 中保持局部坐标：等高线/条田 path 不被二次平移', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 800, name: '图例夹具' },
      terrain: { baseElev: 300, slopeMagM: 12, terrainNoiseAmpM: 0, contourStep: 8 },
      rivers: [{ id: 'r1', name: '横河', points: [[100, 400], [700, 400]], widthStartM: 60, widthEndM: 60 }],
      zones: [
        { id: 'farm', name: '条田', contentType: 'farmland', points: [[120, 120], [320, 120], [320, 280], [120, 280]], seed: 1 },
      ],
    });
    const scene = compileSettlementScene(project);
    const svg = renderPreviewPng(project, scene, { widthPx: 800 }).svg;
    const start = svg.indexOf('id="layer-cartouche"');
    expect(start).toBeGreaterThan(0);
    const nextLayer = svg.indexOf('id="layer-', start + 10);
    const cartouche = svg.slice(start, nextLayer > 0 ? nextLayer : undefined);
    // 图例徽记统一走 pushTransform(x, y, 24/28, 15/18)，局部坐标应恒在 0..28 / 0..18
    const glyphs = cartouche.match(/<g transform="translate\([^)]*\) scale\(0\.857 0\.833\)">[\s\S]*?<\/g>/g) ?? [];
    expect(glyphs.length).toBeGreaterThanOrEqual(2);
    const numbers = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const pathsOf = (glyph: string): string[] => glyph.match(/<path d="[^"]*"/g) ?? [];
    const contour = glyphs.flatMap(pathsOf).find((path) => path.startsWith('<path d="M 1 6.4'));
    const farmland = glyphs.flatMap(pathsOf).find((path) => path.startsWith('<path d="M 1.6 4'));
    expect(contour, '图例缺少等高线徽记 path').toBeDefined();
    expect(farmland, '图例缺少条田徽记 path').toBeDefined();
    for (const glyph of glyphs) {
      for (const path of pathsOf(glyph)) {
        const nums = numbers(path.slice(path.indexOf('d="') + 3));
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(28.0001);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ys)).toBeLessThanOrEqual(18.0001);
      }
    }
  });

  it('局部特写收缩 worldBounds、不叠大图例，且仍输出合法 PNG', () => {
    const project = steepProject();
    const scene = compileSettlementScene(project);
    const crop = renderPreviewPng(project, scene, {
      widthPx: 480,
      mode: 'standard',
      crop: { zoneId: 'steep', padM: 40 },
    });
    const [minX, minY, maxX, maxY] = crop.worldBounds;
    expect(maxX - minX).toBeLessThan(800);
    expect(maxX - minX).toBeCloseTo(maxY - minY, 5);
    expect(minX).toBeLessThan(400);
    expect(maxX).toBeGreaterThan(400);
    expect(crop.svg).not.toContain('layer-cartouche');
    expect(crop.svg).not.toContain('图例');
    expect(Array.from(crop.pngBuffer.subarray(0, 8))).toEqual(PNG_MAGIC);
    expect(crop.pngBuffer.length).toBeGreaterThan(5000);
  });

  it('crop.entityId 支持水工/建筑群/地标/桥/房屋', () => {
    const project = fixture();
    const scene = compileSettlementScene(project);
    const wall = scene.buildings[0];
    expect(wall).toBeDefined();
    if (!wall) return;
    const crop = renderPreviewPng(project, scene, { widthPx: 400, crop: { entityId: wall.id, radiusM: 120 } });
    expect(crop.worldBounds[2] - crop.worldBounds[0]).toBeCloseTo(240, 5);
    expect(crop.pngBuffer.length).toBeGreaterThan(5000);
  });

  it('bbox 裁切以中心归一化为正方形视口', () => {
    const project = fixture();
    const scene = compileSettlementScene(project);
    const crop = renderPreviewPng(project, scene, {
      widthPx: 400,
      crop: { bbox: [200, 300, 500, 360] },
    });
    expect(crop.worldBounds[2] - crop.worldBounds[0]).toBeCloseTo(300, 5);
    expect(crop.worldBounds[3] - crop.worldBounds[1]).toBeCloseTo(300, 5);
    expect(crop.svg).not.toContain('layer-cartouche');
  });
});

type McpContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

function execCli(args: ReadonlyArray<string>): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli/studioCli.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
    return { status: 0, stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    return { status: failed.status ?? 1, stdout: failed.stdout ?? '' };
  }
}

describe('V4-5 · 共享会话与原子落盘', () => {
  it('20 步撤销栈封顶，受保护基准文件名默认拒绝覆盖', () => {
    const session = new StudioSession(fixture());
    for (let i = 0; i < 25; i += 1) {
      session.applyOps([{ op: 'reroll_zone', zoneId: 'zt' }]);
    }
    let undone = 0;
    while (session.undo()) undone += 1;
    expect(undone).toBe(20);
    expect(session.project.zones.find((zone) => zone.id === 'zt')).toBeDefined();
    const protectedName = BUILTIN_PRESETS.find((preset) => preset.key !== 'blank')?.filename ?? '';
    expect(protectedName.length).toBeGreaterThan(0);
    expect(() => saveProjectAtomic(join(tmpdir(), protectedName), session.project)).toThrowError(/受保护/);
  }, 120000);
});

describe('V4-5 · CLI 端到端闭环', () => {
  it('init → apply → inspect → render → export 全部退出码 0，受保护文件名默认拦截', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-cli-'));
    try {
      const projectA = join(dir, 'project.json');
      const init = execCli(['init', '--out', projectA, '--preset', 'blank', '--world-size', '800', '--name', 'CLI 测试', '--subtitle', '端到端']);
      expect(init.status).toBe(0);
      const initJson = JSON.parse(init.stdout) as { ok: boolean; path: string; brief: { meta: { worldSizeM: number } } };
      expect(initJson.ok).toBe(true);
      expect(initJson.brief.meta.worldSizeM).toBe(800);
      expect(existsSync(projectA)).toBe(true);

      const opsFile = join(dir, 'ops.json');
      writeFileSync(opsFile, JSON.stringify([
        { op: 'place_zone', id: 'cli_zone', name: 'CLI 林', contentType: 'woodland', relative: { anchor: [400, 400], shape: 'organic', areaHa: 0.6 }, seed: 9 },
      ]), 'utf8');
      const projectB = join(dir, 'project-2.json');
      const applied = execCli(['apply', projectA, '--ops', opsFile, '--out', projectB]);
      expect(applied.status).toBe(0);
      const appliedJson = JSON.parse(applied.stdout) as { ok: boolean; applied: string[]; savedPath: string };
      expect(appliedJson.ok).toBe(true);
      expect(appliedJson.applied).toContain('place_zone:cli_zone');
      expect(existsSync(projectB)).toBe(true);

      const inspected = execCli(['inspect', projectB]);
      expect(inspected.status).toBe(0);
      const brief = JSON.parse(inspected.stdout) as { ok: boolean; brief: { zones: Array<{ id: string }> } };
      expect(brief.brief.zones.some((zone) => zone.id === 'cli_zone')).toBe(true);

      const previewPath = join(dir, 'preview.png');
      const rendered = execCli(['render', projectB, '--out', previewPath, '--width', '420', '--grid']);
      expect(rendered.status).toBe(0);
      const renderJson = JSON.parse(rendered.stdout) as { ok: boolean; gridOverlay: boolean; worldBounds: number[] };
      expect(renderJson.ok).toBe(true);
      expect(renderJson.gridOverlay).toBe(true);
      expect(renderJson.worldBounds).toEqual([0, 0, 800, 800]);
      expect(readFileSync(previewPath).subarray(0, 8)).toEqual(Buffer.from(PNG_MAGIC));

      const svgPath = join(dir, 'export.svg');
      const pngPath = join(dir, 'export.png');
      const exported = execCli(['export', projectB, '--out-svg', svgPath, '--out-png', pngPath, '--width', '600']);
      expect(exported.status).toBe(0);
      const exportedJson = JSON.parse(exported.stdout) as { ok: boolean; gridOverlay: boolean };
      expect(exportedJson.ok).toBe(true);
      expect(exportedJson.gridOverlay).toBe(false);
      expect(readFileSync(svgPath, 'utf8')).toContain('<svg');
      expect(readFileSync(svgPath, 'utf8')).not.toContain('layer-ai-grid');
      expect(readFileSync(pngPath).subarray(0, 8)).toEqual(Buffer.from(PNG_MAGIC));

      const protectedName = BUILTIN_PRESETS.find((preset) => preset.key !== 'blank')?.filename ?? '';
      expect(protectedName.length).toBeGreaterThan(0);
      const blocked = execCli(['init', '--out', join(dir, protectedName), '--preset', 'blank']);
      expect(blocked.status).not.toBe(0);
      const blockedJson = JSON.parse(blocked.stdout) as { ok: boolean; error: string };
      expect(blockedJson.ok).toBe(false);
      expect(blockedJson.error).toContain('受保护');
      expect(existsSync(join(dir, protectedName))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});

describe('V4-6 · MCP 6 工具 + 2 资源', () => {
  it('工具/资源注册齐全，open → apply → render 返回 image/png base64', async () => {
    const server = createStudioMcpServer(new StudioSession());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'studio_apply_ops',
        'studio_inspect',
        'studio_open',
        'studio_query_point',
        'studio_render_preview',
        'studio_save',
      ]);
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
        'studio://examples/presets',
        'studio://schema/ops',
      ]);
      const unknown = await client.callTool({ name: 'studio_open', arguments: { preset: 'not_a_preset' } });
      const unknownBody = unknown as { isError?: boolean; content?: McpContent[] };
      expect(unknownBody.isError).toBe(true);
      const unknownText = unknownBody.content?.[0];
      expect(unknownText && unknownText.type === 'text' ? unknownText.text : '').toContain('未知预设');
      await client.callTool({
        name: 'studio_open',
        arguments: { preset: 'blank', worldSizeM: 800, name: 'MCP 会话', subtitle: '内存联调' },
      });
      const applied = await client.callTool({
        name: 'studio_apply_ops',
        arguments: {
          ops: [{ op: 'place_zone', id: 'mcp_zone', contentType: 'woodland', relative: { anchor: [400, 400], shape: 'rect', areaHa: 0.5 } }],
        },
      });
      const appliedContent = applied.content as McpContent[];
      expect(appliedContent[0]?.type).toBe('text');
      const preview = await client.callTool({
        name: 'studio_render_preview',
        arguments: { widthPx: 400, gridOverlay: true },
      });
      const previewContent = preview.content as McpContent[];
      const image = previewContent.find((block) => block.type === 'image');
      expect(image).toBeDefined();
      if (image?.type === 'image') {
        expect(image.mimeType).toBe('image/png');
        const bytes = Buffer.from(image.data, 'base64');
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from(PNG_MAGIC));
        expect(bytes.length).toBeGreaterThan(5000);
      }
      const ops = await client.readResource({ uri: 'studio://schema/ops' });
      const opsText = ops.contents[0] && 'text' in ops.contents[0] ? ops.contents[0].text : '';
      expect(opsText).toContain('place_zone');
      expect(opsText).toContain('snap_weir');
      const presets = await client.readResource({ uri: 'studio://examples/presets' });
      const presetText = presets.contents[0] && 'text' in presets.contents[0] ? presets.contents[0].text : '';
      expect(presetText).toContain('worldSizeM');
      expect(presetText).toContain('zoneCount');
    } finally {
      await client.close();
      await server.close();
    }
  }, 120000);
});

describe('V4-4 · 解耦静态守卫', () => {
  it('src/ai + src/cli + src/mcp 零外部仓库路径、零世界观专名、零 Math.random', () => {
    const root = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    for (const sub of ['ai', 'cli', 'mcp']) {
      const dir = join(root, sub);
      if (existsSync(dir)) walk(dir);
    }
    expect(files.length).toBeGreaterThan(16);
    const banned = ['设定/', '地图/', 'worldbuilding', 'Lōsrūmūra', '长湖', '帕隆', 'server.py', 'Math.random('];
    // 世界观预设名一律走 BUILTIN_PRESETS 动态解析，三目录内不得出现任何大小写形式的硬编码
    const presetNamePattern = /losrumura|changhu|palong/i;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const token of banned) {
        expect(text.includes(token), `${file} 含违禁词 ${token}`).toBe(false);
      }
      expect(presetNamePattern.test(text), `${file} 含世界观预设名硬编码`).toBe(false);
    }
  });
});
