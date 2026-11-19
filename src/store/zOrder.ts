import type { SelectionTarget } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';

export type ZMode = 'top' | 'bottom' | 'up' | 'down';

export interface ZItem {
  id: string;
  zIndex: number;
}

const STEP = 10;
const LIMIT = 480;

/** 选中对象 → 它所属的可调层数组（不支持的对象返回 null） */
export function zListOf(project: TownProject, selection: SelectionTarget): ZItem[] | null {
  switch (selection.type) {
    case 'zone': return project.zones;
    case 'river': return project.rivers;
    case 'waterBody': return project.waterBodies;
    case 'canal': return project.canals;
    case 'reef': return project.reefs;
    case 'ford': return project.fords;
    case 'road': return project.roads;
    case 'weir': return project.weirs;
    case 'dock': return project.docks;
    case 'watermill': return project.watermills;
    case 'structure': return project.structures;
    case 'bridge': return project.bridgeOverrides;
    default: return null;
  }
}

/** 在所属数组内调整层级：置顶/置底按当前极值 ±10，上移/下移按 ±10 步进 */
export function applyZ(project: TownProject, selection: SelectionTarget, mode: ZMode): boolean {
  const list = zListOf(project, selection);
  if (!list || list.length === 0) return false;
  const item = list.find((entry) => entry.id === selection.id);
  if (!item) return false;
  const values = list.map((entry) => entry.zIndex ?? 0);
  const current = item.zIndex ?? 0;
  const next =
    mode === 'top' ? Math.max(...values) + STEP
      : mode === 'bottom' ? Math.min(...values) - STEP
        : mode === 'up' ? current + STEP
          : current - STEP;
  const clamped = Math.max(-LIMIT, Math.min(LIMIT, next));
  if (clamped === current) return false;
  item.zIndex = clamped;
  return true;
}

export function zIndexOf(project: TownProject, selection: SelectionTarget | null): number | null {
  if (!selection) return null;
  const list = zListOf(project, selection);
  const item = list?.find((entry) => entry.id === selection.id);
  return item ? item.zIndex ?? 0 : null;
}
