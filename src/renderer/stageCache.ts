import type { RenderBackend } from './RenderBackend';

export type StageCacheLayer = 'static' | 'terrain';

export interface StageCacheKeyInput {
  readonly layer: StageCacheLayer;
  readonly sceneRef: unknown;
  readonly projectRef: unknown;
  readonly paletteKey: string;
  readonly displayMode: string;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpr: number;
  readonly revision: number;
  /** 悬停等高线 / 当前选中对象：影响静态层高亮与图饰排布，必须参与失效 */
  readonly hoverKey?: string;
  readonly selectionKey?: string;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

const identityIds = new WeakMap<object, number>();
let identitySeq = 0;

/** 对象身份戳：同一引用恒定，新引用必变，避免同视口下的旧底图残留 */
function identityOf(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const target = value as object;
  const found = identityIds.get(target);
  if (found !== undefined) return found;
  identitySeq += 1;
  identityIds.set(target, identitySeq);
  return identitySeq;
}

/** 缓存键：场景/工程引用 + 调色板 + 显示模式 + 精确视口 + 修订号，任一变化即失效 */
export function buildStageCacheKey(input: StageCacheKeyInput): string {
  return [
    input.layer,
    identityOf(input.sceneRef),
    identityOf(input.projectRef),
    input.paletteKey,
    input.displayMode,
    round(input.zoom),
    round(input.panX),
    round(input.panY),
    Math.round(input.widthPx),
    Math.round(input.heightPx),
    Math.round(input.dpr * 100) / 100,
    input.revision,
    input.hoverKey ?? '-',
    input.selectionKey ?? '-',
  ].join('|');
}

/** Node / 无 DOM 环境透明降级：直接返回 false，调用方回落到直绘 */
export function isStageCacheSupported(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof CanvasRenderingContext2D === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return typeof probe.getContext === 'function' && probe.getContext('2d') !== null;
  } catch {
    return false;
  }
}

export interface StageSurface {
  readonly image: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

export type SurfaceFactory = (width: number, height: number) => StageSurface | null;

function defaultFactory(width: number, height: number): StageSurface | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx ? { image: canvas, ctx } : null;
}

/**
 * 单槽离屏位图缓存：静态 1–12 层按缓存键复用，命中即 drawImage，
 * 未命中则用同一 `paintScene` 重绘到离屏画布（Canvas/SVG 同源铁律不变）。
 */
export class StageBitmapCache {
  private readonly slots = new Map<StageCacheLayer, { key: string; surface: StageSurface }>();
  private readonly factory: SurfaceFactory;

  constructor(factory: SurfaceFactory = defaultFactory) {
    this.factory = factory;
  }

  /** 命中返回图像；未命中时调用 draw 重绘并缓存；无 DOM 环境返回 null */
  acquire(
    layer: StageCacheLayer,
    key: string,
    widthPx: number,
    heightPx: number,
    dpr: number,
    draw: (backend: RenderBackend) => void,
    createBackend: (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => RenderBackend,
  ): HTMLCanvasElement | null {
    if (!isStageCacheSupported()) return null;
    const hit = this.slots.get(layer);
    if (hit && hit.key === key) return hit.surface.image;
    const scale = Math.max(0.5, dpr);
    const pixelW = Math.max(1, Math.round(widthPx * scale));
    const pixelH = Math.max(1, Math.round(heightPx * scale));
    const surface = hit?.surface ?? this.factory(pixelW, pixelH);
    if (!surface) return null;
    if (surface.image.width !== pixelW || surface.image.height !== pixelH) {
      surface.image.width = pixelW;
      surface.image.height = pixelH;
    }
    surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
    surface.ctx.clearRect(0, 0, pixelW, pixelH);
    draw(createBackend(surface.ctx, widthPx, heightPx, scale));
    this.slots.set(layer, { key, surface });
    return surface.image;
  }

  clear(): void {
    this.slots.clear();
  }

  get size(): number {
    return this.slots.size;
  }
}
