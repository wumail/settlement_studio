import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { normalizeProject, type TownProject } from '../schema/project.schema';
import { BUILTIN_PRESETS, type PresetKey, createPresetProject } from '../schema/presets';
import { type CompiledScene, compileSettlementScene } from '../core/compileScene';
import { renderSceneToSvgString } from '../renderer/exportUtils';
import { buildSpatialRadar, querySpatialPoint } from './spatialBrief';
import type { SpatialBrief, SpatialPointQuery } from './spatialTypes';
import { type AiOpInput, applySemanticOps, GeoBootstrapPayloadSchema } from './semanticOps';
import { type PreviewRenderOptions, type PreviewRenderResult, renderPreviewPng } from './previewRaster';

/** 3 套基准工程按 basename 拦截；名单从预设清单派生，AI 层不硬编码世界观文件名 */
export const PROTECTED_FILENAMES: ReadonlySet<string> = new Set(
  BUILTIN_PRESETS.filter((preset) => preset.key !== 'blank').map((preset) => preset.filename),
);

export interface AtomicSaveOptions {
  readonly allowOverwriteProtected?: boolean;
}

/** 同目录临时文件 + rename 原子替换；受保护基准工程默认拒绝覆盖 */
export function saveProjectAtomic(
  filePath: string,
  project: TownProject,
  options: AtomicSaveOptions = {},
): number {
  const name = basename(filePath);
  if (PROTECTED_FILENAMES.has(name) && options.allowOverwriteProtected !== true) {
    throw new Error(`拒绝覆盖受保护基准工程 ${name}；如确需覆盖请传 allowOverwriteProtected: true`);
  }
  return writeFileAtomic(filePath, `${JSON.stringify(project, null, 2)}\n`);
}

/** 任意文本/二进制产物原子落盘（导出 SVG/PNG 复用） */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): number {
  const target = resolve(filePath);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (typeof data === 'string') writeFileSync(tmp, data, 'utf8');
    else writeFileSync(tmp, data);
    renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // 临时文件可能尚未生成
    }
    throw error;
  }
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

export interface SessionOpenOptions {
  readonly path?: string;
  readonly preset?: PresetKey;
  readonly worldSizeM?: number;
  readonly name?: string;
  readonly subtitle?: string;
  readonly geoBootstrap?: z.input<typeof GeoBootstrapPayloadSchema>;
}

export interface SessionApplyResult {
  readonly applied: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly brief: SpatialBrief;
}

export interface SessionSaveOptions {
  readonly path?: string;
  readonly allowOverwriteProtected?: boolean;
  readonly exportSvgPath?: string;
  readonly exportPngPath?: string;
  readonly exportMode?: 'standard' | 'guided' | 'clean';
  readonly exportWidthPx?: number;
}

export interface SessionSaveResult {
  readonly savedPath: string;
  readonly bytes: number;
  readonly exported: { readonly svg?: string; readonly png?: string };
}

const HISTORY_LIMIT = 20;

/**
 * 无头共享会话：内存维护工程 / 编译场景 / 来源路径 / 20 步撤销栈。
 * CLI 与 MCP 的所有操作都只经过本类，保证两端行为逐字一致。
 */
export class StudioSession {
  private state: TownProject;
  private compiled: CompiledScene;
  private path: string | null;
  private history: TownProject[] = [];

  constructor(project: TownProject = createPresetProject('blank'), sourcePath: string | null = null) {
    this.state = normalizeProject(project);
    this.compiled = compileSettlementScene(this.state);
    this.path = sourcePath;
  }

  get project(): TownProject {
    return this.state;
  }

  get scene(): CompiledScene {
    return this.compiled;
  }

  get sourcePath(): string | null {
    return this.path;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** 打开磁盘工程或内置预设；只触发一次 normalize + compile */
  open(options: SessionOpenOptions = {}): SpatialBrief {
    let base: TownProject;
    if (options.path !== undefined) {
      const full = resolve(options.path);
      base = normalizeProject(JSON.parse(readFileSync(full, 'utf8')));
      this.path = full;
    } else {
      base = createPresetProject(options.preset ?? 'blank');
      this.path = null;
    }
    const ops: AiOpInput[] = [];
    if (options.name !== undefined || options.subtitle !== undefined || options.worldSizeM !== undefined) {
      ops.push({
        op: 'set_meta',
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.subtitle !== undefined ? { subtitle: options.subtitle } : {}),
        ...(options.worldSizeM !== undefined ? { worldSizeM: options.worldSizeM } : {}),
      });
    }
    if (options.geoBootstrap !== undefined) {
      ops.push({ op: 'apply_geo_bootstrap', payload: options.geoBootstrap });
    }
    if (ops.length > 0) {
      const result = applySemanticOps(base, ops);
      this.state = result.project;
      this.compiled = result.scene;
      this.history = [];
      return result.brief;
    }
    this.state = normalizeProject(base);
    this.compiled = compileSettlementScene(this.state);
    this.history = [];
    return buildSpatialRadar(this.state, this.compiled);
  }

  inspect(): SpatialBrief {
    return buildSpatialRadar(this.state, this.compiled);
  }

  queryPoint(x: number, y: number): SpatialPointQuery {
    return querySpatialPoint(this.state, this.compiled, x, y);
  }

  /** 语义操作：成功后才入历史栈；失败保持原工程不变 */
  applyOps(ops: ReadonlyArray<AiOpInput>): SessionApplyResult {
    const result = applySemanticOps(this.state, ops);
    this.history.push(this.state);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.state = result.project;
    this.compiled = result.scene;
    return { applied: result.applied, warnings: result.warnings, brief: result.brief };
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.state = normalizeProject(previous);
    this.compiled = compileSettlementScene(this.state);
    return true;
  }

  renderPreview(options: PreviewRenderOptions = {}): PreviewRenderResult {
    return renderPreviewPng(this.state, this.compiled, options);
  }

  /** 先原子保存工程，再按需导出 SVG/PNG（导出永远不叠 AI 网格） */
  save(options: SessionSaveOptions = {}): SessionSaveResult {
    const target = resolve(options.path ?? this.path ?? '');
    if (!options.path && !this.path) throw new Error('save: 缺少目标路径（工程从预设创建时请显式传 path）');
    const bytes = saveProjectAtomic(target, this.state, {
      allowOverwriteProtected: options.allowOverwriteProtected,
    });
    this.path = target;
    const exported: { svg?: string; png?: string } = {};
    if (options.exportSvgPath !== undefined) {
      const mode = options.exportMode ?? 'standard';
      const svg = renderSceneToSvgString(this.state, this.compiled, {
        mode: mode === 'clean' ? 'clean' : 'full',
        displayMode: mode === 'guided' ? 'guided' : 'standard',
        basePx: options.exportWidthPx ?? 2000,
      });
      writeFileAtomic(options.exportSvgPath, svg);
      exported.svg = resolve(options.exportSvgPath);
    }
    if (options.exportPngPath !== undefined) {
      const preview = renderPreviewPng(this.state, this.compiled, {
        mode: options.exportMode ?? 'standard',
        widthPx: options.exportWidthPx ?? 2000,
        gridOverlay: false,
      });
      writeFileAtomic(options.exportPngPath, preview.pngBuffer);
      exported.png = resolve(options.exportPngPath);
    }
    return { savedPath: target, bytes, exported };
  }
}
