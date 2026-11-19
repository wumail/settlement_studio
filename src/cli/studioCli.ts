import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BUILTIN_PRESETS } from '../schema/presets';
import { saveProjectAtomic, StudioSession, writeFileAtomic } from '../ai/session';
import { type PreviewRenderOptions, renderPreviewPng } from '../ai/previewRaster';
import { GeoBootstrapPayloadSchema, parseAiOps } from '../ai/semanticOps';
import { renderSceneToSvgString } from '../renderer/exportUtils';
import {
  flagBool,
  flagNumber,
  flagString,
  parseArgv,
  required,
  requiredNumber,
  requiredPositional,
  type ParsedArgs,
} from './cliArgs';

type Mode = 'standard' | 'guided' | 'clean';

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseMode(raw: string | undefined): Mode {
  const mode = raw ?? 'standard';
  if (mode !== 'standard' && mode !== 'guided' && mode !== 'clean') {
    throw new Error(`--mode 只能是 standard|guided|clean，收到 "${mode}"`);
  }
  return mode;
}

function readJson(file: string): unknown {
  if (file === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

function openSession(path: string): StudioSession {
  const session = new StudioSession();
  session.open({ path });
  return session;
}

function parseCrop(args: ParsedArgs): PreviewRenderOptions['crop'] | undefined {
  const zone = flagString(args, 'crop-zone');
  const entity = flagString(args, 'crop-entity');
  const bbox = flagString(args, 'crop-bbox');
  if (zone !== undefined) return { zoneId: zone };
  if (entity !== undefined) return { entityId: entity };
  if (bbox === undefined) return undefined;
  const parts = bbox.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error('--crop-bbox 需要 x0,y0,x1,y1 四个数字');
  }
  const [x0, y0, x1, y1] = parts as [number, number, number, number];
  return { bbox: [x0, y0, x1, y1] };
}

function commandInit(args: ParsedArgs): unknown {
  const out = required(args, 'out');
  const rawPreset = flagString(args, 'preset') ?? 'blank';
  const preset = BUILTIN_PRESETS.find((item) => item.key === rawPreset)?.key;
  if (!preset) {
    throw new Error(`未知预设 "${rawPreset}"；可用: ${BUILTIN_PRESETS.map((item) => item.key).join('|')}`);
  }
  const geoFile = flagString(args, 'geo-file');
  const geoBootstrap = geoFile === undefined
    ? undefined
    : GeoBootstrapPayloadSchema.parse(JSON.parse(readFileSync(resolve(geoFile), 'utf8')));
  const worldSize = flagNumber(args, 'world-size');
  const name = flagString(args, 'name');
  const subtitle = flagString(args, 'subtitle');
  const session = new StudioSession();
  const brief = session.open({
    preset,
    ...(worldSize !== undefined ? { worldSizeM: worldSize } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(geoBootstrap !== undefined ? { geoBootstrap } : {}),
  });
  const bytes = saveProjectAtomic(out, session.project);
  return { ok: true, path: resolve(out), bytes, brief };
}

function commandInspect(args: ParsedArgs): unknown {
  const session = openSession(requiredPositional(args, 0, 'path'));
  return { ok: true, brief: session.inspect() };
}

function commandQuery(args: ParsedArgs): unknown {
  const session = openSession(requiredPositional(args, 0, 'path'));
  return { ok: true, query: session.queryPoint(requiredNumber(args, 'x'), requiredNumber(args, 'y')) };
}

function commandApply(args: ParsedArgs): unknown {
  const path = requiredPositional(args, 0, 'path');
  const ops = parseAiOps(readJson(required(args, 'ops')));
  const session = openSession(path);
  const result = session.applyOps(ops);
  const saved = session.save({
    path: flagString(args, 'out') ?? path,
    allowOverwriteProtected: flagBool(args, 'allow-overwrite-protected'),
  });
  return {
    ok: true,
    savedPath: saved.savedPath,
    bytes: saved.bytes,
    applied: result.applied,
    warnings: result.warnings,
    brief: result.brief,
  };
}

function commandRender(args: ParsedArgs): unknown {
  const out = required(args, 'out');
  const mode = parseMode(flagString(args, 'mode'));
  const gridOverlay = flagBool(args, 'grid');
  const crop = parseCrop(args);
  const session = openSession(requiredPositional(args, 0, 'path'));
  const preview = session.renderPreview({
    mode,
    widthPx: flagNumber(args, 'width') ?? 1400,
    gridOverlay,
    ...(crop !== undefined ? { crop } : {}),
  });
  writeFileAtomic(out, preview.pngBuffer);
  const svgOut = flagString(args, 'svg-out');
  if (svgOut !== undefined) writeFileAtomic(svgOut, preview.svg);
  return {
    ok: true,
    out: resolve(out),
    ...(svgOut !== undefined ? { svgOut: resolve(svgOut) } : {}),
    widthPx: preview.widthPx,
    heightPx: preview.heightPx,
    worldBounds: preview.worldBounds,
    gridOverlay,
  };
}

function commandExport(args: ParsedArgs): unknown {
  const path = requiredPositional(args, 0, 'path');
  const svgOut = required(args, 'out-svg');
  const pngOut = flagString(args, 'out-png');
  const mode = parseMode(flagString(args, 'mode'));
  const width = flagNumber(args, 'width') ?? 2000;
  const session = openSession(path);
  const svg = renderSceneToSvgString(session.project, session.scene, {
    mode: mode === 'clean' ? 'clean' : 'full',
    displayMode: mode === 'guided' ? 'guided' : 'standard',
    basePx: width,
  });
  writeFileAtomic(svgOut, svg);
  let pngPath: string | undefined;
  if (pngOut !== undefined) {
    // 正式导出严格不带 AI 坐标网
    const preview = renderPreviewPng(session.project, session.scene, {
      mode,
      widthPx: width,
      gridOverlay: false,
    });
    writeFileAtomic(pngOut, preview.pngBuffer);
    pngPath = resolve(pngOut);
  }
  return {
    ok: true,
    svgOut: resolve(svgOut),
    ...(pngPath !== undefined ? { pngOut: pngPath } : {}),
    widthPx: width,
    mode,
    gridOverlay: false,
  };
}

export function runCli(argv: ReadonlyArray<string>): unknown {
  const args = parseArgv(argv);
  switch (args.command) {
    case 'init':
      return commandInit(args);
    case 'inspect':
      return commandInspect(args);
    case 'query':
      return commandQuery(args);
    case 'apply':
      return commandApply(args);
    case 'render':
      return commandRender(args);
    case 'export':
      return commandExport(args);
    default:
      throw new Error('用法: studio <init|inspect|query|apply|render|export> ...');
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  try {
    output(runCli(process.argv.slice(2)));
  } catch (error) {
    output({ ok: false, error: errorMessage(error) });
    process.exit(1);
  }
}
