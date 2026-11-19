import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BUILTIN_PRESETS, type PresetKey } from '../schema/presets';
import { computePolygonAreaSigned } from '../core/math/polygon';
import { StudioSession } from '../ai/session';
import { AiOpSchema, GeoBootstrapPayloadSchema } from '../ai/semanticOps';
import type { PreviewRenderOptions } from '../ai/previewRaster';

/** 预设按内置清单动态校验（与 CLI 同规则），不在 MCP 层硬编码任何预设名 */
function resolvePreset(raw: string | undefined): PresetKey {
  const key = raw ?? 'blank';
  const found = BUILTIN_PRESETS.find((item) => item.key === key);
  if (!found) {
    throw new Error(`未知预设 "${key}"；可用: ${BUILTIN_PRESETS.map((item) => item.key).join('|')}`);
  }
  return found.key;
}

const CropSchema = z.union([
  z.object({ zoneId: z.string(), padM: z.number().min(0).max(2000).optional() }).strict(),
  z.object({ entityId: z.string(), radiusM: z.number().min(20).max(2000).optional() }).strict(),
  z.object({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) }).strict(),
]);

const OPS_GUIDE = [
  '# AiOp 语法速查',
  '',
  '每次 tool 调用传 `{ "ops": [ ... ] }`，数组按序执行，同 id 覆盖更新。',
  '所有 op 都以 `op` 字段区分，其余字段按下列契约；坐标单位为米（0..worldSizeM）。',
  '',
  '| op | 关键字段 |',
  '| --- | --- |',
  '| set_meta | name / subtitle / worldSizeM / geoAnchor |',
  '| set_terrain | TerrainConfig 任意子集（不含 shapes） |',
  '| upsert_terrain_shape | 完整 hill / basin / ridge / valley / scarp |',
  '| apply_geo_bootstrap | payload: GeoBootstrapPayload, importRivers?, clearExistingRivers? |',
  '| upsert_river | id, points, widthStartM?, widthEndM?, widthsM? |',
  '| upsert_water_body | id, kind, points |',
  '| upsert_canal | id, points, style?, widthM? |',
  '| snap_weir | id, riverId, t, overhangM? |',
  '| snap_dock | id, targetId, targetKind?, t, bank?, kind? |',
  '| snap_watermill | id, targetId, targetKind?, t, bank? |',
  '| place_zone | id, contentType, points? / relative{anchor,shape,areaHa} |',
  '| connect_road | id, from, to, via?, curveOffsetM? |',
  '| upsert_road | id, points, tier?, widthM? |',
  '| upsert_structure | id, x/y 或 anchor, kind?, widthM?, depthM? |',
  '| upsert_bridge_override | id, style, bridgeId? 或 x/y |',
  '| upsert_landmark | id, label, x/y 或 anchor, glyphType? |',
  '| scatter_trees | anchor, radiusM, count, seed? |',
  '| remove_entity | collection, id |',
  '| reroll_zone | zoneId, seed? |',
  '| set_palette | themeId?, overrides? |',
  '| set_legend | displayMode?, position?, furnitureOpacity?, labelOpacity? |',
  '',
  '锚点 `anchor` 支持：`[x,y]`、`{riverId,t,bank,offsetM}`、`{zoneId,side,offsetM}`、',
  '`{entityId}`、`{edge,ratio}`。建议先调 `studio_inspect` 读雷达与 warnings，再用 `studio_query_point` 精调。',
  '',
  '示例：`[{ "op":"place_zone","id":"market_1","contentType":"market","relative":{"anchor":[600,600],"shape":"organic","areaHa":0.8} }]`',
].join('\n');

let presetCache: string | null = null;

/** 内置预设的尺度 / 选区 / 密度摘要（只读、按需求值、进程内缓存） */
function presetSummary(): string {
  if (presetCache !== null) return presetCache;
  const rows = BUILTIN_PRESETS.map((preset) => {
    const project = preset.build();
    const types: Record<string, number> = {};
    let areaHa = 0;
    let density = 0;
    for (const zone of project.zones) {
      types[zone.contentType] = (types[zone.contentType] ?? 0) + 1;
      areaHa += Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
      density += zone.density;
    }
    return {
      key: preset.key,
      worldSizeM: project.meta.worldSizeM,
      zoneCount: project.zones.length,
      contentTypes: types,
      totalZoneAreaHa: Number(areaHa.toFixed(2)),
      meanDensity: project.zones.length > 0 ? Number((density / project.zones.length).toFixed(3)) : 0,
      riverCount: project.rivers.length,
      landmarkCount: project.landmarks.length,
    };
  });
  presetCache = JSON.stringify(rows, null, 2);
  return presetCache;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** 6 工具 + 2 只读资源的轻量 MCP 服务；测试可直接传入内存会话 */
export function createStudioMcpServer(session: StudioSession = new StudioSession()): McpServer {
  const server = new McpServer({ name: 'settlement-studio', version: '4.0.0' });

  server.registerTool('studio_open', {
    title: '打开/新建工程',
    description: '按路径或预设打开工程，可覆盖图幅/标题并注入 GeoBootstrapPayload；返回 SpatialBrief。',
    inputSchema: {
      path: z.string().optional(),
      preset: z.string().optional(),
      worldSizeM: z.number().min(600).max(8000).optional(),
      name: z.string().optional(),
      subtitle: z.string().optional(),
      geoBootstrap: GeoBootstrapPayloadSchema.optional(),
    },
  }, async (args) => json(session.open({ ...args, preset: resolvePreset(args.preset) })));

  server.registerTool('studio_inspect', {
    title: '读取空间雷达',
    description: '返回当前工程的 8×8 选址雷达、河道锚点、选区诊断与 warnings。',
    inputSchema: {},
  }, async () => json(session.inspect()));

  server.registerTool('studio_query_point', {
    title: '点位查询',
    description: '查询任意世界坐标的海拔、坡度、落水/禁区判定与最近河渠投影。',
    inputSchema: { x: z.number(), y: z.number() },
  }, async (args) => json(session.queryPoint(args.x, args.y)));

  server.registerTool('studio_apply_ops', {
    title: '应用语义操作',
    description: '严格校验并按序应用 AiOp 数组，返回 applied / warnings / brief。',
    inputSchema: { ops: z.array(AiOpSchema) },
  }, async (args) => json(session.applyOps(args.ops)));

  server.registerTool('studio_render_preview', {
    title: '多模态视觉自检',
    description: '生成全图或局部特写 PNG；gridOverlay=true 时叠加 AI 坐标标尺网。',
    inputSchema: {
      mode: z.enum(['standard', 'guided', 'clean']).optional(),
      widthPx: z.number().min(400).max(2400).optional(),
      gridOverlay: z.boolean().optional(),
      crop: CropSchema.optional(),
    },
  }, async (args) => {
    const options: PreviewRenderOptions = {
      ...(args.mode !== undefined ? { mode: args.mode } : {}),
      ...(args.widthPx !== undefined ? { widthPx: args.widthPx } : {}),
      ...(args.gridOverlay !== undefined ? { gridOverlay: args.gridOverlay } : {}),
      ...(args.crop !== undefined ? { crop: args.crop } : {}),
    };
    const preview = session.renderPreview(options);
    const meta = {
      widthPx: preview.widthPx,
      heightPx: preview.heightPx,
      worldBounds: preview.worldBounds,
      gridOverlay: args.gridOverlay === true,
    };
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(meta) },
        {
          type: 'image' as const,
          data: Buffer.from(preview.pngBuffer).toString('base64'),
          mimeType: 'image/png',
        },
      ],
    };
  });

  server.registerTool('studio_save', {
    title: '原子保存与导出',
    description: '原子保存工程 JSON，可按需导出 SVG/PNG；默认拦截 3 套受保护基准工程文件名。',
    inputSchema: {
      path: z.string().optional(),
      allowOverwriteProtected: z.boolean().optional(),
      exportSvgPath: z.string().optional(),
      exportPngPath: z.string().optional(),
      exportMode: z.enum(['standard', 'guided', 'clean']).optional(),
    },
  }, async (args) => json(session.save(args)));

  server.registerResource('studio-ops-schema', 'studio://schema/ops', {
    title: 'AiOp 语法速查',
    description: '21 种语义操作的字段速查与示例',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: OPS_GUIDE }],
  }));

  server.registerResource('studio-presets', 'studio://examples/presets', {
    title: '内置预设尺度摘要',
    description: '预设图幅、选区类型/面积/密度与河流地标计数',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: presetSummary() }],
  }));

  return server;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  const server = createStudioMcpServer();
  await server.connect(new StdioServerTransport());
}
