import { beforeEach, describe, expect, it } from 'vitest';
import rawChanghu from '../projects/长湖_复市镇.worldtown.json';
import rawLosrumura from '../projects/起点城_Losrumura.worldtown.json';
import rawPalong from '../projects/帕隆_峡谷铁寨.worldtown.json';
import { GRID_N, GRID_POINT_COUNT } from '../src/schema/geometry.types';
import { createRng, hashSeed } from '../src/core/math/rng';
import {
  SCULPT_MAX_ERROR_M,
  decodeSculptDelta,
  encodeSculptDelta,
} from '../src/core/math/sculptCodecs';
import {
  BUILTIN_PALETTES,
  CANONICAL_THEME_IDS,
  PALETTE_SLOT_KEYS,
  getActivePalette,
  resolveThemeId,
} from '../src/schema/palette.schema';
import {
  BUILTIN_LEGEND_CATALOG,
  CUSTOM_GLYPH_TYPES,
  type LegendSyncProjectView,
  syncLegendWithProject,
} from '../src/schema/legend.schema';
import {
  TownProjectSchema,
  deserializeProject,
  normalizeProject,
  serializeProject,
  type TownProject,
} from '../src/schema/project.schema';
import { BUILTIN_PRESETS, createBlankProject, createPresetProject } from '../src/schema/presets';
import { setSceneCompilerForTest, useStudioStore } from '../src/store/useStudioStore';
import { commitDraftPoints, isClosedDraftTool } from '../src/ui/canvasStageHandlers';
import { compileSettlementScene } from '../src/core/compileScene';
import { resolveEffectiveLegend } from '../src/schema/legend.schema';
import {
  buildElevationField,
  sampleElevation,
  sampleGradient,
  sampleSlopeDeg,
} from '../src/core/terrain/elevationField';
import {
  buildTerrainPackage,
  extractContours,
  extractScarpTicks,
} from '../src/core/terrain/marchingSquares';
import {
  applyContourWarpDrag,
  applySculptBrush,
  hitTestContourLine,
} from '../src/core/terrain/terrainSculpt';
import {
  computePolygonAreaHa,
  computePolygonAreaSigned,
  computePolygonCentroid,
  clipPolygonHalfPlane,
  intersectSegmentsExact,
  minDistPolyToPoly,
  pointInPolygon,
  triangulatePolygon,
} from '../src/core/math/polygon';
import {
  computeVoronoiCells,
  insetConvexPolygon,
  insetPolygonSafe,
} from '../src/core/math/voronoi';
import { closestPointOnPolyline, sampleCatmullRom } from '../src/core/math/spline';
import type { Polygon, Vec2 } from '../src/schema/geometry.types';

const SQUARE: Polygon = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

function makeHillProject(): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: '偏心山包测试' },
    terrain: {
      baseElev: 300,
      slopeMagM: 0,
      slopeDirDeg: 0,
      contourStep: 10,
      indexEvery: 5,
      minContourElev: 200,
      maxContourElev: 400,
      shapes: [
        {
          id: 'h1',
          type: 'hill',
          cx: 800,
          cy: 800,
          rx: 300,
          ry: 240,
          angleDeg: 0,
          deltaElev: 80,
          focusX: 0.35,
          focusY: 0,
        },
      ],
    },
  });
}

function makeScarpProject(): TownProject {
  return normalizeProject({
    meta: { worldSizeM: 1600, name: '陡坎齿线测试' },
    terrain: {
      baseElev: 300,
      slopeMagM: 0,
      slopeDirDeg: 0,
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
}

describe('M0 · 确定性随机源与定点编解码', () => {
  it('同 seed 序列恒一致且落在 [0,1)', () => {
    const a = createRng(20261119);
    const b = createRng(20261119);
    for (let i = 0; i < 64; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const c = createRng(20261120);
    const d = createRng(20261119);
    expect(c()).not.toBe(d());
  });

  it('FNV-1a 种子哈希稳定且非零', () => {
    expect(hashSeed('losrumura')).toBe(hashSeed('losrumura'));
    expect(hashSeed('losrumura')).not.toBe(hashSeed('changhu'));
    expect(hashSeed('')).toBeGreaterThan(0);
    expect(hashSeed(null)).toBe(hashSeed(1));
  });

  it('全零场编码为空串，随机增量往返误差 <= 0.051m', () => {
    expect(encodeSculptDelta(new Float32Array(GRID_POINT_COUNT))).toBe('');
    const rng = createRng('sculpt-roundtrip');
    const delta = new Float32Array(GRID_POINT_COUNT);
    for (let i = 0; i < delta.length; i += 1) delta[i] = (rng() - 0.5) * 240;
    const encoded = encodeSculptDelta(delta);
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = decodeSculptDelta(encoded);
    expect(decoded.length).toBe(GRID_POINT_COUNT);
    let maxErr = 0;
    for (let i = 0; i < delta.length; i += 1) {
      maxErr = Math.max(maxErr, Math.abs((delta[i] ?? 0) - (decoded[i] ?? 0)));
    }
    expect(maxErr).toBeLessThanOrEqual(SCULPT_MAX_ERROR_M);
    expect(SCULPT_MAX_ERROR_M).toBeLessThanOrEqual(0.051);
  });

  it('超限值限幅到 +-3200m，异常输入返回全零场', () => {
    const delta = new Float32Array(GRID_POINT_COUNT);
    delta[0] = 99999;
    delta[1] = -99999;
    const decoded = decodeSculptDelta(encodeSculptDelta(delta));
    expect(decoded[0]).toBe(3200);
    expect(decoded[1]).toBe(-3200);
    expect(decodeSculptDelta('')).toEqual(new Float32Array(GRID_POINT_COUNT));
    expect(decodeSculptDelta('@@not-base64@@')).toEqual(new Float32Array(GRID_POINT_COUNT));
  });
});

describe('M0 · 4x12 调色板与方志别名', () => {
  it('4 套主题 x 12 色槽共 48 色全为 6 位小写 HEX', () => {
    expect(CANONICAL_THEME_IDS.length).toBe(4);
    expect(PALETTE_SLOT_KEYS.length).toBe(12);
    for (const themeId of CANONICAL_THEME_IDS) {
      const palette = BUILTIN_PALETTES[themeId];
      for (const slot of PALETTE_SLOT_KEYS) {
        expect(palette[slot]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('方志别名无损映射到规范主题', () => {
    expect(resolveThemeId('archival_parchment')).toBe('gazetteer_ink');
    expect(resolveThemeId('boreal_slate')).toBe('nordic_fjord');
    expect(resolveThemeId('arid_ochre')).toBe('arid_oasis');
    expect(resolveThemeId('nope')).toBe('watabou_classic');
    expect(resolveThemeId(undefined)).toBe('watabou_classic');
  });

  it('overrides 大写 HEX 自动小写并精准覆盖，非法值被忽略', () => {
    const resolved = getActivePalette({
      themeId: 'gazetteer_ink',
      overrides: { roofInner: '#AABBCC', roadFill: 'not-a-color', unknownSlot: '#123456' },
    });
    expect(resolved.roofInner).toBe('#aabbcc');
    expect(resolved.roadFill).toBe(BUILTIN_PALETTES.gazetteer_ink.roadFill);
    expect(resolved.themeId).toBe('gazetteer_ink');
    expect(resolved.roadCasing).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('M0 · 22 类图例目录与自动感知同步', () => {
  const palette = getActivePalette({ themeId: 'watabou_classic', overrides: {} });

  it('14 内置 + 8 自定义 = 22 类目录完整', () => {
    expect(BUILTIN_LEGEND_CATALOG.length).toBe(14);
    expect(CUSTOM_GLYPH_TYPES.length).toBe(8);
    expect(BUILTIN_LEGEND_CATALOG[0]?.order).toBe(10);
    expect(BUILTIN_LEGEND_CATALOG[13]?.order).toBe(140);
  });

  it('内置项随场景要素切换 autoPresent 且保留用户改名/显隐/排序', () => {
    const project: LegendSyncProjectView = {
      landmarks: [],
      legend: {
        visible: true,
        title: '图例 · 自定义标题',
        position: 'top-left',
        columns: 1,
        items: [
          {
            key: 'roof_inner',
            isCustom: false,
            glyphType: 'building_inner',
            label: '我改过的内城屋宇',
            color: '#aabbcc',
            colorLocked: true,
            strokeColor: '#2b2520',
            visible: false,
            autoPresent: false,
            order: 5,
          },
        ],
      },
    };
    const synced = syncLegendWithProject(
      project,
      { roof_inner: true, city_wall: false, river_pure: true },
      palette,
    );
    const roof = synced.items.find((item) => item.key === 'roof_inner');
    expect(roof?.label).toBe('我改过的内城屋宇');
    expect(roof?.visible).toBe(false);
    expect(roof?.order).toBe(5);
    expect(roof?.autoPresent).toBe(true);
    expect(roof?.color).toBe('#aabbcc');
    const wall = synced.items.find((item) => item.key === 'city_wall');
    expect(wall?.autoPresent).toBe(false);
    const river = synced.items.find((item) => item.key === 'river_pure');
    expect(river?.autoPresent).toBe(true);
    expect(river?.color).toBe('');
    expect(synced.title).toBe('图例 · 自定义标题');
    expect(synced.position).toBe('top-left');
    expect(synced.columns).toBe(1);
  });

  it('未盖章自定义图例重同步后恒保持 autoPresent = true', () => {
    const custom = {
      key: 'custom_weir',
      isCustom: true,
      glyphType: 'well_shrine',
      label: '东关总分水堰',
      color: '#5b844b',
      colorLocked: false,
      strokeColor: '#2b2520',
      visible: true,
      autoPresent: false,
      order: 210,
    };
    const project: LegendSyncProjectView = {
      landmarks: [],
      legend: { visible: true, title: '图例', position: 'bottom-right', columns: 2, items: [custom] },
    };
    const first = syncLegendWithProject(project, {}, palette);
    expect(first.items.find((i) => i.key === 'custom_weir')?.autoPresent).toBe(true);
    const second = syncLegendWithProject(
      { ...project, legend: { ...project.legend!, items: first.items } },
      {},
      palette,
    );
    expect(second.items.find((i) => i.key === 'custom_weir')?.autoPresent).toBe(true);
    expect(second.items.find((i) => i.key === 'custom_weir')?.isCustom).toBe(true);
  });

  it('地标反向补齐缺失的 custom_ 图例项', () => {
    const project: LegendSyncProjectView = {
      landmarks: [
        { legendKey: 'custom_hammer', glyphType: 'mine_hammer', label: '水力锻锤铁坊' },
      ],
    };
    const synced = syncLegendWithProject(project, {}, palette);
    const made = synced.items.find((item) => item.key === 'custom_hammer');
    expect(made?.isCustom).toBe(true);
    expect(made?.autoPresent).toBe(true);
    expect(made?.label).toBe('水力锻锤铁坊');
    expect(made?.glyphType).toBe('mine_hammer');
  });
});

describe('M0 · TownProjectSchema 与 V1.2.2 三套真实工程', () => {
  it('13 个顶层主键完整', () => {
    expect(Object.keys(TownProjectSchema.shape).length).toBe(13);
  });

  it('三套真实 .worldtown.json 100% 无损解析（字段零丢失）', () => {
    const raws: unknown[] = [rawLosrumura, rawChanghu, rawPalong];
    for (const raw of raws) {
      const parsed = normalizeProject(raw);
      expect(parsed).toEqual(raw);
      expect(parsed.schemaVersion).toBe('1.2.0');
      expect(parsed.meta.worldSizeM).toBeGreaterThanOrEqual(600);
      expect(parsed.zones.length).toBeGreaterThan(0);
    }
  });

  it('往返序列化深比较一致', () => {
    for (const preset of BUILTIN_PRESETS) {
      const project = preset.build();
      const roundTrip = deserializeProject(serializeProject(project));
      expect(roundTrip).toEqual(project);
    }
  });

  it('normalizeProject({}) 补齐全部默认键且零异常', () => {
    const blank = normalizeProject({});
    expect(Object.keys(blank).length).toBe(13);
    expect(blank.meta.worldSizeM).toBe(2400);
    expect(blank.terrain.contourStep).toBe(5);
    expect(blank.terrain.showScarpTicks).toBe(false);
    expect(blank.terrain.sculptDeltaB64).toBe('');
    expect(blank.zones).toEqual([]);
    expect(blank.legend.items).toEqual([]);
  });

  it('微雕字段三合一兼容：sculptDeltaBase64 / 数值数组 -> sculptDeltaB64', () => {
    const delta = new Float32Array(GRID_POINT_COUNT);
    delta[7] = 12.34;
    const encoded = encodeSculptDelta(delta);

    const viaAlias = normalizeProject({ terrain: { sculptDeltaBase64: encoded } });
    expect(viaAlias.terrain.sculptDeltaB64).toBe(encoded);

    const viaArray = normalizeProject({ terrain: { sculptDelta: Array.from(delta) } });
    const decoded = decodeSculptDelta(viaArray.terrain.sculptDeltaB64);
    expect(Math.abs((decoded[7] ?? 0) - 12.34)).toBeLessThanOrEqual(0.051);
  });

  it('点列清洗剔除重复顶点并过滤退化图元', () => {
    const project = normalizeProject({
      zones: [
        {
          id: 'zn_dup',
          name: '重复点选区',
          contentType: 'market',
          points: [
            [0, 0],
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0],
          ],
        },
        { id: 'zn_bad', name: '退化折线', contentType: 'market', points: [[0, 0]] },
      ],
    });
    expect(project.zones.length).toBe(1);
    expect(project.zones[0]?.points.length).toBe(4);
  });

  it('盆地强制负增量、山包强制正增量、偏心模长夹紧 0.72', () => {
    const project = normalizeProject({
      terrain: {
        shapes: [
          {
            id: 'b1',
            type: 'basin',
            cx: 100,
            cy: 100,
            rx: 10,
            ry: 10,
            deltaElev: 50,
            focusX: 3,
            focusY: 4,
          },
        ],
      },
    });
    const shape = project.terrain.shapes[0];
    expect(shape?.type).toBe('basin');
    if (shape && (shape.type === 'hill' || shape.type === 'basin')) {
      expect(shape.deltaElev).toBeLessThan(0);
      expect(shape.rx).toBeGreaterThanOrEqual(25);
      expect(Math.hypot(shape.focusX, shape.focusY)).toBeLessThanOrEqual(0.7200001);
    }
  });
});

describe('M0 · Zundo 50 步时间旅行与连续编辑合并', () => {
  beforeEach(() => {
    useStudioStore.temporal.getState().resume();
    useStudioStore.getState().loadProject(createBlankProject(), true);
  });

  it('初始工程与预设工厂可用', () => {
    expect(useStudioStore.getState().project.meta.worldSizeM).toBe(2400);
    const losrumura = createPresetProject('losrumura');
    expect(losrumura.zones.length).toBe(14);
    expect(losrumura.legend.items.length).toBe(0);
  });

  it('连续 60 次变更后 pastStates 锁死上限 50', () => {
    for (let i = 0; i < 60; i += 1) {
      useStudioStore.getState().mutateProject((draft) => {
        draft.terrain.baseElev = 450 + i;
      }, false);
    }
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(50);
  });

  it('beginContinuousEdit -> 25 次高频更新 -> end 仅产生 1 条撤销记录', () => {
    const before = useStudioStore.getState().project;
    useStudioStore.getState().beginContinuousEdit();
    for (let i = 0; i < 25; i += 1) {
      useStudioStore.getState().mutateProject((draft) => {
        draft.terrain.slopeMagM = 10 + i;
      }, false);
    }
    useStudioStore.getState().endContinuousEdit(false);
    const past = useStudioStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect(past[0]?.project).toBe(before);
    useStudioStore.getState().undoProject();
    expect(useStudioStore.getState().project.terrain.slopeMagM).toBe(
      before.terrain.slopeMagM,
    );
    expect(useStudioStore.getState().project).toEqual(before);
  });

  it('视图态不进入历史，撤销重做保持镜头不变', () => {
    useStudioStore.getState().updateViewport({ zoom: 2.4, panX: 120 });
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(0);
    useStudioStore.getState().mutateProject((draft) => {
      draft.terrain.baseElev = 520;
    }, false);
    useStudioStore.getState().undoProject();
    expect(useStudioStore.getState().project.terrain.baseElev).toBe(450);
    expect(useStudioStore.getState().viewport.zoom).toBe(2.4);
    useStudioStore.getState().redoProject();
    expect(useStudioStore.getState().project.terrain.baseElev).toBe(520);
  });

  it('重抽选区只改 unlocked 选区 seed', () => {
    const project = normalizeProject({
      zones: [
        { id: 'z1', name: '甲', contentType: 'market', points: [[0, 0], [10, 0], [10, 10]] },
        { id: 'z2', name: '乙', contentType: 'market', points: [[20, 20], [30, 20], [30, 30]], locked: true },
      ],
    });
    useStudioStore.getState().loadProject(project, true);
    const beforeSeed = useStudioStore.getState().project.zones[0]?.seed;
    const lockedSeed = useStudioStore.getState().project.zones[1]?.seed;
    useStudioStore.getState().rerollAllUnlockedZones();
    expect(useStudioStore.getState().project.zones[0]?.seed).not.toBe(beforeSeed);
    expect(useStudioStore.getState().project.zones[1]?.seed).toBe(lockedSeed);
  });
});

describe('M1 · 高程场与等高线基础冒烟', () => {
  it('66049 点高程场全有限且采样连续', () => {
    const field = buildElevationField(makeHillProject());
    expect(field.elevation.length).toBe(GRID_POINT_COUNT);
    expect(field.gridN).toBe(GRID_N);
    let finite = true;
    for (let i = 0; i < field.elevation.length; i += 1) {
      if (!Number.isFinite(field.elevation[i])) finite = false;
    }
    expect(finite).toBe(true);
    expect(field.maxElev).toBeGreaterThan(field.minElev);
    const a = sampleElevation(field, 800, 800);
    const b = sampleElevation(field, 800.5, 800);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it('纯斜坡坡度采样误差 < 0.05 度', () => {
    const project = normalizeProject({
      meta: { worldSizeM: 2400 },
      terrain: { baseElev: 450, slopeMagM: 20, slopeDirDeg: 90, shapes: [] },
    });
    const field = buildElevationField(project);
    const analytic = Math.atan(20 / 2400) * (180 / Math.PI);
    const measured = sampleSlopeDeg(field, 1200, 1200);
    expect(Math.abs(measured - analytic)).toBeLessThan(0.05);
  });

  it('偏心山包峰顶导数趋于零且较坡腰小一个量级', () => {
    const field = buildElevationField(makeHillProject());
    const peakX = 800 + 0.35 * 300;
    const peakY = 800;
    const gPeak = sampleGradient(field, peakX, peakY);
    const gMid = sampleGradient(field, peakX + 150, peakY);
    const gPeakMag = Math.hypot(gPeak.dzdx, gPeak.dzdy);
    const gMidMag = Math.hypot(gMid.dzdx, gMid.dzdy);
    expect(gMidMag).toBeGreaterThan(0.01);
    expect(gPeakMag).toBeLessThan(gMidMag * 0.15);
    const h0 = sampleElevation(field, peakX, peakY);
    const h1 = sampleElevation(field, peakX + 1, peakY);
    expect(Math.abs(h0 - h1)).toBeLessThan(0.1);
    expect(h0).toBeGreaterThan(sampleElevation(field, peakX + 120, peakY));
  });

  it('等高线拼接为连续长折线且默认零齿线', () => {
    const project = makeHillProject();
    const field = buildElevationField(project);
    extractContours(field, project.terrain);
    let contours: ReturnType<typeof extractContours> = [];
    let elapsed = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      contours = extractContours(field, project.terrain);
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    expect(contours.length).toBeGreaterThan(0);
    for (const contour of contours) {
      expect(contour.points.length).toBeGreaterThanOrEqual(3);
      if (contour.closed) expect(contour.points.length).toBeGreaterThanOrEqual(4);
      for (const p of contour.points) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
    expect(elapsed).toBeLessThan(process.env.CI === 'true' ? 90 : 35);
    expect(extractScarpTicks(contours, field, project.terrain)).toEqual([]);
  });

  it('开启 showScarpTicks 时齿线实长严格 4.0m 且指向下坡', () => {
    const project = makeScarpProject();
    const pkg = buildTerrainPackage(project);
    expect(pkg.scarpTicks.length).toBeGreaterThan(0);
    const field = pkg.terrainData;
    for (const tick of pkg.scarpTicks.slice(0, 40)) {
      const len = Math.hypot(tick.x2 - tick.x1, tick.y2 - tick.y1);
      expect(Math.abs(len - 4.0)).toBeLessThanOrEqual(0.01);
      const g = sampleGradient(field, tick.x1, tick.y1);
      const dot = (tick.x2 - tick.x1) * g.dzdx + (tick.y2 - tick.y1) * g.dzdy;
      expect(dot).toBeLessThan(0);
    }
    const projectOff = normalizeProject(project);
    projectOff.terrain.showScarpTicks = false;
    expect(extractScarpTicks(pkg.contours, field, projectOff.terrain)).toEqual([]);
  });

  it('三套真实工程高程与等高线管线零异常（含实测耗时）', () => {
    for (const preset of BUILTIN_PRESETS) {
      if (preset.key === 'blank') continue;
      const project = preset.build();
      const started = performance.now();
      const field = buildElevationField(project);
      const tElev = performance.now();
      const contours = extractContours(field, project.terrain);
      const tContour = performance.now();
      const scarpTicks = extractScarpTicks(contours, field, project.terrain);
      const elapsed = performance.now() - started;
      console.log(
        `[M1] ${preset.key} 地形管线 ${elapsed.toFixed(1)}ms（高程 ${(tElev - started).toFixed(1)} / 等高线 ${(tContour - tElev).toFixed(1)} / 齿线 ${(performance.now() - tContour).toFixed(1)}）contours=${contours.length} ticks=${scarpTicks.length}`,
      );
      expect(contours.length).toBeGreaterThan(0);
      expect(field.minElev).toBeLessThan(field.maxElev);
      expect(elapsed).toBeLessThan(1500);
      for (const contour of contours) {
        expect(contour.points.length).toBeGreaterThanOrEqual(2);
      }
      for (const tick of scarpTicks) {
        expect(Math.abs(Math.hypot(tick.x2 - tick.x1, tick.y2 - tick.y1) - 4.0)).toBeLessThanOrEqual(
          0.01,
        );
      }
    }
  });

  it('等高线拾取与推拉笔刷零 NaN，重提取仍连续', () => {
    const project = makeHillProject();
    const field = buildElevationField(project);
    const contours = extractContours(field, project.terrain);
    const target = contours.find((c) => c.closed && c.points.length > 8);
    expect(target).toBeDefined();
    const anchor = target?.points[4];
    expect(anchor).toBeDefined();
    const hit = hitTestContourLine(contours, anchor?.[0] ?? 0, anchor?.[1] ?? 0, 12);
    expect(hit).not.toBeNull();

    let last = { points: contours };
    for (let step = 0; step < 12; step += 1) {
      const out = applyContourWarpDrag(field, project.terrain, {
        prevX: 700 + step * 6,
        prevY: 700,
        currX: 706 + step * 6,
        currY: 700,
        lockedElev: hit?.elev ?? 330,
        radiusM: 90,
        strength: 0.8,
      });
      last = { points: out.contours };
    }
    for (const contour of last.points) {
      for (const p of contour.points) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
    for (const mode of ['raise', 'lower', 'smooth', 'flatten'] as const) {
      const out = applySculptBrush(field, project.terrain, {
        x: 780,
        y: 820,
        radiusM: 70,
        strength: 0.7,
        mode,
        flattenTargetElev: 320,
      });
      expect(out.sculptDeltaB64.length).toBeGreaterThan(0);
    }
    let finite = true;
    for (let i = 0; i < field.elevation.length; i += 1) {
      if (!Number.isFinite(field.elevation[i])) finite = false;
    }
    expect(finite).toBe(true);
  });
});

describe('M1 · 样条 / 多边形 / Voronoi 算子', () => {
  it('开样条锁死首末点，闭合样条不重复首点', () => {
    const open = sampleCatmullRom(
      [
        [0, 0],
        [100, 40],
        [200, 0],
      ],
      10,
      false,
    );
    expect(open[0]).toEqual([0, 0]);
    expect(open[open.length - 1]).toEqual([200, 0]);
    const closed = sampleCatmullRom(SQUARE, 8, true);
    expect(closed.length).toBe(32);
    expect(closed[0]).not.toEqual(closed[closed.length - 1]);
  });

  it('折线最近点投影含段号与纵向比例', () => {
    const hit = closestPointOnPolyline(50, 10, [
      [0, 0],
      [100, 0],
    ]);
    expect(hit?.dist).toBeCloseTo(10, 6);
    expect(hit?.sAlong).toBeCloseTo(0.5, 6);
    expect(hit?.segIndex).toBe(0);
  });

  it('100x100m 多边形为 1.00 ha，重心与点包含正确', () => {
    expect(computePolygonAreaHa(SQUARE)).toBeCloseTo(1.0, 6);
    expect(computePolygonAreaSigned(SQUARE)).toBeCloseTo(10000, 6);
    const c = computePolygonCentroid(SQUARE);
    expect(c[0]).toBeCloseTo(50, 6);
    expect(c[1]).toBeCloseTo(50, 6);
    expect(pointInPolygon(50, 50, SQUARE)).toBe(true);
    expect(pointInPolygon(150, 50, SQUARE)).toBe(false);
  });

  it('精确线段求交与半平面裁剪', () => {
    const hit = intersectSegmentsExact([0, 0], [100, 100], [0, 100], [100, 0]);
    expect(hit?.x).toBeCloseTo(50, 9);
    expect(hit?.y).toBeCloseTo(50, 9);
    expect(intersectSegmentsExact([0, 0], [10, 0], [0, 5], [10, 5])).toBeNull();
    const clipped = clipPolygonHalfPlane(SQUARE, 1, 0, 50);
    expect(Math.abs(computePolygonAreaSigned(clipped))).toBeCloseTo(5000, 6);
    expect(minDistPolyToPoly(SQUARE, SQUARE.map(([x, y]) => [x + 110, y] as Vec2))).toBeCloseTo(
      10,
      6,
    );
  });

  it('耳切三角化面积和等于原多边形', () => {
    const tris = triangulatePolygon(SQUARE);
    expect(tris.length).toBe(2);
    let sum = 0;
    for (const tri of tris) sum += Math.abs(computePolygonAreaSigned(tri));
    expect(sum).toBeCloseTo(10000, 6);
  });

  it('Voronoi 有界 2 轮松弛，面积和等于边界多边形', () => {
    const sites: Vec2[] = [];
    const rng = createRng('voronoi-sites');
    for (let i = 0; i < 12; i += 1) sites.push([40 + rng() * 320, 40 + rng() * 320]);
    const cells = computeVoronoiCells(sites, [0, 0, 400, 400], 2);
    expect(cells.length).toBe(12);
    let area = 0;
    for (const cell of cells) area += Math.abs(computePolygonAreaSigned(cell));
    expect(area).toBeCloseTo(160000, 0);

    const boundary: Polygon = [
      [200, 0],
      [400, 200],
      [200, 400],
      [0, 200],
    ];
    const clipped = computeVoronoiCells(sites, [0, 0, 400, 400], 2, boundary);
    let clippedArea = 0;
    for (const cell of clipped) clippedArea += Math.abs(computePolygonAreaSigned(cell));
    expect(clippedArea).toBeCloseTo(80000, 0);
  });

  it('凸多边形内缩精确，超大内缩安全塌缩为空', () => {
    const inset = insetConvexPolygon(SQUARE, 10);
    expect(Math.abs(computePolygonAreaSigned(inset))).toBeCloseTo(6400, 4);
    expect(insetConvexPolygon(SQUARE, 500)).toEqual([]);
    expect(insetPolygonSafe(SQUARE, 500)).toEqual([]);
    const safe = insetPolygonSafe(SQUARE, 5);
    expect(safe.length).toBe(4);
  });
});


describe('V2.0.1 · 时间旅行恢复对抗回归', () => {
  it('loadProject 无条件 resume：暂停态载入后恢复入栈且历史清零', () => {
    const timeline = useStudioStore.temporal.getState();
    timeline.pause();
    expect(useStudioStore.temporal.getState().isTracking).toBe(false);
    useStudioStore.getState().loadProject(createPresetProject('palong'), true);
    expect(useStudioStore.temporal.getState().isTracking).toBe(true);
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(0);
    useStudioStore.getState().mutateProject((draft) => {
      draft.meta.name = '恢复后可撤销';
    }, false);
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(1);
  });
});


describe('V2.0.2 · 草稿落盘 / 重抽快照 / 图例合成对抗回归', () => {
  it('R2-1/R2-2 两点明渠与坎儿井正常落盘，新选区 mutate 后自动选中，小面积被拦', () => {
    useStudioStore.getState().loadProject(createBlankProject(), true);
    expect(isClosedDraftTool('draw_water_area', 'open_canal')).toBe(false);
    expect(isClosedDraftTool('draw_water_area', 'qanat_canal')).toBe(false);
    expect(isClosedDraftTool('draw_water_area', 'lake')).toBe(true);
    expect(isClosedDraftTool('draw_zone', 'lake')).toBe(true);
    const context = {
      tool: 'draw_water_area' as const,
      waterMode: 'open_canal' as const,
      roadTier: 'street' as const,
      zoneContentType: 'town_blocks' as const,
      linearType: 'ridge' as const,
    };
    const canalsBefore = useStudioStore.getState().project.canals.length;
    const open = commitDraftPoints([[100, 100], [320, 140]] as [number, number][], context, 11);
    expect(open.ok).toBe(true);
    expect(useStudioStore.getState().project.canals.length).toBe(canalsBefore + 1);
    const qanat = commitDraftPoints([[120, 200], [360, 260], [520, 240]] as [number, number][], { ...context, waterMode: 'qanat_canal' }, 12);
    expect(qanat.ok).toBe(true);
    const canals = useStudioStore.getState().project.canals;
    expect(canals.length).toBe(canalsBefore + 2);
    expect(canals[canals.length - 1]?.style).toBe('qanat');

    const zonePoints = [[200, 200], [700, 200], [700, 700], [200, 700]];
    const zone = commitDraftPoints(zonePoints as [number, number][], { ...context, tool: 'draw_zone' }, 13);
    expect(zone.ok).toBe(true);
    expect(zone.zoneId).not.toBeNull();
    const state = useStudioStore.getState();
    expect(state.project.zones.some((item) => item.id === zone.zoneId)).toBe(true);
    expect(state.selection?.type).toBe('zone');
    expect(state.selection?.id).toBe(zone.zoneId);

    const tiny = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const rejected = commitDraftPoints(tiny as [number, number][], { ...context, tool: 'draw_zone' }, 14);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('area');
  });

  it('R2-3 rerollZone 仅产生 1 条 Zundo 快照，且 loadProject 竞态不污染新工程', async () => {
    useStudioStore.getState().loadProject(createPresetProject('losrumura'), true);
    setSceneCompilerForTest(async (project) => ({ scene: compileSettlementScene(project), updatedSeed: 4242 }));
    const timeline = useStudioStore.temporal.getState();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const before = timeline.pastStates.length;
    const zoneId = useStudioStore.getState().project.zones[1]?.id;
    expect(zoneId).toBeDefined();
    useStudioStore.getState().rerollZone(zoneId ?? '');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(useStudioStore.temporal.getState().pastStates.length - before).toBe(1);

    setSceneCompilerForTest(async (project) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { scene: compileSettlementScene(project), stale: false };
    });
    useStudioStore.getState().rerollZone(zoneId ?? '');
    useStudioStore.getState().loadProject(createPresetProject('palong'), true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(useStudioStore.getState().project.meta.id).toBe('proj_palong');
    expect(useStudioStore.getState().compiledScene?.worldSizeM).toBe(1400);
    setSceneCompilerForTest(null);
  });

  it('R2-6 图例合成：关闭立即生效，加自定义项不丢 14 类内置项', () => {
    const builtins = BUILTIN_LEGEND_CATALOG.map((entry, index) => ({
      key: entry.key,
      isCustom: false,
      glyphType: entry.glyphType,
      label: entry.label,
      color: '',
      colorLocked: false,
      strokeColor: entry.strokeColor,
      visible: true,
      autoPresent: true,
      order: index * 10,
    }));
    const sceneLegend = {
      visible: true, title: '图例 · LEGEND', position: 'bottom-right' as const, columns: 2 as const, items: builtins,
    };
    const custom = {
      key: 'custom_tower', isCustom: true, glyphType: 'tower', label: '烽燧',
      color: '', colorLocked: false, strokeColor: '', visible: true, autoPresent: true, order: 999,
    };
    const projectLegend = {
      visible: false, title: '图例 · LEGEND', position: 'top-left' as const, columns: 1 as const, items: [custom],
    };
    const effective = resolveEffectiveLegend(projectLegend, sceneLegend);
    expect(effective.visible).toBe(false);
    expect(effective.position).toBe('top-left');
    expect(effective.columns).toBe(1);
    expect(effective.items.length).toBe(15);
    expect(effective.items.filter((item) => item.isCustom === false).length).toBe(14);
    expect(effective.items.some((item) => item.key === 'custom_tower')).toBe(true);
    expect(effective.items.find((item) => item.key === 'city_wall')?.label).toBe('城垣与敌台');
  });
});

describe('V2.0.3 · 终版种子一致性与图例删除回归', () => {
  it('删除自定义图例后不再从场景侧复活', () => {
    const builtins = BUILTIN_LEGEND_CATALOG.map((entry, index) => ({
      key: entry.key, isCustom: false, glyphType: entry.glyphType, label: entry.label,
      color: '', colorLocked: false, strokeColor: entry.strokeColor,
      visible: true, autoPresent: true, order: index * 10,
    }));
    const custom = {
      key: 'custom_tower', isCustom: true, glyphType: 'tower' as const, label: '烽燧',
      color: '', colorLocked: false, strokeColor: '', visible: true, autoPresent: true, order: 999,
    };
    const sceneLegend = { visible: true, title: '图例 · LEGEND', position: 'bottom-right' as const, columns: 2 as const, items: [...builtins, custom] };
    const withCustom = { visible: true, title: '图例 · LEGEND', position: 'top-left' as const, columns: 1 as const, items: [...builtins, custom] };
    expect(resolveEffectiveLegend(withCustom, sceneLegend).items.some((item) => item.key === 'custom_tower')).toBe(true);
    const deleted = { ...withCustom, items: builtins };
    const effective = resolveEffectiveLegend(deleted, sceneLegend);
    expect(effective.items.some((item) => item.key === 'custom_tower')).toBe(false);
    expect(effective.items.length).toBe(14);
  });
});
