/**
 * Terrax Settlement Studio — M5 全工具交互控制器
 * 文件：web/js/app.js
 *
 * 职责：
 *   1. 挂载浅色纸本测绘工坊主视图，管理工程状态、场景重编译与 60fps 渲染循环；
 *   2. 打通 12 项工具（V 选择 / C 等高线推拉 / B 四笔刷 / H 山包盆地 / G 山脊冲沟陡坎 /
 *      W 河流 / L 湖海水渠 / K 岩礁渡口 / D 道路 / Z 抽卡选区 / M 地标 / U 测距）；
 *   3. 右侧 5 标签检视器：地形、水路、选区抽卡、图例、配色与导出；
 *   4. HistoryManager 单步合并撤销重做、水路拖拽后选区自动避让重编；
 *   5. `/api/ping` 探测与纯静态离线降级，`/api/terrax-context` 经纬度初值导入。
 *
 * 范围铁律：本模块不提供任何单栋房屋的新建、点选、拖拽、旋转或删除入口。
 */

import {
  ZONE_CONTENT_TYPES,
  CUSTOM_GLYPH_TYPES,
  BUILTIN_LEGEND_CATALOG,
  BUILTIN_PALETTES,
  HistoryManager,
  createDefaultProject,
  getBuiltinPresetProjects,
  normalizeProject,
  deserializeProject,
  getActivePalette,
  syncLegendWithProject,
  createUid,
  hashSeed
} from './state_and_schema.js';

import {
  buildTerrainPackage,
  sampleElevation,
  sampleSlopeDeg,
  hitTestContourLine,
  applyContourWarpDrag,
  applySculptBrush
} from './terrain_engine.js';

import {
  buildHydroRoadPackage,
  closestPointOnPolyline
} from './hydro_road_engine.js';

import {
  compileSettlementScene,
  rerollZoneSeed,
  verifyZeroCollisions,
  pointInPolygon,
  computePolygonAreaHa,
  segmentsIntersect
} from './gacha_zone_engine.js';

import {
  createViewport,
  fitViewportToWorld,
  screenToWorld,
  zoomViewportAtScreenPoint,
  renderSceneToCanvas,
  drawLegendGlyphCanvas
} from './canvas_renderer.js';

import {
  downloadPNG,
  downloadSVG,
  downloadProjectJSON,
  readProjectJSONFile
} from './exporter.js';

const ZONE_LABELS = {
  walled_city: '内城城垣与街坊',
  town_blocks: '市镇沿街坊巷',
  village: '顺坡散居村寨',
  citadel: '堡寨官署石碉',
  market: '集场换装货市',
  farmland: '河阶条田农田',
  saltpan: '晒盐池卤畦',
  woodland: '成片疏林炭林',
  exclusion: '禁建留白区'
};

const ZONE_SHORT = {
  walled_city: '内城',
  town_blocks: '市镇',
  village: '村寨',
  citadel: '堡寨',
  market: '集场',
  farmland: '条田',
  saltpan: '盐池',
  woodland: '疏林',
  exclusion: '禁建'
};

const PALETTE_SLOT_LABELS = {
  paperBg: '底图纸张色',
  inkDark: '钢笔主墨线色',
  roofInner: '内城/堡寨屋面色',
  roofTown: '市镇/村寨屋面色',
  roadFill: '干道/街巷路面色',
  waterFill: '河湖海域水底色',
  waterRipple: '贴岸水纹弦线色',
  treeFill: '融合树冠叶面色',
  treeOutline: '树冠深墨外廓色',
  contourLine: '等高线棕褐测绘色',
  farmlandFill: '河阶农田条垄底色',
  saltpanFill: '晒盐池卤畦镜面色'
};

const GLYPH_LABELS = {
  star_fort: '八角星芒 · 王廷官署',
  tower: '方座箭楼 · 烽燧石碉',
  well_shrine: '双环水滴 · 泉眼分水堰',
  ferry_anchor: '横杠铁锚 · 船坞埠头',
  gate_arch: '双柱牌楼 · 关隘税卡',
  market_tent: '三角旗帐 · 互市集场',
  mine_hammer: '交叉锤钻 · 铁坊炭窑',
  stele: '圭首方碑 · 界碑古迹'
};

const THEME_LABELS = {
  watabou_classic: '经典羊皮纸淡彩',
  nordic_fjord: '寒海峡湾石青',
  arid_oasis: '旱原泉线赭砂',
  gazetteer_ink: '方志素笺水墨'
};

const TOOL_HINTS = {
  select: '选择图元后拖拽顶点、轴柄或偏心菱形柄；拖拽选区内部可整体平移。',
  contour_drag: '按住任意等高线向山外拉宽或向山内推挤，实时重提等高线。',
  sculpt_brush: '按住涂抹；Alt + 点击吸取该点海拔为定高目标。',
  add_hill: '点击放置山包/盆地，按住拖拽可同时指定长半轴。',
  add_ridge: '连续点击绘制折线，双击结束；类型在右侧【地形】面板切换。',
  draw_river: '依上游→下游顺序点击落点，双击生成纯净变宽河道。',
  draw_water_area: '湖海：连续点击后双击闭合；明渠/暗渠：点击折线，双击结束。',
  place_reef: '点击河道内放置显式基岩礁石；点击道路与河流交点切换浅滩渡口。',
  draw_road: '连续点击绘制道路，双击结束；跨河处自动生成正交桥梁。',
  draw_zone: '连续点击框定多边形，双击或点击首点闭合，立即抽卡生成内部要素。',
  place_landmark: '在【图例】面板选中图例项后，点击画布盖印地标徽记与旁注。',
  measure: '按住拖拽拉出测距虚线，实时显示水平距离。'
};

const TOOL_CURSOR = {
  select: 'default',
  contour_drag: 'nwse',
  sculpt_brush: 'brush',
  add_hill: 'crosshair',
  add_ridge: 'crosshair',
  draw_river: 'crosshair',
  draw_water_area: 'crosshair',
  place_reef: 'crosshair',
  draw_road: 'crosshair',
  draw_zone: 'crosshair',
  place_landmark: 'pick',
  measure: 'crosshair'
};

const SHORTCUTS = {
  v: 'select',
  c: 'contour_drag',
  b: 'sculpt_brush',
  h: 'add_hill',
  g: 'add_ridge',
  w: 'draw_river',
  l: 'draw_water_area',
  k: 'place_reef',
  d: 'draw_road',
  z: 'draw_zone',
  m: 'place_landmark',
  u: 'measure'
};

function fmtNum(v, digits) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return digits === undefined ? String(Math.round(n * 100) / 100) : n.toFixed(digits);
}

function escHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* ================================================================================================
 * 应用主入口
 * ============================================================================================== */

export function createStudioApp(rootDocument) {
  const doc = rootDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('createStudioApp 需要可用的 Document 环境');

  const $ = (id) => doc.getElementById(id);
  const canvas = $('map-canvas');
  const wrap = $('viewport-wrap');
  if (!canvas || !wrap) throw new Error('createStudioApp 未找到 #map-canvas / #viewport-wrap');

  const ctx = canvas.getContext('2d');
  const presets = getBuiltinPresetProjects();

  const state = {
    project: createDefaultProject('losrumura'),
    scene: null,
    terrainData: null,
    hydro: null,
    viewport: createViewport(1200, 820, 3200),
    tool: 'select',
    selection: null,
    hover: null,
    history: new HistoryManager(40),
    brushMode: 'raise',
    brushRadiusM: 140,
    brushStrength: 0.35,
    brushTargetElev: null,
    shapeAddType: 'hill',
    ridgeType: 'ridge',
    waterMode: 'lake',
    roadTier: 'highway',
    zoneType: 'town_blocks',
    activeLegendKey: null,
    draft: null,
    drag: null,
    measure: null,
    mouse: { x: 0, y: 0, inside: false },
    spaceDown: false,
    rafPending: false,
    rebuildTimer: null,
    badgeTimer: null,
    verifyTimer: null,
    lastContourHit: null,
    inspectorTab: 'terrain',
    backendOnline: false,
    terraxPreview: null
  };

  const dom = {
    toolButtons: Array.from(doc.querySelectorAll('.tool-btn')),
    tabs: Array.from(doc.querySelectorAll('.inspector-tab')),
    panels: {
      terrain: $('panel-terrain'),
      hydro: $('panel-hydro'),
      zones: $('panel-zones'),
      legend: $('panel-legend'),
      palette: $('panel-palette')
    },
    projectName: $('project-name'),
    presetSelect: $('preset-select'),
    zoneHud: $('zone-floating-hud'),
    zoneHudName: $('zone-hud-name'),
    zoneHudType: $('zone-hud-type'),
    zoneHudReroll: $('zone-hud-reroll'),
    zoneHudLock: $('zone-hud-lock'),
    zoneHudMeta: $('zone-hud-meta'),
    draftHint: $('draft-hint'),
    viewportBadge: $('viewport-badge'),
    viewportBadgeText: $('viewport-badge-text'),
    zoomReadout: $('zoom-readout'),
    statusCoords: $('status-coords'),
    statusElevSlope: $('status-elev-slope'),
    statusCounts: $('status-counts'),
    statusZoom: $('status-zoom'),
    backendBadge: $('backend-badge'),
    collisionPill: $('status-collision-pill'),
    shapeList: $('shape-list'),
    shapeEditor: $('shape-editor'),
    listRivers: $('list-rivers'),
    listWater: $('list-water'),
    listCanals: $('list-canals'),
    listRoads: $('list-roads'),
    listReefs: $('list-reefs'),
    listFords: $('list-fords'),
    hydroEditor: $('hydro-editor'),
    hydroStats: $('hydro-stats'),
    zoneList: $('zone-list'),
    zoneEditor: $('zone-editor'),
    zoneStats: $('zone-stats'),
    collisionDetail: $('collision-detail'),
    legendList: $('legend-list'),
    legendVisible: $('legend-visible'),
    legendTitle: $('legend-title'),
    legendPosition: $('legend-position'),
    legendColumns: $('legend-columns'),
    customGlyph: $('custom-glyph'),
    customLabel: $('custom-label'),
    customColor: $('custom-color'),
    themeCards: $('theme-cards'),
    paletteSlots: $('palette-slots'),
    projectMetaInfo: $('project-meta-info'),
    toast: $('toast'),
    modalBackdrop: $('modal-backdrop'),
    terraxResult: $('terrax-result'),
    terraxLon: $('terrax-lon'),
    terraxLat: $('terrax-lat'),
    terraxSpan: $('terrax-span'),
    modalApply: $('btn-modal-apply'),
    fileInput: $('file-input')
  };

  /* ---------------------------------------------------------------------------------------------
   * 一、场景编译与渲染
   * ------------------------------------------------------------------------------------------- */

  function rebuildScene(options) {
    const opts = options || {};
    // 立即重建时取消已排队的延迟重建，避免旧任务覆盖新场景
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = null;
    try {
      state.scene = compileSettlementScene(state.project);
      state.terrainData = state.scene.terrain.terrainData;
      state.hydro = state.scene.hydro;
      if (opts.keepSelection !== true) {
        validateSelection();
      }
      syncInspector();
      requestRender();
      return true;
    } catch (err) {
      showToast(`场景编译失败：${err && err.message ? err.message : err}`, true);
      return false;
    }
  }

  function rebuildTerrainOnly() {
    const pkg = buildTerrainPackage(state.project);
    state.terrainData = pkg.terrainData;
    if (state.scene) {
      state.scene.terrain = {
        terrainData: pkg.terrainData,
        contours: pkg.contours,
        scarpTicks: pkg.scarpTicks,
        stats: pkg.stats
      };
    }
    requestRender();
  }

  function rebuildHydroOnly() {
    state.hydro = buildHydroRoadPackage(state.project, state.terrainData);
    if (state.scene) state.scene.hydro = state.hydro;
    requestRender();
  }

  function reaggregateScene() {
    const zones = state.scene.zones || [];
    const buildings = [];
    const walls = [];
    const trees = [];
    const farmlandPlots = [];
    const saltpanCells = [];
    const marketAprons = [];
    const lanes = [];
    const gardenFences = [];
    const internalStreets = [];
    const wells = [];
    const exclusionPolys = [];
    for (let i = 0; i < zones.length; i += 1) {
      const z = zones[i];
      if (!z) continue;
      for (let k = 0; k < z.buildings.length; k += 1) buildings.push(z.buildings[k]);
      for (let k = 0; k < z.walls.length; k += 1) walls.push(z.walls[k]);
      for (let k = 0; k < z.trees.length; k += 1) trees.push(z.trees[k]);
      for (let k = 0; k < z.farmlandPlots.length; k += 1) farmlandPlots.push(z.farmlandPlots[k]);
      for (let k = 0; k < z.saltpanCells.length; k += 1) saltpanCells.push(z.saltpanCells[k]);
      for (let k = 0; k < z.marketAprons.length; k += 1) marketAprons.push(z.marketAprons[k]);
      for (let k = 0; k < z.lanes.length; k += 1) lanes.push(z.lanes[k]);
      for (let k = 0; k < z.gardenFences.length; k += 1) gardenFences.push(z.gardenFences[k]);
      for (let k = 0; k < z.internalStreets.length; k += 1) internalStreets.push(z.internalStreets[k]);
      for (let k = 0; k < z.wells.length; k += 1) wells.push(z.wells[k]);
      if (z.exclusionPoly) exclusionPolys.push(z.exclusionPoly);
    }
    state.scene.buildings = buildings;
    state.scene.walls = walls;
    state.scene.trees = trees;
    state.scene.farmlandPlots = farmlandPlots;
    state.scene.saltpanCells = saltpanCells;
    state.scene.marketAprons = marketAprons;
    state.scene.lanes = lanes;
    state.scene.gardenFences = gardenFences;
    state.scene.internalStreets = internalStreets;
    state.scene.wells = wells;
    state.scene.exclusionPolys = exclusionPolys;
    state.scene.stats.buildingCount = buildings.length;
    state.scene.stats.wallCount = walls.length;
    state.scene.stats.treeCount = trees.length;
    syncLegendWithProject(state.project, state.scene);
    state.scene.legend = state.project.legend;
  }

  function scheduleVerify() {
    clearTimeout(state.verifyTimer);
    state.verifyTimer = setTimeout(() => {
      if (!state.scene) return;
      const report = verifyZeroCollisions(
        state.project,
        state.terrainData,
        state.hydro,
        state.scene.zones
      );
      state.scene.collisionReport = report;
      state.scene.stats.collisionHits = report.totalHits;
      updateStatusbar();
      syncCollisionPanel();
    }, 16);
  }

  function scheduleSceneRebuild(delay) {
    showBadge(true, '重算中…');
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = setTimeout(() => {
      rebuildScene();
      showBadge(false);
    }, typeof delay === 'number' ? delay : 140);
  }

  function showBadge(visible, text) {
    if (!dom.viewportBadge) return;
    if (visible) {
      if (text) dom.viewportBadgeText.textContent = text;
      dom.viewportBadge.classList.remove('hidden');
    } else {
      dom.viewportBadge.classList.add('hidden');
    }
  }

  function requestRender() {
    if (state.rafPending) return;
    state.rafPending = true;
    const raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    raf(() => {
      state.rafPending = false;
      draw();
    });
  }

  function buildUiState() {
    const ui = {
      selection: state.selection,
      hover: state.hover,
      measure: state.measure
    };
    if (state.draft) {
      ui.draft = {
        kind: state.draft.kind,
        points: state.draft.points,
        cursor: state.mouse.inside ? [state.mouse.x, state.mouse.y] : null
      };
    }
    if (state.tool === 'sculpt_brush' && state.mouse.inside) {
      ui.brush = { x: state.mouse.x, y: state.mouse.y, radiusM: state.brushRadiusM };
    }
    if (state.lastContourHit && state.tool === 'contour_drag' && state.mouse.inside) {
      ui.hover = {
        type: 'contour',
        x: state.lastContourHit.x,
        y: state.lastContourHit.y,
        label: `等高线 ${Math.round(state.lastContourHit.elev)} m`
      };
    }
    return ui;
  }

  function draw() {
    if (!ctx || !state.project) return;
    const dpr = state.viewport.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderSceneToCanvas(ctx, state.project, state.scene, state.viewport, {
      isExport: false,
      includeCartouche: true,
      ui: buildUiState()
    });
    updateStatusbar();
  }

  /* ---------------------------------------------------------------------------------------------
   * 二、画布尺寸与视口
   * ------------------------------------------------------------------------------------------- */

  function resizeCanvas(keepCenter) {
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    const dpr = clampNum(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 1, 3);
    const oldW = state.viewport.widthPx;
    const oldH = state.viewport.heightPx;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    state.viewport.widthPx = w;
    state.viewport.heightPx = h;
    state.viewport.dpr = dpr;
    if (keepCenter !== false && oldW > 0 && oldH > 0) {
      state.viewport.panX += (w - oldW) * 0.5;
      state.viewport.panY += (h - oldH) * 0.5;
    }
    requestRender();
  }

  function fitToWorld() {
    fitViewportToWorld(state.viewport, state.viewport.widthPx, state.viewport.heightPx,
      state.project.meta.worldSizeM, 42);
    requestRender();
  }

  /* ---------------------------------------------------------------------------------------------
   * 三、状态栏
   * ------------------------------------------------------------------------------------------- */

  function updateStatusbar() {
    const vp = state.viewport;
    const scene = state.scene;
    if (dom.zoomReadout) dom.zoomReadout.textContent = `${Math.round(vp.zoom * 100)}%`;
    if (dom.statusZoom) dom.statusZoom.textContent = `缩放: ${Math.round(vp.zoom * 100)}%`;

    if (state.mouse.inside && state.terrainData) {
      const { x, y } = state.mouse;
      const worldSizeM = state.project.meta.worldSizeM;
      if (x < 0 || y < 0 || x > worldSizeM || y > worldSizeM) {
        dom.statusCoords.textContent = 'X: 图幅外 · Y: 图幅外';
        dom.statusElevSlope.textContent = '海拔: — m · 坡度: —°';
      } else {
        const elev = sampleElevation(state.terrainData, x, y);
        const slope = sampleSlopeDeg(state.terrainData, x, y);
        dom.statusCoords.textContent = `X: ${x.toFixed(1)} m · Y: ${y.toFixed(1)} m`;
        dom.statusElevSlope.textContent = `海拔: ${elev.toFixed(1)} m · 坡度: ${slope.toFixed(1)}°`;
      }
    } else {
      dom.statusCoords.textContent = 'X: — m · Y: — m';
      dom.statusElevSlope.textContent = '海拔: — m · 坡度: —°';
    }

    if (scene) {
      dom.statusCounts.textContent =
        `选区: ${scene.zones.length} · 屋宇: ${scene.buildings.length} 栋 · 桥梁: ${(scene.hydro.bridges || []).length} 座`;
      const report = scene.collisionReport;
      if (report && report.passed) {
        dom.collisionPill.className = 'badge badge-ok';
        dom.collisionPill.textContent = '✓ 零穿模核验 (0 冲突)';
        dom.collisionPill.title = `河心岛 ${report.riverIslands} · 桥梁 ${(scene.hydro.bridges || []).length} 座`;
      } else if (report) {
        dom.collisionPill.className = 'badge badge-warn';
        dom.collisionPill.textContent = `⚠ 穿模 ${report.totalHits} 处`;
        dom.collisionPill.title = `道路 ${report.buildingRoadHits} · 水体 ${report.buildingWaterHits} · 城垣 ${report.buildingWallHits} · 邻屋 ${report.buildingBuildingHits} · 禁建 ${report.buildingExclusionHits}`;
      } else {
        dom.collisionPill.className = 'badge badge-warn';
        dom.collisionPill.textContent = '核验中…';
      }
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * 四、选中态与通用查询
   * ------------------------------------------------------------------------------------------- */

  function findZone(id) {
    return state.project.zones.find((z) => z.id === id) || null;
  }

  function findShape(id) {
    return state.project.terrain.shapes.find((s) => s.id === id) || null;
  }

  function findRiver(id) {
    return state.project.rivers.find((r) => r.id === id) || null;
  }

  function findWaterBody(id) {
    return state.project.waterBodies.find((w) => w.id === id) || null;
  }

  function findCanal(id) {
    return state.project.canals.find((c) => c.id === id) || null;
  }

  function findRoad(id) {
    return state.project.roads.find((r) => r.id === id) || null;
  }

  function findReef(id) {
    return state.project.reefs.find((r) => r.id === id) || null;
  }

  function findLandmark(id) {
    return state.project.landmarks.find((l) => l.id === id) || null;
  }

  function findFord(id) {
    return state.project.fords.find((f) => f.id === id) || null;
  }

  function selectedZone() {
    return (state.selection && state.selection.type === 'zone') ? findZone(state.selection.id) : null;
  }

  function validateSelection() {
    const sel = state.selection;
    if (!sel) return;
    let exists = false;
    if (sel.type === 'zone') exists = !!findZone(sel.id);
    else if (sel.type === 'shape') exists = !!findShape(sel.id);
    else if (sel.type === 'river') exists = !!findRiver(sel.id);
    else if (sel.type === 'waterBody') exists = !!findWaterBody(sel.id);
    else if (sel.type === 'canal') exists = !!findCanal(sel.id);
    else if (sel.type === 'road') exists = !!findRoad(sel.id);
    else if (sel.type === 'reef') exists = !!findReef(sel.id);
    else if (sel.type === 'landmark') exists = !!findLandmark(sel.id);
    else if (sel.type === 'ford') exists = !!findFord(sel.id);
    if (!exists) state.selection = null;
  }

  /* ---------------------------------------------------------------------------------------------
   * 五、指针交互
   * ------------------------------------------------------------------------------------------- */

  function eventToWorld(evt) {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(evt.clientX - rect.left, evt.clientY - rect.top, state.viewport);
  }

  function worldTol(px) {
    return px / state.viewport.zoom;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = clampNum(t, 0, 1);
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  function distToPolyline(px, py, poly, closed) {
    if (!Array.isArray(poly) || poly.length === 0) return Infinity;
    if (poly.length === 1) return Math.hypot(px - poly[0][0], py - poly[0][1]);
    let best = Infinity;
    const segCount = closed ? poly.length : poly.length - 1;
    for (let i = 0; i < segCount; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const d = distToSegment(px, py, a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
    return best;
  }

  function hitZoneAt(wx, wy, tolWorld) {
    const zones = state.project.zones;
    for (let i = zones.length - 1; i >= 0; i -= 1) {
      const zone = zones[i];
      const pts = zone.points;
      if (!Array.isArray(pts) || pts.length < 3) continue;
      if (pointInPolygon(wx, wy, pts) || distToPolyline(wx, wy, pts, true) <= tolWorld) {
        return zone;
      }
    }
    return null;
  }

  function hitZoneVertex(zone, wx, wy, tolWorld) {
    if (!zone) return -1;
    for (let i = 0; i < zone.points.length; i += 1) {
      if (Math.hypot(wx - zone.points[i][0], wy - zone.points[i][1]) <= tolWorld) return i;
    }
    return -1;
  }

  function hitZoneMidpoint(zone, wx, wy, tolWorld) {
    if (!zone) return -1;
    for (let i = 0; i < zone.points.length; i += 1) {
      const a = zone.points[i];
      const b = zone.points[(i + 1) % zone.points.length];
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      if (Math.hypot(wx - mx, wy - my) <= tolWorld) return i;
    }
    return -1;
  }

  function hitPolylineObject(wx, wy, tolWorld) {
    const candidates = [];
    for (let i = 0; i < state.project.rivers.length; i += 1) {
      const r = state.project.rivers[i];
      candidates.push({ type: 'river', id: r.id, dist: distToPolyline(wx, wy, r.points, false), name: r.name });
    }
    for (let i = 0; i < state.project.roads.length; i += 1) {
      const r = state.project.roads[i];
      candidates.push({ type: 'road', id: r.id, dist: distToPolyline(wx, wy, r.points, false), name: r.name });
    }
    for (let i = 0; i < state.project.canals.length; i += 1) {
      const c = state.project.canals[i];
      candidates.push({ type: 'canal', id: c.id, dist: distToPolyline(wx, wy, c.points, false), name: c.name });
    }
    for (let i = 0; i < state.project.waterBodies.length; i += 1) {
      const w = state.project.waterBodies[i];
      const inside = pointInPolygon(wx, wy, w.points);
      candidates.push({ type: 'waterBody', id: w.id, dist: inside ? 0 : distToPolyline(wx, wy, w.points, true), name: w.name });
    }
    let best = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (c.dist <= tolWorld && (!best || c.dist < best.dist)) best = c;
    }
    return best;
  }

  function hitReef(wx, wy, tolWorld) {
    for (let i = state.project.reefs.length - 1; i >= 0; i -= 1) {
      const reef = state.project.reefs[i];
      if (Math.hypot(wx - reef.x, wy - reef.y) <= reef.radiusM + tolWorld) {
        return { type: 'reef', id: reef.id, dist: 0, name: '基岩礁石' };
      }
    }
    return null;
  }

  function hitLandmark(wx, wy, tolWorld) {
    for (let i = state.project.landmarks.length - 1; i >= 0; i -= 1) {
      const lm = state.project.landmarks[i];
      const r = Math.max(10, (lm.sizePx || 15) / state.viewport.zoom);
      if (Math.hypot(wx - lm.x, wy - lm.y) <= r + tolWorld) {
        return { type: 'landmark', id: lm.id, dist: 0, name: lm.label };
      }
    }
    return null;
  }

  function hitShape(wx, wy, tolWorld) {
    const shapes = state.project.terrain.shapes;
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const s = shapes[i];
      if (s.type === 'hill' || s.type === 'basin') {
        const rad = ((s.angleDeg || 0) * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const dx = wx - s.cx;
        const dy = wy - s.cy;
        const u = (dx * cosA + dy * sinA) / Math.max(25, s.rx);
        const v = (-dx * sinA + dy * cosA) / Math.max(25, s.ry);
        if (u * u + v * v <= 1.06) return { type: 'shape', id: s.id, dist: 0, name: s.type };
      } else if (Array.isArray(s.points)) {
        if (distToPolyline(wx, wy, s.points, false) <= tolWorld * 1.6) {
          return { type: 'shape', id: s.id, dist: 0, name: s.type };
        }
      }
    }
    return null;
  }

  function hitShapeHandle(shape, wx, wy, tolWorld) {
    if (!shape) return null;
    if (shape.type === 'hill' || shape.type === 'basin') {
      const rad = ((shape.angleDeg || 0) * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      if (Math.hypot(wx - shape.cx, wy - shape.cy) <= tolWorld * 1.6) return { part: 'center' };
      const axes = [
        { part: 'rx+', lx: shape.rx, ly: 0 },
        { part: 'ry+', lx: 0, ly: shape.ry },
        { part: 'rx-', lx: -shape.rx, ly: 0 },
        { part: 'ry-', lx: 0, ly: -shape.ry }
      ];
      for (let i = 0; i < axes.length; i += 1) {
        const a = axes[i];
        const px = shape.cx + a.lx * cosA - a.ly * sinA;
        const py = shape.cy + a.lx * sinA + a.ly * cosA;
        if (Math.hypot(wx - px, wy - py) <= tolWorld * 1.5) return { part: a.part };
      }
      const rotPx = shape.cx - (-shape.ry - 24 / state.viewport.zoom) * sinA;
      const rotPy = shape.cy + (-shape.ry - 24 / state.viewport.zoom) * cosA;
      if (Math.hypot(wx - rotPx, wy - rotPy) <= tolWorld * 1.8) return { part: 'rotate' };
      const fwx = shape.cx + shape.focusX * shape.rx * cosA - shape.focusY * shape.ry * sinA;
      const fwy = shape.cy + shape.focusX * shape.rx * sinA + shape.focusY * shape.ry * cosA;
      if (Math.hypot(wx - fwx, wy - fwy) <= tolWorld * 1.8) return { part: 'focus' };
      return null;
    }
    if (Array.isArray(shape.points)) {
      for (let i = 0; i < shape.points.length; i += 1) {
        if (Math.hypot(wx - shape.points[i][0], wy - shape.points[i][1]) <= tolWorld * 1.3) {
          return { part: 'pt', index: i };
        }
      }
      for (let i = 0; i + 1 < shape.points.length; i += 1) {
        const mx = (shape.points[i][0] + shape.points[i + 1][0]) * 0.5;
        const my = (shape.points[i][1] + shape.points[i + 1][1]) * 0.5;
        if (Math.hypot(wx - mx, wy - my) <= tolWorld) return { part: 'mid', index: i };
      }
    }
    return null;
  }

  function hitFord(wx, wy, tolWorld) {
    for (let i = state.project.fords.length - 1; i >= 0; i -= 1) {
      const ford = state.project.fords[i];
      const r = Math.max(8, (ford.radiusM || 24) * 0.55);
      if (Math.hypot(wx - ford.x, wy - ford.y) <= r + tolWorld) {
        return { type: 'ford', id: ford.id, dist: 0, name: ford.name || '渡口' };
      }
    }
    return null;
  }

  function hitObject(wx, wy) {
    const tol = worldTol(9);
    // 点状/线状要素优先于外层面状选区，避免河湖渠路被大选区抢走拾取
    const lm = hitLandmark(wx, wy, tol);
    if (lm) return lm;
    const reef = hitReef(wx, wy, tol);
    if (reef) return reef;
    const ford = hitFord(wx, wy, tol);
    if (ford) return ford;
    const poly = hitPolylineObject(wx, wy, tol);
    if (poly) return poly;
    // 选区优先于地形椭圆/山包：避免大面积 hill 把内城与议事厅的点击截胡
    const zone = hitZoneAt(wx, wy, tol);
    if (zone) return { type: 'zone', id: zone.id, dist: 0, name: zone.name };
    const shape = hitShape(wx, wy, tol);
    if (shape) return shape;
    return null;
  }

  /* ---------------------------------------------------------------------------------------------
   * 六、历史与提交
   * ------------------------------------------------------------------------------------------- */

  function beginHistory() {
    state.history.beginContinuousAction(state.project);
  }

  function commitHistory(label) {
    state.history.commitHistory(state.project, label);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const status = state.history.getStatus();
    const undoBtn = $('btn-undo');
    const redoBtn = $('btn-redo');
    if (undoBtn) undoBtn.disabled = !status.canUndo;
    if (redoBtn) redoBtn.disabled = !status.canRedo;
  }

  function undo() {
    const next = state.history.undo(state.project);
    if (!next) return;
    state.project = next;
    state.selection = null;
    state.draft = null;
    const view = snapshotViewport();
    rebuildScene();
    restoreViewport(view);
    updateHistoryButtons();
    showToast('已撤销');
  }

  function redo() {
    const next = state.history.redo(state.project);
    if (!next) return;
    state.project = next;
    state.selection = null;
    state.draft = null;
    const view = snapshotViewport();
    rebuildScene();
    restoreViewport(view);
    updateHistoryButtons();
    showToast('已重做');
  }

  function snapshotViewport() {
    return {
      zoom: state.viewport.zoom,
      panX: state.viewport.panX,
      panY: state.viewport.panY
    };
  }

  function restoreViewport(view) {
    if (!view || !Number.isFinite(view.zoom)) return;
    state.viewport.zoom = view.zoom;
    state.viewport.panX = view.panX;
    state.viewport.panY = view.panY;
    requestRender();
  }

  function fitToWorldIfNeeded() {
    fitViewportToWorld(state.viewport, state.viewport.widthPx, state.viewport.heightPx,
      state.project.meta.worldSizeM, 42);
    requestRender();
  }

  function showToast(message, isWarn) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.className = isWarn ? 'is-warn' : '';
    dom.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      dom.toast.classList.add('hidden');
    }, 2600);
  }

  /* ---------------------------------------------------------------------------------------------
   * 七、pointer 事件主状态机
   * ------------------------------------------------------------------------------------------- */

  function setCursor(cursor) {
    canvas.setAttribute('data-cursor', cursor || 'default');
  }

  function capturePointer(evt) {
    try {
      canvas.setPointerCapture(evt.pointerId);
    } catch (err) {
      // 合成事件或已释放的 pointerId 下无捕获能力，忽略即可
    }
  }

  function beginPan(evt, world) {
    state.drag = {
      kind: 'pan',
      startScreen: { x: evt.clientX, y: evt.clientY },
      startPan: { x: state.viewport.panX, y: state.viewport.panY }
    };
    setCursor('grabbing');
    if (wrap) wrap.classList.add('is-panning');
  }

  function onPointerDown(evt) {
    if (evt.button === 2) return;
    canvas.focus();
    const world = eventToWorld(evt);
    state.mouse.x = world.x;
    state.mouse.y = world.y;
    state.mouse.inside = true;

    if (evt.button === 1 || (evt.button === 0 && state.spaceDown)) {
      evt.preventDefault();
      capturePointer(evt);
      beginPan(evt, world);
      return;
    }
    if (evt.button !== 0) return;
    capturePointer(evt);

    const tool = state.tool;
    if (tool === 'select') return onSelectDown(evt, world);
    if (tool === 'contour_drag') return onContourDown(evt, world);
    if (tool === 'sculpt_brush') return onBrushDown(evt, world);
    if (tool === 'add_hill') return onAddHillDown(evt, world);
    if (tool === 'add_ridge') return onDraftClick(evt, world, 'ridge');
    if (tool === 'draw_river') return onDraftClick(evt, world, 'river');
    if (tool === 'draw_water_area') return onDraftClick(evt, world, 'water');
    if (tool === 'draw_road') return onDraftClick(evt, world, 'road');
    if (tool === 'draw_zone') return onDraftClick(evt, world, 'zone');
    if (tool === 'place_reef') return onPlaceReef(evt, world);
    if (tool === 'place_landmark') return onPlaceLandmark(evt, world);
    if (tool === 'measure') return onMeasureDown(evt, world);
    return undefined;
  }

  function onSelectDown(evt, world) {
    const tol = worldTol(9);
    const zone = selectedZone();

    // 1) 选区顶点 / 边中点
    if (zone) {
      const vi = hitZoneVertex(zone, world.x, world.y, tol * 1.3);
      if (vi >= 0) {
        beginHistory();
        state.drag = { kind: 'zone-vertex', zoneId: zone.id, index: vi };
        return;
      }
      const mi = hitZoneMidpoint(zone, world.x, world.y, tol * 1.15);
      if (mi >= 0) {
        beginHistory();
        const a = zone.points[mi];
        const b = zone.points[(mi + 1) % zone.points.length];
        zone.points.splice(mi + 1, 0, [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]);
        state.drag = { kind: 'zone-vertex', zoneId: zone.id, index: mi + 1 };
        syncInspector();
        requestRender();
        return;
      }
    }

    // 2) 地形图元手柄
    if (state.selection && state.selection.type === 'shape') {
      const shape = findShape(state.selection.id);
      const handle = hitShapeHandle(shape, world.x, world.y, tol);
      if (handle) {
        beginHistory();
        state.drag = {
          kind: 'shape-handle',
          shapeId: shape.id,
          part: handle.part,
          index: handle.index,
          startX: world.x,
          startY: world.y,
          origin: JSON.parse(JSON.stringify(shape))
        };
        return;
      }
    }

    // 3) 地标拖拽
    if (state.selection && state.selection.type === 'landmark') {
      const lm = findLandmark(state.selection.id);
      if (lm) {
        const r = Math.max(10, (lm.sizePx || 15) / state.viewport.zoom);
        if (Math.hypot(world.x - lm.x, world.y - lm.y) <= r + tol) {
          beginHistory();
          state.drag = { kind: 'landmark', id: lm.id };
          return;
        }
      }
    }

    // 4) 折线顶点拖拽
    if (state.selection && ['river', 'road', 'canal'].indexOf(state.selection.type) >= 0) {
      const obj = state.selection.type === 'river' ? findRiver(state.selection.id)
        : (state.selection.type === 'road' ? findRoad(state.selection.id) : findCanal(state.selection.id));
      if (obj) {
        for (let i = 0; i < obj.points.length; i += 1) {
          if (Math.hypot(world.x - obj.points[i][0], world.y - obj.points[i][1]) <= tol * 1.2) {
            beginHistory();
            state.drag = { kind: 'poly-vertex', type: state.selection.type, id: obj.id, index: i };
            return;
          }
        }
      }
    }

    // 4b) 湖海多边形顶点拖拽
    if (state.selection && state.selection.type === 'waterBody') {
      const wb = findWaterBody(state.selection.id);
      if (wb) {
        for (let i = 0; i < wb.points.length; i += 1) {
          if (Math.hypot(world.x - wb.points[i][0], world.y - wb.points[i][1]) <= tol * 1.2) {
            beginHistory();
            state.drag = { kind: 'water-vertex', id: wb.id, index: i };
            return;
          }
        }
      }
    }

    // 4c) 岩礁 / 渡口整体拖动
    if (state.selection && state.selection.type === 'reef') {
      const reef = findReef(state.selection.id);
      if (reef && Math.hypot(world.x - reef.x, world.y - reef.y) <= reef.radiusM + tol) {
        beginHistory();
        state.drag = { kind: 'reef', id: reef.id };
        return;
      }
    }
    if (state.selection && state.selection.type === 'ford') {
      const ford = findFord(state.selection.id);
      if (ford && Math.hypot(world.x - ford.x, world.y - ford.y) <= Math.max(8, ford.radiusM * 0.55) + tol) {
        beginHistory();
        state.drag = { kind: 'ford', id: ford.id };
        return;
      }
    }

    // 5) 常规拾取
    const hit = hitObject(world.x, world.y);
    if (!hit) {
      state.selection = null;
      syncInspector();
      requestRender();
      return;
    }
    state.selection = { type: hit.type, id: hit.id };

    if (hit.type === 'zone') {
      const zoneHit = findZone(hit.id);
      const vi = hitZoneVertex(zoneHit, world.x, world.y, tol * 1.3);
      beginHistory();
      state.drag = vi >= 0
        ? { kind: 'zone-vertex', zoneId: zoneHit.id, index: vi }
        : { kind: 'zone-move', zoneId: zoneHit.id, last: { x: world.x, y: world.y } };
    } else if (hit.type === 'landmark') {
      beginHistory();
      state.drag = { kind: 'landmark', id: hit.id };
    }
    syncInspector();
    requestRender();
    return undefined;
  }

  function onPointerMove(evt) {
    const world = eventToWorld(evt);
    state.mouse.x = world.x;
    state.mouse.y = world.y;
    state.mouse.inside = true;

    if (!state.drag) {
      updateHover(world);
      if (state.tool === 'sculpt_brush' || state.tool === 'contour_drag') requestRender();
      else updateStatusbar();
      return;
    }

    if (state.drag.kind === 'pan') {
      state.viewport.panX = state.drag.startPan.x + (evt.clientX - state.drag.startScreen.x);
      state.viewport.panY = state.drag.startPan.y + (evt.clientY - state.drag.startScreen.y);
      requestRender();
      return;
    }

    if (state.drag.kind === 'zone-vertex') {
      const zone = findZone(state.drag.zoneId);
      if (zone) {
        zone.points[state.drag.index] = [world.x, world.y];
        requestRender();
        updateZoneHudMeta();
      }
      return;
    }

    if (state.drag.kind === 'zone-move') {
      const zone = findZone(state.drag.zoneId);
      if (zone) {
        const dx = world.x - state.drag.last.x;
        const dy = world.y - state.drag.last.y;
        for (let i = 0; i < zone.points.length; i += 1) {
          zone.points[i][0] += dx;
          zone.points[i][1] += dy;
        }
        state.drag.last = { x: world.x, y: world.y };
        requestRender();
      }
      return;
    }

    if (state.drag.kind === 'poly-vertex') {
      const obj = state.drag.type === 'river' ? findRiver(state.drag.id)
        : (state.drag.type === 'road' ? findRoad(state.drag.id) : findCanal(state.drag.id));
      if (obj) {
        obj.points[state.drag.index] = [world.x, world.y];
        rebuildHydroOnly();
      }
      return;
    }

    if (state.drag.kind === 'water-vertex') {
      const wb = findWaterBody(state.drag.id);
      if (wb && wb.points[state.drag.index]) {
        wb.points[state.drag.index] = [world.x, world.y];
        rebuildHydroOnly();
      }
      return;
    }

    if (state.drag.kind === 'reef') {
      const reef = findReef(state.drag.id);
      if (reef) {
        reef.x = world.x;
        reef.y = world.y;
        rebuildHydroOnly();
      }
      return;
    }

    if (state.drag.kind === 'ford') {
      const ford = findFord(state.drag.id);
      if (ford) {
        ford.x = world.x;
        ford.y = world.y;
        rebuildHydroOnly();
      }
      return;
    }

    if (state.drag.kind === 'landmark') {
      const lm = findLandmark(state.drag.id);
      if (lm) {
        lm.x = world.x;
        lm.y = world.y;
        requestRender();
      }
      return;
    }

    if (state.drag.kind === 'shape-handle') {
      applyShapeHandleDrag(world);
      return;
    }

    if (state.drag.kind === 'add-hill') {
      const shape = findShape(state.drag.shapeId);
      if (shape) {
        shape.rx = Math.max(25, Math.abs(world.x - shape.cx));
        shape.ry = Math.max(25, Math.abs(world.y - shape.cy));
        rebuildTerrainOnly();
        syncInspector();
      }
      return;
    }

    if (state.drag.kind === 'contour') {
      const dragCtx = {
        prevX: state.drag.prevX,
        prevY: state.drag.prevY,
        currX: world.x,
        currY: world.y,
        lockedElev: state.drag.lockedElev,
        radiusM: state.drag.radiusM,
        strength: 0.68
      };
      const contours = applyContourWarpDrag(state.project, state.terrainData, dragCtx);
      state.scene.terrain.contours = contours;
      state.scene.terrain.terrainData = state.terrainData;
      state.drag.prevX = world.x;
      state.drag.prevY = world.y;
      requestRender();
      return;
    }

    if (state.drag.kind === 'brush') {
      const d = Math.hypot(world.x - state.drag.lastX, world.y - state.drag.lastY);
      if (d < worldTol(4)) return;
      state.drag.lastX = world.x;
      state.drag.lastY = world.y;
      const contours = applySculptBrush(state.project, state.terrainData, {
        mode: state.brushMode,
        x: world.x,
        y: world.y,
        radiusM: state.brushRadiusM,
        strength: state.brushStrength,
        targetElev: state.brushTargetElev === null
          ? state.project.terrain.baseElev
          : state.brushTargetElev
      });
      state.scene.terrain.contours = contours;
      state.scene.terrain.terrainData = state.terrainData;
      requestRender();
      return;
    }

    if (state.drag.kind === 'measure') {
      const start = state.drag.start;
      const dist = Math.hypot(world.x - start.x, world.y - start.y);
      const elevA = state.terrainData ? sampleElevation(state.terrainData, start.x, start.y) : 0;
      const elevB = state.terrainData ? sampleElevation(state.terrainData, world.x, world.y) : 0;
      const slopeDeg = dist > 1e-6 ? (Math.atan(Math.abs(elevB - elevA) / dist) * 180) / Math.PI : 0;
      state.measure = {
        start,
        end: { x: world.x, y: world.y },
        dz: elevB - elevA,
        slopeDeg
      };
      requestRender();
      return;
    }

    if (state.drag.kind === 'draft') {
      requestRender();
    }
  }

  function onPointerUp(evt) {
    const world = eventToWorld(evt);
    const drag = state.drag;
    state.drag = null;
    if (wrap) wrap.classList.remove('is-panning');
    setCursor(TOOL_CURSOR[state.tool] || 'default');

    if (!drag) return;

    if (drag.kind === 'pan') {
      requestRender();
      return;
    }
    if (drag.kind === 'contour') {
      commitHistory('等高线推拉');
      scheduleSceneRebuild(30);
      showToast('等高线已重提，选区正在自动避让重算');
      return;
    }
    if (drag.kind === 'brush') {
      commitHistory(`高程笔刷 · ${state.brushMode}`);
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'zone-vertex' || drag.kind === 'zone-move') {
      const zone = findZone(drag.zoneId);
      if (zone) {
        zone.points = sanitizePolygon(zone.points);
      }
      commitHistory('调整选区边界');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'poly-vertex') {
      commitHistory('拖拽水路干道顶点');
      scheduleSceneRebuild(30);
      showToast('水路已更新，受影响选区自动重算避让');
      return;
    }
    if (drag.kind === 'water-vertex') {
      const wb = findWaterBody(drag.id);
      if (wb) wb.points = sanitizePolygon(wb.points);
      commitHistory('拖拽湖海顶点');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'reef') {
      commitHistory('移动基岩礁石');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'ford') {
      commitHistory('移动渡口');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'landmark') {
      commitHistory('移动地标');
      rebuildScene({ keepSelection: true });
      return;
    }
    if (drag.kind === 'shape-handle') {
      commitHistory('调整地形图元');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'add-hill') {
      commitHistory('新增地形图元');
      scheduleSceneRebuild(30);
      return;
    }
    if (drag.kind === 'measure') {
      const start = drag.start;
      const dist = Math.hypot(world.x - start.x, world.y - start.y);
      const elevA = state.terrainData ? sampleElevation(state.terrainData, start.x, start.y) : 0;
      const elevB = state.terrainData ? sampleElevation(state.terrainData, world.x, world.y) : 0;
      const slope = dist > 1e-6 ? (Math.atan(Math.abs(elevB - elevA) / dist) * 180) / Math.PI : 0;
      showToast(`测距 ${dist.toFixed(1)} m · 高差 ${(elevB - elevA).toFixed(1)} m · 平均坡度 ${slope.toFixed(1)}°`);
      requestRender();
      return;
    }
    requestRender();
  }

  function updateHover(world) {
    if (state.tool === 'contour_drag' && state.scene) {
      const tol = Math.max(5, Math.min(32, 12 / state.viewport.zoom));
      const hit = hitTestContourLine(state.scene.terrain.contours, world.x, world.y, tol);
      state.lastContourHit = hit;
      state.hover = null;
      if (hit) requestRender();
      return;
    }
    const hit = hitObject(world.x, world.y);
    if (hit) {
      state.hover = { type: hit.type, id: hit.id, x: world.x, y: world.y, label: hit.name || '' };
    } else {
      state.hover = null;
    }
    requestRender();
  }

  /* ---------------------------------------------------------------------------------------------
   * 八、各工具的具体实现
   * ------------------------------------------------------------------------------------------- */

  function onContourDown(evt, world) {
    if (!state.scene || !state.terrainData) return;
    const tol = Math.max(5, Math.min(32, 12 / state.viewport.zoom));
    const hit = hitTestContourLine(state.scene.terrain.contours, world.x, world.y, tol);
    if (!hit) {
      showToast('未命中等高线，请靠近任一条等高线按下', true);
      return;
    }
    beginHistory();
    state.drag = {
      kind: 'contour',
      prevX: world.x,
      prevY: world.y,
      lockedElev: hit.elev,
      radiusM: Math.max(60, 180),
      contourId: hit.contourId
    };
    showToast(`已锁定 ${Math.round(hit.elev)} m 等高线，向内/外拖拽推拉`);
  }

  function onBrushDown(evt, world) {
    if (!state.terrainData) return;
    if (evt.altKey) {
      const elev = sampleElevation(state.terrainData, world.x, world.y);
      state.brushTargetElev = Math.round(elev * 10) / 10;
      const input = $('brush-target');
      if (input) input.value = fmtNum(state.brushTargetElev, 1);
      showToast(`已吸取海拔 ${elev.toFixed(1)} m 为定高目标`);
      return;
    }
    beginHistory();
    state.drag = { kind: 'brush', lastX: world.x, lastY: world.y };
    const contours = applySculptBrush(state.project, state.terrainData, {
      mode: state.brushMode,
      x: world.x,
      y: world.y,
      radiusM: state.brushRadiusM,
      strength: state.brushStrength,
      targetElev: state.brushTargetElev === null ? state.project.terrain.baseElev : state.brushTargetElev
    });
    state.scene.terrain.contours = contours;
    state.scene.terrain.terrainData = state.terrainData;
    requestRender();
  }

  function onAddHillDown(evt, world) {
    beginHistory();
    const type = state.shapeAddType;
    const shape = {
      id: createUid(`shape_${type}`),
      type,
      cx: world.x,
      cy: world.y,
      rx: 60,
      ry: 60,
      angleDeg: 0,
      deltaElev: type === 'basin' ? -18 : 22,
      focusX: 0,
      focusY: 0
    };
    state.project.terrain.shapes.push(shape);
    state.selection = { type: 'shape', id: shape.id };
    state.drag = { kind: 'add-hill', shapeId: shape.id };
    rebuildTerrainOnly();
    syncInspector();
    showToast(`已放置${type === 'basin' ? '盆地' : '山包'}，拖拽可指定长半轴`);
  }

  function onDraftClick(evt, world, kind) {
    if (!state.draft || state.draft.kind !== kind) {
      state.draft = { kind, points: [] };
    }
    const points = state.draft.points;
    if (points.length >= 3) {
      const first = points[0];
      if (Math.hypot(world.x - first[0], world.y - first[1]) <= worldTol(11)) {
        finishDraft();
        return;
      }
    }
    if (points.length > 0) {
      const last = points[points.length - 1];
      if (Math.hypot(world.x - last[0], world.y - last[1]) <= worldTol(6)) {
        return;
      }
    }
    points.push([world.x, world.y]);
    updateDraftHint();
    requestRender();
  }

  function finishDraft() {
    const draft = state.draft;
    state.draft = null;
    if (!draft || draft.points.length < 2) {
      updateDraftHint();
      requestRender();
      return;
    }
    const pts = draft.points;
    const kind = draft.kind;
    if (kind === 'ridge') {
      if (pts.length < 2) return;
      beginHistory();
      const type = state.ridgeType;
      state.project.terrain.shapes.push({
        id: createUid(`shape_${type}`),
        type,
        points: pts,
        deltaElev: type === 'valley' ? -18 : (type === 'scarp' ? 14 : 26),
        widthLeft: type === 'scarp' ? 220 : 130,
        widthRight: type === 'scarp' ? 70 : 160
      });
      commitHistory('新增山脊/冲沟/陡坎');
      scheduleSceneRebuild(20);
      return;
    }
    if (kind === 'river') {
      if (pts.length < 2) return;
      beginHistory();
      state.project.rivers.push({
        id: createUid('riv'),
        name: `河道 ${state.project.rivers.length + 1}`,
        points: pts,
        widthStartM: 28,
        widthEndM: 46,
        carveDepthM: 6,
        rippleLines: 3
      });
      commitHistory('绘制河流');
      scheduleSceneRebuild(20);
      return;
    }
    if (kind === 'road') {
      if (pts.length < 2) return;
      beginHistory();
      const tier = state.roadTier;
      state.project.roads.push({
        id: createUid('rd'),
        name: `${tier === 'highway' ? '驿道' : (tier === 'street' ? '街路' : '村径')} ${state.project.roads.length + 1}`,
        tier,
        points: pts,
        widthM: tier === 'highway' ? 14 : (tier === 'street' ? 9 : 5)
      });
      commitHistory('绘制道路');
      scheduleSceneRebuild(20);
      return;
    }
    if (kind === 'water') {
      const mode = state.waterMode;
      beginHistory();
      if (mode === 'open' || mode === 'qanat') {
        if (pts.length < 2) return;
        state.project.canals.push({
          id: createUid('can'),
          name: `${mode === 'qanat' ? '坎儿井暗渠' : '引水明渠'} ${state.project.canals.length + 1}`,
          style: mode,
          points: pts,
          widthM: mode === 'qanat' ? 4.5 : 7
        });
        commitHistory('绘制水渠');
      } else {
        if (pts.length < 3) return;
        state.project.waterBodies.push({
          id: createUid('lake'),
          name: `${mode === 'sea' ? '海域' : '湖泊'} ${state.project.waterBodies.length + 1}`,
          kind: mode,
          points: pts,
          rippleLines: 3
        });
        commitHistory('绘制湖海');
      }
      scheduleSceneRebuild(20);
      return;
    }
    if (kind === 'zone') {
      if (pts.length < 3) return;
      if (!isSimplePolygon(pts)) {
        showToast('选区边界自交，请重新框定', true);
        return;
      }
      const area = computePolygonAreaHa(pts);
      if (area * 10000 < 400) {
        showToast('选区面积小于 400 m²，已忽略', true);
        return;
      }
      beginHistory();
      const zone = {
        id: createUid('zn'),
        name: `${ZONE_LABELS[state.zoneType] || '抽卡选区'} ${state.project.zones.length + 1}`,
        contentType: state.zoneType,
        points: pts,
        seed: (hashSeed(`${Date.now()}_${state.project.zones.length}`) >>> 0),
        locked: false,
        density: 0.72,
        maxSlopeDeg: 24,
        streetWidthM: 7.5,
        wallThicknessM: 5.5,
        towerIntervalM: 110
      };
      state.project.zones.push(zone);
      state.selection = { type: 'zone', id: zone.id };
      commitHistory('新增抽卡选区');
      scheduleSceneRebuild(20);
      showToast(`已创建选区 ${area.toFixed(2)} ha，正在抽卡生成`);
      return;
    }
  }

  function onPlaceReef(evt, world) {
    if (!state.hydro) return;
    const roads = state.hydro.roads || [];
    const rivers = state.hydro.rivers || [];
    let crossing = null;
    for (let i = 0; i < roads.length && !crossing; i += 1) {
      const roadHit = closestPointOnPolyline(world.x, world.y, roads[i].centerline);
      if (roadHit.dist > worldTol(16)) continue;
      for (let r = 0; r < rivers.length; r += 1) {
        const rv = rivers[r];
        const riverHit = closestPointOnPolyline(world.x, world.y, rv.centerline);
        const halfW = (typeof rv.widthAtU === 'function' ? rv.widthAtU(riverHit.sAlong) : 30) * 0.5;
        if (riverHit.dist <= halfW + worldTol(6)) {
          crossing = { x: world.x, y: world.y, roadId: roads[i].id, riverId: rv.id };
          break;
        }
      }
    }
    if (crossing) {
      const existing = state.project.fords.find((f) =>
        Math.hypot(f.x - crossing.x, f.y - crossing.y) <= 24);
      beginHistory();
      if (existing) {
        state.project.fords = state.project.fords.filter((f) => f.id !== existing.id);
        commitHistory('移除浅滩渡口');
        showToast('已恢复为自动正交桥梁');
      } else {
        state.project.fords.push({
          id: createUid('ford'),
          x: crossing.x,
          y: crossing.y,
          radiusM: 24,
          name: '浅滩渡'
        });
        commitHistory('标记浅滩渡口');
        showToast('已标记浅滩渡口：该跨河点不再自动架桥');
      }
      scheduleSceneRebuild(20);
      return;
    }
    const inWater = (state.hydro.rivers || []).some((r) => pointInPolygon(world.x, world.y, r.bankPolygon))
      || (state.hydro.waterBodies || []).some((w) => pointInPolygon(world.x, world.y, w.shorePoly));
    if (!inWater) {
      showToast('请在河道或湖面内点击以放置基岩礁石', true);
      return;
    }
    beginHistory();
    const reef = {
      id: createUid('reef'),
      x: world.x,
      y: world.y,
      radiusM: 14,
      angleDeg: 20,
      seed: (hashSeed(`${world.x}_${world.y}_${state.project.reefs.length}`) >>> 0),
      count: 2
    };
    state.project.reefs.push(reef);
    state.selection = { type: 'reef', id: reef.id };
    commitHistory('点放基岩礁石');
    scheduleSceneRebuild(20);
    showToast('已放置显式基岩礁石（非自动生成）');
  }

  function onPlaceLandmark(evt, world) {
    const legend = state.project.legend;
    let item = null;
    if (state.activeLegendKey) {
      item = legend.items.find((it) => it.key === state.activeLegendKey) || null;
    }
    if (!item) item = legend.items.find((it) => it && it.visible !== false) || null;
    if (!item) {
      showToast('请先在【图例】面板选择或新增一个图例符号', true);
      return;
    }
    // 盖印标签必须取所选图例项自身的 label；#custom-label 仅用于新建自定义图例
    const label = item.label || item.key;
    beginHistory();
    const lm = {
      id: createUid('lm'),
      legendKey: item.key,
      glyphType: item.glyphType,
      label,
      x: world.x,
      y: world.y,
      showLabel: true,
      sizePx: 15
    };
    state.project.landmarks.push(lm);
    state.selection = { type: 'landmark', id: lm.id };
    commitHistory('盖印地标徽记');
    rebuildScene({ keepSelection: true });
    showToast(`已盖印「${label}」`);
  }

  function onMeasureDown(evt, world) {
    state.measure = { start: { x: world.x, y: world.y }, end: { x: world.x, y: world.y } };
    state.drag = { kind: 'measure', start: { x: world.x, y: world.y } };
    requestRender();
  }

  /* ---------------------------------------------------------------------------------------------
   * 九、几何小工具
   * ------------------------------------------------------------------------------------------- */

  function isSimplePolygon(points) {
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue;
        const c = points[j];
        const d = points[(j + 1) % n];
        if (segmentsIntersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return false;
      }
    }
    return true;
  }

  function sanitizePolygon(points) {
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const limit = state.project.meta.worldSizeM;
      out.push([clampNum(p[0], 0, limit), clampNum(p[1], 0, limit)]);
    }
    return out.length >= 3 ? out : points;
  }

  function applyShapeHandleDrag(world) {
    const drag = state.drag;
    const shape = findShape(drag.shapeId);
    if (!shape) return;
    const origin = drag.origin;
    if (shape.type === 'hill' || shape.type === 'basin') {
      const rad = ((origin.angleDeg || 0) * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      if (drag.part === 'center') {
        shape.cx = origin.cx + (world.x - drag.startX);
        shape.cy = origin.cy + (world.y - drag.startY);
      } else if (drag.part === 'rotate') {
        const ang = Math.atan2(world.y - origin.cy, world.x - origin.cx) + Math.PI / 2;
        shape.angleDeg = Math.round((ang * 180) / Math.PI);
      } else if (drag.part === 'focus') {
        const dx = world.x - origin.cx;
        const dy = world.y - origin.cy;
        const u = (dx * cosA + dy * sinA) / Math.max(25, origin.rx);
        const v = (-dx * sinA + dy * cosA) / Math.max(25, origin.ry);
        const n = Math.hypot(u, v);
        if (n > 0.72) {
          shape.focusX = (u * 0.72) / n;
          shape.focusY = (v * 0.72) / n;
        } else {
          shape.focusX = u;
          shape.focusY = v;
        }
      } else {
        const dx = world.x - origin.cx;
        const dy = world.y - origin.cy;
        const u = Math.abs(dx * cosA + dy * sinA);
        const v = Math.abs(-dx * sinA + dy * cosA);
        if (drag.part === 'rx+' || drag.part === 'rx-') shape.rx = Math.max(25, u);
        if (drag.part === 'ry+' || drag.part === 'ry-') shape.ry = Math.max(25, v);
      }
    } else if (Array.isArray(shape.points)) {
      if (drag.part === 'pt' && Number.isInteger(drag.index)) {
        shape.points[drag.index] = [world.x, world.y];
      } else if (drag.part === 'mid' && Number.isInteger(drag.index)) {
        const a = shape.points[drag.index];
        const b = shape.points[drag.index + 1];
        shape.points.splice(drag.index + 1, 0, [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]);
        drag.part = 'pt';
        drag.index = drag.index + 1;
        shape.points[drag.index] = [world.x, world.y];
      }
    }
    rebuildTerrainOnly();
    syncInspector();
  }

  /* ---------------------------------------------------------------------------------------------
   * 十、滚轮、右键与键盘
   * ------------------------------------------------------------------------------------------- */

  function onWheel(evt) {
    evt.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = evt.clientX - rect.left;
    const sy = evt.clientY - rect.top;
    const factor = Math.exp(-evt.deltaY * 0.0015);
    zoomViewportAtScreenPoint(state.viewport, sx, sy, factor);
    requestRender();
  }

  function onContextMenu(evt) {
    evt.preventDefault();
    const world = eventToWorld(evt);
    const zone = selectedZone();
    if (zone) {
      const vi = hitZoneVertex(zone, world.x, world.y, worldTol(11));
      if (vi >= 0) {
        if (zone.points.length <= 3) {
          showToast('选区至少保留 3 个顶点', true);
          return;
        }
        beginHistory();
        zone.points.splice(vi, 1);
        zone.points = sanitizePolygon(zone.points);
        commitHistory('删除选区顶点');
        scheduleSceneRebuild(30);
        return;
      }
    }
    if (state.selection && state.selection.type === 'shape') {
      const shape = findShape(state.selection.id);
      if (shape && Array.isArray(shape.points)) {
        const handle = hitShapeHandle(shape, world.x, world.y, worldTol(11));
        if (handle && handle.part === 'pt' && shape.points.length > 2) {
          beginHistory();
          shape.points.splice(handle.index, 1);
          commitHistory('删除折线控制点');
          scheduleSceneRebuild(30);
        }
      }
    }
  }

  function onKeyDown(evt) {
    const tag = evt.target && evt.target.tagName ? evt.target.tagName.toUpperCase() : '';
    const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const meta = evt.metaKey || evt.ctrlKey;

    if (meta && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      if (evt.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && evt.key.toLowerCase() === 'y') {
      evt.preventDefault();
      redo();
      return;
    }
    if (evt.key === ' ') {
      if (!isTyping) {
        state.spaceDown = true;
        if (!state.drag) setCursor('grab');
        evt.preventDefault();
      }
      return;
    }
    if (evt.key === 'Escape') {
      if (state.draft) {
        state.draft = null;
        updateDraftHint();
        requestRender();
        showToast('已取消当前绘制');
      } else {
        state.selection = null;
        syncInspector();
        requestRender();
      }
      return;
    }
    if (evt.key === 'Enter') {
      if (state.draft) finishDraft();
      return;
    }
    if (evt.key === 'Delete' || evt.key === 'Backspace') {
      if (!isTyping) {
        evt.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (isTyping || meta) return;
    if (evt.key.toLowerCase() === 'r') {
      evt.preventDefault();
      rerollSelectedZone();
      return;
    }
    const tool = SHORTCUTS[evt.key.toLowerCase()];
    if (tool) {
      evt.preventDefault();
      setTool(tool);
    }
  }

  function onKeyUp(evt) {
    if (evt.key === ' ') {
      state.spaceDown = false;
      if (!state.drag) setCursor(TOOL_CURSOR[state.tool] || 'default');
    }
  }

  function onDoubleClick(evt) {
    evt.preventDefault();
    if (state.draft && state.draft.points.length >= 2) finishDraft();
  }

  function setTool(tool) {
    if (!TOOL_CURSOR[tool]) return;
    state.tool = tool;
    state.draft = null;
    state.lastContourHit = null;
    state.measure = null;
    dom.toolButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tool') === tool);
    });
    setCursor(TOOL_CURSOR[tool]);
    updateDraftHint();
    syncToolDefaults(tool);
    requestRender();
  }

  function syncToolDefaults(tool) {
    if (tool === 'add_hill') {
      const seg = $('shape-list');
      if (seg) seg.scrollTop = 0;
    }
    if (tool === 'draw_zone') {
      showToast('连续点击框定选区，双击或点击首点闭合');
    }
  }

  function updateDraftHint() {
    if (!dom.draftHint) return;
    if (state.draft && state.draft.points.length > 0) {
      const n = state.draft.points.length;
      const label = state.draft.kind === 'zone' ? '选区' : (state.draft.kind === 'river' ? '河道'
        : (state.draft.kind === 'road' ? '道路' : (state.draft.kind === 'ridge' ? '山脊/冲沟' : '水域')));
      dom.draftHint.textContent = `正在绘制${label} · 已落 ${n} 点 · 双击 / Enter 结束 · Esc 取消`;
      dom.draftHint.classList.remove('hidden');
    } else {
      dom.draftHint.classList.add('hidden');
    }
  }

  function deleteSelected() {
    const sel = state.selection;
    if (!sel) return;
    beginHistory();
    let removed = true;
    if (sel.type === 'zone') state.project.zones = state.project.zones.filter((z) => z.id !== sel.id);
    else if (sel.type === 'shape') state.project.terrain.shapes = state.project.terrain.shapes.filter((s) => s.id !== sel.id);
    else if (sel.type === 'river') state.project.rivers = state.project.rivers.filter((r) => r.id !== sel.id);
    else if (sel.type === 'waterBody') state.project.waterBodies = state.project.waterBodies.filter((w) => w.id !== sel.id);
    else if (sel.type === 'canal') state.project.canals = state.project.canals.filter((c) => c.id !== sel.id);
    else if (sel.type === 'road') state.project.roads = state.project.roads.filter((r) => r.id !== sel.id);
    else if (sel.type === 'reef') state.project.reefs = state.project.reefs.filter((r) => r.id !== sel.id);
    else if (sel.type === 'landmark') state.project.landmarks = state.project.landmarks.filter((l) => l.id !== sel.id);
    else if (sel.type === 'ford') state.project.fords = state.project.fords.filter((f) => f.id !== sel.id);
    else removed = false;
    if (!removed) return;
    commitHistory('删除图元');
    state.selection = null;
    rebuildScene();
    showToast('已删除所选图元');
  }

  function rerollSelectedZone() {
    const zone = selectedZone();
    if (!zone) {
      showToast('请先选中一个抽卡选区', true);
      return;
    }
    if (zone.locked) {
      showToast('该选区已锁定；如需重抽请先解锁', true);
      return;
    }
    beginHistory();
    const result = rerollZoneSeed(state.project, zone.id);
    if (!result || !result.zone) {
      showToast('重抽失败', true);
      return;
    }
    const idx = state.scene.zones.findIndex((z) => z.id === zone.id);
    if (idx >= 0) state.scene.zones[idx] = result.zone;
    reaggregateScene();
    commitHistory('重抽选区');
    requestRender();
    syncInspector();
    scheduleVerify();
    showToast(`已重抽「${zone.name}」· ${result.elapsedMs.toFixed(0)} ms · 种子 ${result.seed}`);
  }

  /* ---------------------------------------------------------------------------------------------
   * 十一、检视器同步
   * ------------------------------------------------------------------------------------------- */

  function setInputValue(el, value) {
    if (!el) return;
    if (doc.activeElement === el) return;
    el.value = value;
  }

  function setOutput(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function syncInspector() {
    syncTerrainPanel();
    syncHydroPanel();
    syncZonesPanel();
    syncLegendPanel();
    syncPalettePanel();
    syncZoneHud();
    updateHistoryButtons();
    syncCollisionPanel();
  }

  function syncTerrainPanel() {
    const t = state.project.terrain;
    setInputValue($('terr-base'), fmtNum(t.baseElev));
    setInputValue($('terr-slope-mag'), String(t.slopeMagM));
    setOutput('terr-slope-mag-out', fmtNum(t.slopeMagM));
    setInputValue($('terr-slope-dir'), String(t.slopeDirDeg));
    setOutput('terr-slope-dir-out', fmtNum(t.slopeDirDeg));
    setInputValue($('terr-step'), fmtNum(t.contourStep));
    setInputValue($('terr-index'), String(t.indexEvery));
    setInputValue($('terr-min'), fmtNum(t.minContourElev));
    setInputValue($('terr-max'), fmtNum(t.maxContourElev));
    const showContours = $('terr-show-contours');
    if (showContours) showContours.checked = t.showContours !== false;
    const showTicks = $('terr-show-ticks');
    if (showTicks) showTicks.checked = t.showScarpTicks === true;
    setInputValue($('terr-tick-thresh'), String(t.scarpSlopeThresholdDeg));
    setOutput('terr-tick-thresh-out', fmtNum(t.scarpSlopeThresholdDeg));
    if (state.brushTargetElev === null) state.brushTargetElev = t.baseElev;
    setInputValue($('brush-target'), fmtNum(state.brushTargetElev, 1));
    setInputValue($('brush-radius'), String(state.brushRadiusM));
    setOutput('brush-radius-out', fmtNum(state.brushRadiusM));
    setInputValue($('brush-strength'), String(state.brushStrength));
    setOutput('brush-strength-out', fmtNum(state.brushStrength));
    Array.from(doc.querySelectorAll('[data-brush]')).forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-brush') === state.brushMode);
    });
    renderShapeList();
  }

  function renderShapeList() {
    if (!dom.shapeList) return;
    const shapes = state.project.terrain.shapes;
    if (shapes.length === 0) {
      dom.shapeList.innerHTML = '<div class="list-empty">暂无参数化地形图元</div>';
      if (dom.shapeEditor) dom.shapeEditor.classList.add('hidden');
      return;
    }
    const rows = shapes.map((s) => {
      const selected = state.selection && state.selection.type === 'shape' && state.selection.id === s.id;
      const label = s.type === 'hill' ? '偏心山包' : (s.type === 'basin' ? '盆地洼地'
        : (s.type === 'ridge' ? '山脊' : (s.type === 'valley' ? '冲沟' : '河阶陡坎')));
      const meta = (s.type === 'hill' || s.type === 'basin')
        ? `Δ${fmtNum(s.deltaElev)} m · ${fmtNum(s.rx)}×${fmtNum(s.ry)} m`
        : `${s.points.length} 点 · Δ${fmtNum(s.deltaElev)} m · 坡宽 ${fmtNum(s.widthLeft)}/${fmtNum(s.widthRight)}`;
      return `<div class="list-row${selected ? ' is-selected' : ''}" data-shape-id="${escHtml(s.id)}">
        <span class="row-swatch" style="background:${s.type === 'basin' || s.type === 'valley' ? '#8faab3' : '#b55838'}"></span>
        <span class="row-main"><span class="row-name">${escHtml(label)}</span><span class="row-meta">${escHtml(meta)}</span></span>
        <button class="row-btn" data-act="shape-delete" title="删除">✕</button>
      </div>`;
    });
    dom.shapeList.innerHTML = rows.join('');
    renderShapeEditor();
  }

  function renderShapeEditor() {
    if (!dom.shapeEditor) return;
    const sel = state.selection;
    const shape = sel && sel.type === 'shape' ? findShape(sel.id) : null;
    if (!shape) {
      dom.shapeEditor.classList.add('hidden');
      return;
    }
    dom.shapeEditor.classList.remove('hidden');
    const blocks = [];
    if (shape.type === 'hill' || shape.type === 'basin') {
      blocks.push(`<div class="editor-title">${shape.type === 'hill' ? '偏心山包' : '盆地洼地'}</div>`);
      blocks.push(`<div class="field-grid">
        ${numField('中心 X', 'cx', shape.cx, 1)}
        ${numField('中心 Y', 'cy', shape.cy, 1)}
        ${numField('长半轴 rx', 'rx', shape.rx, 1, 25)}
        ${numField('短半轴 ry', 'ry', shape.ry, 1, 25)}
        ${numField('旋转角 (°)', 'angleDeg', shape.angleDeg, 1)}
        ${numField('高差 Δ (m)', 'deltaElev', shape.deltaElev, 1)}
        ${numField('偏心 focusX', 'focusX', shape.focusX, 0.02, -0.72, 0.72)}
        ${numField('偏心 focusY', 'focusY', shape.focusY, 0.02, -0.72, 0.72)}
      </div>`);
    } else {
      blocks.push(`<div class="editor-title">${shape.type === 'ridge' ? '山脊' : (shape.type === 'valley' ? '冲沟' : '河阶陡坎')} · ${shape.points.length} 个控制点</div>`);
      blocks.push(`<div class="field-grid">
        ${numField('高差 Δ (m)', 'deltaElev', shape.deltaElev, 1)}
        ${numField('左坡宽 (m)', 'widthLeft', shape.widthLeft, 5, 20)}
        ${numField('右坡宽 (m)', 'widthRight', shape.widthRight, 5, 20)}
      </div>`);
    }
    dom.shapeEditor.innerHTML = blocks.join('');
  }

  function numField(label, field, value, step, min, max) {
    return `<div class="field"><label>${escHtml(label)}</label><input type="number" data-field="${field}" data-scope="shape" value="${fmtNum(value)}" step="${step}"${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}></div>`;
  }

  function syncHydroPanel() {
    renderPolylineList(dom.listRivers, 'river', state.project.rivers, (r) => `${r.points.length} 点 · 宽 ${fmtNum(r.widthStartM)}→${fmtNum(r.widthEndM)} m`);
    renderPolylineList(dom.listWater, 'waterBody', state.project.waterBodies, (w) => `${w.kind === 'sea' ? '海域' : '湖泊'} · ${computePolygonAreaHa(w.points).toFixed(2)} ha`);
    renderPolylineList(dom.listCanals, 'canal', state.project.canals, (c) => `${c.style === 'qanat' ? '暗渠 qanat' : '明渠 open'} · 宽 ${fmtNum(c.widthM)} m`);
    renderPolylineList(dom.listRoads, 'road', state.project.roads, (r) => `${r.tier} · 宽 ${fmtNum(r.widthM)} m`);
    const reefRows = state.project.reefs.map((r) => {
      const selected = state.selection && state.selection.type === 'reef' && state.selection.id === r.id;
      return `<div class="list-row${selected ? ' is-selected' : ''}" data-reef-id="${escHtml(r.id)}">
        <span class="row-swatch" style="background:#585550"></span>
        <span class="row-main"><span class="row-name">基岩礁石</span><span class="row-meta">R ${fmtNum(r.radiusM)} m · ${r.count} 枚 · 种子 ${r.seed}</span></span>
        <button class="row-btn" data-act="reef-delete" title="删除">✕</button>
      </div>`;
    });
    if (dom.listReefs) {
      dom.listReefs.innerHTML = reefRows.length > 0 ? reefRows.join('') : '<div class="list-empty">暂无显式岩礁（河道保持纯净无岛）</div>';
    }
    const fordRows = state.project.fords.map((f) => {
      const selected = state.selection && state.selection.type === 'ford' && state.selection.id === f.id;
      return `<div class="list-row${selected ? ' is-selected' : ''}" data-ford-id="${escHtml(f.id)}">
        <span class="row-swatch" style="background:#2f6a72"></span>
        <span class="row-main"><span class="row-name">${escHtml(f.name)}</span><span class="row-meta">R ${fmtNum(f.radiusM)} m · ${fmtNum(f.x)}, ${fmtNum(f.y)}</span></span>
        <button class="row-btn" data-act="ford-delete" title="删除">✕</button>
      </div>`;
    });
    if (dom.listFords) {
      dom.listFords.innerHTML = fordRows.length > 0 ? fordRows.join('') : '<div class="list-empty">暂无浅滩渡口（跨河处自动架桥）</div>';
    }
    renderHydroEditor();
    const hydro = state.hydro;
    if (dom.hydroStats && hydro) {
      dom.hydroStats.innerHTML = `
        <div class="stat-row"><span>河道 / 湖海 / 水渠</span><span>${hydro.rivers.length} / ${hydro.waterBodies.length} / ${hydro.canals.length}</span></div>
        <div class="stat-row"><span>道路 / 正交桥 / 渡口</span><span>${hydro.roads.length} / ${hydro.bridges.length} / ${hydro.fordCrossings.length}</span></div>
        <div class="stat-row"><span>河心岛（必须为 0）</span><span class="${hydro.riverIslandCount === 0 ? 'stat-ok' : 'stat-warn'}">${hydro.riverIslandCount}</span></div>`;
    }
  }

  function renderPolylineList(container, type, items, metaFn) {
    if (!container) return;
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="list-empty">暂无要素</div>';
      return;
    }
    container.innerHTML = items.map((item) => {
      const selected = state.selection && state.selection.type === type && state.selection.id === item.id;
      return `<div class="list-row${selected ? ' is-selected' : ''}" data-poly-type="${type}" data-poly-id="${escHtml(item.id)}">
        <span class="row-swatch" style="background:${type === 'river' || type === 'waterBody' || type === 'canal' ? '#8faab3' : '#cc9a76'}"></span>
        <span class="row-main"><span class="row-name">${escHtml(item.name)}</span><span class="row-meta">${escHtml(metaFn(item))}</span></span>
        <button class="row-btn" data-act="poly-delete" title="删除">✕</button>
      </div>`;
    }).join('');
  }

  function renderHydroEditor() {
    if (!dom.hydroEditor) return;
    const sel = state.selection;
    if (!sel || ['river', 'road', 'canal', 'waterBody', 'reef', 'ford'].indexOf(sel.type) < 0) {
      dom.hydroEditor.classList.add('hidden');
      return;
    }
    dom.hydroEditor.classList.remove('hidden');
    const blocks = [];
    if (sel.type === 'river') {
      const r = findRiver(sel.id);
      if (!r) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push(`<div class="editor-title">河道 · ${escHtml(r.name)}</div>`);
      blocks.push(`<div class="field"><label>名称</label><input type="text" data-field="name" data-scope="hydro" value="${escHtml(r.name)}"></div>`);
      blocks.push(`<div class="field-grid">
        ${numField('上游宽 (m)', 'widthStartM', r.widthStartM, 1, 6)}
        ${numField('下游宽 (m)', 'widthEndM', r.widthEndM, 1, 6)}
        ${numField('下切深度 (m)', 'carveDepthM', r.carveDepthM, 0.5, 0)}
        ${numField('水纹道数', 'rippleLines', r.rippleLines, 1, 0, 3)}
      </div>`);
    } else if (sel.type === 'road') {
      const r = findRoad(sel.id);
      if (!r) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push(`<div class="editor-title">道路 · ${escHtml(r.name)}</div>`);
      blocks.push(`<div class="field"><label>名称</label><input type="text" data-field="name" data-scope="hydro" value="${escHtml(r.name)}"></div>`);
      blocks.push(`<div class="field"><label>等级</label><select data-field="tier" data-scope="hydro">
        <option value="highway"${r.tier === 'highway' ? ' selected' : ''}>主干驿道 highway</option>
        <option value="street"${r.tier === 'street' ? ' selected' : ''}>市镇街路 street</option>
        <option value="lane"${r.tier === 'lane' ? ' selected' : ''}>顺坡村径 lane</option>
      </select></div>`);
      blocks.push(`<div class="field-grid">${numField('路宽 (m)', 'widthM', r.widthM, 0.5, 2)}</div>`);
    } else if (sel.type === 'canal') {
      const c = findCanal(sel.id);
      if (!c) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push(`<div class="editor-title">水渠 · ${escHtml(c.name)}</div>`);
      blocks.push(`<div class="field"><label>名称</label><input type="text" data-field="name" data-scope="hydro" value="${escHtml(c.name)}"></div>`);
      blocks.push(`<div class="field"><label>样式</label><select data-field="style" data-scope="hydro">
        <option value="open"${c.style === 'open' ? ' selected' : ''}>引水明渠 open</option>
        <option value="qanat"${c.style === 'qanat' ? ' selected' : ''}>坎儿井暗渠 qanat</option>
      </select></div>`);
      blocks.push(`<div class="field-grid">${numField('渠宽 (m)', 'widthM', c.widthM, 0.5, 1.2)}</div>`);
    } else if (sel.type === 'waterBody') {
      const w = findWaterBody(sel.id);
      if (!w) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push(`<div class="editor-title">湖海 · ${escHtml(w.name)}</div>`);
      blocks.push(`<div class="field"><label>名称</label><input type="text" data-field="name" data-scope="hydro" value="${escHtml(w.name)}"></div>`);
      blocks.push(`<div class="field-grid">${numField('水纹环数', 'rippleLines', w.rippleLines, 1, 0, 3)}</div>`);
    } else if (sel.type === 'reef') {
      const r = findReef(sel.id);
      if (!r) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push('<div class="editor-title">显式基岩礁石</div>');
      blocks.push(`<div class="field-grid">
        ${numField('半径 (m)', 'radiusM', r.radiusM, 1, 4)}
        ${numField('礁体枚数', 'count', r.count, 1, 1, 3)}
        ${numField('旋转角 (°)', 'angleDeg', r.angleDeg, 1)}
        ${numField('随机种子', 'seed', r.seed, 1)}
      </div>`);
    } else if (sel.type === 'ford') {
      const f = findFord(sel.id);
      if (!f) { dom.hydroEditor.classList.add('hidden'); return; }
      blocks.push('<div class="editor-title">浅滩渡口</div>');
      blocks.push(`<div class="field"><label>名称</label><input type="text" data-field="name" data-scope="hydro" value="${escHtml(f.name)}"></div>`);
      blocks.push(`<div class="field-grid">${numField('半径 (m)', 'radiusM', f.radiusM, 1, 6)}</div>`);
    }
    dom.hydroEditor.innerHTML = blocks.join('');
  }

  function syncZonesPanel() {
    if (!dom.zoneList) return;
    const zones = state.project.zones;
    if (zones.length === 0) {
      dom.zoneList.innerHTML = '<div class="list-empty">暂无选区。切换到 Z 工具框定多边形即可抽卡。</div>';
    } else {
      dom.zoneList.innerHTML = zones.map((z) => {
        const selected = state.selection && state.selection.type === 'zone' && state.selection.id === z.id;
        const area = computePolygonAreaHa(z.points);
        return `<div class="list-row${selected ? ' is-selected' : ''}" data-zone-id="${escHtml(z.id)}">
          <span class="row-swatch" style="background:${z.contentType === 'walled_city' || z.contentType === 'citadel' ? '#cbb582' : (z.contentType === 'farmland' ? '#dfd8be' : (z.contentType === 'saltpan' ? '#cde0e3' : (z.contentType === 'woodland' ? '#5b844b' : (z.contentType === 'exclusion' ? '#b55838' : '#cc9a76'))))}"></span>
          <span class="row-main">
            <span class="row-name">${escHtml(z.name)}</span>
            <span class="row-meta">${escHtml(ZONE_SHORT[z.contentType] || z.contentType)} · ${area.toFixed(2)} ha · 种子 ${z.seed}${z.locked ? ' · 已锁定' : ''}</span>
          </span>
          <button class="row-btn${z.locked ? ' is-on' : ''}" data-act="zone-lock" title="${z.locked ? '解锁' : '锁定'}">${z.locked ? '🔒' : '🔓'}</button>
          <button class="row-btn" data-act="zone-reroll" title="重抽">🎲</button>
          <button class="row-btn" data-act="zone-delete" title="删除">✕</button>
        </div>`;
      }).join('');
    }
    if (dom.zoneStats) {
      const totalBuildings = state.scene ? state.scene.buildings.length : 0;
      const totalArea = zones.reduce((acc, z) => acc + computePolygonAreaHa(z.points), 0);
      dom.zoneStats.innerHTML = `
        <div class="stat-row"><span>选区数量 / 总面积</span><span>${zones.length} / ${totalArea.toFixed(2)} ha</span></div>
        <div class="stat-row"><span>已生成屋宇</span><span>${totalBuildings} 栋</span></div>
        <div class="stat-row"><span>锁定选区</span><span>${zones.filter((z) => z.locked).length}</span></div>`;
    }
    renderZoneEditor();
    syncZoneHud();
  }

  function renderZoneEditor() {
    if (!dom.zoneEditor) return;
    const zone = selectedZone();
    if (!zone) {
      dom.zoneEditor.classList.add('hidden');
      return;
    }
    dom.zoneEditor.classList.remove('hidden');
    const options = ZONE_CONTENT_TYPES.map((t) =>
      `<option value="${t}"${t === zone.contentType ? ' selected' : ''}>${ZONE_LABELS[t]}</option>`).join('');
    dom.zoneEditor.innerHTML = `
      <div class="editor-title">选区参数 · ${computePolygonAreaHa(zone.points).toFixed(2)} ha</div>
      <div class="field"><label>选区名称</label><input type="text" data-field="name" data-scope="zone" value="${escHtml(zone.name)}"></div>
      <div class="field"><label>生成内容类型</label><select data-field="contentType" data-scope="zone">${options}</select></div>
      <div class="field-grid">
        ${numField('密度 density', 'density', zone.density, 0.02, 0.2, 1)}
        ${numField('最大坡度 (°)', 'maxSlopeDeg', zone.maxSlopeDeg, 1, 4, 60)}
        ${numField('坊内街宽 (m)', 'streetWidthM', zone.streetWidthM, 0.5, 3, 24)}
        ${numField('城垣厚度 (m)', 'wallThicknessM', zone.wallThicknessM, 0.5, 1.5, 16)}
        ${numField('敌台间距 (m)', 'towerIntervalM', zone.towerIntervalM, 10, 30, 320)}
        ${numField('抽卡种子', 'seed', zone.seed, 1)}
      </div>
      <div class="btn-row">
        <button class="btn btn-chip" data-act="zone-reroll" type="button">🎲 重抽</button>
        <button class="btn btn-chip" data-act="zone-lock" type="button">${zone.locked ? '解锁选区' : '锁定选区'}</button>
      </div>`;
  }

  function syncZoneHud() {
    if (!dom.zoneHud) return;
    const zone = selectedZone();
    if (!zone) {
      dom.zoneHud.classList.add('hidden');
      return;
    }
    dom.zoneHud.classList.remove('hidden');
    if (doc.activeElement !== dom.zoneHudName) dom.zoneHudName.value = zone.name;
    if (doc.activeElement !== dom.zoneHudType) dom.zoneHudType.value = zone.contentType;
    dom.zoneHudLock.checked = zone.locked === true;
    updateZoneHudMeta();
  }

  function updateZoneHudMeta() {
    const zone = selectedZone();
    if (!zone || !dom.zoneHudMeta) return;
    const area = computePolygonAreaHa(zone.points);
    const compiled = state.scene ? state.scene.zones.find((z) => z.id === zone.id) : null;
    const count = compiled ? compiled.buildings.length : 0;
    dom.zoneHudMeta.textContent = `${area.toFixed(2)} ha · ${count} 屋 · 种子 ${zone.seed}`;
  }

  function syncCollisionPanel() {
    if (!dom.collisionDetail) return;
    const report = state.scene ? state.scene.collisionReport : null;
    if (!report) {
      dom.collisionDetail.innerHTML = '<div class="stat-row"><span>尚未核验</span><span>—</span></div>';
      return;
    }
    const ok = report.passed ? 'stat-ok' : 'stat-warn';
    dom.collisionDetail.innerHTML = `
      <div class="stat-row"><span>总判定</span><span class="${ok}">${report.passed ? '✓ 零穿模通过' : `✗ ${report.totalHits} 处冲突`}</span></div>
      <div class="stat-row"><span>道路 / 水体 / 城垣</span><span>${report.buildingRoadHits} / ${report.buildingWaterHits} / ${report.buildingWallHits}</span></div>
      <div class="stat-row"><span>邻屋 / 禁建区</span><span>${report.buildingBuildingHits} / ${report.buildingExclusionHits}</span></div>
      <div class="stat-row"><span>河心岛（BG-02）</span><span class="${report.riverIslands === 0 ? 'stat-ok' : 'stat-warn'}">${report.riverIslands}</span></div>`;
  }

  function syncLegendPanel() {
    const legend = state.project.legend;
    if (dom.legendVisible) dom.legendVisible.checked = legend.visible !== false;
    setInputValue(dom.legendTitle, legend.title);
    Array.from(doc.querySelectorAll('#legend-position [data-pos]')).forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-pos') === (legend.position || 'bottom-right'));
    });
    Array.from(doc.querySelectorAll('#legend-columns [data-cols]')).forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-cols')) === (legend.columns === 1 ? 1 : 2));
    });
    renderLegendList();
  }

  function renderLegendList() {
    if (!dom.legendList) return;
    const items = state.project.legend.items;
    if (items.length === 0) {
      dom.legendList.innerHTML = '<div class="list-empty">图面暂无要素；绘制后会自动挂载图例项。</div>';
      return;
    }
    const palette = getActivePalette(state.project);
    const resolvedColor = (item) => {
      if (typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)) return item.color;
      const cat = BUILTIN_LEGEND_CATALOG.find((c) => c.key === item.key) ||
        BUILTIN_LEGEND_CATALOG.find((c) => c.glyphType === item.glyphType);
      return (cat && cat.paletteSlot && palette[cat.paletteSlot]) || palette.roofTown;
    };
    dom.legendList.innerHTML = items.map((item, idx) => `
      <div class="legend-row${item.isCustom ? ' is-custom' : ''}${state.activeLegendKey === item.key ? ' is-selected' : ''}" data-legend-key="${escHtml(item.key)}">
        <canvas class="legend-preview" data-legend-preview="${escHtml(item.key)}" width="68" height="44"></canvas>
        <input type="checkbox" data-legend-visible="${escHtml(item.key)}"${item.visible !== false ? ' checked' : ''} title="显隐">
        <input type="text" data-legend-label="${escHtml(item.key)}" value="${escHtml(item.label)}">
        <input type="color" data-legend-color="${escHtml(item.key)}" value="${resolvedColor(item)}" title="${item.colorLocked ? '已手动锁定颜色' : '随主题自动取色'}">
        <button class="row-btn" data-legend-move="up" data-key="${escHtml(item.key)}" title="上移">↑</button>
        <button class="row-btn" data-legend-move="down" data-key="${escHtml(item.key)}" title="下移">↓</button>
        ${item.isCustom
          ? `<button class="row-btn" data-legend-delete="${escHtml(item.key)}" title="删除">✕</button>`
          : `<span class="legend-index">${idx + 1}</span>`}
      </div>`).join('');

    const previews = dom.legendList.querySelectorAll('canvas[data-legend-preview]');
    for (let i = 0; i < previews.length; i += 1) {
      const cvs = previews[i];
      const key = cvs.getAttribute('data-legend-preview');
      const item = items.find((it) => it.key === key);
      if (!item) continue;
      const g = cvs.getContext('2d');
      if (!g) continue;
      g.setTransform(2, 0, 0, 2, 0, 0);
      g.clearRect(0, 0, 34, 22);
      g.fillStyle = palette.paperBg;
      g.fillRect(0, 0, 34, 22);
      drawLegendGlyphCanvas(g, item, 3, 2, 28, 18, palette);
    }
  }

  function syncPalettePanel() {
    const themeId = state.project.palette.themeId;
    if (dom.themeCards) {
      dom.themeCards.innerHTML = Object.keys(BUILTIN_PALETTES).map((id) => {
        const p = BUILTIN_PALETTES[id];
        const swatches = ['paperBg', 'roofInner', 'roofTown', 'waterFill', 'treeFill', 'farmlandFill']
          .map((k) => `<i style="background:${p[k]}"></i>`).join('');
        return `<button class="theme-card${id === themeId ? ' is-active' : ''}" data-theme="${id}" type="button">
          <span class="theme-name">${escHtml(THEME_LABELS[id] || id)}</span>
          <span class="theme-sub">${id}</span>
          <span class="theme-swatches">${swatches}</span>
        </button>`;
      }).join('');
    }
    if (dom.paletteSlots) {
      const active = getActivePalette(state.project);
      dom.paletteSlots.innerHTML = Object.keys(PALETTE_SLOT_LABELS).map((slot) => `
        <div class="palette-row">
          <label for="pal-${slot}">${escHtml(PALETTE_SLOT_LABELS[slot])}<br><span class="palette-hex">${active[slot]}</span></label>
          <input id="pal-${slot}" type="color" data-palette-slot="${slot}" value="${active[slot]}">
        </div>`).join('');
    }
    if (dom.projectMetaInfo && state.scene) {
      const meta = state.project.meta;
      const anchor = meta.terraxAnchor;
      dom.projectMetaInfo.innerHTML = `
        <div class="stat-row"><span>图幅边长</span><span>${meta.worldSizeM} m</span></div>
        <div class="stat-row"><span>锚定经纬度</span><span>${anchor ? `${anchor.lon}°E, ${anchor.lat}°N` : '未锚定'}</span></div>
        <div class="stat-row"><span>真值海拔</span><span>${anchor ? `${anchor.elevM} m` : '—'}</span></div>
        <div class="stat-row"><span>场景编译</span><span>${state.scene.stats.compileMs.toFixed(0)} ms</span></div>
        <div class="stat-row"><span>轮廓 / 齿线</span><span>${state.scene.terrain.contours.length} / ${state.scene.terrain.scarpTicks.length}</span></div>`;
    }
  }

  function syncModalSummary() {
    if (!dom.terraxResult) return;
    const p = state.terraxPreview;
    if (!p) {
      dom.terraxResult.textContent = '尚未查询。';
      if (dom.modalApply) dom.modalApply.disabled = true;
      return;
    }
    dom.terraxResult.innerHTML = `
      <div class="stat-row"><span>格网 row / col</span><span>${p.grid.row} / ${p.grid.col}</span></div>
      <div class="stat-row"><span>DEM 真值海拔</span><span>${p.elevM} m</span></div>
      <div class="stat-row"><span>陆地 / 湖泊</span><span>${p.isLand ? '陆地' : '水域'} / ${p.lakeId}</span></div>
      <div class="stat-row"><span>背景坡向 / 高差</span><span>${p.slopeDirDeg}° / ${p.slopeMagM} m</span></div>
      <div class="stat-row"><span>邻近河流</span><span>${(p.nearbyRivers || []).map((r) => r.label).join('、') || '无'}</span></div>`;
    if (dom.modalApply) dom.modalApply.disabled = false;
  }

  /* ---------------------------------------------------------------------------------------------
   * 十二、事件绑定
   * ------------------------------------------------------------------------------------------- */

  function bindEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      state.mouse.inside = false;
      if (!state.drag) {
        state.hover = null;
        updateStatusbar();
        requestRender();
      }
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDoubleClick);

    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);

    dom.toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => setTool(btn.getAttribute('data-tool')));
    });

    dom.tabs.forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.getAttribute('data-tab')));
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resizeCanvas(true));
      ro.observe(wrap);
    } else {
      window.addEventListener('resize', () => resizeCanvas(true));
    }

    $('btn-zoom-in').addEventListener('click', () => {
      zoomViewportAtScreenPoint(state.viewport, state.viewport.widthPx * 0.5, state.viewport.heightPx * 0.5, 1.25);
      requestRender();
    });
    $('btn-zoom-out').addEventListener('click', () => {
      zoomViewportAtScreenPoint(state.viewport, state.viewport.widthPx * 0.5, state.viewport.heightPx * 0.5, 0.8);
      requestRender();
    });
    $('btn-fit').addEventListener('click', () => fitToWorld());

    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);

    dom.projectName.addEventListener('change', () => {
      beginHistory();
      state.project.meta.name = dom.projectName.value.trim() || '未命名聚落测绘图';
      commitHistory('重命名工程');
      requestRender();
      syncPalettePanel();
    });

    dom.presetSelect.addEventListener('change', () => {
      loadPreset(dom.presetSelect.value);
    });

    $('btn-open-json').addEventListener('click', () => dom.fileInput.click());
    $('btn-open-json-2').addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', async () => {
      const file = dom.fileInput.files && dom.fileInput.files[0];
      if (!file) return;
      try {
        const { text } = await readProjectJSONFile(file);
        const next = deserializeProject(text);
        applyProject(next, `已打开 ${file.name}`);
      } catch (err) {
        showToast(`打开失败：${err && err.message ? err.message : err}`, true);
      } finally {
        dom.fileInput.value = '';
      }
    });

    $('btn-save-json').addEventListener('click', () => {
      const info = downloadProjectJSON(state.project);
      showToast(`已保存 ${info.filename}`);
    });
    $('btn-save-json-2').addEventListener('click', () => {
      const info = downloadProjectJSON(state.project);
      showToast(`已保存 ${info.filename}`);
    });

    $('btn-export').addEventListener('click', () => {
      switchTab('palette');
      showToast('已切到【配色与导出】面板');
    });
    $('btn-export-png').addEventListener('click', () => {
      const scale = Number($('export-scale').value) || 2;
      const mode = $('export-mode').value === 'clean' ? 'clean' : 'full';
      try {
        const info = downloadPNG(state.project, state.scene, { scale, mode });
        showToast(`已导出 ${info.filename}（${info.width}×${info.height}）`);
      } catch (err) {
        showToast(`PNG 导出失败：${err && err.message ? err.message : err}`, true);
      }
    });
    $('btn-export-svg').addEventListener('click', () => {
      const mode = $('export-mode').value === 'clean' ? 'clean' : 'full';
      try {
        const info = downloadSVG(state.project, state.scene, { mode });
        showToast(`已导出 ${info.filename}（${(info.bytes / 1024).toFixed(0)} KB）`);
      } catch (err) {
        showToast(`SVG 导出失败：${err && err.message ? err.message : err}`, true);
      }
    });

    bindTerrainInputs();
    bindHydroInputs();
    bindZoneInputs();
    bindLegendInputs();
    bindPaletteInputs();
    bindModal();
    bindListDelegates();
  }

  function switchTab(tab) {
    state.inspectorTab = tab;
    dom.tabs.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab));
    Object.keys(dom.panels).forEach((key) => {
      const panel = dom.panels[key];
      if (panel) panel.classList.toggle('is-active', key === tab);
    });
  }

  function bindTerrainInputs() {
    const t = () => state.project.terrain;
    bindNumber('terr-base', () => t().baseElev, (v) => { t().baseElev = v; }, '基准海拔');
    bindRange('terr-slope-mag', 'terr-slope-mag-out', () => t().slopeMagM, (v) => { t().slopeMagM = v; }, '背景高差');
    bindRange('terr-slope-dir', 'terr-slope-dir-out', () => t().slopeDirDeg, (v) => { t().slopeDirDeg = v; }, '下坡方向');
    bindNumber('terr-step', () => t().contourStep, (v) => { t().contourStep = clampNum(v, 1, 100); }, '等高距');
    bindNumber('terr-index', () => t().indexEvery, (v) => { t().indexEvery = Math.round(clampNum(v, 1, 20)); }, '计曲线间隔');
    bindNumber('terr-min', () => t().minContourElev, (v) => { t().minContourElev = Math.min(v, t().maxContourElev - 1); }, '最低截断');
    bindNumber('terr-max', () => t().maxContourElev, (v) => { t().maxContourElev = Math.max(v, t().minContourElev + 1); }, '最高截断');
    bindRange('terr-tick-thresh', 'terr-tick-thresh-out', () => t().scarpSlopeThresholdDeg, (v) => { t().scarpSlopeThresholdDeg = v; }, '齿线阈值');

    $('terr-show-contours').addEventListener('change', (e) => {
      beginHistory();
      t().showContours = e.target.checked;
      commitHistory('切换等高线图层');
      rebuildScene();
    });
    $('terr-show-ticks').addEventListener('change', (e) => {
      beginHistory();
      t().showScarpTicks = e.target.checked;
      commitHistory('切换陡坎齿线');
      rebuildScene();
    });

    Array.from(doc.querySelectorAll('[data-add-shape]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-add-shape');
        if (type === 'hill' || type === 'basin') {
          state.shapeAddType = type;
          setTool('add_hill');
        } else {
          state.ridgeType = type;
          setTool('add_ridge');
        }
        showToast(`已切换到「${btn.textContent.replace('＋', '')}」绘制`);
      });
    });

    Array.from(doc.querySelectorAll('[data-brush]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.brushMode = btn.getAttribute('data-brush');
        Array.from(doc.querySelectorAll('[data-brush]')).forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        setTool('sculpt_brush');
      });
    });

    bindRange('brush-radius', 'brush-radius-out', () => state.brushRadiusM,
      (v) => { state.brushRadiusM = v; }, '笔刷半径', { affectsScene: false, history: false });
    bindRange('brush-strength', 'brush-strength-out', () => state.brushStrength,
      (v) => { state.brushStrength = v; }, '笔刷强度', { affectsScene: false, history: false });
    bindNumber('brush-target', () => (state.brushTargetElev === null ? state.project.terrain.baseElev : state.brushTargetElev), (v) => { state.brushTargetElev = v; }, '定高目标');
    $('btn-pick-elev').addEventListener('click', () => {
      setTool('sculpt_brush');
      showToast('已切换笔刷工具：按住 Alt 点击画布吸取高程');
    });

    if (dom.shapeList) {
      dom.shapeList.addEventListener('click', (e) => {
        const del = e.target.closest('[data-act="shape-delete"]');
        const row = e.target.closest('[data-shape-id]');
        if (del && row) {
          const id = row.getAttribute('data-shape-id');
          beginHistory();
          state.project.terrain.shapes = state.project.terrain.shapes.filter((s) => s.id !== id);
          if (state.selection && state.selection.id === id) state.selection = null;
          commitHistory('删除地形图元');
          rebuildScene();
          return;
        }
        if (row) {
          state.selection = { type: 'shape', id: row.getAttribute('data-shape-id') };
          setTool('select');
          syncInspector();
          requestRender();
        }
      });
    }

    if (dom.shapeEditor) {
      dom.shapeEditor.addEventListener('change', (e) => {
        const input = e.target.closest('[data-field]');
        if (!input) return;
        const shape = state.selection && state.selection.type === 'shape' ? findShape(state.selection.id) : null;
        if (!shape) return;
        const field = input.getAttribute('data-field');
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        beginHistory();
        shape[field] = field === 'rx' || field === 'ry' ? Math.max(25, value) : value;
        if (field === 'focusX' || field === 'focusY') {
          const n = Math.hypot(shape.focusX, shape.focusY);
          if (n > 0.72) {
            shape.focusX = (shape.focusX * 0.72) / n;
            shape.focusY = (shape.focusY * 0.72) / n;
          }
        }
        commitHistory('调整地形图元参数');
        rebuildScene({ keepSelection: true });
      });
    }
  }

  function bindHydroInputs() {
    $('road-tier').addEventListener('change', (e) => {
      state.roadTier = e.target.value;
    });
    Array.from(doc.querySelectorAll('#water-mode [data-water]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.waterMode = btn.getAttribute('data-water');
        Array.from(doc.querySelectorAll('#water-mode [data-water]')).forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        setTool('draw_water_area');
      });
    });
    if (dom.hydroEditor) {
      dom.hydroEditor.addEventListener('change', (e) => {
        const input = e.target.closest('[data-field]');
        if (!input) return;
        const sel = state.selection;
        if (!sel) return;
        const field = input.getAttribute('data-field');
        let target = null;
        if (sel.type === 'river') target = findRiver(sel.id);
        else if (sel.type === 'road') target = findRoad(sel.id);
        else if (sel.type === 'canal') target = findCanal(sel.id);
        else if (sel.type === 'waterBody') target = findWaterBody(sel.id);
        else if (sel.type === 'reef') target = findReef(sel.id);
        else if (sel.type === 'ford') target = findFord(sel.id);
        if (!target) return;
        beginHistory();
        if (input.tagName === 'SELECT') {
          target[field] = input.value;
          if (field === 'tier') {
            target.widthM = input.value === 'highway' ? 14 : (input.value === 'street' ? 9 : 5);
          }
        } else if (input.type === 'text') {
          target[field] = input.value;
        } else {
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          target[field] = value;
        }
        commitHistory('调整水路参数');
        if (sel.type === 'reef' || sel.type === 'ford') rebuildScene({ keepSelection: true });
        else scheduleSceneRebuild(40);
      });
    }
  }

  function bindZoneInputs() {
    if (dom.zoneList) {
      dom.zoneList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-zone-id]');
        if (!row) return;
        const id = row.getAttribute('data-zone-id');
        const act = e.target.closest('[data-act]');
        if (act) {
          const action = act.getAttribute('data-act');
          if (action === 'zone-delete') {
            beginHistory();
            state.project.zones = state.project.zones.filter((z) => z.id !== id);
            if (state.selection && state.selection.id === id) state.selection = null;
            commitHistory('删除选区');
            rebuildScene();
            return;
          }
          if (action === 'zone-lock') {
            const zone = findZone(id);
            if (!zone) return;
            beginHistory();
            zone.locked = !zone.locked;
            commitHistory(zone.locked ? '锁定选区' : '解锁选区');
            syncInspector();
            requestRender();
            return;
          }
          if (action === 'zone-reroll') {
            state.selection = { type: 'zone', id };
            rerollSelectedZone();
            return;
          }
        }
        state.selection = { type: 'zone', id };
        setTool('select');
        syncInspector();
        requestRender();
      });
    }

    if (dom.zoneEditor) {
      dom.zoneEditor.addEventListener('change', (e) => {
        const input = e.target.closest('[data-field]');
        if (!input) return;
        const zone = selectedZone();
        if (!zone) return;
        const field = input.getAttribute('data-field');
        beginHistory();
        if (input.tagName === 'SELECT' || input.type === 'text') {
          if (field === 'contentType') zone.contentType = input.value;
          else zone[field] = input.value;
        } else {
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          zone[field] = value;
        }
        commitHistory('调整选区参数');
        if (field === 'name') {
          syncZoneHud();
          renderZoneListOnly();
          requestRender();
          return;
        }
        rebuildScene({ keepSelection: true });
      });
      dom.zoneEditor.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.getAttribute('data-act') === 'zone-reroll') rerollSelectedZone();
        if (act.getAttribute('data-act') === 'zone-lock') {
          const zone = selectedZone();
          if (!zone) return;
          beginHistory();
          zone.locked = !zone.locked;
          commitHistory(zone.locked ? '锁定选区' : '解锁选区');
          syncInspector();
        }
      });
    }

    if (dom.zoneHudName) {
      dom.zoneHudName.addEventListener('change', () => {
        const zone = selectedZone();
        if (!zone) return;
        beginHistory();
        zone.name = dom.zoneHudName.value.trim() || zone.name;
        commitHistory('重命名选区');
        renderZoneListOnly();
        requestRender();
      });
    }
    if (dom.zoneHudType) {
      dom.zoneHudType.addEventListener('change', () => {
        const zone = selectedZone();
        if (!zone) return;
        beginHistory();
        zone.contentType = dom.zoneHudType.value;
        commitHistory('切换选区内容类型');
        rebuildScene({ keepSelection: true });
      });
    }
    if (dom.zoneHudReroll) dom.zoneHudReroll.addEventListener('click', rerollSelectedZone);
    if (dom.zoneHudLock) {
      dom.zoneHudLock.addEventListener('change', () => {
        const zone = selectedZone();
        if (!zone) return;
        beginHistory();
        zone.locked = dom.zoneHudLock.checked;
        commitHistory(zone.locked ? '锁定选区' : '解锁选区');
        syncInspector();
        requestRender();
      });
    }
  }

  function renderZoneListOnly() {
    if (!dom.zoneList) return;
    syncZonesPanel();
  }

  function bindLegendInputs() {
    dom.legendVisible.addEventListener('change', (e) => {
      beginHistory();
      state.project.legend.visible = e.target.checked;
      commitHistory('切换图例显示');
      requestRender();
    });
    dom.legendTitle.addEventListener('change', () => {
      beginHistory();
      state.project.legend.title = dom.legendTitle.value.trim() || '图例 · LEGEND';
      commitHistory('修改图例标题');
      requestRender();
    });
    Array.from(doc.querySelectorAll('#legend-position [data-pos]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        beginHistory();
        state.project.legend.position = btn.getAttribute('data-pos');
        commitHistory('图例停靠方位');
        syncLegendPanel();
        requestRender();
      });
    });
    Array.from(doc.querySelectorAll('#legend-columns [data-cols]')).forEach((btn) => {
      btn.addEventListener('click', () => {
        beginHistory();
        state.project.legend.columns = Number(btn.getAttribute('data-cols'));
        commitHistory('图例列数');
        syncLegendPanel();
        requestRender();
      });
    });

    if (dom.legendList) {
      dom.legendList.addEventListener('change', (e) => {
        const labelInput = e.target.closest('[data-legend-label]');
        if (labelInput) {
          const key = labelInput.getAttribute('data-legend-label');
          const item = state.project.legend.items.find((it) => it.key === key);
          if (item) {
            beginHistory();
            item.label = labelInput.value.trim() || item.label;
            commitHistory('修改图例名称');
            requestRender();
          }
          return;
        }
        const visInput = e.target.closest('[data-legend-visible]');
        if (visInput) {
          const key = visInput.getAttribute('data-legend-visible');
          const item = state.project.legend.items.find((it) => it.key === key);
          if (item) {
            beginHistory();
            item.visible = visInput.checked;
            commitHistory('切换图例项显隐');
            requestRender();
          }
          return;
        }
        const colorInput = e.target.closest('[data-legend-color]');
        if (colorInput) {
          const key = colorInput.getAttribute('data-legend-color');
          const item = state.project.legend.items.find((it) => it.key === key);
          if (item) {
            beginHistory();
            item.color = String(colorInput.value || '').toLowerCase();
            item.colorLocked = true;
            commitHistory('修改图例颜色');
            renderLegendList();
            requestRender();
          }
        }
      });
      dom.legendList.addEventListener('click', (e) => {
        const move = e.target.closest('[data-legend-move]');
        if (move) {
          const key = move.getAttribute('data-key');
          const dir = move.getAttribute('data-legend-move');
          moveLegendItem(key, dir === 'up' ? -1 : 1);
          return;
        }
        const del = e.target.closest('[data-legend-delete]');
        if (del) {
          const key = del.getAttribute('data-legend-delete');
          beginHistory();
          state.project.legend.items = state.project.legend.items.filter((it) => it.key !== key);
          state.project.landmarks = state.project.landmarks.filter((lm) => lm.legendKey !== key);
          if (state.activeLegendKey === key) state.activeLegendKey = null;
          commitHistory('删除自定义图例');
          syncInspector();
          rebuildScene({ keepSelection: true });
          return;
        }
        const row = e.target.closest('[data-legend-key]');
        if (row) {
          state.activeLegendKey = row.getAttribute('data-legend-key');
          renderLegendList();
          showToast('已选中该图例项：切到 M 工具即可在画布盖印');
        }
      });
    }

    if (dom.customGlyph) {
      dom.customGlyph.innerHTML = CUSTOM_GLYPH_TYPES.map((g) =>
        `<option value="${g}">${escHtml(GLYPH_LABELS[g] || g)}</option>`).join('');
    }
    $('btn-add-custom').addEventListener('click', () => {
      const glyph = dom.customGlyph.value;
      const label = (dom.customLabel.value || '').trim() || GLYPH_LABELS[glyph] || '自定义地标';
      const color = dom.customColor.value || '#8c3b2b';
      const key = `custom_${glyph}_${hashSeed(`${label}_${Date.now()}`).toString(36)}`;
      beginHistory();
      state.project.legend.items.push({
        key,
        isCustom: true,
        glyphType: glyph,
        label,
        color,
        colorLocked: true,
        strokeColor: getActivePalette(state.project).inkDark,
        visible: true,
        autoPresent: true,
        order: 500 + state.project.legend.items.length * 10
      });
      state.activeLegendKey = key;
      commitHistory('新增自定义图例符号');
      syncInspector();
      requestRender();
      showToast(`已新增图例「${label}」，切到 M 工具可盖印`);
    });
    $('btn-reset-legend').addEventListener('click', () => {
      beginHistory();
      state.project.legend.items = [];
      syncLegendWithProject(state.project, state.scene);
      if (state.scene) state.scene.legend = state.project.legend;
      commitHistory('恢复默认自动图例');
      syncInspector();
      requestRender();
      showToast('已恢复默认自动图例');
    });
  }

  function moveLegendItem(key, delta) {
    const items = state.project.legend.items;
    const idx = items.findIndex((it) => it.key === key);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    beginHistory();
    const tmp = items[idx];
    items[idx] = items[target];
    items[target] = tmp;
    items.forEach((it, i) => { it.order = (i + 1) * 10; });
    commitHistory('调整图例顺序');
    renderLegendList();
    requestRender();
  }

  function bindPaletteInputs() {
    if (dom.themeCards) {
      dom.themeCards.addEventListener('click', (e) => {
        const card = e.target.closest('[data-theme]');
        if (!card) return;
        beginHistory();
        state.project.palette.themeId = card.getAttribute('data-theme');
        state.project.palette.overrides = {};
        commitHistory('切换主题');
        syncInspector();
        requestRender();
      });
    }
    if (dom.paletteSlots) {
      dom.paletteSlots.addEventListener('change', (e) => {
        const input = e.target.closest('[data-palette-slot]');
        if (!input) return;
        const slot = input.getAttribute('data-palette-slot');
        beginHistory();
        state.project.palette.overrides[slot] = input.value.toLowerCase();
        commitHistory('手动覆盖色槽');
        syncPalettePanel();
        requestRender();
      });
    }
    $('btn-reset-palette').addEventListener('click', () => {
      beginHistory();
      state.project.palette.overrides = {};
      commitHistory('重置配色');
      syncInspector();
      requestRender();
      showToast('已重置为当前主题原始配色');
    });
  }

  function bindModal() {
    $('btn-import-terrax').addEventListener('click', () => {
      if (!state.backendOnline) {
        showToast('离线独立模式下不可用：请运行 server.py 后重新打开', true);
        return;
      }
      dom.modalBackdrop.classList.remove('hidden');
      syncModalSummary();
    });
    $('btn-modal-close').addEventListener('click', () => dom.modalBackdrop.classList.add('hidden'));
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) dom.modalBackdrop.classList.add('hidden');
    });
    $('btn-terrax-fetch').addEventListener('click', async () => {
      const lon = Number(dom.terraxLon.value);
      const lat = Number(dom.terraxLat.value);
      const span = Number(dom.terraxSpan.value) || 2800;
      dom.terraxResult.textContent = '正在读取 TERRAX 只读地理数据…';
      try {
        const resp = await fetch(`/api/terrax-context?lon=${lon}&lat=${lat}&span_m=${span}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || data.ok !== true) throw new Error('返回数据格式异常');
        state.terraxPreview = data;
        syncModalSummary();
      } catch (err) {
        state.terraxPreview = null;
        syncModalSummary();
        dom.terraxResult.textContent = `查询失败：${err && err.message ? err.message : err}`;
      }
    });
    dom.modalApply.addEventListener('click', () => {
      const data = state.terraxPreview;
      if (!data) return;
      beginHistory();
      state.project.terrain.baseElev = Math.round(Number(data.elevM) || state.project.terrain.baseElev);
      if (Number.isFinite(Number(data.slopeMagM))) {
        state.project.terrain.slopeMagM = clampNum(Number(data.slopeMagM), 0, 800);
      }
      if (Number.isFinite(Number(data.slopeDirDeg))) {
        state.project.terrain.slopeDirDeg = Number(data.slopeDirDeg);
      }
      state.project.meta.terraxAnchor = {
        lon: Number(data.query.lon),
        lat: Number(data.query.lat),
        elevM: Number(data.elevM),
        regionNote: '< 地图数据只读桥接 >'
      };
      const span = Number(data.query.spanM) || state.project.meta.worldSizeM;
      state.project.meta.worldSizeM = clampNum(Math.round(span / 100) * 100, 600, 8000);
      if (Array.isArray(data.nearbyRivers) && data.nearbyRivers.length > 0) {
        const local = data.nearbyRivers[0].localPoints;
        if (Array.isArray(local) && local.length >= 2) {
          state.project.rivers.push({
            id: createUid('riv_terrax'),
            name: data.nearbyRivers[0].label || 'TERRAX 邻近河流',
            points: local,
            widthStartM: 36,
            widthEndM: 52,
            carveDepthM: 6,
            rippleLines: 3
          });
        }
      }
      commitHistory('应用 TERRAX 经纬度初值');
      dom.modalBackdrop.classList.add('hidden');
      rebuildScene();
      fitToWorld();
      showToast('已应用 TERRAX 经纬度初值');
    });
  }

  function bindListDelegates() {
    const polyContainers = [dom.listRivers, dom.listWater, dom.listCanals, dom.listRoads];
    polyContainers.forEach((container) => {
      if (!container) return;
      container.addEventListener('click', (e) => {
        const del = e.target.closest('[data-act="poly-delete"]');
        const row = e.target.closest('[data-poly-id]');
        if (!row) return;
        const type = row.getAttribute('data-poly-type');
        const id = row.getAttribute('data-poly-id');
        if (del) {
          beginHistory();
          if (type === 'river') state.project.rivers = state.project.rivers.filter((r) => r.id !== id);
          if (type === 'road') state.project.roads = state.project.roads.filter((r) => r.id !== id);
          if (type === 'canal') state.project.canals = state.project.canals.filter((c) => c.id !== id);
          if (type === 'waterBody') state.project.waterBodies = state.project.waterBodies.filter((w) => w.id !== id);
          if (state.selection && state.selection.id === id) state.selection = null;
          commitHistory('删除水路要素');
          rebuildScene();
          return;
        }
        state.selection = { type, id };
        setTool('select');
        syncInspector();
        requestRender();
      });
    });

    if (dom.listReefs) {
      dom.listReefs.addEventListener('click', (e) => {
        const row = e.target.closest('[data-reef-id]');
        if (!row) return;
        const id = row.getAttribute('data-reef-id');
        if (e.target.closest('[data-act="reef-delete"]')) {
          beginHistory();
          state.project.reefs = state.project.reefs.filter((r) => r.id !== id);
          if (state.selection && state.selection.id === id) state.selection = null;
          commitHistory('删除岩礁');
          rebuildScene();
          return;
        }
        state.selection = { type: 'reef', id };
        syncInspector();
        requestRender();
      });
    }
    if (dom.listFords) {
      dom.listFords.addEventListener('click', (e) => {
        const row = e.target.closest('[data-ford-id]');
        if (!row) return;
        const id = row.getAttribute('data-ford-id');
        if (e.target.closest('[data-act="ford-delete"]')) {
          beginHistory();
          state.project.fords = state.project.fords.filter((f) => f.id !== id);
          if (state.selection && state.selection.id === id) state.selection = null;
          commitHistory('删除渡口');
          rebuildScene();
          return;
        }
        state.selection = { type: 'ford', id };
        syncInspector();
        requestRender();
      });
    }
  }

  function bindNumber(id, read, write, label) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const value = Number(el.value);
      if (!Number.isFinite(value)) {
        syncInspector();
        return;
      }
      beginHistory();
      write(value);
      commitHistory(label);
      rebuildScene({ keepSelection: true });
      requestRender();
    });
  }

  function bindRange(id, outId, read, write, label, options) {
    const el = $(id);
    if (!el) return;
    const opts = options || {};
    const affectsScene = opts.affectsScene !== false;
    const recordHistory = opts.history !== false;
    let pending = false;
    // 拖动起始即保存修改前快照，松手（change）时提交，撤销栈才能回到拖拽前
    const beginOnce = () => {
      if (!recordHistory || pending) return;
      pending = true;
      beginHistory();
    };
    el.addEventListener('pointerdown', beginOnce);
    el.addEventListener('input', () => {
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      beginOnce();
      write(value);
      setOutput(outId, fmtNum(value));
      if (affectsScene) scheduleSceneRebuild(180);
    });
    el.addEventListener('change', () => {
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      beginOnce();
      write(value);
      if (recordHistory) {
        commitHistory(label);
        pending = false;
      }
      if (affectsScene) rebuildScene({ keepSelection: true });
      else requestRender();
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * 十三、工程装载与后端探测
   * ------------------------------------------------------------------------------------------- */

  function applyProject(next, toastText) {
    state.project = normalizeProject(next);
    state.selection = null;
    state.draft = null;
    state.measure = null;
    state.history.reset();
    rebuildScene();
    fitToWorld();
    syncInspector();
    if (toastText) showToast(toastText);
  }

  function loadPreset(key) {
    const preset = presets.find((p) => p.key === key);
    if (!preset) return;
    applyProject(normalizeProject(preset.project), `已载入示例「${preset.label}」`);
    dom.projectName.value = state.project.meta.name;
  }

  function populateStaticSelects() {
    if (dom.presetSelect) {
      dom.presetSelect.innerHTML = ['<option value="">示例工程…</option>']
        .concat(presets.map((p) => `<option value="${p.key}">${escHtml(p.label)}</option>`))
        .join('');
    }
    if (dom.zoneHudType) {
      dom.zoneHudType.innerHTML = ZONE_CONTENT_TYPES.map((t) =>
        `<option value="${t}">${escHtml(ZONE_LABELS[t])}</option>`).join('');
    }
  }

  async function probeBackend() {
    try {
      const resp = await fetch('/api/ping', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || data.ok !== true) throw new Error('返回异常');
      state.backendOnline = true;
      if (dom.backendBadge) {
        dom.backendBadge.className = 'badge badge-online';
        dom.backendBadge.textContent = data.terraxDataAvailable
          ? '后端在线 · TERRAX 数据就绪'
          : '后端在线 · 数据缺失';
      }
      $('btn-import-terrax').disabled = false;
    } catch (err) {
      state.backendOnline = false;
      if (dom.backendBadge) {
        dom.backendBadge.className = 'badge badge-offline';
        dom.backendBadge.textContent = '离线独立模式';
      }
      const importBtn = $('btn-import-terrax');
      importBtn.disabled = true;
      importBtn.title = '离线独立模式：请先运行 server.py 再打开页面';
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * 十四、启动
   * ------------------------------------------------------------------------------------------- */

  function preferredPresetKey() {
    // 支持 ?preset=losrumura|changhu|palong 直达示例工程（也接受中文文件名关键词）
    let requested = '';
    try {
      requested = new URLSearchParams(window.location.search).get('preset') || '';
    } catch (err) {
      requested = '';
    }
    if (!requested) return 'losrumura';
    const direct = presets.find((p) => p.key === requested);
    if (direct) return direct.key;
    const fuzzy = presets.find((p) => requested.indexOf(p.key) >= 0 ||
      String(p.project.meta.name).indexOf(requested) >= 0 ||
      String(p.label).indexOf(requested) >= 0);
    return fuzzy ? fuzzy.key : 'losrumura';
  }

  function start() {
    populateStaticSelects();
    const bootKey = preferredPresetKey();
    const bootPreset = presets.find((p) => p.key === bootKey);
    if (bootPreset && bootKey !== 'losrumura') {
      state.project = normalizeProject(bootPreset.project);
      dom.projectName.value = state.project.meta.name;
    } else {
      dom.projectName.value = state.project.meta.name;
    }
    if (dom.presetSelect) dom.presetSelect.value = bootKey;
    state.history.reset();
    rebuildScene();
    resizeCanvas(false);
    fitToWorld();
    bindEvents();
    syncInspector();
    updateHistoryButtons();
    requestRender();
    probeBackend();
    showToast('浅色纸本测绘工坊已就绪 · 快捷键 V/C/B/H/G/W/L/K/D/Z/M/U');
  }

  start();

  return {
    getProject: () => state.project,
    getScene: () => state.scene,
    getState: () => state,
    setProject: (next) => applyProject(next, '工程已替换'),
    loadPreset,
    rebuild: () => rebuildScene(),
    render: () => requestRender(),
    fit: () => fitToWorld(),
    setTool,
    undo,
    redo
  };
}

/* ------------------------------------------------------------------------------------------------
 * 浏览器自动挂载
 * ---------------------------------------------------------------------------------------------- */

const AUTO_MOUNT_FLAG = '__terraxSettlementStudioMounted__';

function autoMount() {
  if (typeof document === 'undefined') return;
  if (document[AUTO_MOUNT_FLAG]) return;
  if (!document.getElementById('studio-root')) return;
  document[AUTO_MOUNT_FLAG] = true;
  const app = createStudioApp(document);
  if (typeof window !== 'undefined') {
    window.__terraxStudio = app;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  } else {
    autoMount();
  }
}
