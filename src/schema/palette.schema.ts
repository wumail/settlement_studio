import { z } from 'zod';

/** 12 语义色槽键名（顺序即 UI 拾色器呈现顺序） */
export const PALETTE_SLOT_KEYS = [
  'paperBg',
  'inkDark',
  'roofInner',
  'roofTown',
  'roadFill',
  'waterFill',
  'waterRipple',
  'treeFill',
  'treeOutline',
  'contourLine',
  'farmlandFill',
  'saltpanFill',
] as const;

export type PaletteSlotKey = (typeof PALETTE_SLOT_KEYS)[number];

export const CANONICAL_THEME_IDS = [
  'watabou_classic',
  'nordic_fjord',
  'arid_oasis',
  'gazetteer_ink',
] as const;

export type CanonicalThemeId = (typeof CANONICAL_THEME_IDS)[number];

export type ThemePalette = Readonly<Record<PaletteSlotKey, string>>;

/** 4 套主题 × 12 色槽 = 48 个 6 位小写 HEX */
export const BUILTIN_PALETTES: Readonly<Record<CanonicalThemeId, ThemePalette>> = {
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
    saltpanFill: '#cde0e3',
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
    saltpanFill: '#bfd4de',
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
    saltpanFill: '#d4e8e6',
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
    saltpanFill: '#dfe6e8',
  },
};

/** 方志旧别名 -> 规范主题 ID（boreal_slate / arid_ochre / archival_parchment 等） */
export const THEME_ALIASES: Readonly<Record<string, CanonicalThemeId>> = {
  watabou_classic: 'watabou_classic',
  nordic_fjord: 'nordic_fjord',
  arid_oasis: 'arid_oasis',
  gazetteer_ink: 'gazetteer_ink',
  boreal_slate: 'nordic_fjord',
  arid_ochre: 'arid_oasis',
  archival_parchment: 'gazetteer_ink',
};

export const PaletteConfigSchema = z.object({
  themeId: z.string().default('watabou_classic'),
  overrides: z.record(z.string(), z.string()).default({}),
});

export type PaletteConfig = z.infer<typeof PaletteConfigSchema>;

/** 解析后调色板：12 语义色槽 + 派生辅助描边色 */
export interface ResolvedPalette extends ThemePalette {
  readonly themeId: CanonicalThemeId;
  readonly roadCasing: string;
  readonly wallFill: string;
  readonly wallStroke: string;
  readonly reefFill: string;
  readonly bridgeDeck: string;
  readonly labelInk: string;
  readonly inkSecondary: string;
  readonly inkMuted: string;
  readonly accentPine: string;
  readonly accentTerracotta: string;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isHex6(value: string): boolean {
  return HEX6.test(value);
}

export function resolveThemeId(rawThemeId?: string): CanonicalThemeId {
  if (typeof rawThemeId !== 'string') return 'watabou_classic';
  const key = rawThemeId.trim().toLowerCase();
  const mapped = THEME_ALIASES[key];
  if (mapped) return mapped;
  return 'watabou_classic';
}

/** 合并基础主题 12 色与 overrides 中匹配 `^#[0-9a-fA-F]{6}$` 的槽位覆盖色（统一小写） */
export function getActivePalette(paletteConfig?: PaletteConfig | null): ResolvedPalette {
  const themeId = resolveThemeId(paletteConfig?.themeId);
  const base = BUILTIN_PALETTES[themeId];
  const merged: Record<PaletteSlotKey, string> = { ...base };
  const overrides = paletteConfig?.overrides ?? {};
  for (const slot of PALETTE_SLOT_KEYS) {
    const raw = overrides[slot];
    if (typeof raw === 'string' && HEX6.test(raw)) {
      merged[slot] = raw.toLowerCase();
    }
  }
  return {
    themeId,
    ...merged,
    roadCasing: '#5b4a38',
    wallFill: '#504233',
    wallStroke: '#3a3026',
    reefFill: '#585550',
    bridgeDeck: '#e6dcc8',
    labelInk: '#2b2520',
    inkSecondary: '#4a4339',
    inkMuted: '#6e6659',
    accentPine: '#365942',
    accentTerracotta: '#b55838',
  };
}
