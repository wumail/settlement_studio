import { useCallback, useEffect, useState } from 'react';
import type { CompiledScene } from '../core/compileScene';
import { useStudioStore } from '../store/useStudioStore';
import { compileSceneAsync } from '../worker/sceneCompilerClient';
import { handleStudioHotkey } from './appHotkeys';
import { CanvasStage } from './CanvasStage';
import { GeoImportModal } from './GeoImportModal';
import { EMPTY_TELEMETRY, StatusBar, type CursorTelemetry } from './StatusBar';
import { ToolDock } from './ToolDock';
import { ToolOptionsBar } from './ToolOptionsBar';
import { TopBar } from './TopBar';
import { ZoneFloatingHud } from './ZoneFloatingHud';
import { InspectorTabs } from './inspector/InspectorTabs';

/** 四区测绘工作台：顶栏 48px + 选项栏 36px + 左坞 52px + 画布 + 右检视器 320px + 底栏 30px */
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
      handleStudioHotkey(event);
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
      <ToolOptionsBar />
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
