import type { WritableDraft } from 'immer';
import type { TownProject } from '../schema/project.schema';
import { hashSeed, createRng } from '../core/math/rng';

export type MutableProject = WritableDraft<TownProject>;

/** 同 id 覆盖、无则新增（所有 upsert 操作的唯一写入口） */
export function upsertWith<T extends { id: string }>(
  list: T[],
  id: string,
  create: () => T,
  patch: (target: T) => void,
): void {
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) {
    const target = list[index];
    if (target) patch(target);
    return;
  }
  list.push(create());
}

/** 只写入显式提供的字段，绝不把 undefined 覆盖到既有实体上 */
export function applyDefined(target: object, source: object): void {
  const sink = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && key !== 'op' && key !== 'id') sink[key] = value;
  }
}

export function withoutOp<T extends { op: string }>(op: T): Omit<T, 'op'> {
  const { op: _op, ...rest } = op;
  return rest;
}

export function tierWidth(tier: 'highway' | 'street' | 'lane' | undefined): number {
  if (tier === 'highway') return 14;
  if (tier === 'lane') return 5;
  return 9;
}

export function clampWorld(value: number): number {
  return Math.max(600, Math.min(8000, value));
}

export const COLLECTION_KEYS = [
  'rivers', 'waterBodies', 'canals', 'reefs', 'roads', 'fords', 'zones', 'landmarks',
  'weirs', 'docks', 'watermills', 'structures', 'bridgeOverrides', 'paintedTrees',
] as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** 14 类实体 + terrain.shapes 的统一删除寻址 */
export function removeById(project: MutableProject, collection: CollectionKey | 'terrainShapes', id: string): boolean {
  if (collection === 'terrainShapes') {
    const index = project.terrain.shapes.findIndex((item) => item.id === id);
    if (index < 0) return false;
    project.terrain.shapes.splice(index, 1);
    return true;
  }
  const list = project[collection];
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** 确定性撒树：返回 id 前缀与条目，同参数重复执行可先清后插，保持幂等 */
export function scatterTreePoints(
  anchor: readonly [number, number],
  radiusM: number,
  count: number,
  seed: number,
  worldSizeM: number,
  minR = 3.6,
  maxR = 8.2,
  kind: 'woodland' | 'garden' | 'plaza' = 'woodland',
): { prefix: string; trees: Array<{ id: string; x: number; y: number; r: number; kind: 'woodland' | 'garden' | 'plaza' }> } {
  const key = hashSeed(
    `ai-trees:${seed}:${anchor[0].toFixed(2)}:${anchor[1].toFixed(2)}:${radiusM.toFixed(1)}:${count}`,
  );
  const prefix = `pt_ai_${key}_`;
  const rng = createRng(key || 1);
  const trees: Array<{ id: string; x: number; y: number; r: number; kind: 'woodland' | 'garden' | 'plaza' }> = [];
  const maxTrees = Math.max(1, Math.min(600, Math.floor(count)));
  for (let i = 0; i < maxTrees; i += 1) {
    const radius = radiusM * Math.sqrt(rng());
    const angle = rng() * Math.PI * 2;
    const x = Math.max(5, Math.min(worldSizeM - 5, anchor[0] + Math.cos(angle) * radius));
    const y = Math.max(5, Math.min(worldSizeM - 5, anchor[1] + Math.sin(angle) * radius));
    trees.push({
      id: `${prefix}${i}`,
      x,
      y,
      r: Math.max(2.5, Math.min(16, minR + (maxR - minR) * rng())),
      kind,
    });
  }
  return { prefix, trees };
}
