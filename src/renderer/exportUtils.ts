import type { CompiledSceneBase } from '../schema/geometry.types';
import { deserializeProject, type TownProject } from '../schema/project.schema';
import { Canvas2DBackend } from './Canvas2DBackend';
import { paintScene } from './paintScene';
import { createViewport } from './RenderBackend';
import { SvgStringBackend } from './SvgStringBackend';

export type ExportMode = 'full' | 'clean' | 'pure';
export type PngScale = 1 | 2 | 3;

export interface SvgExportOptions {
  readonly mode: ExportMode;
  readonly basePx?: number;
  readonly displayMode?: 'standard' | 'guided' | 'pure';
}

export interface PngExportOptions {
  readonly scale: PngScale;
  readonly mode: ExportMode;
  readonly displayMode?: 'standard' | 'guided' | 'pure';
}

function exportViewport(project: TownProject, sizePx: number) {
  return createViewport(sizePx, sizePx, project.meta.worldSizeM, 1);
}

/** 满幅分层无损 SVG：纯字符串零 DOM，Node 与浏览器通用 */
export function renderSceneToSvgString(
  project: TownProject,
  scene: CompiledSceneBase | null,
  options: SvgExportOptions,
): string {
  const size = Math.max(320, Math.round(options.basePx ?? 1600));
  const backend = new SvgStringBackend(size, size);
  paintScene(backend, project, scene, exportViewport(project, size), {
    isExport: true,
    includeCartouche: options.mode === 'full',
    cleanPaper: options.mode === 'clean' || options.mode === 'pure',
    displayMode: options.displayMode ?? (options.mode === 'pure' ? 'pure' : undefined),
  });
  return backend.toSvgString();
}

/** 离屏 1x/2x/3x PNG：最高 4800 × 4800 px，与屏幕端共用同一套 paintScene */
export function exportScenePngBlob(
  project: TownProject,
  scene: CompiledSceneBase | null,
  options: PngExportOptions,
): Promise<Blob> {
  const size = 1600 * Math.max(1, Math.min(3, Math.round(options.scale)));
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('PNG export requires a browser canvas'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context is unavailable'));
  const backend = new Canvas2DBackend(ctx, size, size, 1);
  paintScene(backend, project, scene, exportViewport(project, size), {
    isExport: true,
    includeCartouche: options.mode === 'full',
    cleanPaper: options.mode === 'clean' || options.mode === 'pure',
    displayMode: options.displayMode ?? (options.mode === 'pure' ? 'pure' : undefined),
  });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}

function triggerDownload(href: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function safeName(project: TownProject): string {
  const base = project.meta.name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return base.length > 0 ? base : 'untitled';
}

export function downloadPngFile(blob: Blob, project: TownProject, scale: PngScale, mode: ExportMode): void {
  if (typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${safeName(project)}-${mode}-${scale}x.png`);
  URL.revokeObjectURL(url);
}

export function downloadSvgFile(project: TownProject, scene: CompiledSceneBase | null, mode: ExportMode): void {
  if (typeof URL === 'undefined') return;
  const svg = renderSceneToSvgString(project, scene, { mode });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  triggerDownload(url, `${safeName(project)}-${mode}.svg`);
  URL.revokeObjectURL(url);
}

export function downloadProjectJsonFile(project: TownProject): void {
  if (typeof URL === 'undefined') return;
  const json = JSON.stringify(project, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  triggerDownload(url, `${safeName(project)}.worldtown.json`);
  URL.revokeObjectURL(url);
}

export async function readProjectJsonFromFile(file: File): Promise<TownProject> {
  const text = await file.text();
  return deserializeProject(text);
}

export function openProjectFilePicker(): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.worldtown.json,application/json';
    input.addEventListener('change', () => {
      resolve(input.files && input.files.length > 0 ? input.files[0] ?? null : null);
    });
    input.click();
  });
}
