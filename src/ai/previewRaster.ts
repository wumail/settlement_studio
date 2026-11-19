import { Resvg } from '@resvg/resvg-js';
import type { BBox, ViewportState, Vec2 } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import { computePolygonBBox, computePolygonCentroid } from '../core/math/polygon';
import { paintScene } from '../renderer/paintScene';
import { samplePolylineAtT } from './geometrySnap';
import { appendGridOverlay } from './previewGrid';
import { PreviewCullBackend } from './previewCull';

export type PreviewMode = 'standard' | 'guided' | 'clean';

export interface PreviewRenderOptions {
  readonly mode?: PreviewMode;
  readonly widthPx?: number;
  readonly gridOverlay?: boolean;
  readonly gridStepM?: number;
  readonly crop?:
    | { readonly zoneId: string; readonly padM?: number }
    | { readonly entityId: string; readonly radiusM?: number }
    | { readonly bbox: BBox };
}

export interface PreviewRenderResult {
  readonly pngBuffer: Uint8Array;
  readonly svg: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly worldBounds: BBox;
}

function squareAround(cx: number, cy: number, span: number): BBox {
  const half = Math.max(30, span) * 0.5;
  return [cx - half, cy - half, cx + half, cy + half];
}

function entityPoint(project: TownProject, scene: CompiledScene, id: string): Vec2 | null {
  const zone = project.zones.find((item) => item.id === id);
  if (zone) return computePolygonCentroid(zone.points);
  const river = project.rivers.find((item) => item.id === id);
  if (river) return samplePolylineAtT(river.points, 0.5).point;
  const body = project.waterBodies.find((item) => item.id === id);
  if (body) return computePolygonCentroid(body.points);
  const canal = project.canals.find((item) => item.id === id);
  if (canal) return samplePolylineAtT(canal.points, 0.5).point;
  const weir = project.weirs.find((item) => item.id === id);
  if (weir) return [(weir.pStart[0] + weir.pEnd[0]) * 0.5, (weir.pStart[1] + weir.pEnd[1]) * 0.5];
  const dock = project.docks.find((item) => item.id === id);
  if (dock) return [dock.x, dock.y];
  const mill = project.watermills.find((item) => item.id === id);
  if (mill) return [mill.x, mill.y];
  const structure = project.structures.find((item) => item.id === id);
  if (structure) return [structure.x, structure.y];
  const landmark = project.landmarks.find((item) => item.id === id);
  if (landmark) return [landmark.x, landmark.y];
  const bridge = scene.hydro.bridges.find((item) => item.id === id);
  if (bridge) return [bridge.x, bridge.y];
  const building = scene.buildings.find((item) => item.id === id);
  if (building) return building.centroid;
  return null;
}

function cropBounds(project: TownProject, scene: CompiledScene, crop: NonNullable<PreviewRenderOptions['crop']>): BBox {
  if ('zoneId' in crop) {
    const zone = project.zones.find((item) => item.id === crop.zoneId);
    if (!zone) throw new Error(`crop: 找不到选区 ${crop.zoneId}`);
    const [minX, minY, maxX, maxY] = computePolygonBBox(zone.points);
    const pad = crop.padM ?? 80;
    return squareAround((minX + maxX) * 0.5, (minY + maxY) * 0.5, Math.max(maxX - minX, maxY - minY) + pad * 2);
  }
  if ('entityId' in crop) {
    const point = entityPoint(project, scene, crop.entityId);
    if (!point) throw new Error(`crop: 找不到实体 ${crop.entityId}`);
    return squareAround(point[0], point[1], Math.max(80, (crop.radiusM ?? 220) * 2));
  }
  const [x0, y0, x1, y1] = crop.bbox;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const span = Math.max(80, maxX - minX, maxY - minY);
  return squareAround((minX + maxX) * 0.5, (minY + maxY) * 0.5, span);
}

/** 裁切框整体夹回图幅内：保证去掉 clip-path 后画面仍只显示地图范围内内容 */
function clampBounds(bounds: BBox, worldSizeM: number): BBox {
  const span = Math.min(worldSizeM, Math.max(30, bounds[2] - bounds[0], bounds[3] - bounds[1]));
  let minX = Math.max(0, Math.min(worldSizeM - span, bounds[0]));
  let minY = Math.max(0, Math.min(worldSizeM - span, bounds[1]));
  if (span >= worldSizeM) {
    minX = 0;
    minY = 0;
  }
  return [minX, minY, minX + span, minY + span];
}

function viewportFor(widthPx: number, bounds: BBox, worldSizeM: number): ViewportState {
  const span = Math.max(30, bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const zoom = widthPx / span;
  return {
    widthPx,
    heightPx: widthPx,
    dpr: 1,
    panX: -bounds[0] * zoom,
    panY: -bounds[1] * zoom,
    zoom,
    worldSizeM,
  };
}

/**
 * 多模态视觉自检：复用 SvgStringBackend + paintScene（零重复绘制逻辑），
 * 再交给 resvg 栅格化为 PNG；crop 特写不叠大图例。
 */
export function renderPreviewPng(
  project: TownProject,
  scene: CompiledScene,
  options: PreviewRenderOptions = {},
): PreviewRenderResult {
  const mode = options.mode ?? 'standard';
  const widthPx = Math.max(400, Math.min(2400, Math.round(options.widthPx ?? 1400)));
  const world = project.meta.worldSizeM;
  const bounds: BBox = options.crop
    ? clampBounds(cropBounds(project, scene, options.crop), world)
    : [0, 0, world, world];
  const vp = viewportFor(widthPx, bounds, world);
  const backend = new PreviewCullBackend(widthPx, widthPx);
  paintScene(backend, project, scene, vp, {
    isExport: true,
    includeCartouche: !options.crop && mode !== 'clean',
    cleanPaper: mode === 'clean',
    displayMode: mode === 'guided' ? 'guided' : 'standard',
  });
  let svg = backend.toSvgString();
  if (options.gridOverlay === true) {
    const step = options.gridStepM ?? (world <= 2400 ? 200 : 400);
    svg = appendGridOverlay(svg, vp, bounds, step);
  }
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    font: { loadSystemFonts: true },
  }).render().asPng();
  return {
    pngBuffer: png,
    svg,
    widthPx,
    heightPx: widthPx,
    worldBounds: bounds,
  };
}
