import type { CompiledSceneBase, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import type { ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import type { BuiltStructure } from '../core/generators/customStructures';
import type { HydraulicWorks } from '../core/hydro/hydraulicWorks';
import type { TerrainShadingData } from '../core/terrain/terrainShading';
import { type RenderBackend, worldToScreen } from './RenderBackend';

/** 编译产物可选增值层：Canvas 与 SVG 共用同一套结构化几何，禁止任何一端另算 */
export interface SceneExtras {
  readonly hydraulic?: HydraulicWorks | null;
  readonly structures?: ReadonlyArray<BuiltStructure> | null;
  readonly shading?: TerrainShadingData | null;
  readonly paintedTreeRejects?: ReadonlyArray<string> | null;
}

export type PaintSceneData = CompiledSceneBase & SceneExtras;

export interface PaintContext {
  readonly backend: RenderBackend;
  readonly project: TownProject;
  readonly scene: PaintSceneData | null;
  readonly vp: ViewportState;
  readonly pal: ResolvedPalette;
  readonly selection: SelectionTarget | null;
  readonly hoverContourId: string | null;
  /** 图饰统一半透明度（图例框/标题牌/指北针/比例尺/导览目录） */
  readonly furnitureOpacity: number;
  /** 图面文字统一透明度（0 = 隐去） */
  readonly labelOpacity: number;
  /** 成图导出态：禁建留白等辅助标记彻底无痕 */
  readonly isExport: boolean;
  readonly pt: (v: Vec2) => Vec2;
  readonly px: (m: number) => number;
}

export const SERIF_FONT = '"Palatino Linotype", "Book Antiqua", "Songti SC", serif';

export function screenPoint(vp: ViewportState, x: number, y: number): Vec2 {
  return worldToScreen(x, y, vp);
}

export function makeContext(
  backend: RenderBackend,
  project: TownProject,
  scene: PaintSceneData | null,
  vp: ViewportState,
  pal: ResolvedPalette,
  selection: SelectionTarget | null,
  hoverContourId: string | null,
  isExport = false,
): PaintContext {
  return {
    backend,
    project,
    scene,
    vp,
    pal,
    selection,
    hoverContourId,
    furnitureOpacity: project.legend.furnitureOpacity,
    labelOpacity: project.legend.labelOpacity,
    isExport,
    pt: (v: Vec2) => worldToScreen(v[0], v[1], vp),
    px: (m: number) => Math.max(0.35, m * vp.zoom),
  };
}

/** 6 位 HEX 线性混色（sRGB 近似），用于高程淡彩与图例派生色 */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): readonly [number, number, number] => {
    const raw = hex.replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    const n = Number.parseInt(full.slice(0, 6), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
  };
  const k = Math.max(0, Math.min(1, t));
  const ca = parse(a);
  const cb = parse(b);
  const ch = (i: 0 | 1 | 2): string =>
    Math.round((ca[i] ?? 0) + ((cb[i] ?? 0) - (ca[i] ?? 0)) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}
