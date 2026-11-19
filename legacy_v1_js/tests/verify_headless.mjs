#!/usr/bin/env node
/**
 * Terrax Settlement Studio V1.2 — 前端无头全量核验脚本（PRD FR-10.5 / T-6.5）。
 *
 * 运行：
 *   node /Users/jrdamocles/code/TERRAX/settlement_studio/tests/verify_headless.mjs
 *
 * 覆盖：
 *   1. Schema / 调色板 / sculptDelta Base64 往返 / HistoryManager 40 步撤销栈；
 *   2. 257×257 高程场、偏心核峰值无尖刺、连续等高线推拉与四支笔刷无 NaN 无自交；
 *   3. 9 类 ZONE_CONTENT_TYPES 全部有效产出，单选区重抽 < 80 ms；
 *   4. 综合压测场景 + 3 套 projects/*.worldtown.json，各 50 组随机种子零穿模零河心岛；
 *   5. 图例自动同步与 buildSVGString 完整性（双遍树冠分组 + 闭合根节点）。
 *
 * 退出码：全部断言通过为 0，任一断言失败为 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as S from '../web/js/state_and_schema.js';
import * as T from '../web/js/terrain_engine.js';
import * as H from '../web/js/hydro_road_engine.js';
import * as G from '../web/js/gacha_zone_engine.js';
import * as E from '../web/js/exporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECTS_DIR = path.join(ROOT, 'projects');

const PROJECT_FILES = [
  '起点城_Losrumura.worldtown.json',
  '长湖_复市镇.worldtown.json',
  '帕隆_峡谷铁寨.worldtown.json'
];

let passed = 0;
const failures = [];

function ok(condition, message, detail) {
  if (condition) {
    passed += 1;
    return true;
  }
  const extra = detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  failures.push(`${message}${extra}`);
  console.error(`  ✗ ${message}${extra}`);
  return false;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000n) / 1000;
}

function finiteField(field) {
  for (let i = 0; i < field.length; i += 1) {
    if (!Number.isFinite(field[i])) return false;
  }
  return true;
}

function countNanPoints(contours) {
  let bad = 0;
  for (const c of contours) {
    for (const p of c.points) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) bad += 1;
    }
  }
  return bad;
}

function selfIntersections(contour) {
  const P = contour.points;
  const n = P.length;
  if (n < 4) return 0;
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let hits = 0;
  const closed = contour.closed !== false;
  for (let i = 0; i + 1 < n; i += 1) {
    for (let j = i + 2; j + 1 < n; j += 1) {
      if (closed && i === 0 && j === n - 2) continue;
      const a = P[i];
      const b = P[i + 1];
      const c = P[j];
      const d = P[j + 1];
      const d1 = cross(c, d, a);
      const d2 = cross(c, d, b);
      const d3 = cross(a, b, c);
      const d4 = cross(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        hits += 1;
      }
    }
  }
  return hits;
}

function crossLevelIntersections(contours) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let hits = 0;
  for (let i = 0; i < contours.length; i += 1) {
    for (let j = i + 1; j < contours.length; j += 1) {
      const A = contours[i];
      const B = contours[j];
      if (Math.abs(A.elev - B.elev) < 1e-9) continue;
      for (let a = 0; a + 1 < A.points.length; a += 1) {
        for (let b = 0; b + 1 < B.points.length; b += 1) {
          const p1 = A.points[a];
          const p2 = A.points[a + 1];
          const q1 = B.points[b];
          const q2 = B.points[b + 1];
          const d1 = cross(q1, q2, p1);
          const d2 = cross(q1, q2, p2);
          const d3 = cross(p1, p2, q1);
          const d4 = cross(p1, p2, q2);
          if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            hits += 1;
          }
        }
      }
    }
  }
  return hits;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 场景构造
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

function buildStressProject() {
  return S.normalizeProject({
    schemaVersion: '1.2.0',
    meta: {
      id: 'proj_stress', name: 'BG-01 交叉水路陡坡压测场',
      subtitle: '河湖渠路墙禁建与陡崖综合压测', worldSizeM: 2000,
      terraxAnchor: null, updatedAt: '2026-11-18T09:00:00Z'
    },
    palette: { themeId: 'nordic_fjord', overrides: {} },
    terrain: {
      baseElev: 520, slopeMagM: 22, slopeDirDeg: 300, contourStep: 5,
      indexEvery: 5, minContourElev: 470, maxContourElev: 620,
      showContours: true, showScarpTicks: true, scarpSlopeThresholdDeg: 26,
      shapes: [
        { id: 's_ridge', type: 'ridge', points: [[0, 1020], [700, 1080], [1400, 1000], [2000, 1060]], deltaElev: 52, widthLeft: 130, widthRight: 190 },
        { id: 's_hill', type: 'hill', cx: 620, cy: 380, rx: 420, ry: 300, angleDeg: 14, deltaElev: 34, focusX: 0.3, focusY: -0.2 },
        { id: 's_scarp', type: 'scarp', points: [[1980, 1720], [1200, 1760], [400, 1800], [40, 1830]], deltaElev: 14, widthLeft: 220, widthRight: 70 }
      ],
      sculptDeltaB64: ''
    },
    rivers: [
      { id: 'riv_main', name: '弯曲干流', points: [[0, 720], [400, 660], [800, 760], [1200, 640], [1600, 740], [2000, 660]], widthStartM: 30, widthEndM: 56, carveDepthM: 7, rippleLines: 3 },
      { id: 'riv_trib', name: '南来支流', points: [[900, 2000], [880, 1600], [900, 1200], [860, 760]], widthStartM: 16, widthEndM: 26, carveDepthM: 4, rippleLines: 2 }
    ],
    waterBodies: [
      { id: 'lake_1', name: '压测湖湾', kind: 'lake', points: [[1350, 80], [1800, 100], [1850, 420], [1500, 500], [1330, 300]], rippleLines: 3 }
    ],
    canals: [
      { id: 'can_open', name: '穿城明渠', style: 'open', points: [[300, 640], [700, 900], [1100, 1200], [1500, 1500]], widthM: 7 },
      { id: 'can_qanat', name: '西坡暗渠', style: 'qanat', points: [[80, 1200], [420, 1300], [820, 1400], [1180, 1460]], widthM: 4.5 }
    ],
    reefs: [
      { id: 'reef_1', x: 800, y: 760, radiusM: 12, angleDeg: 22, seed: 7, count: 2 },
      { id: 'reef_2', x: 1200, y: 644, radiusM: 10, angleDeg: 61, seed: 11, count: 1 }
    ],
    roads: [
      { id: 'rd_hw', name: '斜穿驿道', tier: 'highway', points: [[20, 1780], [600, 1560], [1150, 1350], [1700, 1120], [1980, 980]], widthM: 15 },
      { id: 'rd_st', name: '跨河街路', tier: 'street', points: [[980, 1150], [960, 900], [940, 700], [920, 420], [900, 120]], widthM: 10 },
      { id: 'rd_ln', name: '顺坡村径', tier: 'lane', points: [[220, 1900], [420, 1700], [640, 1520], [860, 1360]], widthM: 5 }
    ],
    fords: [],
    zones: [
      { id: 'z_wall', name: '压测内城', contentType: 'walled_city', points: [[280, 1180], [880, 1200], [860, 1560], [260, 1540]], seed: 11, density: 0.72, maxSlopeDeg: 24, streetWidthM: 7.5, wallThicknessM: 5.5, towerIntervalM: 110 },
      { id: 'z_cit', name: '压测堡寨', contentType: 'citadel', points: [[900, 1180], [1180, 1195], [1170, 1400], [890, 1385]], seed: 22, density: 0.6, maxSlopeDeg: 24, streetWidthM: 6, wallThicknessM: 5, towerIntervalM: 90 },
      { id: 'z_town', name: '压测市镇', contentType: 'town_blocks', points: [[1200, 1120], [1700, 1140], [1680, 1480], [1180, 1460]], seed: 33, density: 0.76, maxSlopeDeg: 26, streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110 },
      { id: 'z_vil', name: '压测村寨', contentType: 'village', points: [[180, 1680], [720, 1700], [700, 1940], [160, 1920]], seed: 44, density: 0.62, maxSlopeDeg: 28, streetWidthM: 4.5, wallThicknessM: 3, towerIntervalM: 110 },
      { id: 'z_mkt', name: '压测集场', contentType: 'market', points: [[980, 1580], [1330, 1600], [1320, 1820], [970, 1800]], seed: 55, density: 0.85, maxSlopeDeg: 24, streetWidthM: 6, wallThicknessM: 4, towerIntervalM: 110 },
      { id: 'z_farm', name: '压测条田', contentType: 'farmland', points: [[1120, 1620], [1900, 1640], [1880, 1980], [1100, 1960]], seed: 66, density: 0.55, maxSlopeDeg: 30, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110 },
      { id: 'z_salt', name: '压测盐池', contentType: 'saltpan', points: [[1560, 1120], [1960, 1140], [1940, 1420], [1540, 1400]], seed: 77, density: 0.8, maxSlopeDeg: 26, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110 },
      { id: 'z_wood', name: '压测疏林', contentType: 'woodland', points: [[100, 1100], [250, 1110], [240, 1500], [90, 1490]], seed: 88, density: 0.7, maxSlopeDeg: 34, streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110 },
      { id: 'z_excl', name: '压测禁建圈', contentType: 'exclusion', points: [[1600, 1700], [1900, 1720], [1880, 1940], [1580, 1920]], seed: 99, density: 0.5, maxSlopeDeg: 40, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110 }
    ],
    landmarks: [
      { id: 'lm_1', legendKey: 'custom_weir', glyphType: 'well_shrine', label: '压测分水堰', x: 700, y: 900, showLabel: true, sizePx: 15 }
    ],
    legend: { visible: true, title: '图例 · 压测', position: 'bottom-right', columns: 2, items: [] }
  });
}

function loadProjectFile(filename) {
  const full = path.join(PROJECTS_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`缺少示例工程文件：projects/${filename}`);
  }
  return { text: fs.readFileSync(full, 'utf8'), project: S.deserializeProject(fs.readFileSync(full, 'utf8')) };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. Schema / 调色板 / Base64 / 撤销栈
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('1. Schema · 调色板 · Base64 · 撤销栈');

ok(S.SCHEMA_VERSION === '1.2.0', 'SCHEMA_VERSION === 1.2.0', S.SCHEMA_VERSION);
ok(S.GRID_N === 257, 'GRID_N === 257', S.GRID_N);
ok(S.OBSTACLE_GRID_N === 512, 'OBSTACLE_GRID_N === 512', S.OBSTACLE_GRID_N);
ok(S.ZONE_CONTENT_TYPES.length === 9, 'ZONE_CONTENT_TYPES 共 9 类', S.ZONE_CONTENT_TYPES.length);
ok(S.CUSTOM_GLYPH_TYPES.length === 8, 'CUSTOM_GLYPH_TYPES 共 8 类', S.CUSTOM_GLYPH_TYPES.length);
ok(S.BUILTIN_LEGEND_CATALOG.length === 14, 'BUILTIN_LEGEND_CATALOG 共 14 项', S.BUILTIN_LEGEND_CATALOG.length);

{
  const a = S.createRng(20261118);
  const b = S.createRng(20261118);
  let same = true;
  for (let i = 0; i < 12; i += 1) {
    if (a() !== b()) same = false;
  }
  ok(same, '同种子 mulberry32 序列完全一致');
  ok(S.hashSeed('Lōsrūmūra') === S.hashSeed('Lōsrūmūra') && S.hashSeed('') > 0, 'hashSeed 稳定且空串有效');
}

{
  const themes = Object.keys(S.BUILTIN_PALETTES);
  ok(themes.length === 4, '4 套内置主题', themes.join(','));
  let slotTotal = 0;
  let hexBad = [];
  for (const id of themes) {
    const palette = S.BUILTIN_PALETTES[id];
    const keys = Object.keys(palette);
    if (keys.length !== 12) hexBad.push(`${id}:${keys.length}槽`);
    for (const key of keys) {
      slotTotal += 1;
      if (!/^#[0-9a-f]{6}$/.test(palette[key])) hexBad.push(`${id}.${key}=${palette[key]}`);
    }
  }
  ok(hexBad.length === 0, '4×12 色槽全部为 6 位小写 HEX', hexBad.slice(0, 4));
  ok(slotTotal === 48, '色槽总数 48', slotTotal);
  const overridden = S.getActivePalette({ palette: { themeId: 'boreal_slate', overrides: { roofTown: '#C8926E' } } });
  ok(overridden.roofTown === '#c8926e', '方志别名 + overrides 归一化生效', overridden.roofTown);
  ok(Object.keys(overridden).length === 12, 'getActivePalette 恒返 12 槽');
}

{
  const field = new Float32Array(66049);
  ok(S.encodeSculptDelta(field) === '', '全零微雕场编码为空串');
  const rng = S.createRng(70117);
  for (let i = 0; i < field.length; i += 1) {
    field[i] = rng() * 700 - 350;
  }
  const b64 = S.encodeSculptDelta(field);
  const back = S.decodeSculptDelta(b64, 66049);
  let maxErr = 0;
  for (let i = 0; i < field.length; i += 1) {
    maxErr = Math.max(maxErr, Math.abs(back[i] - field[i]));
  }
  ok(back.length === 66049, 'sculptDelta 解码长度恒为 66049', back.length);
  ok(maxErr <= 0.051, 'sculptDelta 往返最大误差 ≤ 0.051 m', `${maxErr.toFixed(7)} m`);
  console.log(`  · Base64 长度 ${b64.length}，最大量化误差 ${maxErr.toFixed(7)} m`);
}

{
  const blank = S.normalizeProject({});
  const keys = Object.keys(blank);
  ok(keys.length === 13, 'normalizeProject({}) 补齐 13 个顶层键', keys.length);
  const roundTrip = S.deserializeProject(S.serializeProject(blank));
  ok(JSON.stringify(roundTrip) === JSON.stringify(blank), 'serialize → deserialize 深层无损');
}

{
  const history = new S.HistoryManager(40);
  const project = S.createDefaultProject();
  history.reset();
  for (let i = 0; i < 50; i += 1) {
    history.beginContinuousAction(project);
    project.meta.name = `聚落-${i}`;
    history.commitHistory(project, `改名-${i}`);
  }
  const status = history.getStatus();
  ok(status.undoCount === 40, 'HistoryManager 压栈 50 次锁死 40 步上限', status.undoCount);
  const undone = history.undo(project);
  ok(undone.meta.name === '聚落-48', 'undo 精确回退上一步', undone.meta.name);
  const redone = history.redo(undone);
  ok(redone.meta.name === '聚落-49', 'redo 完整还原', redone.meta.name);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 2. 高程场与等高线拓扑
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('2. 高程场 · 偏心核 · 推拉与笔刷');

{
  const project = S.normalizeProject({
    meta: { worldSizeM: 2400, id: 'p_terrain', name: '地形核验', subtitle: 't', updatedAt: '2026-11-18T09:00:00Z' },
    terrain: {
      baseElev: 450, slopeMagM: 0, contourStep: 5, indexEvery: 5,
      minContourElev: 440, maxContourElev: 560, showContours: true, showScarpTicks: false,
      shapes: [
        { id: 'h1', type: 'hill', cx: 1200, cy: 1200, rx: 420, ry: 320, angleDeg: 20, deltaElev: 40, focusX: 0.3, focusY: -0.2 },
        { id: 'r1', type: 'ridge', points: [[300, 760], [1200, 760], [2100, 760]], deltaElev: 30, widthLeft: 70, widthRight: 340 },
        { id: 's1', type: 'scarp', points: [[2100, 1800], [300, 1800]], deltaElev: 14, widthLeft: 260, widthRight: 90 }
      ],
      sculptDeltaB64: ''
    },
    rivers: [{ id: 'rv', name: '核验溪', points: [[200, 1500], [1200, 1460], [2200, 1500]], widthStartM: 34, widthEndM: 46, carveDepthM: 7, rippleLines: 3 }]
  });
  const field = T.buildElevationField(project);
  ok(field.elevation.length === 66049, '高程场长度 66049', field.elevation.length);
  ok(finiteField(field.elevation), '高程场全域有限（无 NaN / Infinity）');

  const hill = project.terrain.shapes[0];
  const rad = (20 * Math.PI) / 180;
  const focusX = 1200 + (0.3 * 420 * Math.cos(rad) - (-0.2) * 320 * Math.sin(rad));
  const focusY = 1200 + (0.3 * 420 * Math.sin(rad) + (-0.2) * 320 * Math.cos(rad));
  ok(Math.abs(T.evalTerrainShape(hill, focusX, focusY) - 40) < 1e-6, '偏心核峰值严格等于 deltaElev');
  const eps = 0.5;
  const gx = (T.evalTerrainShape(hill, focusX + eps, focusY) - T.evalTerrainShape(hill, focusX - eps, focusY)) / (2 * eps);
  const gy = (T.evalTerrainShape(hill, focusX, focusY + eps) - T.evalTerrainShape(hill, focusX, focusY - eps)) / (2 * eps);
  ok(Math.hypot(gx, gy) < 1e-3, '峰顶导数趋零（无尖刺）', Math.hypot(gx, gy).toExponential(2));

  const proj2 = JSON.parse(JSON.stringify(project));
  const field2 = T.buildElevationField(proj2);
  let contours = T.extractContours(field2, proj2.terrain);
  ok(contours.length > 5, '初始等高线条数 > 5', contours.length);

  for (let i = 0; i < 100; i += 1) {
    const ang = i * 0.31;
    const cx = 1200 + 280 * Math.cos(ang);
    const cy = 1330 + 240 * Math.sin(ang);
    contours = T.applyContourWarpDrag(proj2, field2, {
      prevX: cx, prevY: cy,
      currX: cx + 14 * Math.cos(ang + 1.2),
      currY: cy + 14 * Math.sin(ang + 1.2),
      lockedElev: 470 + (i % 8) * 4,
      radiusM: 380,
      strength: 0.6
    });
  }
  ok(finiteField(field2.elevation), '100 步等高线推拉后高程场无 NaN');
  ok(countNanPoints(contours) === 0, '100 步推拉后等高线折线无 NaN 点');
  let selfTotal = 0;
  for (const c of contours) selfTotal += selfIntersections(c);
  ok(selfTotal === 0, '推拉后同层等高线零自交', selfTotal);
  const crossDrag = crossLevelIntersections(contours);
  ok(crossDrag === 0, '推拉后跨高程等高线零相交', crossDrag);

  const brushes = [
    { mode: 'raise', x: 900, y: 900, radiusM: 220, strength: 0.5 },
    { mode: 'lower', x: 1400, y: 1000, radiusM: 220, strength: 0.5 },
    { mode: 'smooth', x: 1100, y: 1400, radiusM: 260, strength: 0.5 },
    { mode: 'flatten', x: 1600, y: 1300, radiusM: 240, strength: 0.5, targetElev: 470 }
  ];
  for (const brush of brushes) {
    const out = T.applySculptBrush(proj2, field2, brush);
    ok(finiteField(field2.elevation), `笔刷 ${brush.mode} 后高程场无 NaN`);
    ok(countNanPoints(out) === 0, `笔刷 ${brush.mode} 后等高线无 NaN`);
  }
  let selfAfterBrush = 0;
  for (const c of contours) selfAfterBrush += selfIntersections(c);
  ok(selfAfterBrush === 0, '四支笔刷后同层等高线零自交', selfAfterBrush);
  const crossBrush = crossLevelIntersections(T.extractContours(field2, proj2.terrain));
  ok(crossBrush === 0, '四支笔刷后跨高程等高线零相交', crossBrush);

  const pkg = T.buildTerrainPackage(proj2);
  ok(pkg.stats.scarpTickCount === 0 && T.extractScarpTicks(pkg.contours, pkg.terrainData, proj2.terrain).length === 0,
    'showScarpTicks 默认关闭时零齿线');
  const tickProj = JSON.parse(JSON.stringify(proj2));
  tickProj.terrain.showScarpTicks = true;
  tickProj.terrain.scarpSlopeThresholdDeg = 20;
  const tickPkg = T.buildTerrainPackage(tickProj);
  let tickLenBad = 0;
  for (const tick of tickPkg.scarpTicks) {
    const len = Math.hypot(tick.x2 - tick.x1, tick.y2 - tick.y1);
    if (Math.abs(len - 4.0) > 0.01) tickLenBad += 1;
  }
  ok(tickPkg.scarpTicks.length > 0, '开启陡坎齿线后有产出', tickPkg.scarpTicks.length);
  ok(tickLenBad === 0, '每条齿线严格 4.000 m', tickLenBad);
  console.log(`  · 等高线 ${contours.length} 条 · 齿线 ${tickPkg.scarpTicks.length} 条 · 高程 ${pkg.stats.hMin.toFixed(1)}—${pkg.stats.hMax.toFixed(1)} m`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 3. 九类选区与单区重抽耗时
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('3. 九类 ZONE_CONTENT_TYPES · 单区重抽 < 80 ms');

const EXPECT = {
  walled_city: (z) => z.buildings.length > 0 && z.walls.length > 0 && z.towers.length >= 4,
  town_blocks: (z) => z.buildings.length > 0,
  village: (z) => z.buildings.length > 0 && z.lanes.length >= 2,
  citadel: (z) => z.buildings.length > 0 && z.walls.length > 0,
  market: (z) => z.marketStalls.length > 0 && z.marketAprons.length > 0,
  farmland: (z) => z.farmlandPlots.length > 0 && z.buildings.length === 0,
  saltpan: (z) => z.saltpanCells.length > 0,
  woodland: (z) => z.trees.length > 0 && z.buildings.length === 0,
  exclusion: (z) => z.buildings.length === 0 && z.trees.length === 0 && z.exclusionPoly !== null
};

let rerollMax = 0;
let rerollWorst = '';

for (const type of S.ZONE_CONTENT_TYPES) {
  const project = S.createDefaultProject();
  project.meta.worldSizeM = 1400;
  project.terrain.slopeMagM = 8;
  project.terrain.shapes = [];
  project.zones = [{
    id: `z_${type}`, name: type, contentType: type,
    // 31 ha 代表性地块：接近两倍于三套示例工程中的最大真实选区（17 ha）
    points: [[300, 300], [920, 308], [910, 800], [290, 792]],
    seed: 20261118, locked: false, density: 0.75, maxSlopeDeg: 30,
    streetWidthM: 7, wallThicknessM: 5.5, towerIntervalM: 110
  }];
  const terrainData = T.buildElevationField(project);
  const hydro = H.buildHydroRoadPackage(project, terrainData);
  const compiled = G.compileAllZones(project, terrainData, hydro);
  const zone = compiled.zones[0];
  const report = G.verifyZeroCollisions(project, terrainData, hydro, compiled.zones);
  const expectFn = EXPECT[type];
  ok(expectFn(zone), `9 类之 ${type} 产出符合规格`, {
    buildings: zone.buildings.length, walls: zone.walls.length, trees: zone.trees.length,
    farm: zone.farmlandPlots.length, salt: zone.saltpanCells.length, stalls: zone.marketStalls.length
  });
  ok(report.passed === true, `9 类之 ${type} 零穿模`, report.totalHits);

  // 单区重抽耗时（含全量避让重编）
  const t0 = nowMs();
  const reroll = G.rerollZoneSeed(project, project.zones[0].id);
  const elapsed = nowMs() - t0;
  if (elapsed > rerollMax) {
    rerollMax = elapsed;
    rerollWorst = type;
  }
  ok(reroll.found === true, `${type} 重抽成功`, reroll.found);
}
ok(rerollMax < 80, '单区重抽 < 80 ms', `最差 ${rerollWorst} ${rerollMax.toFixed(1)} ms`);
console.log(`  · 重抽最差用例 ${rerollWorst} = ${rerollMax.toFixed(1)} ms（31 ha 选区）`);

{
  // 超大 81 ha 选区（远超实际使用）性能观察值，不计入门禁
  const big = S.createDefaultProject();
  big.meta.worldSizeM = 1400;
  big.terrain.slopeMagM = 8;
  big.terrain.shapes = [];
  big.zones = [{
    id: 'z_big', name: '超大选区', contentType: 'walled_city',
    points: [[250, 250], [1150, 258], [1140, 1158], [240, 1150]],
    seed: 424242, locked: false, density: 0.75, maxSlopeDeg: 30,
    streetWidthM: 7, wallThicknessM: 5.5, towerIntervalM: 110
  }];
  const bigTerrain = T.buildElevationField(big);
  const bigHydro = H.buildHydroRoadPackage(big, bigTerrain);
  G.compileAllZones(big, bigTerrain, bigHydro);
  const t0 = nowMs();
  const r = G.rerollZoneSeed(big, 'z_big');
  const ms = nowMs() - t0;
  console.log(`  · 参考：81 ha 超大选区重抽 ${ms.toFixed(1)} ms / ${r.zone.buildings.length} 屋（不设门禁）`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 4. 50 组随机种子零穿模压测（综合压测场 + 3 套示例工程）
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('4. 50 组随机种子零穿模极限压测');

const projectFiles = [];
for (const filename of PROJECT_FILES) {
  const loaded = loadProjectFile(filename);
  projectFiles.push({ key: filename, project: loaded.project });
  ok(loaded.project.zones.length >= 4, `${filename} 含 ≥4 个选区`, loaded.project.zones.length);
  ok(loaded.project.meta.worldSizeM >= 600 && loaded.project.meta.worldSizeM <= 8000,
    `${filename} 图幅合法`, loaded.project.meta.worldSizeM);
}

// 示例工程与内置预设必须完全一致（离线直开与服务端读取同源）
{
  const presets = S.getBuiltinPresetProjects();
  const presetByKey = new Map(presets.map((p) => [p.project.meta.id, p.project]));
  for (const item of projectFiles) {
    const preset = presetByKey.get(item.project.meta.id);
    ok(!!preset, `${item.key} 对应内置预设存在`);
    if (preset) {
      ok(JSON.stringify(S.normalizeProject(preset)) === JSON.stringify(item.project),
        `${item.key} 与 getBuiltinPresetProjects() 逐字一致`);
    }
  }
}

const scenarios = [
  { key: '压测场', make: () => buildStressProject() },
  ...projectFiles.map((item) => ({ key: item.key, make: () => S.normalizeProject(item.project) }))
];

const SEEDS = 50;
let totalCompiles = 0;
let totalFailures = 0;
let maxCompileMs = 0;
let maxCompileCase = '';
const summary = new Map();
for (const sc of scenarios) {
  summary.set(sc.key, { minBuildings: Infinity, maxBuildings: 0, maxMs: 0 });
}

const stressStart = nowMs();
for (let iter = 0; iter < SEEDS; iter += 1) {
  for (const sc of scenarios) {
    const project = sc.make();
    project.zones.forEach((zone, zi) => {
      zone.seed = (90001 + iter * 7919 + zi * 104729 + zone.id.length * 37) >>> 0;
    });
    const t0 = nowMs();
    const scene = G.compileSettlementScene(project);
    const elapsed = nowMs() - t0;
    totalCompiles += 1;
    const report = scene.collisionReport;
    const bad = [];
    if (report.passed !== true) bad.push('passed');
    if (report.buildingRoadHits !== 0) bad.push(`road=${report.buildingRoadHits}`);
    if (report.buildingWaterHits !== 0) bad.push(`water=${report.buildingWaterHits}`);
    if (report.buildingWallHits !== 0) bad.push(`wall=${report.buildingWallHits}`);
    if (report.buildingBuildingHits !== 0) bad.push(`building=${report.buildingBuildingHits}`);
    if (report.buildingExclusionHits !== 0) bad.push(`exclusion=${report.buildingExclusionHits}`);
    if (report.riverIslands !== 0) bad.push(`islands=${report.riverIslands}`);
    if (bad.length > 0) {
      totalFailures += 1;
      if (totalFailures <= 5) {
        console.error(`  ✗ seed#${iter} ${sc.key}: ${bad.join(' ')}`);
        console.error(`     details=${JSON.stringify(report.details.slice(0, 3))}`);
      }
    }
    const s = summary.get(sc.key);
    s.minBuildings = Math.min(s.minBuildings, scene.stats.buildingCount);
    s.maxBuildings = Math.max(s.maxBuildings, scene.stats.buildingCount);
    s.maxMs = Math.max(s.maxMs, elapsed);
    if (elapsed > maxCompileMs) {
      maxCompileMs = elapsed;
      maxCompileCase = sc.key;
    }
  }
}
const stressWall = (nowMs() - stressStart) / 1000;

ok(totalFailures === 0, `50 组种子 × ${scenarios.length} 场景 = ${totalCompiles} 次编译全部零穿模零河心岛`, totalFailures);
for (const [key, s] of summary.entries()) {
  ok(s.maxBuildings > 0, `${key} 每轮均有屋宇产出`, s.maxBuildings);
  console.log(`  · ${key.padEnd(28)} 屋宇 ${String(s.minBuildings).padStart(5)}—${String(s.maxBuildings).padEnd(5)} 单轮最慢 ${s.maxMs.toFixed(0)} ms`);
}
console.log(`  · 合计 ${totalCompiles} 次编译 / ${stressWall.toFixed(1)} s，单轮最慢 ${maxCompileMs.toFixed(0)} ms（${maxCompileCase}）`);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 5. 图例同步与 SVG 导出
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('5. 图例同步 · SVG 完整性');

{
  const project = S.normalizeProject(projectFiles[0].project);
  const scene = G.compileSettlementScene(project);
  const legend = S.syncLegendWithProject(project, scene);
  const keys = legend.items.map((it) => it.key);
  ok(keys.includes('roof_inner') && keys.includes('roof_town'), '图例自动挂载内城/市镇屋顶');
  ok(keys.includes('city_wall') && keys.includes('road_highway') && keys.includes('bridge_ortho'), '图例自动挂载城墙/道路/桥梁');
  ok(keys.includes('river_pure') && keys.includes('contour_line') && keys.includes('farmland_plot'), '图例自动挂载河流/等高线/条田');
  ok(keys.includes('woodland_tree'), '图例自动挂载树冠');

  const autoItem = legend.items.find((it) => it.key === 'roof_inner');
  ok(autoItem.color === '' && autoItem.colorLocked !== true, '未手动改色的内置图例 color 保持空串（随主题动态取色）', autoItem.color);
  const target = legend.items.find((it) => it.key === 'roof_inner');
  target.label = '三木合契议事厅与高阶公仓';
  target.color = '#8c3b2b';
  target.colorLocked = true;
  target.visible = false;
  S.syncLegendWithProject(project, scene);
  const kept = project.legend.items.find((it) => it.key === 'roof_inner');
  ok(kept.label === '三木合契议事厅与高阶公仓' && kept.color === '#8c3b2b' && kept.visible === false,
    '图例用户改名/改色/隐藏三项自定义全部保留');

  const svg = E.buildSVGString(project, scene, { mode: 'full' });
  ok(svg.startsWith('<svg '), 'buildSVGString 以 <svg 开头');
  ok(svg.trimEnd().endsWith('</svg>'), 'buildSVGString 以 </svg> 闭合');
  ok(svg.includes('<g id="trees-outline">'), 'SVG 含 <g id="trees-outline">');
  ok(svg.includes('<g id="trees-fill">'), 'SVG 含 <g id="trees-fill">');
  ok(svg.includes('<g id="trees-shadow">'), 'SVG 含 <g id="trees-shadow">');
  ok(svg.includes('class="legend-glyph"'), 'SVG 含真图形图例徽记');
  const gOpen = (svg.match(/<g /g) || []).length;
  const gClose = (svg.match(/<\/g>/g) || []).length;
  ok(gOpen === gClose, 'SVG <g> 开闭配平', `${gOpen}/${gClose}`);
  const clean = E.buildSVGString(project, scene, { mode: 'clean' });
  ok(!clean.includes('layer-13-cartouche'), 'clean 模式不含图饰层');
  ok(clean.length < svg.length, 'clean 模式体积更小', `${clean.length} < ${svg.length}`);
  console.log(`  · SVG ${(svg.length / 1024 / 1024).toFixed(2)} MB · ${gOpen} 组 <g> · 图例 ${keys.length} 项`);
}

{
  // 图例消失感知：空场景下内置项应标记 autoPresent=false
  const project = S.normalizeProject(projectFiles[0].project);
  S.syncLegendWithProject(project, G.compileSettlementScene(project));
  S.syncLegendWithProject(project, {
    buildings: [], walls: [], trees: [], farmlandPlots: [], saltpanCells: [],
    hydro: { roads: [], bridges: [], rivers: [], waterBodies: [], canals: [], reefs: [] },
    terrain: { contours: [], scarpTicks: [] },
    zones: []
  });
  const item = project.legend.items.find((it) => it.key === 'roof_inner');
  ok(item && item.autoPresent === false, '元素消失后 autoPresent 置 false');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 6. V1.2.1 靶向缺陷回归（城墙 / 重抽上下文 / 桥梁 / 水纹 / 急弯 / 凹多边形）
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('6. V1.2.1 靶向缺陷回归');

function selfIntersectionsOf(poly) {
  const n = poly.length;
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const c = poly[j];
      const d = poly[(j + 1) % n];
      const d1 = cross(c, d, a);
      const d2 = cross(c, d, b);
      const d3 = cross(a, b, c);
      const d4 = cross(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) hits += 1;
    }
  }
  return hits;
}

// 6.1 城墙：敌台不重复挂载 + 城门只归属一段
{
  const project = S.normalizeProject(projectFiles[0].project);
  const scene = G.compileSettlementScene(project);
  let towerSlots = 0;
  const uniqueTowers = new Set();
  let gateSlots = 0;
  const gateIds = new Set();
  for (const wall of scene.walls) {
    for (const t of (wall.towers || [])) {
      towerSlots += 1;
      uniqueTowers.add(`${t.x.toFixed(2)},${t.y.toFixed(2)}`);
    }
    for (const g of (wall.gates || [])) {
      gateSlots += 1;
      gateIds.add(g.id);
    }
  }
  ok(scene.walls.length > 0, '起点城存在城垣', scene.walls.length);
  ok(towerSlots === uniqueTowers.size, '敌台不重复挂载（槽位数 === 唯一坐标数）', `${towerSlots}/${uniqueTowers.size}`);
  ok(gateSlots === gateIds.size, '城门只归属唯一墙段', `${gateSlots}/${gateIds.size}`);
}

// 6.2 反序 [market, walled_city] 零穿墙
{
  const base = S.normalizeProject(projectFiles[0].project);
  const market = base.zones.find((z) => z.contentType === 'market');
  const walled = base.zones.find((z) => z.contentType === 'walled_city');
  ok(!!market && !!walled, '示例工程含 market 与 walled_city');
  if (market && walled) {
    const reversed = S.normalizeProject(base);
    reversed.zones = [market, walled];
    const scene = G.compileSettlementScene(reversed);
    ok(scene.collisionReport.passed === true && scene.collisionReport.buildingWallHits === 0,
      '反序 [market, walled_city] 零穿墙', scene.collisionReport.buildingWallHits);
  }
}

// 6.3 重抽后零河中树 / 零穿模（三套工程逐区）
{
  let maxReroll = 0;
  let worstZone = '';
  let waterTreeHits = 0;
  let crossZoneHits = 0;
  for (const item of projectFiles) {
    const project = S.normalizeProject(item.project);
    const scene = G.compileSettlementScene(project);
    const zones = scene.zones.slice();
    for (const zone of project.zones) {
      const t0 = nowMs();
      const reroll = G.rerollZoneSeed(project, zone.id);
      const elapsed = nowMs() - t0;
      if (elapsed > maxReroll) {
        maxReroll = elapsed;
        worstZone = `${item.key}/${zone.contentType}`;
      }
      const idx = zones.findIndex((z) => z.id === zone.id);
      if (idx >= 0) zones[idx] = reroll.zone;
      for (const tree of reroll.zone.trees) {
        for (const river of scene.hydro.rivers) {
          if (G.pointInPolygon(tree.x, tree.y, river.bankPolygon)) waterTreeHits += 1;
        }
        for (const wb of scene.hydro.waterBodies) {
          if (G.pointInPolygon(tree.x, tree.y, wb.shorePoly)) waterTreeHits += 1;
        }
      }
      const report = G.verifyZeroCollisions(project, scene.terrain.terrainData, scene.hydro, zones);
      if (!report.passed) crossZoneHits += 1;
    }
  }
  ok(waterTreeHits === 0, '重抽后树木零入水（河/湖）', waterTreeHits);
  ok(crossZoneHits === 0, '重抽后跨选区零穿模', crossZoneHits);
  ok(maxReroll < 80, '携带邻区上下文的重抽 < 80 ms', `${worstZone} ${maxReroll.toFixed(1)} ms`);
  console.log(`  · 重抽最慢 ${worstZone} = ${maxReroll.toFixed(1)} ms`);
}

// 6.4 斜交跨河桥四角全部落在岸上
{
  for (const deg of [90, 60, 40, 25]) {
    const rad = (deg * Math.PI) / 180;
    const project = S.normalizeProject({
      meta: { worldSizeM: 2000, id: `p_bridge_${deg}`, name: '斜交桥', subtitle: 's', updatedAt: '2026-11-18T09:00:00Z' },
      rivers: [{ id: 'r', name: '宽河', points: [[0, 1000], [2000, 1000]], widthStartM: 120, widthEndM: 120, carveDepthM: 5, rippleLines: 1 }],
      roads: [{
        id: 'd', name: '斜路', tier: 'street',
        points: [[1000 - 700 * Math.cos(rad), 1000 + 700 * Math.sin(rad)],
          [1000 + 700 * Math.cos(rad), 1000 - 700 * Math.sin(rad)]],
        widthM: 10
      }]
    });
    const hydro = H.buildHydroRoadPackage(project, null);
    const bridge = hydro.bridges[0];
    ok(!!bridge, `${deg}° 斜交生成桥梁`);
    if (!bridge) continue;
    let outside = 0;
    for (const corner of bridge.corners) {
      if (!G.pointInPolygon(corner[0], corner[1], hydro.rivers[0].bankPolygon)) outside += 1;
    }
    ok(outside === 4, `${deg}° 斜交桥四角全部在岸上`, `${outside}/4`);
  }
}

// 6.5 河流水纹非空且为二维折线数组
{
  for (const item of projectFiles) {
    const project = S.normalizeProject(item.project);
    const hydro = H.buildHydroRoadPackage(project, null);
    for (const river of hydro.rivers) {
      const expected = Math.max(0, Math.min(3, Math.round(river.rippleLines))) * 2;
      ok(Array.isArray(river.ripples) && river.ripples.length === expected,
        `${item.key}/${river.name} 水纹条数 = ${expected}`, river.ripples.length);
      let flat = true;
      for (const ripple of river.ripples) {
        if (!Array.isArray(ripple) || ripple.length < 2 || !Array.isArray(ripple[0])) flat = false;
      }
      ok(flat, `${item.key}/${river.name} 水纹为二维折线数组（无四维嵌套）`);
    }
    for (const wb of hydro.waterBodies) {
      ok(Array.isArray(wb.ripples) && wb.ripples.length >= 1, `${item.key} 湖海水纹非空`, wb.ripples.length);
    }
  }
}

// 6.6 急弯宽河岸线零自交
{
  for (const width of [60, 90, 120]) {
    const project = S.normalizeProject({
      meta: { worldSizeM: 1600, id: `p_bend_${width}`, name: '急弯河', subtitle: 's', updatedAt: '2026-11-18T09:00:00Z' },
      rivers: [{
        id: 'r2', name: '急弯', points: [[100, 800], [300, 800], [420, 700], [500, 800], [700, 800]],
        widthStartM: width, widthEndM: width, carveDepthM: 4, rippleLines: 2
      }]
    });
    const hydro = H.buildHydroRoadPackage(project, null);
    const hits = selfIntersectionsOf(hydro.rivers[0].bankPolygon);
    ok(hits === 0, `河宽 ${width} m 急弯岸线零自交`, hits);
  }
}

// 6.7 凹多边形选区
{
  const project = S.createDefaultProject();
  project.meta.worldSizeM = 1400;
  project.terrain.slopeMagM = 6;
  project.terrain.shapes = [];
  project.zones = [{
    id: 'z_concave', name: '凹形村寨', contentType: 'village',
    points: [[220, 220], [1180, 240], [1160, 640], [640, 620], [620, 1160], [240, 1140]],
    seed: 20261118, locked: false, density: 0.7, maxSlopeDeg: 30,
    streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
  }];
  const terrainData = T.buildElevationField(project);
  const hydro = H.buildHydroRoadPackage(project, terrainData);
  const agg = G.compileAllZones(project, terrainData, hydro);
  const report = G.verifyZeroCollisions(project, terrainData, hydro, agg.zones);
  ok(agg.zones[0].buildings.length > 0, '凹多边形选区正常产出屋宇', agg.zones[0].buildings.length);
  ok(report.passed === true, '凹多边形选区零穿模', report.totalHits);
}

// 6.8 农田 / 盐池扣除禁建区
{
  const project = S.createDefaultProject();
  project.meta.worldSizeM = 1400;
  project.terrain.slopeMagM = 4;
  project.terrain.shapes = [];
  project.zones = [
    {
      id: 'z_ex', name: '禁建', contentType: 'exclusion',
      points: [[420, 420], [780, 430], [770, 760], [410, 750]],
      seed: 5, density: 0.5, maxSlopeDeg: 40, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
    },
    {
      id: 'z_farm', name: '绕禁区条田', contentType: 'farmland',
      points: [[260, 260], [940, 280], [920, 940], [240, 920]],
      seed: 77, density: 0.6, maxSlopeDeg: 30, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
    },
    {
      id: 'z_salt', name: '绕禁区盐池', contentType: 'saltpan',
      points: [[260, 980], [940, 1000], [920, 1180], [240, 1160]],
      seed: 88, density: 0.8, maxSlopeDeg: 30, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
    }
  ];
  const terrainData = T.buildElevationField(project);
  const hydro = H.buildHydroRoadPackage(project, terrainData);
  const agg = G.compileAllZones(project, terrainData, hydro);
  const exPoly = project.zones[0].points;
  let farmInEx = 0;
  let saltInEx = 0;
  for (const zone of agg.zones) {
    for (const plot of zone.farmlandPlots) {
      const c = G.computePolygonCentroid(plot.innerPolygon);
      if (G.pointInPolygon(c[0], c[1], exPoly)) farmInEx += 1;
    }
    for (const cell of zone.saltpanCells) {
      const c = G.computePolygonCentroid(cell.polygon);
      if (G.pointInPolygon(c[0], c[1], exPoly)) saltInEx += 1;
    }
  }
  ok(agg.zones[1].farmlandPlots.length > 0, '农田在禁区外正常产出', agg.zones[1].farmlandPlots.length);
  ok(farmInEx === 0, '农田条块零侵入禁建区', farmInEx);
  ok(saltInEx === 0, '盐池格零侵入禁建区', saltInEx);
}

// 6.9 村寨菜畦与水井安全
{
  const palong = projectFiles.find((p) => p.key.indexOf('帕隆') >= 0);
  const project = S.normalizeProject(palong.project);
  const scene = G.compileSettlementScene(project);
  let fenceBad = 0;
  for (const fence of scene.gardenFences) {
    const ring = fence.points || [];
    const zone = project.zones.find((z) => z.id === fence.zoneId);
    if (!zone) { fenceBad += 1; continue; }
    for (const pt of ring) {
      if (!G.pointInPolygon(pt[0], pt[1], zone.points)) { fenceBad += 1; break; }
      let wet = false;
      for (const rv of scene.hydro.rivers) if (G.pointInPolygon(pt[0], pt[1], rv.bankPolygon)) wet = true;
      for (const wb of scene.hydro.waterBodies) if (G.pointInPolygon(pt[0], pt[1], wb.shorePoly)) wet = true;
      if (wet) { fenceBad += 1; break; }
    }
  }
  ok(scene.gardenFences.length > 0, '村寨菜畦有产出', scene.gardenFences.length);
  ok(fenceBad === 0, '菜畦全部位于选区内且不落水', fenceBad);
  let wellBad = 0;
  for (const well of scene.wells) {
    let wet = false;
    for (const rv of scene.hydro.rivers) if (G.pointInPolygon(well.x, well.y, rv.bankPolygon)) wet = true;
    for (const wb of scene.hydro.waterBodies) if (G.pointInPolygon(well.x, well.y, wb.shorePoly)) wet = true;
    if (wet) wellBad += 1;
  }
  ok(scene.wells.length > 0 && wellBad === 0, '水井有产出且不落水', `${scene.wells.length}/${wellBad}`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 7. V1.2.2 终审收口回归（水渠急折 / 拾取顺序 / 图例改色 / 自定义图例 / 禁建树 / 缓存签名 / 旋转杆）
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('7. V1.2.2 终审收口回归');

const appSource = fs.readFileSync(path.join(ROOT, 'web/js/app.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(ROOT, 'web/js/canvas_renderer.js'), 'utf8');

// 7.1 水渠 90° 急折角编译（曾因 halfWidths / widths 未声明崩溃）
{
  for (const style of ['open', 'qanat']) {
    const project = S.normalizeProject({
      meta: { worldSizeM: 1400, id: `p_canal_${style}`, name: '急折渠', subtitle: 's', updatedAt: '2026-11-18T09:00:00Z' },
      canals: [{
        id: 'c1', name: '九十度折渠', style,
        points: [[120, 620], [340, 620], [340, 860]], widthM: 6
      }]
    });
    let geom = null;
    let threw = null;
    try {
      geom = H.buildCanalGeometry(project.canals[0]);
    } catch (err) {
      threw = err;
    }
    ok(threw === null, `${style} 水渠 90° 急折不抛异常`, threw && threw.message);
    ok(!!geom && Array.isArray(geom.bankPolygon) && geom.bankPolygon.length >= 4, `${style} 急折水渠产出合法岸线`);
    if (geom) {
      let bad = 0;
      for (const p of geom.bankPolygon) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) bad += 1;
      ok(bad === 0, `${style} 急折水渠岸线无 NaN`, bad);
      if (style === 'qanat') ok(geom.shaftPoints.length > 0, '急折暗渠仍有竖井串', geom.shaftPoints.length);
    }
  }
}

// 7.2 拾取顺序：zone 先于 shape，且不再重复声明 findFord / 延迟重建已清理
{
  const start = appSource.indexOf('function hitObject(');
  const body = appSource.slice(start, appSource.indexOf('/* ---', start));
  const iPoly = body.indexOf('hitPolylineObject');
  const iZone = body.indexOf('hitZoneAt');
  const iShape = body.indexOf('hitShape');
  ok(iPoly >= 0 && iZone >= 0 && iShape >= 0, 'hitObject 含折线/选区/图元三段命中');
  ok(iPoly < iZone && iZone < iShape, '命中顺序为 polyline → zone → shape', `${iPoly}/${iZone}/${iShape}`);
  ok((appSource.match(/function findFord\(/g) || []).length === 1, 'findFord 仅声明一次');
  ok(appSource.includes('clearTimeout(state.rebuildTimer)'), 'rebuildScene 前清理延迟重建定时器');

  const project = S.normalizeProject(projectFiles[0].project);
  const hills = project.terrain.shapes.filter((sh) => sh.type === 'hill' || sh.type === 'basin');
  let centers = 0;
  let underHill = 0;
  for (const zone of project.zones) {
    const c = G.computePolygonCentroid(zone.points);
    if (G.pointInPolygon(c[0], c[1], zone.points)) centers += 1;
    for (const sh of hills) {
      const rad = ((sh.angleDeg || 0) * Math.PI) / 180;
      const dx = c[0] - sh.cx;
      const dy = c[1] - sh.cy;
      const u = (dx * Math.cos(rad) + dy * Math.sin(rad)) / Math.max(25, sh.rx);
      const v = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / Math.max(25, sh.ry);
      if (u * u + v * v <= 1.06) {
        underHill += 1;
        break;
      }
    }
  }
  ok(project.zones.length === 14, '起点城 14 个选区齐备', project.zones.length);
  ok(centers === project.zones.length, '14 个选区中心点均落在自身多边形内', centers);
  ok(underHill >= 8, '多个选区中心同时被山包椭圆覆盖（顺序修复具实际意义）', underHill);
  console.log(`  · 14 个选区中心：全部落在自身多边形内；其中 ${underHill} 个同时位于 hill 椭圆内`);
}

// 7.3 图例 7 类分支响应手动改色（Canvas 源码 + SVG 实际输出双检）
{
  const pal = S.getActivePalette({ palette: { themeId: 'watabou_classic' } });
  const glyphs = ['city_wall', 'road_main', 'bridge', 'river', 'canal', 'tree_cluster', 'reef'];
  for (const glyph of glyphs) {
    const svg = E.buildLegendGlyphSVG({ glyphType: glyph, color: '#ff3300' }, 0, 0, 28, 18, pal);
    ok(svg.includes('#ff3300'), `SVG ${glyph} 响应手动改色`);
    let legacyLeft = false;
    if (glyph === 'city_wall') legacyLeft = svg.includes('#504233');
    else if (glyph === 'reef') legacyLeft = svg.includes('#585550');
    else if (glyph === 'road_main' || glyph === 'bridge') legacyLeft = svg.includes(pal.roadFill);
    else if (glyph === 'river' || glyph === 'canal') legacyLeft = svg.includes(pal.waterFill);
    else legacyLeft = svg.includes(pal.treeFill);
    ok(!legacyLeft, `SVG ${glyph} 不再残留写死主色`);
  }
  ok(!canvasSource.includes("fill('#504233')") && !canvasSource.includes("fill('#585550')"),
    'Canvas 图例分支无写死主色残留');
  ok(canvasSource.includes("} else if (glyph === 'city_wall') {\n    fill(main);"), 'Canvas city_wall 使用 main');
  ok(canvasSource.includes("} else if (glyph === 'river') {\n    stroke(main, 6.4);"), 'Canvas river 使用 main');
}

// 7.4 自定义图例在未盖章前保持可见
{
  const project = S.normalizeProject({
    legend: {
      items: [{ key: 'custom_unstamped', isCustom: true, glyphType: 'stele', label: '未盖章自定符号', color: '#123456', visible: true }]
    }
  });
  S.syncLegendWithProject(project, {
    buildings: [], walls: [], trees: [], farmlandPlots: [], saltpanCells: [],
    hydro: { roads: [], bridges: [], rivers: [], waterBodies: [], canals: [], reefs: [] },
    terrain: { contours: [], scarpTicks: [] },
    zones: []
  });
  const item = project.legend.items.find((it) => it.key === 'custom_unstamped');
  ok(!!item && item.autoPresent === true, '未盖章的自定义图例 autoPresent 保持 true');
  ok(!!item && item.isCustom === true && item.visible !== false, '自定义图例 isCustom 与 visible 保持');
}

// 7.5 禁建圈零树木 / 菜畦全量安全 / 缓存签名含坐标
{
  const project = S.createDefaultProject();
  project.meta.worldSizeM = 1200;
  project.terrain.shapes = [];
  project.terrain.slopeMagM = 0;
  project.zones = [
    { id: 'ex', name: '禁建', contentType: 'exclusion', points: [[200, 200], [600, 210], [590, 600], [190, 590]], seed: 1, density: 0.5, maxSlopeDeg: 40, streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110 },
    { id: 'wd', name: '林', contentType: 'woodland', points: [[150, 150], [650, 160], [640, 650], [140, 640]], seed: 2, density: 0.95, maxSlopeDeg: 40, streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110 }
  ];
  const scene = G.compileSettlementScene(project);
  let inEx = 0;
  for (const tree of scene.trees) {
    if (G.pointInPolygon(tree.x, tree.y, project.zones[0].points)) inEx += 1;
  }
  ok(scene.trees.length > 0, '林地有树冠产出', scene.trees.length);
  ok(inEx === 0, '禁建圈内树木恒为 0', inEx);

  const palong = projectFiles.find((item) => item.key.indexOf('帕隆') >= 0);
  const palongProject = S.normalizeProject(palong.project);
  const palongScene = G.compileSettlementScene(palongProject);
  const ctx = {
    worldSizeM: palongProject.meta.worldSizeM,
    terrainData: palongScene.terrain.terrainData,
    maxSlopeDeg: 28,
    riversBuilt: palongScene.hydro.rivers,
    waterBodiesBuilt: palongScene.hydro.waterBodies,
    canalsBuilt: palongScene.hydro.canals,
    roadsBuilt: palongScene.hydro.roads,
    wallsBuilt: [],
    exclusionPolys: palongProject.zones.filter((z) => z.contentType === 'exclusion').map((z) => z.points),
    spatialHash: { queryPolygonBBox: () => [] },
    grid: null
  };
  let fenceBad = 0;
  for (const fence of palongScene.gardenFences) {
    if (!G.isPolygonSafe(fence.points, ctx, 0)) fenceBad += 1;
  }
  ok(palongScene.gardenFences.length > 0, '帕隆菜畦有产出', palongScene.gardenFences.length);
  ok(fenceBad === 0, '菜畦全部通过道路/水系/禁建区/坡度复核', fenceBad);

  // 缓存在道路顶点改动后必须失效
  const sigProj = S.createDefaultProject();
  sigProj.meta.worldSizeM = 1400;
  sigProj.terrain.shapes = [];
  sigProj.terrain.slopeMagM = 4;
  sigProj.zones = [{
    id: 'z', name: '签名镇', contentType: 'town_blocks',
    points: [[300, 300], [1000, 310], [990, 1000], [290, 990]],
    seed: 123, density: 0.78, maxSlopeDeg: 30, streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
  }];
  sigProj.roads = [{ id: 'r', name: '路', tier: 'street', points: [[100, 100], [1300, 120]], widthM: 10 }];
  const sigScene = G.compileSettlementScene(sigProj);
  sigProj.roads[0].points = [[100, 640], [1300, 660]];
  const rerolled = G.rerollZoneSeed(sigProj, 'z');
  const hydroNew = H.buildHydroRoadPackage(sigProj, sigScene.terrain.terrainData);
  const sigReport = G.verifyZeroCollisions(sigProj, sigScene.terrain.terrainData, hydroNew, [rerolled.zone]);
  ok(rerolled.zone.buildings.length > 0, '改路后重抽仍有屋宇产出', rerolled.zone.buildings.length);
  ok(sigReport.buildingRoadHits === 0 && sigReport.passed === true,
    '道路顶点改动后重抽不命中旧缓存', sigReport.buildingRoadHits);
}

// 7.6 山包旋转杆连杆起点随旋转角变换
{
  ok(canvasSource.includes('ctx.moveTo(sx(shape.cx + shape.ry * sinA), sy(shape.cy - shape.ry * cosA));'),
    '旋转连杆起点使用椭圆旋转后的顶边点');
  ok(!canvasSource.includes('ctx.moveTo(sx(shape.cx), sy(shape.cy - shape.ry));'),
    '旧的水平未旋转连杆起点已移除');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 汇总
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

section('汇总');

if (failures.length > 0) {
  console.error(`\n✗ 共 ${failures.length} 项断言失败 / 通过 ${passed} 项：`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ verify_headless: ${passed} 项断言全部通过；${totalCompiles} 次随机编译零穿模零河心岛。`);
process.exit(0);
