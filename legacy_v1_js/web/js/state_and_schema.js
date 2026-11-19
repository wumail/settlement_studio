/**
 * Terrax Settlement Studio — M0 数据契约与状态底座
 * 文件：web/js/state_and_schema.js
 *
 * 职责：
 *   1. 常量枚举（Schema 版本、格网分辨率、9 类选区内容、8 类自定义徽记、14 类内置图例）；
 *   2. 确定性伪随机源（FNV-1a 种子哈希 + mulberry32），全模块严禁 Math.random()；
 *   3. sculptDelta 高程微雕场的 0.1 m 定点 Int16 小端 Base64 双端编解码；
 *   4. 4 套主题 × 12 语义色槽调色板与手动覆盖合并；
 *   5. .worldtown.json 默认工程构造、缺省字段归一化、序列化与反序列化；
 *   6. 3 套内置世界观精品预设工程（与 projects/*.worldtown.json 同构）；
 *   7. 40 步快照撤销栈 HistoryManager（连续拖拽合并单步）；
 *   8. 图面要素自动感知的图例同步器 syncLegendWithProject。
 *
 * 无头铁律：模块顶层与全部函数内严禁访问 window / document / localStorage / HTMLCanvasElement。
 */

export const SCHEMA_VERSION = '1.2.0';
export const GRID_N = 257;
export const OBSTACLE_GRID_N = 512;

const GRID_POINT_COUNT = GRID_N * GRID_N;
const SCULPT_CLAMP_M = 3200;

/* ------------------------------------------------------------------------------------------------
 * 一、调色板：4 套主题 × 12 语义色槽（6 位小写 HEX，原生 <input type="color"> 可直接读取）
 * ---------------------------------------------------------------------------------------------- */

export const BUILTIN_PALETTES = {
  watabou_classic: {
    paperBg: '#f3ede0',
    inkDark: '#2b2520',
    roofInner: '#cbb582',
    roofTown: '#cc9a76',
    roadFill: '#faf6ed',
    waterFill: '#8faab3',
    waterRipple: '#dce7ea',
    treeFill: '#5b844b',
    treeOutline: '#2c4024',
    contourLine: '#9e8c72',
    farmlandFill: '#dfd8be',
    saltpanFill: '#cde0e3'
  },
  nordic_fjord: {
    paperBg: '#eaeeef',
    inkDark: '#1f2930',
    roofInner: '#b8a98a',
    roofTown: '#a87e6b',
    roadFill: '#f7f9fa',
    waterFill: '#6c8c9e',
    waterRipple: '#c8dce6',
    treeFill: '#466952',
    treeOutline: '#223629',
    contourLine: '#838e94',
    farmlandFill: '#d2d9c5',
    saltpanFill: '#bfd4de'
  },
  arid_oasis: {
    paperBg: '#f5ead6',
    inkDark: '#332419',
    roofInner: '#d8b475',
    roofTown: '#c98357',
    roadFill: '#fcf5e8',
    waterFill: '#74a3a8',
    waterRipple: '#cde4e6',
    treeFill: '#6b8e4e',
    treeOutline: '#354726',
    contourLine: '#b08d65',
    farmlandFill: '#e3d6ad',
    saltpanFill: '#d4e8e6'
  },
  gazetteer_ink: {
    paperBg: '#f7f5ef',
    inkDark: '#222220',
    roofInner: '#cfc9bc',
    roofTown: '#b5aea0',
    roadFill: '#ffffff',
    waterFill: '#c5d0d4',
    waterRipple: '#eef3f5',
    treeFill: '#8c9685',
    treeOutline: '#3d423a',
    contourLine: '#9c968c',
    farmlandFill: '#eae7de',
    saltpanFill: '#dfe6e8'
  }
};

/** 12 个语义色槽键名（顺序固定，供检视器逐行渲染拾色器） */
const PALETTE_SLOT_KEYS = [
  'paperBg', 'inkDark', 'roofInner', 'roofTown', 'roadFill', 'waterFill',
  'waterRipple', 'treeFill', 'treeOutline', 'contourLine', 'farmlandFill', 'saltpanFill'
];

const THEME_LABELS = {
  watabou_classic: '经典羊皮纸淡彩',
  nordic_fjord: '寒海峡湾石青',
  arid_oasis: '旱原泉线赭砂',
  gazetteer_ink: '方志素笺水墨'
};

/** 方志文档中的主题简写别名 → 内置主题规范键 */
const THEME_ALIASES = {
  boreal_slate: 'nordic_fjord',
  arid_ochre: 'arid_oasis',
  archival_parchment: 'gazetteer_ink',
  watabou_classic: 'watabou_classic',
  nordic_fjord: 'nordic_fjord',
  arid_oasis: 'arid_oasis',
  gazetteer_ink: 'gazetteer_ink'
};

/* ------------------------------------------------------------------------------------------------
 * 二、选区内容、自定义徽记与内置图例目录
 * ---------------------------------------------------------------------------------------------- */

export const ZONE_CONTENT_TYPES = [
  'walled_city', 'town_blocks', 'village', 'citadel',
  'market', 'farmland', 'saltpan', 'woodland', 'exclusion'
];

const ZONE_CONTENT_LABELS = {
  walled_city: '内城城垣与街坊',
  town_blocks: '市镇沿街坊巷',
  village: '顺坡散居村寨',
  citadel: '堡寨官署石碉',
  market: '集场换装货市',
  farmland: '河阶条田农田',
  saltpan: '晒盐池卤畦',
  woodland: '成片疏林炭林',
  exclusion: '禁建留白保护区'
};

export const CUSTOM_GLYPH_TYPES = [
  'star_fort', 'tower', 'well_shrine', 'ferry_anchor',
  'gate_arch', 'market_tent', 'mine_hammer', 'stele'
];

const CUSTOM_GLYPH_LABELS = {
  star_fort: '八角星芒',
  tower: '方座箭楼',
  well_shrine: '双环水滴',
  ferry_anchor: '横杠铁锚',
  gate_arch: '双柱牌楼',
  market_tent: '三角旗帐',
  mine_hammer: '交叉锤钻',
  stele: '圭首方碑'
};

export const BUILTIN_LEGEND_CATALOG = [
  {
    key: 'roof_inner', glyphType: 'building_inner', label: '内城官署与公仓屋宇',
    color: '#cbb582', strokeColor: '#2b2520', paletteSlot: 'roofInner', order: 10
  },
  {
    key: 'roof_town', glyphType: 'building_town', label: '市镇街坊与村舍屋宇',
    color: '#cc9a76', strokeColor: '#2b2520', paletteSlot: 'roofTown', order: 20
  },
  {
    key: 'city_wall', glyphType: 'city_wall', label: '城垣、敌台与城门',
    color: '#504233', strokeColor: '#2b2520', paletteSlot: 'inkDark', order: 30
  },
  {
    key: 'road_highway', glyphType: 'road_main', label: '主干车马驿道与街巷',
    color: '#faf6ed', strokeColor: '#5b4a38', paletteSlot: 'roadFill', order: 40
  },
  {
    key: 'bridge_ortho', glyphType: 'bridge', label: '跨水正交木石桥梁',
    color: '#faf6ed', strokeColor: '#2b2520', paletteSlot: 'roadFill', order: 50
  },
  {
    key: 'river_pure', glyphType: 'river', label: '常年河道与流向',
    color: '#8faab3', strokeColor: '#4f6b73', paletteSlot: 'waterFill', order: 60
  },
  {
    key: 'water_lake_sea', glyphType: 'water_body', label: '湖泊与近海水域',
    color: '#8faab3', strokeColor: '#4f6b73', paletteSlot: 'waterFill', order: 70
  },
  {
    key: 'canal_water', glyphType: 'canal', label: '引水明渠与坎儿井暗渠',
    color: '#8faab3', strokeColor: '#3d6a74', paletteSlot: 'waterFill', order: 80
  },
  {
    key: 'contour_line', glyphType: 'contour', label: '等高线（计曲线/首曲线）',
    color: '#9e8c72', strokeColor: '#9e8c72', paletteSlot: 'contourLine', order: 90
  },
  {
    key: 'scarp_tick', glyphType: 'scarp_tick', label: '陡坎示坡测绘齿线',
    color: '#9e8c72', strokeColor: '#9e8c72', paletteSlot: 'contourLine', order: 100
  },
  {
    key: 'farmland_plot', glyphType: 'farmland', label: '河阶条田与灌区耕垄',
    color: '#dfd8be', strokeColor: '#8a7a52', paletteSlot: 'farmlandFill', order: 110
  },
  {
    key: 'saltpan_plot', glyphType: 'saltpan', label: '晒盐池与卤畦',
    color: '#cde0e3', strokeColor: '#7c979b', paletteSlot: 'saltpanFill', order: 120
  },
  {
    key: 'woodland_tree', glyphType: 'tree_cluster', label: '林木与庭院绿荫',
    color: '#5b844b', strokeColor: '#2c4024', paletteSlot: 'treeFill', order: 130
  },
  {
    key: 'rock_reef', glyphType: 'reef', label: '基岩暗礁与险滩',
    color: '#585550', strokeColor: '#2b2520', paletteSlot: 'waterFill', order: 140
  }
];

/* ------------------------------------------------------------------------------------------------
 * 三、确定性伪随机源
 * ---------------------------------------------------------------------------------------------- */

export function hashSeed(input) {
  const str = String(input === undefined || input === null ? 1 : input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h === 0 ? 1 : h) >>> 0;
}

export function createRng(seed) {
  let a = (typeof seed === 'number' ? (seed >>> 0) : hashSeed(seed));
  if (a === 0) a = 1;
  return function nextFloat() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uidCounter = 0;

export function createUid(prefix, rngOrCounter) {
  const p = (typeof prefix === 'string' && prefix.length > 0) ? prefix : 'uid';
  uidCounter += 1;
  if (typeof rngOrCounter === 'function') {
    const v = Math.floor(rngOrCounter() * 1679616);
    return `${p}_${v.toString(36)}${uidCounter.toString(36)}`;
  }
  const c = (typeof rngOrCounter === 'number' && Number.isFinite(rngOrCounter))
    ? Math.floor(rngOrCounter)
    : uidCounter;
  return `${p}_${c.toString(36)}`;
}

/* ------------------------------------------------------------------------------------------------
 * 四、sculptDelta 0.1 m 定点 Int16 小端 Base64 编解码
 * ---------------------------------------------------------------------------------------------- */

export function encodeSculptDelta(float32Arr) {
  if ((float32Arr instanceof Float32Array) === false || float32Arr.length === 0) {
    return '';
  }
  let hasNonZero = false;
  const int16 = new Int16Array(float32Arr.length);
  for (let i = 0; i < float32Arr.length; i += 1) {
    const raw = Number.isFinite(float32Arr[i]) ? float32Arr[i] : 0;
    const clamped = Math.max(-SCULPT_CLAMP_M, Math.min(SCULPT_CLAMP_M, raw));
    const q = Math.round(clamped * 10);
    int16[i] = q;
    if ((q === 0) === false) {
      hasNonZero = true;
    }
  }
  if (hasNonZero === false) {
    return '';
  }
  const bytes = new Uint8Array(int16.buffer);
  if (typeof Buffer === 'function') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeSculptDelta(base64Str, expectedLen = GRID_POINT_COUNT) {
  const len = (typeof expectedLen === 'number' && expectedLen > 0) ? Math.floor(expectedLen) : GRID_POINT_COUNT;
  const out = new Float32Array(len);
  if (typeof base64Str === 'string' && base64Str.length > 0) {
    let bytes;
    if (typeof Buffer === 'function') {
      const buf = Buffer.from(base64Str, 'base64');
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      const bin = atob(base64Str);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
      }
    }
    const copyBytes = new Uint8Array(len * 2);
    copyBytes.set(bytes.subarray(0, Math.min(bytes.length, copyBytes.length)));
    const int16 = new Int16Array(copyBytes.buffer);
    for (let i = 0; i < len; i += 1) {
      out[i] = int16[i] * 0.1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * 五、调色板解析与手动覆盖
 * ---------------------------------------------------------------------------------------------- */

export function getActivePalette(project) {
  const pal = (project && typeof project === 'object' && project.palette) ? project.palette : {};
  const rawId = (typeof pal.themeId === 'string' && pal.themeId.length > 0) ? pal.themeId : 'watabou_classic';
  const resolved = THEME_ALIASES[rawId] || (BUILTIN_PALETTES[rawId] ? rawId : 'watabou_classic');
  const base = BUILTIN_PALETTES[resolved];
  const out = {};
  for (let i = 0; i < PALETTE_SLOT_KEYS.length; i += 1) {
    const key = PALETTE_SLOT_KEYS[i];
    out[key] = base[key];
  }
  const overrides = (pal.overrides && typeof pal.overrides === 'object') ? pal.overrides : {};
  for (let i = 0; i < PALETTE_SLOT_KEYS.length; i += 1) {
    const key = PALETTE_SLOT_KEYS[i];
    const value = overrides[key];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      out[key] = value.toLowerCase();
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * 六、通用归一化工具
 * ---------------------------------------------------------------------------------------------- */

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function text(value, fallback) {
  return (typeof value === 'string' && value.length > 0) ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normPoint(raw) {
  if (Array.isArray(raw) && raw.length >= 2) {
    return [num(raw[0], 0), num(raw[1], 0)];
  }
  if (raw && typeof raw === 'object') {
    return [num(raw.x, 0), num(raw.y, 0)];
  }
  return [0, 0];
}

function normPoints(raw, minCount) {
  const src = list(raw);
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const p = normPoint(src[i]);
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (Math.abs(prev[0] - p[0]) < 1e-9 && Math.abs(prev[1] - p[1]) < 1e-9) {
        continue;
      }
    }
    out.push(p);
  }
  if (out.length >= 3) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
      out.pop();
    }
  }
  if (out.length < minCount) {
    return [];
  }
  return out;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------------------------------------
 * 七、Shape / River / WaterBody / Canal / Reef / Road / Ford / Zone / Landmark 归一化
 * ---------------------------------------------------------------------------------------------- */

function normalizeShape(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = text(raw.type, 'hill');
  const id = text(raw.id, createUid('shape'));
  if (type === 'hill' || type === 'basin') {
    const sign = type === 'hill' ? 1 : -1;
    let deltaElev = num(raw.deltaElev, sign * 20);
    if (type === 'hill' && deltaElev <= 0) deltaElev = Math.abs(deltaElev) || 20;
    if (type === 'basin' && deltaElev >= 0) deltaElev = -Math.abs(deltaElev) || -20;
    let fx = num(raw.focusX, 0);
    let fy = num(raw.focusY, 0);
    const fn = Math.hypot(fx, fy);
    if (fn > 0.72) {
      fx = (fx * 0.72) / fn;
      fy = (fy * 0.72) / fn;
    }
    return {
      id,
      type,
      cx: num(raw.cx, 0),
      cy: num(raw.cy, 0),
      rx: Math.max(25, num(raw.rx, 220)),
      ry: Math.max(25, num(raw.ry, 220)),
      angleDeg: num(raw.angleDeg, 0),
      deltaElev,
      focusX: fx,
      focusY: fy
    };
  }
  if (type === 'ridge' || type === 'valley' || type === 'scarp') {
    const points = normPoints(raw.points, 2);
    if (points.length < 2) return null;
    let deltaElev = num(raw.deltaElev, type === 'valley' ? -18 : 18);
    if (type === 'valley' && deltaElev > 0) deltaElev = -deltaElev;
    if (type !== 'valley' && deltaElev < 0) deltaElev = Math.abs(deltaElev);
    return {
      id,
      type,
      points,
      deltaElev,
      widthLeft: Math.max(20, num(raw.widthLeft, 120)),
      widthRight: Math.max(20, num(raw.widthRight, 120))
    };
  }
  return null;
}

function normalizeRiver(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const points = normPoints(raw.points, 2);
  if (points.length < 2) return null;
  return {
    id: text(raw.id, createUid('riv')),
    name: text(raw.name, '未命名河道'),
    points,
    widthStartM: clampNum(num(raw.widthStartM, 28), 6, 600),
    widthEndM: clampNum(num(raw.widthEndM, 46), 6, 600),
    carveDepthM: clampNum(num(raw.carveDepthM, 6), 0, 120),
    rippleLines: Math.round(clampNum(num(raw.rippleLines, 3), 0, 3))
  };
}

function normalizeWaterBody(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const points = normPoints(raw.points, 3);
  if (points.length < 3) return null;
  return {
    id: text(raw.id, createUid('lake')),
    name: text(raw.name, '未命名水域'),
    kind: raw.kind === 'sea' ? 'sea' : 'lake',
    points,
    rippleLines: Math.round(clampNum(num(raw.rippleLines, 3), 0, 3))
  };
}

function normalizeCanal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const points = normPoints(raw.points, 2);
  if (points.length < 2) return null;
  return {
    id: text(raw.id, createUid('can')),
    name: text(raw.name, '未命名水渠'),
    style: raw.style === 'qanat' ? 'qanat' : 'open',
    points,
    widthM: clampNum(num(raw.widthM, 6), 1.2, 60)
  };
}

function normalizeReef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: text(raw.id, createUid('reef')),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    radiusM: clampNum(num(raw.radiusM, 14), 4, 120),
    angleDeg: num(raw.angleDeg, 20),
    seed: Math.round(num(raw.seed, 101)),
    count: Math.round(clampNum(num(raw.count, 2), 1, 3))
  };
}

function normalizeRoad(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const points = normPoints(raw.points, 2);
  if (points.length < 2) return null;
  const tier = (raw.tier === 'street' || raw.tier === 'lane') ? raw.tier : 'highway';
  const defaultWidth = tier === 'highway' ? 14 : (tier === 'street' ? 9 : 5);
  return {
    id: text(raw.id, createUid('rd')),
    name: text(raw.name, '未命名道路'),
    tier,
    points,
    widthM: clampNum(num(raw.widthM, defaultWidth), 2, 60)
  };
}

function normalizeFord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: text(raw.id, createUid('ford')),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    radiusM: clampNum(num(raw.radiusM, 24), 6, 120),
    name: text(raw.name, '浅滩渡')
  };
}

function normalizeZone(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const points = normPoints(raw.points, 3);
  if (points.length < 3) return null;
  const contentType = ZONE_CONTENT_TYPES.indexOf(raw.contentType) >= 0 ? raw.contentType : 'town_blocks';
  return {
    id: text(raw.id, createUid('zone', index + 1)),
    name: text(raw.name, `${ZONE_CONTENT_LABELS[contentType]} ${index + 1}`),
    contentType,
    points,
    seed: Math.round(num(raw.seed, 20261118)),
    locked: raw.locked === true,
    density: clampNum(num(raw.density, 0.72), 0.2, 1.0),
    maxSlopeDeg: clampNum(num(raw.maxSlopeDeg, 24), 4, 60),
    streetWidthM: clampNum(num(raw.streetWidthM, 7.5), 3, 24),
    wallThicknessM: clampNum(num(raw.wallThicknessM, 5.5), 1.5, 16),
    towerIntervalM: clampNum(num(raw.towerIntervalM, 110), 30, 320)
  };
}

function normalizeLandmark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const glyph = CUSTOM_GLYPH_TYPES.indexOf(raw.glyphType) >= 0 ? raw.glyphType : 'stele';
  return {
    id: text(raw.id, createUid('lm')),
    legendKey: text(raw.legendKey, `custom_${glyph}`),
    glyphType: glyph,
    label: text(raw.label, '地标'),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    showLabel: raw.showLabel !== false,
    sizePx: clampNum(num(raw.sizePx, 15), 8, 48)
  };
}

function normalizeLegendItem(raw, fallbackOrder) {
  if (!raw || typeof raw !== 'object') return null;
  const key = text(raw.key, createUid('lg'));
  const isCustom = raw.isCustom === true || key.indexOf('custom_') === 0;
  const glyphType = text(raw.glyphType, isCustom ? 'stele' : 'building_town');
  const color = (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color))
    ? raw.color.toLowerCase()
    : '';
  const strokeColor = (typeof raw.strokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.strokeColor))
    ? raw.strokeColor.toLowerCase()
    : '#2b2520';
  return {
    key,
    isCustom,
    glyphType,
    label: text(raw.label, '图例项'),
    color,
    colorLocked: raw.colorLocked === true,
    strokeColor,
    visible: raw.visible !== false,
    autoPresent: raw.autoPresent === true,
    order: num(raw.order, fallbackOrder)
  };
}

function normalizeLegend(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const position = (src.position === 'bottom-left' || src.position === 'top-right' || src.position === 'top-left')
    ? src.position
    : 'bottom-right';
  const items = [];
  const srcItems = list(src.items);
  for (let i = 0; i < srcItems.length; i += 1) {
    const item = normalizeLegendItem(srcItems[i], (i + 1) * 10);
    if (item) items.push(item);
  }
  items.sort((a, b) => a.order - b.order);
  return {
    visible: src.visible !== false,
    title: text(src.title, '图例 · LEGEND'),
    position,
    columns: src.columns === 1 ? 1 : 2,
    items
  };
}

/* ------------------------------------------------------------------------------------------------
 * 八、默认工程与预设容器
 * ---------------------------------------------------------------------------------------------- */

function buildBlankProject(overrides) {
  const nowIso = '2026-11-18T09:00:00Z';
  const base = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_default',
      name: '未命名聚落测绘图',
      subtitle: '河阶与街坊平面图',
      worldSizeM: 2400,
      terraxAnchor: null,
      updatedAt: nowIso
    },
    palette: {
      themeId: 'watabou_classic',
      overrides: {}
    },
    terrain: {
      baseElev: 450,
      slopeMagM: 18,
      slopeDirDeg: 315,
      contourStep: 5,
      indexEvery: 5,
      minContourElev: -500,
      maxContourElev: 6000,
      showContours: true,
      showScarpTicks: false,
      scarpSlopeThresholdDeg: 26,
      shapes: [],
      sculptDeltaB64: ''
    },
    rivers: [],
    waterBodies: [],
    canals: [],
    reefs: [],
    roads: [],
    fords: [],
    zones: [],
    landmarks: [],
    legend: {
      visible: true,
      title: '图例 · LEGEND',
      position: 'bottom-right',
      columns: 2,
      items: []
    }
  };
  if (!overrides) return base;
  const merged = deepClone(base);
  for (const key of Object.keys(overrides)) {
    if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
      merged[key] = { ...merged[key], ...deepClone(overrides[key]) };
    } else {
      merged[key] = deepClone(overrides[key]);
    }
  }
  return merged;
}

/* ------------------------------------ 预设一：起点城 Lōsrūmūra --------------------------------- */

function buildPresetLosrumura() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_losrumura',
      name: '起点都城 Lōsrūmūra',
      subtitle: 'R1966 南岸高阶台地与分水堰水工平面图',
      worldSizeM: 3200,
      terraxAnchor: { lon: 42.51, lat: 35.19, elevM: 484.9, regionNote: 'E1-01 起点河阶本境' },
      updatedAt: '2026-11-18T09:00:00Z'
    },
    palette: { themeId: 'watabou_classic', overrides: {} },
    terrain: {
      baseElev: 468,
      slopeMagM: 16,
      slopeDirDeg: 300,
      contourStep: 4,
      indexEvery: 5,
      minContourElev: 448,
      maxContourElev: 528,
      showContours: true,
      showScarpTicks: false,
      scarpSlopeThresholdDeg: 26,
      shapes: [
        {
          id: 'shape_terrace_01', type: 'hill',
          cx: 1560, cy: 1820, rx: 980, ry: 720, angleDeg: -10,
          deltaElev: 26, focusX: 0.12, focusY: -0.42
        },
        {
          id: 'shape_scarp_01', type: 'scarp',
          points: [[3140, 980], [2400, 1010], [1600, 1055], [800, 1105], [80, 1150]],
          deltaElev: 12, widthLeft: 300, widthRight: 90
        },
        {
          id: 'shape_ridge_west', type: 'ridge',
          points: [[60, 2060], [420, 1960], [820, 1900], [1180, 1880]],
          deltaElev: 36, widthLeft: 200, widthRight: 260
        },
        {
          id: 'shape_ridge_east', type: 'ridge',
          points: [[3140, 2140], [2820, 2060], [2500, 2010]],
          deltaElev: 24, widthLeft: 180, widthRight: 210
        }
      ],
      sculptDeltaB64: ''
    },
    rivers: [
      {
        id: 'riv_r1966', name: 'R1966 干流',
        points: [[3140, 790], [2700, 720], [2300, 650], [1900, 604], [1560, 570], [1200, 512], [860, 450], [460, 404], [80, 356]],
        widthStartM: 58, widthEndM: 78, carveDepthM: 8, rippleLines: 3
      }
    ],
    waterBodies: [],
    canals: [
      {
        id: 'can_clean_01', name: '东关饮用净水渠', style: 'open',
        points: [[2380, 690], [2140, 900], [1960, 1080], [1760, 1180], [1520, 1260]],
        widthM: 7
      },
      {
        id: 'can_drain_01', name: '南排污碱渠', style: 'open',
        points: [[1360, 1580], [1580, 1760], [1820, 1940], [2080, 2080]],
        widthM: 5.5
      }
    ],
    reefs: [],
    roads: [
      {
        id: 'rd_p1_main', name: 'P1 坡冈换装驿道', tier: 'highway',
        points: [[60, 1700], [700, 1620], [1420, 1560], [2120, 1510], [2620, 1540], [3140, 1580]],
        widthM: 15
      },
      {
        id: 'rd_north_port', name: '北埠门道', tier: 'street',
        points: [[1500, 1730], [1610, 1600], [1640, 1300], [1655, 980], [1670, 620], [1690, 300]],
        widthM: 10
      },
      {
        id: 'rd_west_ring', name: '西郭顺城街', tier: 'street',
        points: [[700, 900], [690, 1220], [700, 1500], [720, 1700]],
        widthM: 9
      },
      {
        id: 'rd_east_avenue', name: '东郭顺城街', tier: 'street',
        points: [[2050, 900], [2040, 1220], [2050, 1500], [2070, 1700], [2090, 2050]],
        widthM: 9
      },
      {
        id: 'rd_south_avenue', name: '南关横街', tier: 'street',
        points: [[760, 2100], [1420, 2112], [2100, 2104], [2760, 2090]],
        widthM: 8
      },
      {
        id: 'rd_east_lane', name: '东郊车马小径', tier: 'lane',
        points: [[2320, 1700], [2540, 1980], [2740, 2300]],
        widthM: 5
      },
      {
        id: 'rd_west_lane', name: '西郊麦场小径', tier: 'lane',
        points: [[700, 1720], [560, 1980], [430, 2260]],
        widthM: 5
      }
    ],
    fords: [],
    zones: [
      {
        id: 'zn_inner_city', name: '砾基夯土内城', contentType: 'walled_city',
        points: [[1120, 1150], [1660, 1168], [1646, 1520], [1106, 1502]],
        seed: 112301, locked: false, density: 0.78, maxSlopeDeg: 24,
        streetWidthM: 7.5, wallThicknessM: 5.5, towerIntervalM: 110
      },
      {
        id: 'zn_citadel', name: '三木合契议事厅与公仓', contentType: 'citadel',
        points: [[1680, 1175], [2000, 1190], [1986, 1470], [1666, 1455]],
        seed: 55127, locked: false, density: 0.62, maxSlopeDeg: 24,
        streetWidthM: 6.5, wallThicknessM: 5, towerIntervalM: 90
      },
      {
        id: 'zn_north_blocks', name: '北关河埠换装街区', contentType: 'town_blocks',
        points: [[820, 880], [1560, 900], [1548, 1112], [808, 1092]],
        seed: 40233, locked: false, density: 0.76, maxSlopeDeg: 26,
        streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_west_blocks', name: '西坡老榆梁换装街区', contentType: 'town_blocks',
        points: [[700, 1210], [1070, 1226], [1056, 1600], [686, 1584]],
        seed: 90211, locked: false, density: 0.8, maxSlopeDeg: 26,
        streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_east_blocks', name: '东关盐铁坊巷', contentType: 'town_blocks',
        points: [[2060, 1210], [2500, 1226], [2486, 1580], [2046, 1564]],
        seed: 31777, locked: false, density: 0.78, maxSlopeDeg: 26,
        streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_south_blocks', name: '南关厢车马店巷', contentType: 'town_blocks',
        points: [[980, 1618], [1400, 1634], [1386, 1900], [966, 1884]],
        seed: 31877, locked: false, density: 0.76, maxSlopeDeg: 26,
        streetWidthM: 6.5, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_southeast_blocks', name: '东南厢匠户坊巷', contentType: 'town_blocks',
        points: [[1830, 1640], [2260, 1656], [2246, 2010], [1816, 1994]],
        seed: 60413, locked: false, density: 0.74, maxSlopeDeg: 26,
        streetWidthM: 6.5, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_south_market', name: '南门灰粪柴市', contentType: 'market',
        points: [[1470, 1618], [1790, 1634], [1776, 1868], [1456, 1852]],
        seed: 70401, locked: false, density: 0.88, maxSlopeDeg: 24,
        streetWidthM: 6, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_west_farm', name: '西郊河阶麦粟条田', contentType: 'farmland',
        points: [[250, 1620], [640, 1636], [626, 2060], [236, 2044]],
        seed: 227, locked: false, density: 0.62, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_east_farm', name: '东郊渠灌条田', contentType: 'farmland',
        points: [[2320, 1640], [2900, 1656], [2886, 2120], [2306, 2104]],
        seed: 331, locked: false, density: 0.6, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_south_farm', name: '南郊河阶麦粟条田', contentType: 'farmland',
        points: [[640, 2180], [2300, 2200], [2280, 2820], [620, 2800]],
        seed: 457, locked: false, density: 0.58, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_south_wood', name: '东南岗薪炭疏林', contentType: 'woodland',
        points: [[2420, 2260], [2960, 2280], [2940, 2820], [2400, 2800]],
        seed: 613, locked: false, density: 0.66, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_north_wood', name: '东北岗河柳薪炭林', contentType: 'woodland',
        points: [[2620, 900], [3060, 915], [3045, 1250], [2605, 1235]],
        seed: 727, locked: false, density: 0.62, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_west_wood', name: '西冈榆槐护坡林', contentType: 'woodland',
        points: [[120, 1180], [420, 1196], [410, 1560], [108, 1544]],
        seed: 839, locked: false, density: 0.6, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      }
    ],
    landmarks: [
      {
        id: 'lm_weir_01', legendKey: 'custom_weir', glyphType: 'well_shrine',
        label: '东关总分水堰', x: 2190, y: 686, showLabel: true, sizePx: 16
      },
      {
        id: 'lm_altar_01', legendKey: 'custom_altar', glyphType: 'star_fort',
        label: '司辰河衡官坛', x: 1230, y: 1195, showLabel: true, sizePx: 15
      },
      {
        id: 'lm_slip_01', legendKey: 'custom_slip', glyphType: 'ferry_anchor',
        label: '北埠浅船滑道坞', x: 1730, y: 520, showLabel: true, sizePx: 15
      }
    ],
    legend: {
      visible: true,
      title: '图例 · Lōsrūmūra',
      position: 'bottom-right',
      columns: 2,
      items: []
    }
  };
}

/* ------------------------------------ 预设二：长湖 复市镇 ------------------------------------- */

function buildPresetChanghu() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_changhu',
      name: '长湖复市镇 Simibihmāh',
      subtitle: 'L6 半咸水湖湾与伊珂免税暗渠互市平面图',
      worldSizeM: 2600,
      terraxAnchor: { lon: 35.61, lat: 28.53, elevM: 427.5, regionNote: 'G02 长湖西南 E2 东廊灌区' },
      updatedAt: '2026-11-18T09:00:00Z'
    },
    palette: { themeId: 'arid_oasis', overrides: {} },
    terrain: {
      baseElev: 424,
      slopeMagM: 15,
      slopeDirDeg: 118,
      contourStep: 4,
      indexEvery: 5,
      minContourElev: 405,
      maxContourElev: 470,
      showContours: true,
      showScarpTicks: false,
      scarpSlopeThresholdDeg: 26,
      shapes: [
        {
          id: 'shape_fan_west', type: 'hill',
          cx: 420, cy: 1260, rx: 760, ry: 980, angleDeg: 8,
          deltaElev: 26, focusX: 0.2, focusY: 0.1
        },
        {
          id: 'shape_ridge_east', type: 'ridge',
          points: [[2540, 880], [2280, 1200], [2080, 1580], [1980, 1900]],
          deltaElev: 16, widthLeft: 150, widthRight: 240
        },
        {
          id: 'shape_ridge_south', type: 'ridge',
          points: [[120, 2380], [760, 2320], [1420, 2360], [2080, 2300]],
          deltaElev: 20, widthLeft: 170, widthRight: 220
        }
      ],
      sculptDeltaB64: ''
    },
    rivers: [],
    waterBodies: [
      {
        id: 'lake_l6', name: 'L6 半咸水湖湾', kind: 'lake',
        points: [
          [1400, 140], [2260, 150], [2540, 430], [2450, 790],
          [1880, 860], [1520, 690], [1380, 380]
        ],
        rippleLines: 3
      }
    ],
    canals: [
      {
        id: 'can_qanat_ikke', name: '伊珂免税暗渠', style: 'qanat',
        points: [[180, 880], [620, 960], [1080, 1040], [1500, 1090]],
        widthM: 4.5
      },
      {
        id: 'can_lake_open', name: '湖滨引水明渠', style: 'open',
        points: [[1620, 900], [1640, 1200], [1660, 1500], [1680, 1860], [1700, 2180]],
        widthM: 6
      }
    ],
    reefs: [],
    roads: [
      {
        id: 'rd_lake_highway', name: '湖西南盐鱼驿道', tier: 'highway',
        points: [[80, 1560], [860, 1500], [1700, 1450], [2520, 1500]],
        widthM: 14
      },
      {
        id: 'rd_market_street', name: '互市坪直街', tier: 'street',
        points: [[1180, 900], [1160, 1200], [1140, 1500], [1120, 1800], [1100, 2100]],
        widthM: 9
      },
      {
        id: 'rd_west_lane', name: '西坡井道', tier: 'lane',
        points: [[260, 1020], [480, 1180], [640, 1420]],
        widthM: 5
      },
      {
        id: 'rd_south_avenue', name: '南滩横街', tier: 'street',
        points: [[420, 2200], [1080, 2212], [1760, 2200], [2320, 2180]],
        widthM: 8
      },
      {
        id: 'rd_east_lane', name: '盐场驳运小径', tier: 'lane',
        points: [[2060, 1500], [2260, 1820], [2380, 2120]],
        widthM: 5
      }
    ],
    fords: [],
    zones: [
      {
        id: 'zn_west_blocks', name: '西坡互市坊巷', contentType: 'town_blocks',
        points: [[300, 1120], [760, 1136], [746, 1520], [286, 1504]],
        seed: 4112, locked: false, density: 0.78, maxSlopeDeg: 26,
        streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_central_blocks', name: '中街匠户坊巷', contentType: 'town_blocks',
        points: [[820, 1160], [1100, 1172], [1088, 1490], [808, 1478]],
        seed: 5223, locked: false, density: 0.8, maxSlopeDeg: 26,
        streetWidthM: 6.5, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_east_blocks', name: '东廊互市坊巷', contentType: 'town_blocks',
        points: [[1720, 1130], [2160, 1146], [2146, 1520], [1706, 1504]],
        seed: 7788, locked: false, density: 0.78, maxSlopeDeg: 26,
        streetWidthM: 7, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_lake_market', name: '湖滨盐鱼互市坪', contentType: 'market',
        points: [[1180, 880], [1560, 896], [1548, 1080], [1168, 1064]],
        seed: 9931, locked: false, density: 0.9, maxSlopeDeg: 24,
        streetWidthM: 6, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_saltpan', name: '南滩分级晒盐池', contentType: 'saltpan',
        points: [[1820, 1560], [2400, 1576], [2386, 1960], [1806, 1944]],
        seed: 6621, locked: false, density: 0.86, maxSlopeDeg: 26,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_dry_farm', name: '渠灌旱谷条田', contentType: 'farmland',
        points: [[520, 1600], [1500, 1620], [1480, 2160], [500, 2140]],
        seed: 1212, locked: false, density: 0.6, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_south_farm', name: '南滩井灌黍田', contentType: 'farmland',
        points: [[1600, 2000], [2300, 2020], [2280, 2480], [1580, 2460]],
        seed: 1313, locked: false, density: 0.56, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_west_farm', name: '西坡冲积扇麦田', contentType: 'farmland',
        points: [[160, 1560], [480, 1576], [466, 2000], [146, 1984]],
        seed: 1414, locked: false, density: 0.54, maxSlopeDeg: 30,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_south_wood', name: '东南沙枣疏林', contentType: 'woodland',
        points: [[2360, 2000], [2560, 2012], [2546, 2380], [2346, 2368]],
        seed: 1515, locked: false, density: 0.6, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_southwest_wood', name: '西南沙丘梭梭薪炭林', contentType: 'woodland',
        points: [[140, 2080], [520, 2096], [508, 2400], [128, 2384]],
        seed: 1616, locked: false, density: 0.58, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_plague_circle', name: '前405年黑石大疫禁建界圈', contentType: 'exclusion',
        points: [[200, 320], [700, 340], [690, 700], [180, 680]],
        seed: 405, locked: true, density: 0.5, maxSlopeDeg: 40,
        streetWidthM: 5, wallThicknessM: 3, towerIntervalM: 110
      }
    ],
    landmarks: [
      {
        id: 'lm_well_third', legendKey: 'custom_well3', glyphType: 'well_shrine',
        label: '第三竖井（哭井）', x: 1080, y: 1040, showLabel: true, sizePx: 16
      },
      {
        id: 'lm_mother_shrine', legendKey: 'custom_shrine', glyphType: 'well_shrine',
        label: '西井母共祭祠', x: 620, y: 960, showLabel: true, sizePx: 15
      },
      {
        id: 'lm_bronze_rule', legendKey: 'custom_rule', glyphType: 'stele',
        label: '分水铜尺公所', x: 1500, y: 1090, showLabel: true, sizePx: 14
      }
    ],
    legend: {
      visible: true,
      title: '图例 · Simibihmāh',
      position: 'bottom-right',
      columns: 2,
      items: []
    }
  };
}

/* ------------------------------------ 预设三：帕隆 峡谷铁寨 ----------------------------------- */

function buildPresetPalong() {
  const reefList = [];
  const reefSpec = [
    [-16, -6, 12, 24, 101, 1],
    [10, -12, 10, 68, 211, 1],
    [22, 8, 13, 132, 307, 1],
    [-8, 14, 9, 12, 419, 1],
    [2, 0, 14, 96, 523, 1],
    [-26, 10, 8, 44, 631, 1],
    [30, -4, 9, 156, 743, 1]
  ];
  for (let i = 0; i < reefSpec.length; i += 1) {
    const s = reefSpec[i];
    reefList.push({
      id: `reef_anliang_${i + 1}`,
      x: 702 + s[0],
      y: 716 + s[1],
      radiusM: s[2],
      angleDeg: s[3],
      seed: s[4],
      count: s[5]
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_palong',
      name: '帕隆双生铁寨',
      subtitle: '停战线深切 V 形峡谷与暗梁渡口平面图',
      worldSizeM: 1400,
      terraxAnchor: { lon: 29.04, lat: 14.58, elevM: 1662.6, regionNote: 'G04 帕隆停战峡谷' },
      updatedAt: '2026-11-18T09:00:00Z'
    },
    palette: { themeId: 'nordic_fjord', overrides: {} },
    terrain: {
      baseElev: 1652,
      slopeMagM: 26,
      slopeDirDeg: 340,
      contourStep: 10,
      indexEvery: 5,
      minContourElev: 1600,
      maxContourElev: 1920,
      showContours: true,
      showScarpTicks: true,
      scarpSlopeThresholdDeg: 26,
      shapes: [
        {
          id: 'shape_ridge_north', type: 'ridge',
          points: [[60, 214], [420, 262], [820, 224], [1340, 264]],
          deltaElev: 150, widthLeft: 220, widthRight: 196
        },
        {
          id: 'shape_ridge_south', type: 'ridge',
          points: [[60, 1214], [420, 1152], [820, 1192], [1340, 1146]],
          deltaElev: 170, widthLeft: 214, widthRight: 202
        },
        {
          id: 'shape_gorge_east', type: 'valley',
          points: [[1120, 520], [1190, 700], [1130, 940]],
          deltaElev: -24, widthLeft: 96, widthRight: 120
        },
        {
          id: 'shape_gorge_west', type: 'valley',
          points: [[210, 520], [260, 700], [220, 940]],
          deltaElev: -18, widthLeft: 88, widthRight: 104
        }
      ],
      sculptDeltaB64: ''
    },
    rivers: [
      {
        id: 'riv_palong', name: '帕隆急溪',
        points: [[40, 700], [220, 684], [420, 690], [700, 716], [980, 690], [1180, 700], [1360, 712]],
        widthStartM: 26, widthEndM: 34, carveDepthM: 6, rippleLines: 3
      }
    ],
    waterBodies: [],
    canals: [],
    reefs: reefList,
    roads: [
      {
        id: 'rd_bridge_road', name: '跨溪廊桥石道', tier: 'street',
        points: [[260, 360], [360, 540], [460, 690], [560, 860], [600, 1020]],
        widthM: 10
      },
      {
        id: 'rd_ford_road', name: '暗梁渡口道', tier: 'lane',
        points: [[700, 430], [702, 716], [706, 1000]],
        widthM: 6
      },
      {
        id: 'rd_north_terrace', name: '北岸阶地石径', tier: 'highway',
        points: [[80, 520], [300, 440], [700, 430], [1100, 500], [1300, 560]],
        widthM: 8
      },
      {
        id: 'rd_south_terrace', name: '南岸盘山石道', tier: 'street',
        points: [[80, 860], [340, 900], [700, 900], [1040, 880], [1300, 920]],
        widthM: 7
      },
      {
        id: 'rd_switchback_a', name: '北坡之字盘道', tier: 'lane',
        points: [[300, 440], [380, 300], [520, 250], [640, 330], [660, 430]],
        widthM: 5
      },
      {
        id: 'rd_switchback_b', name: '南坡之字盘道', tier: 'lane',
        points: [[1040, 880], [1120, 1020], [1000, 1080], [880, 1020], [860, 900]],
        widthM: 5
      }
    ],
    fords: [
      { id: 'ford_anliang', x: 702, y: 716, radiusM: 30, name: '暗梁渡口' }
    ],
    zones: [
      {
        id: 'zn_village_north', name: '北岸窄阶地散居铁寨', contentType: 'village',
        points: [[180, 340], [640, 360], [624, 636], [164, 616]],
        seed: 771, locked: false, density: 0.72, maxSlopeDeg: 28,
        streetWidthM: 4.5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_village_south', name: '南岸窄阶地散居铁寨', contentType: 'village',
        points: [[740, 790], [1200, 810], [1184, 1070], [724, 1050]],
        seed: 882, locked: false, density: 0.7, maxSlopeDeg: 28,
        streetWidthM: 4.5, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_market_north', name: '北岸铁寨互市坪', contentType: 'market',
        points: [[720, 420], [940, 432], [930, 600], [710, 588]],
        seed: 935, locked: false, density: 0.82, maxSlopeDeg: 26,
        streetWidthM: 6, wallThicknessM: 4, towerIntervalM: 110
      },
      {
        id: 'zn_wood_north', name: '北山腰薪炭林', contentType: 'woodland',
        points: [[940, 250], [1330, 272], [1312, 590], [920, 568]],
        seed: 993, locked: false, density: 0.76, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      },
      {
        id: 'zn_wood_south', name: '南山腰薪炭林', contentType: 'woodland',
        points: [[180, 980], [700, 1000], [690, 1290], [170, 1270]],
        seed: 1010, locked: false, density: 0.72, maxSlopeDeg: 34,
        streetWidthM: 4, wallThicknessM: 3, towerIntervalM: 110
      }
    ],
    landmarks: [
      {
        id: 'lm_hammer', legendKey: 'custom_hammer', glyphType: 'mine_hammer',
        label: '水力锻锤铁坊', x: 470, y: 640, showLabel: true, sizePx: 15
      },
      {
        id: 'lm_reef_ford', legendKey: 'custom_ford', glyphType: 'ferry_anchor',
        label: '暗梁渡口礁滩', x: 702, y: 716, showLabel: true, sizePx: 15
      },
      {
        id: 'lm_watchtower', legendKey: 'custom_tower', glyphType: 'tower',
        label: '停战线哨塔望碉', x: 300, y: 330, showLabel: true, sizePx: 15
      }
    ],
    legend: {
      visible: true,
      title: '图例 · 帕隆铁寨',
      position: 'bottom-right',
      columns: 2,
      items: []
    }
  };
}

export function getBuiltinPresetProjects() {
  return [
    { key: 'losrumura', label: '起点都城 Lōsrūmūra', project: normalizeProject(buildPresetLosrumura()) },
    { key: 'changhu', label: '长湖复市镇 Simibihmāh', project: normalizeProject(buildPresetChanghu()) },
    { key: 'palong', label: '帕隆双生铁寨', project: normalizeProject(buildPresetPalong()) }
  ];
}

export function createDefaultProject(presetKey) {
  if (typeof presetKey === 'string' && presetKey.length > 0) {
    const presets = getBuiltinPresetProjects();
    for (let i = 0; i < presets.length; i += 1) {
      if (presets[i].key === presetKey) {
        return deepClone(presets[i].project);
      }
    }
    const blank = buildBlankProject(null);
    blank.meta.id = `proj_${presetKey}`;
    return normalizeProject(blank);
  }
  return normalizeProject(buildBlankProject(null));
}

/* ------------------------------------------------------------------------------------------------
 * 九、工程归一化、序列化与反序列化
 * ---------------------------------------------------------------------------------------------- */

export function normalizeProject(rawObj) {
  const raw = (rawObj && typeof rawObj === 'object') ? rawObj : {};
  const metaRaw = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
  const palRaw = (raw.palette && typeof raw.palette === 'object') ? raw.palette : {};
  const terRaw = (raw.terrain && typeof raw.terrain === 'object') ? raw.terrain : {};

  const worldSizeM = clampNum(num(metaRaw.worldSizeM, 2400), 600, 8000);
  const themeRaw = text(palRaw.themeId, 'watabou_classic');
  const themeId = THEME_ALIASES[themeRaw] || (BUILTIN_PALETTES[themeRaw] ? themeRaw : 'watabou_classic');

  const overrides = {};
  const ovRaw = (palRaw.overrides && typeof palRaw.overrides === 'object') ? palRaw.overrides : {};
  for (let i = 0; i < PALETTE_SLOT_KEYS.length; i += 1) {
    const key = PALETTE_SLOT_KEYS[i];
    const value = ovRaw[key];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      overrides[key] = value.toLowerCase();
    }
  }

  let minE = num(terRaw.minContourElev, -500);
  let maxE = num(terRaw.maxContourElev, 6000);
  if (minE > maxE) {
    const tmp = minE;
    minE = maxE;
    maxE = tmp;
  }

  const shapes = [];
  const shapesRaw = list(terRaw.shapes);
  for (let i = 0; i < shapesRaw.length; i += 1) {
    const s = normalizeShape(shapesRaw[i]);
    if (s) shapes.push(s);
  }

  const rivers = [];
  const riversRaw = list(raw.rivers);
  for (let i = 0; i < riversRaw.length; i += 1) {
    const r = normalizeRiver(riversRaw[i]);
    if (r) rivers.push(r);
  }

  const waterBodies = [];
  const wbRaw = list(raw.waterBodies);
  for (let i = 0; i < wbRaw.length; i += 1) {
    const w = normalizeWaterBody(wbRaw[i]);
    if (w) waterBodies.push(w);
  }

  const canals = [];
  const canalsRaw = list(raw.canals);
  for (let i = 0; i < canalsRaw.length; i += 1) {
    const c = normalizeCanal(canalsRaw[i]);
    if (c) canals.push(c);
  }

  const reefs = [];
  const reefsRaw = list(raw.reefs);
  for (let i = 0; i < reefsRaw.length; i += 1) {
    const f = normalizeReef(reefsRaw[i]);
    if (f) reefs.push(f);
  }

  const roads = [];
  const roadsRaw = list(raw.roads);
  for (let i = 0; i < roadsRaw.length; i += 1) {
    const rd = normalizeRoad(roadsRaw[i]);
    if (rd) roads.push(rd);
  }

  const fords = [];
  const fordsRaw = list(raw.fords);
  for (let i = 0; i < fordsRaw.length; i += 1) {
    const f = normalizeFord(fordsRaw[i]);
    if (f) fords.push(f);
  }

  const zones = [];
  const zonesRaw = list(raw.zones);
  for (let i = 0; i < zonesRaw.length; i += 1) {
    const z = normalizeZone(zonesRaw[i], zones.length);
    if (z) zones.push(z);
  }

  const landmarks = [];
  const lmRaw = list(raw.landmarks);
  for (let i = 0; i < lmRaw.length; i += 1) {
    const lm = normalizeLandmark(lmRaw[i]);
    if (lm) landmarks.push(lm);
  }

  const anchorRaw = metaRaw.terraxAnchor;
  const terraxAnchor = (anchorRaw && typeof anchorRaw === 'object')
    ? {
      lon: num(anchorRaw.lon, 0),
      lat: num(anchorRaw.lat, 0),
      elevM: num(anchorRaw.elevM, 0),
      regionNote: text(anchorRaw.regionNote, '')
    }
    : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: text(metaRaw.id, 'proj_default'),
      name: text(metaRaw.name, '未命名聚落测绘图'),
      subtitle: text(metaRaw.subtitle, '河阶与街坊平面图'),
      worldSizeM,
      terraxAnchor,
      updatedAt: text(metaRaw.updatedAt, '2026-11-18T09:00:00Z')
    },
    palette: {
      themeId,
      overrides
    },
    terrain: {
      baseElev: clampNum(num(terRaw.baseElev, 450), -200, 6000),
      slopeMagM: clampNum(num(terRaw.slopeMagM, 18), 0, 800),
      slopeDirDeg: num(terRaw.slopeDirDeg, 315),
      contourStep: clampNum(num(terRaw.contourStep, 5), 1, 100),
      indexEvery: Math.round(clampNum(num(terRaw.indexEvery, 5), 1, 20)),
      minContourElev: minE,
      maxContourElev: maxE,
      showContours: terRaw.showContours !== false,
      showScarpTicks: terRaw.showScarpTicks === true,
      scarpSlopeThresholdDeg: clampNum(num(terRaw.scarpSlopeThresholdDeg, 26), 2, 80),
      shapes,
      sculptDeltaB64: typeof terRaw.sculptDeltaB64 === 'string' ? terRaw.sculptDeltaB64 : ''
    },
    rivers,
    waterBodies,
    canals,
    reefs,
    roads,
    fords,
    zones,
    landmarks,
    legend: normalizeLegend(raw.legend)
  };
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

export function deserializeProject(jsonText) {
  if (typeof jsonText !== 'string' || jsonText.length === 0) {
    throw new Error('deserializeProject: 传入的工程文本为空');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`deserializeProject: JSON 解析失败 — ${err && err.message ? err.message : '未知错误'}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('deserializeProject: 工程根节点必须为对象');
  }
  return normalizeProject(parsed);
}

/* ------------------------------------------------------------------------------------------------
 * 十、图例自动感知同步器
 * ---------------------------------------------------------------------------------------------- */

function detectScenePresence(compiledScene) {
  const presence = {
    roofInner: false,
    roofTown: false,
    cityWall: false,
    road: false,
    bridge: false,
    river: false,
    waterBody: false,
    canal: false,
    contour: false,
    scarpTick: false,
    farmland: false,
    saltpan: false,
    tree: false,
    reef: false
  };
  if (!compiledScene || typeof compiledScene !== 'object') {
    return presence;
  }
  const buildings = list(compiledScene.buildings);
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    if (b && b.roofKind === 'inner') presence.roofInner = true;
    if (b && b.roofKind === 'town') presence.roofTown = true;
  }
  const zones = list(compiledScene.zones);
  for (let i = 0; i < zones.length; i += 1) {
    const z = zones[i];
    if (!z) continue;
    if (list(z.walls).length > 0) presence.cityWall = true;
    if (list(z.farmlandPlots).length > 0) presence.farmland = true;
    if (list(z.saltpanCells).length > 0) presence.saltpan = true;
    if (list(z.trees).length > 0) presence.tree = true;
  }
  if (list(compiledScene.walls).length > 0) presence.cityWall = true;
  if (list(compiledScene.trees).length > 0) presence.tree = true;
  if (list(compiledScene.farmlandPlots).length > 0) presence.farmland = true;
  if (list(compiledScene.saltpanCells).length > 0) presence.saltpan = true;

  const hydro = (compiledScene.hydro && typeof compiledScene.hydro === 'object') ? compiledScene.hydro : {};
  if (list(hydro.roads).length > 0) presence.road = true;
  if (list(hydro.bridges).length > 0) presence.bridge = true;
  if (list(hydro.rivers).length > 0) presence.river = true;
  if (list(hydro.waterBodies).length > 0) presence.waterBody = true;
  if (list(hydro.canals).length > 0) presence.canal = true;
  if (list(hydro.reefs).length > 0) presence.reef = true;

  const terrain = (compiledScene.terrain && typeof compiledScene.terrain === 'object') ? compiledScene.terrain : {};
  const contours = list(terrain.contours);
  if (contours.length > 0) presence.contour = true;
  if (list(terrain.scarpTicks).length > 0) presence.scarpTick = true;
  if (list(compiledScene.scarpTicks).length > 0) presence.scarpTick = true;
  if (list(compiledScene.contours).length > 0) presence.contour = true;
  return presence;
}

const LEGEND_PRESENCE_BY_KEY = {
  roof_inner: 'roofInner',
  roof_town: 'roofTown',
  city_wall: 'cityWall',
  road_highway: 'road',
  bridge_ortho: 'bridge',
  river_pure: 'river',
  water_lake_sea: 'waterBody',
  canal_water: 'canal',
  contour_line: 'contour',
  scarp_tick: 'scarpTick',
  farmland_plot: 'farmland',
  saltpan_plot: 'saltpan',
  woodland_tree: 'tree',
  rock_reef: 'reef'
};

export function syncLegendWithProject(project, compiledScene) {
  const target = (project && typeof project === 'object') ? project : {};
  if (!target.legend || typeof target.legend !== 'object') {
    target.legend = normalizeLegend(null);
  }
  if (!Array.isArray(target.legend.items)) {
    target.legend.items = [];
  }
  const palette = getActivePalette(target);
  const presence = detectScenePresence(compiledScene);
  const items = target.legend.items;

  const findByKey = (key) => {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i] && items[i].key === key) return items[i];
    }
    return null;
  };

  for (let i = 0; i < BUILTIN_LEGEND_CATALOG.length; i += 1) {
    const cat = BUILTIN_LEGEND_CATALOG[i];
    const presentKey = LEGEND_PRESENCE_BY_KEY[cat.key];
    const isPresent = presentKey ? presence[presentKey] === true : false;
    let item = findByKey(cat.key);
    if (!item) {
      if (isPresent === false) continue;
      item = {
        key: cat.key,
        isCustom: false,
        glyphType: cat.glyphType,
        label: cat.label,
        // 内置图例默认留空：渲染时动态读取当前激活调色板，换主题即换色
        color: '',
        colorLocked: false,
        strokeColor: cat.strokeColor,
        visible: true,
        autoPresent: true,
        order: cat.order
      };
      items.push(item);
    } else {
      item.autoPresent = isPresent;
      if (typeof item.glyphType !== 'string' || item.glyphType.length === 0) {
        item.glyphType = cat.glyphType;
      }
      if (item.isCustom !== true && item.colorLocked !== true) {
        item.color = '';
      }
      if (typeof item.label !== 'string' || item.label.length === 0) {
        item.label = cat.label;
      }
    }
  }

  const landmarks = list(target.landmarks);
  const usedKeys = new Set();
  for (let i = 0; i < landmarks.length; i += 1) {
    const lm = landmarks[i];
    if (lm && typeof lm.legendKey === 'string') {
      usedKeys.add(lm.legendKey);
      if (lm.legendKey.indexOf('custom_') === 0 && findByKey(lm.legendKey) === null) {
        const glyphType = CUSTOM_GLYPH_TYPES.indexOf(lm.glyphType) >= 0 ? lm.glyphType : 'stele';
        items.push({
          key: lm.legendKey,
          isCustom: true,
          glyphType,
          label: lm.label || CUSTOM_GLYPH_LABELS[glyphType],
          color: palette.treeFill,
          strokeColor: palette.inkDark,
          visible: true,
          autoPresent: true,
          order: 500 + i * 10
        });
      }
    }
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && item.isCustom === true) {
      item.autoPresent = Boolean(item.isCustom) || usedKeys.has(item.key);
      if (typeof item.color !== 'string' || item.color.length === 0) {
        item.color = palette.treeFill;
      }
    }
  }

  items.sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 999;
    const bo = typeof b.order === 'number' ? b.order : 999;
    if (ao !== bo) return ao - bo;
    return String(a.key).localeCompare(String(b.key));
  });

  return target.legend;
}

/* ------------------------------------------------------------------------------------------------
 * 十一、40 步快照撤销/重做历史栈
 * ---------------------------------------------------------------------------------------------- */

export class HistoryManager {
  constructor(maxSteps = 40) {
    this.maxSteps = Math.max(1, Math.floor(Number(maxSteps) || 40));
    this.undoStack = [];
    this.redoStack = [];
    this.pendingBeforeJson = null;
    this.pendingLabel = '';
    this.serialCounter = 0;
  }

  reset(initialProject) {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingBeforeJson = null;
    this.pendingLabel = '';
    this.serialCounter = 0;
    if (initialProject !== undefined && initialProject !== null) {
      this.undoStack.push({ json: serializeProject(initialProject), label: '初始化' });
    }
    return this.getStatus();
  }

  beginContinuousAction(projectSnapshot) {
    if (projectSnapshot === undefined || projectSnapshot === null) {
      this.pendingBeforeJson = null;
      return null;
    }
    this.pendingBeforeJson = serializeProject(projectSnapshot);
    return this.pendingBeforeJson;
  }

  commitHistory(currentProject, actionLabel) {
    if (currentProject === undefined || currentProject === null) {
      return false;
    }
    const label = (typeof actionLabel === 'string' && actionLabel.length > 0) ? actionLabel : '编辑';
    const currentJson = serializeProject(currentProject);
    const beforeJson = (typeof this.pendingBeforeJson === 'string') ? this.pendingBeforeJson : null;
    this.pendingBeforeJson = null;
    if (beforeJson === null) {
      this.undoStack.push({ json: currentJson, label });
      this.trimUndo();
      this.redoStack = [];
      this.serialCounter += 1;
      return true;
    }
    if (beforeJson === currentJson) {
      return false;
    }
    this.undoStack.push({ json: beforeJson, label });
    this.trimUndo();
    this.redoStack = [];
    this.serialCounter += 1;
    return true;
  }

  trimUndo() {
    while (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(currentProject) {
    if (this.undoStack.length === 0) {
      return null;
    }
    const entry = this.undoStack.pop();
    const currentJson = serializeProject(currentProject);
    this.redoStack.push({ json: currentJson, label: entry.label });
    while (this.redoStack.length > this.maxSteps) {
      this.redoStack.shift();
    }
    return deserializeProject(entry.json);
  }

  redo(currentProject) {
    if (this.redoStack.length === 0) {
      return null;
    }
    const entry = this.redoStack.pop();
    const currentJson = serializeProject(currentProject);
    this.undoStack.push({ json: currentJson, label: entry.label });
    this.trimUndo();
    return deserializeProject(entry.json);
  }

  getStatus() {
    return {
      maxSteps: this.maxSteps,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      pending: this.pendingBeforeJson !== null,
      lastLabel: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : '',
      serialCounter: this.serialCounter
    };
  }
}

/* ------------------------------------------------------------------------------------------------
 * 十二、模块内部只读元数据（不对外导出，仅用于本模块调试与断言提示）
 * ---------------------------------------------------------------------------------------------- */

const INTERNAL_META = {
  paletteSlotKeys: PALETTE_SLOT_KEYS,
  themeLabels: THEME_LABELS,
  themeAliases: THEME_ALIASES,
  zoneContentLabels: ZONE_CONTENT_LABELS,
  customGlyphLabels: CUSTOM_GLYPH_LABELS,
  gridPointCount: GRID_POINT_COUNT
};

void INTERNAL_META;
