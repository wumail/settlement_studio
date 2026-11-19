import { useCallback, useEffect, useState } from 'react';
import type { ToolId } from '../schema/geometry.types';
import type { CompiledScene } from '../core/compileScene';
import { useStudioStore } from '../store/useStudioStore';
import { compileSceneAsync } from '../worker/sceneCompilerClient';
import { CanvasStage } from './CanvasStage';
import { GeoImportModal } from './GeoImportModal';
import { EMPTY_TELEMETRY, StatusBar, type CursorTelemetry } from './StatusBar';
import { ToolDock } from './ToolDock';
import { TopBar } from './TopBar';
import { ZoneFloatingHud } from './ZoneFloatingHud';
import { InspectorTabs } from './inspector/InspectorTabs';

const KEY_TO_TOOL: Readonly<Record<string, ToolId>> = {
  V: 'select',
  C: 'contour_drag',
  B: 'sculpt_brush',
  H: 'add_hill',
  G: 'add_ridge',
  W: 'draw_river',
  L: 'draw_water_area',
  K: 'place_reef',
  D: 'draw_road',
  Z: 'draw_zone',
  M: 'place_landmark',
  U: 'measure',
};

function deleteSelection(): void {
  const store = useStudioStore.getState();
  const selection = store.selection;
  if (!selection) return;
  store.mutateProject((draft) => {
    const id = selection.id;
    if (selection.type === 'zone') draft.zones = draft.zones.filter((item) => item.id !== id);
    if (selection.type === 'landmark') draft.landmarks = draft.landmarks.filter((item) => item.id !== id);
    if (selection.type === 'reef') draft.reefs = draft.reefs.filter((item) => item.id !== id);
    if (selection.type === 'road') draft.roads = draft.roads.filter((item) => item.id !== id);
    if (selection.type === 'canal') draft.canals = draft.canals.filter((item) => item.id !== id);
    if (selection.type === 'river') draft.rivers = draft.rivers.filter((item) => item.id !== id);
    if (selection.type === 'waterBody') draft.waterBodies = draft.waterBodies.filter((item) => item.id !== id);
    if (selection.type === 'ford') draft.fords = draft.fords.filter((item) => item.id !== id);
    if (selection.type === 'terrainShape') draft.terrain.shapes = draft.terrain.shapes.filter((item) => item.id !== id);
  });
  store.setSelection(null);
}

/** 四区测绘工作台：顶栏 48px + 左坞 56px + 中央画布 + 右检视器 320px + 底栏 30px */
export function App() {
  const [telemetry, setTelemetry] = useState<CursorTelemetry>(EMPTY_TELEMETRY);
  const geoModalOpen = useStudioStore((state) => state.geoModalOpen);
  const toast = useStudioStore((state) => state.toastMessage);
  const onCursorSample = useCallback((sample: CursorTelemetry) => setTelemetry(sample), []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ping')
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const payload = data as { ok?: boolean; terraxDataAvailable?: boolean } | null;
        useStudioStore.getState().setBackendStatus(Boolean(payload?.ok), Boolean(payload?.terraxDataAvailable));
      })
      .catch(() => {
        if (!cancelled) useStudioStore.getState().setBackendStatus(false, false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const store = useStudioStore.getState();
    store.registerSceneCompiler(async (project, zoneId, prevScene, explicitSeed) => {
      const outcome = await compileSceneAsync(project, zoneId, (prevScene as CompiledScene | null) ?? undefined, explicitSeed);
      return outcome.scene ? { scene: outcome.scene, updatedSeed: outcome.updatedSeed, stale: outcome.stale } : null;
    });
    if (store.project.zones.length === 0) store.loadPreset('losrumura');
    return () => {
      useStudioStore.getState().registerSceneCompiler(null);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const store = useStudioStore.getState();
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redoProject();
        else store.undoProject();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redoProject();
        return;
      }
      const tool = KEY_TO_TOOL[event.key.toUpperCase()];
      if (tool) {
        store.setActiveTool(tool);
        return;
      }
      if (event.key.toUpperCase() === 'R') {
        if (store.selection?.type === 'zone') store.rerollZone(store.selection.id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Escape') store.setSelection(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => useStudioStore.getState().showToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-desk text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolDock />
        <main className="relative min-w-0 flex-1 overflow-hidden bg-desk">
          <CanvasStage onCursorSample={onCursorSample} />
          <ZoneFloatingHud />
          {toast ? (
            <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-md border border-brass bg-panel/95 px-3 py-1.5 text-[11px] text-ink shadow-md">
              {toast}
            </div>
          ) : null}
        </main>
        <aside className="w-80 shrink-0 overflow-hidden border-l border-brass bg-panel">
          <InspectorTabs />
        </aside>
      </div>
      <StatusBar telemetry={telemetry} />
      {geoModalOpen ? <GeoImportModal /> : null}
    </div>
  );
}
