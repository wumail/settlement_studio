import { produce } from 'immer';
import { z } from 'zod';
import { normalizeProject, type TownProject } from '../schema/project.schema';
import { type CompiledScene, compileSettlementScene } from '../core/compileScene';
import { AiOpSchema, type AiOp } from './opSchemas';

export { AiOpSchema, GeoBootstrapPayloadSchema } from './opSchemas';
export type { AiOp } from './opSchemas';
import { applyProjectOp } from './opProjectHandlers';
import { applyHydroOp } from './opHydroHandlers';
import { buildSpatialRadar } from './spatialBrief';
import type { SpatialBrief } from './spatialTypes';

function isProjectOp(op: AiOp): boolean {
  return op.op === 'set_meta'
    || op.op === 'set_terrain'
    || op.op === 'upsert_terrain_shape'
    || op.op === 'apply_geo_bootstrap'
    || op.op === 'upsert_river'
    || op.op === 'upsert_water_body'
    || op.op === 'upsert_canal'
    || op.op === 'place_zone'
    || op.op === 'connect_road'
    || op.op === 'upsert_road'
    || op.op === 'upsert_structure'
    || op.op === 'upsert_landmark'
    || op.op === 'scatter_trees';
}

/** 外部输入类型：允许省略所有带默认值的字段 */
export type AiOpInput = z.input<typeof AiOpSchema>;

export interface ApplyOpsResult {
  readonly project: TownProject;
  readonly scene: CompiledScene;
  readonly applied: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly brief: SpatialBrief;
}

/** 兼容数组与 { ops: [...] } 两种输入写法（CLI 与 MCP 共用） */
export function parseAiOps(raw: unknown): AiOp[] {
  if (Array.isArray(raw)) return z.array(AiOpSchema).parse(raw);
  if (typeof raw === 'object' && raw !== null && 'ops' in raw) {
    return z.array(AiOpSchema).parse((raw as { ops: unknown }).ops);
  }
  throw new Error('ops 必须是 AiOp[] 或 { "ops": AiOp[] }');
}

/**
 * 语义操作总装：Zod 严格校验 → 同 id 幂等 upsert → 末尾统一 normalize + compile。
 * 仅在存在 bridgeId 覆写时才编译一次“基准桥位”，几何吸附一律走工程契约，避免逐 op 重编。
 */
export function applySemanticOps(project: TownProject, ops: ReadonlyArray<AiOpInput>): ApplyOpsResult {
  const parsed = z.array(AiOpSchema).parse(ops);
  const input = normalizeProject(project);
  const needsBridgeScene = parsed.some((op) => op.op === 'upsert_bridge_override' && op.bridgeId);
  const seedScene = needsBridgeScene ? compileSettlementScene(input) : null;
  const applied: string[] = [];
  const next = produce(input, (draft) => {
    for (const op of parsed) {
      applied.push(isProjectOp(op)
        ? applyProjectOp(draft, op, seedScene)
        : applyHydroOp(draft, op, seedScene));
    }
  });
  const normalized = normalizeProject(next);
  const scene = compileSettlementScene(normalized);
  const brief = buildSpatialRadar(normalized, scene);
  return {
    project: normalized,
    scene,
    applied,
    warnings: brief.warnings,
    brief,
  };
}
