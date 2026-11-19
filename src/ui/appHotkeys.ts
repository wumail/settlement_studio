import { useStudioStore } from '../store/useStudioStore';
import { clampHardness, clampRadius } from '../store/studioDefaults';
import { resolveToolHotkey } from './toolCatalog';

export interface HotkeyEvent {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: { readonly tagName?: string } | EventTarget | null;
  preventDefault?: () => void;
}

/** 删除当前选中实体（含 V3 水工、核心建筑群、桥梁覆写） */
export function deleteSelection(): void {
  const store = useStudioStore.getState();
  const selection = store.selection;
  if (!selection) return;
  store.mutateProject((draft) => {
    const id = selection.id;
    if (selection.type === 'zone') draft.zones = draft.zones.filter((item) => item.id !== id);
    if (selection.type === 'landmark') draft.landmarks = draft.landmarks.filter((item) => item.id !== id);
    if (selection.type === 'reef') draft.reefs = draft.reefs.filter((item) => item.id !== id);
    if (selection.type === 'road') draft.roads = draft.roads.filter((item) => item.id !== id);
    if (selection.type === 'bridge') draft.bridgeOverrides = draft.bridgeOverrides.filter((item) => item.id !== id);
    if (selection.type === 'weir') draft.weirs = draft.weirs.filter((item) => item.id !== id);
    if (selection.type === 'dock') draft.docks = draft.docks.filter((item) => item.id !== id);
    if (selection.type === 'watermill') draft.watermills = draft.watermills.filter((item) => item.id !== id);
    if (selection.type === 'structure') draft.structures = draft.structures.filter((item) => item.id !== id);
    if (selection.type === 'canal') draft.canals = draft.canals.filter((item) => item.id !== id);
    if (selection.type === 'river') draft.rivers = draft.rivers.filter((item) => item.id !== id);
    if (selection.type === 'waterBody') draft.waterBodies = draft.waterBodies.filter((item) => item.id !== id);
    if (selection.type === 'ford') draft.fords = draft.fords.filter((item) => item.id !== id);
    if (selection.type === 'terrainShape') draft.terrain.shapes = draft.terrain.shapes.filter((item) => item.id !== id);
  });
  store.setSelection(null);
}

/**
 * 全局快捷键：工具组轮换 / 单键直达 / 笔刷半径与硬度 / 删除 / 撤销重做。
 * 返回动作名便于无头测试断言，未命中返回 null。
 */
export function handleStudioHotkey(event: HotkeyEvent): string | null {
  const tag = (event.target as { readonly tagName?: string } | null)?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  const store = useStudioStore.getState();
  const meta = Boolean(event.metaKey || event.ctrlKey);
  const key = event.key;
  if (meta && key.toLowerCase() === 'z') {
    event.preventDefault?.();
    if (event.shiftKey) store.redoProject();
    else store.undoProject();
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (meta && key.toLowerCase() === 'y') {
    event.preventDefault?.();
    store.redoProject();
    return 'redo';
  }
  if (key === '[' || key === ']') {
    event.preventDefault?.();
    const grow = key === ']';
    if (event.shiftKey) {
      const next = clampHardness(store.brush.hardness + (grow ? 0.1 : -0.1));
      store.updateBrush({ hardness: next });
      return 'hardness';
    }
    const next = clampRadius(store.brush.radiusM * (grow ? 1.18 : 0.85));
    if (store.activeTool === 'tree_brush') store.updateTreeBrush({ radiusM: next });
    else store.updateBrush({ radiusM: next });
    return 'radius';
  }
  const tool = resolveToolHotkey(key, {
    activeTool: store.activeTool,
    lastToolInGroup: store.lastToolInGroup,
    shift: Boolean(event.shiftKey),
  });
  if (tool) {
    store.setActiveTool(tool);
    return `tool:${tool}`;
  }
  if (key.toUpperCase() === 'R') {
    if (store.selection?.type === 'zone') store.rerollZone(store.selection.id);
    return 'reroll';
  }
  if (key === 'Delete' || key === 'Backspace') {
    event.preventDefault?.();
    deleteSelection();
    return 'delete';
  }
  if (key === 'Escape') {
    store.setSelection(null);
    return 'escape';
  }
  return null;
}
