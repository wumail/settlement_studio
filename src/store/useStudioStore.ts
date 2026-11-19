import { type TemporalState, type ZundoOptions, temporal } from 'zundo';
import { create, useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { hashSeed } from '../core/math/rng';
import type { CompiledSceneBase } from '../schema/geometry.types';
import type { LegendConfig } from '../schema/legend.schema';
import { type PresetKey, createBlankProject, createPresetProject } from '../schema/presets';
import { type TownProject, normalizeProject } from '../schema/project.schema';
import {
  INITIAL_BRUSH,
  INITIAL_HYDRAULIC,
  INITIAL_LAST_TOOL_IN_GROUP,
  INITIAL_STRUCTURE,
  INITIAL_TREE_BRUSH,
  clampHardness,
  clampRadius,
} from './studioDefaults';
import type { SceneCompilerRunner, StudioHistorySlice, StudioState } from './studioTypes';
import { groupOf } from '../ui/toolCatalog';
import { applyZ } from './zOrder';

export type {
  HydraulicPreset,
  SceneCompilerRunner,
  SculptBrushSettings,
  StudioHistorySlice,
  StudioState,
  StructurePreset,
  TreeBrushSettings,
} from './studioTypes';

/** 注入式编译器句柄，刻意不进状态切片，避免函数进入历史快照 */
let sceneRunner: SceneCompilerRunner | null = null;
let continuousStartProject: TownProject | null = null;
let compileSeq = 0;
let rerollSeq = 0;

const temporalOptions: ZundoOptions<StudioState, StudioHistorySlice> = {
  limit: 50,
  partialize: (state): StudioHistorySlice => ({
    project: state.project,
  }),
  equality: (pastState, currentState) => pastState.project === currentState.project,
};

export const useStudioStore = create<StudioState>()(
  temporal(
    immer((set, get) => ({
      project: createBlankProject(),
      compiledScene: null,
      isCompiling: false,
      activeTool: 'select',
      activeTab: 'terrain',
      selection: null,
      viewport: {
        widthPx: 1280,
        heightPx: 800,
        dpr: 1,
        panX: 0,
        panY: 0,
        zoom: 1,
        worldSizeM: 2400,
      },
      brush: { ...INITIAL_BRUSH },
      treeBrush: { ...INITIAL_TREE_BRUSH },
      hydraulicPreset: { ...INITIAL_HYDRAULIC },
      structurePreset: { ...INITIAL_STRUCTURE },
      lastToolInGroup: { ...INITIAL_LAST_TOOL_IN_GROUP },
      drawZoneContentType: 'town_blocks',
      drawRoadTier: 'street',
      drawLinearShapeType: 'ridge',
      drawWaterMode: 'lake',
      drawReefMode: 'reef',
      activeLandmarkKey: 'custom_stele',
      activeLandmarkLabel: '地标徽记',
      backendOnline: false,
      terraxDataAvailable: false,
      geoModalOpen: false,
      toastMessage: null,
      registerSceneCompiler: (runner) => {
        sceneRunner = runner;
      },
      loadProject: (rawOrProject, resetHistory = true) => {
        compileSeq += 1;
        const project = normalizeProject(rawOrProject);
        continuousStartProject = null;
        set((draft) => {
          draft.project = project;
          draft.compiledScene = null;
          draft.selection = null;
          draft.viewport.worldSizeM = project.meta.worldSizeM;
        });
        const timeline = useStudioStore.temporal.getState();
        timeline.resume();
        if (resetHistory) timeline.clear();
        void get().requestRecompile();
      },
      loadPreset: (key) => {
        get().loadProject(createPresetProject(key as PresetKey), true);
      },
      mutateProject: (recipe, recompile = true) => {
        set((draft) => {
          recipe(draft.project);
          draft.project.meta.updatedAt = new Date().toISOString();
        });
        if (recompile) void get().requestRecompile();
      },
      setCompiledScene: (scene) => {
        set({ compiledScene: scene });
      },
      requestRecompile: async () => {
        const runner = sceneRunner;
        if (!runner) return;
        compileSeq += 1;
        const requestId = compileSeq;
        set((draft) => { draft.isCompiling = true; });
        try {
          const result = await runner(get().project);
          if (requestId !== compileSeq) return;
          if (result) {
            set({ compiledScene: result.scene });
            adoptSceneLegend(result.scene);
          }
        } finally {
          if (requestId === compileSeq) set((draft) => { draft.isCompiling = false; });
        }
      },
      setSelectionZ: (mode) => {
        const selection = get().selection;
        if (!selection) return;
        get().mutateProject((draft) => {
          applyZ(draft as unknown as TownProject, selection, mode);
        }, false);
      },
      rerollZone: (zoneId) => {
        const targetZone = get().project.zones.find((zone) => zone.id === zoneId);
        if (!targetZone || targetZone.locked) return;
        rerollSeq += 1;
        const nextSeed = hashSeed(`${targetZone.id}|${targetZone.seed}|${rerollSeq}`);
        set((draft) => {
          const zone = draft.project.zones.find((item) => item.id === zoneId);
          if (zone) zone.seed = nextSeed;
        });
        compileSeq += 1;
        const requestId = compileSeq;
        const runner = sceneRunner;
        if (!runner) {
          void get().requestRecompile();
          return;
        }
        void (async () => {
          set((draft) => { draft.isCompiling = true; });
          try {
            const result = await runner(get().project, zoneId, get().compiledScene, nextSeed);
            if (!result || result.stale === true || requestId !== compileSeq) return;
            set({ compiledScene: result.scene });
            adoptSceneLegend(result.scene);
          } finally {
            if (requestId === compileSeq) set((draft) => { draft.isCompiling = false; });
          }
        })();
      },
      rerollAllUnlockedZones: () => {
        rerollSeq += 1;
        const seq = rerollSeq;
        set((draft) => {
          for (const zone of draft.project.zones) {
            if (!zone.locked) zone.seed = hashSeed(`${zone.id}|${zone.seed}|${seq}`);
          }
        });
        void get().requestRecompile();
      },
      beginContinuousEdit: () => {
        if (continuousStartProject !== null) return;
        continuousStartProject = get().project;
        useStudioStore.temporal.getState().pause();
      },
      endContinuousEdit: (recompileOnEnd = true) => {
        const startProj = continuousStartProject;
        const finalProj = get().project;
        continuousStartProject = null;
        const timeline = useStudioStore.temporal.getState();
        if (startProj !== null && startProj !== finalProj) {
          set((draft) => {
            draft.project = startProj;
          });
          timeline.resume();
          set((draft) => {
            draft.project = finalProj;
          });
        } else {
          timeline.resume();
        }
        if (recompileOnEnd) void get().requestRecompile();
      },
      undoProject: () => {
        const timeline = useStudioStore.temporal.getState();
        if (timeline.pastStates.length === 0) return;
        timeline.undo();
        void get().requestRecompile();
      },
      redoProject: () => {
        const timeline = useStudioStore.temporal.getState();
        if (timeline.futureStates.length === 0) return;
        timeline.redo();
        void get().requestRecompile();
      },
      setActiveTool: (tool) => {
        set((draft) => {
          draft.activeTool = tool;
          draft.lastToolInGroup[groupOf(tool).id] = tool;
        });
      },
      setDrawReefMode: (mode) => {
        set((draft) => {
          draft.drawReefMode = mode;
        });
      },
      setActiveTab: (tab) => { set((draft) => { draft.activeTab = tab; }); },
      setSelection: (sel) => { set((draft) => { draft.selection = sel; }); },
      updateViewport: (patch) => { set((draft) => { Object.assign(draft.viewport, patch); }); },
      updateBrush: (patch) => {
        set((draft) => {
          Object.assign(draft.brush, patch);
          draft.brush.radiusM = clampRadius(draft.brush.radiusM);
          draft.brush.hardness = clampHardness(draft.brush.hardness);
        });
      },
      updateTreeBrush: (patch) => {
        set((draft) => {
          Object.assign(draft.treeBrush, patch);
          draft.treeBrush.radiusM = clampRadius(draft.treeBrush.radiusM);
        });
      },
      setHydraulicPreset: (patch) => {
        set((draft) => {
          Object.assign(draft.hydraulicPreset, patch);
        });
      },
      setStructurePreset: (patch) => {
        set((draft) => {
          Object.assign(draft.structurePreset, patch);
        });
      },
      setBackendStatus: (online, terraxAvailable) => {
        set((draft) => {
          draft.backendOnline = online;
          draft.terraxDataAvailable = terraxAvailable;
        });
      },
      setGeoModalOpen: (open) => { set((draft) => { draft.geoModalOpen = open; }); },
      showToast: (msg) => { set((draft) => { draft.toastMessage = msg; }); },
    })),
    temporalOptions,
  ),
);

/** 编译产物图例回写工程（派生数据，暂停时间旅行以免污染撤销栈） */
function adoptSceneLegend(scene: CompiledSceneBase | null): void {
  const legend = (scene as { legend?: LegendConfig } | null)?.legend;
  if (!legend || continuousStartProject !== null) return;
  const current = useStudioStore.getState().project.legend;
  const sameItems = current.items.length === legend.items.length
    && JSON.stringify(current.items) === JSON.stringify(legend.items);
  if (sameItems && current.title === legend.title && current.visible === legend.visible) return;
  const timeline = useStudioStore.temporal.getState();
  timeline.pause();
  useStudioStore.setState((draft) => {
    draft.project.legend = {
      visible: legend.visible,
      title: legend.title,
      position: legend.position,
      columns: legend.columns,
      displayMode: legend.displayMode,
      furnitureOpacity: legend.furnitureOpacity ?? current.furnitureOpacity,
      labelOpacity: legend.labelOpacity ?? current.labelOpacity,
      items: legend.items.map((item) => ({ ...item })),
    } as LegendConfig;
  });
  timeline.resume();
}

export function useTemporalStore<T>(selector: (state: TemporalState<StudioHistorySlice>) => T): T {
  return useStore(useStudioStore.temporal, selector);
}
/** 无头测试与 M3 Worker 注入共用的临时编译器切换口（不进入历史切片） */
export function setSceneCompilerForTest(runner: SceneCompilerRunner | null): void {
  sceneRunner = runner;
}
