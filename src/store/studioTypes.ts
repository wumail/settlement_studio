import type { WritableDraft } from 'immer';
import type {
  CompiledSceneBase,
  InspectorTabId,
  SculptBrushMode,
  SelectionTarget,
  ToolId,
} from '../schema/geometry.types';
import type { HydraulicKind, StructureKind, StructureRoofKind } from '../schema/v3.entity.schema';
import type { TownProject } from '../schema/project.schema';
import type { ToolGroupId } from '../ui/toolCatalog';

export interface TownProjectHolder {
  project: TownProject;
}

export type StudioHistorySlice = Pick<TownProjectHolder, 'project'>;

export type SceneCompilerRunner = (
  project: TownProject,
  zoneId?: string,
  prevScene?: CompiledSceneBase | null,
  explicitSeed?: number,
) => Promise<{ scene: CompiledSceneBase; updatedSeed?: number; stale?: boolean } | null>;

export interface SculptBrushSettings {
  mode: SculptBrushMode;
  radiusM: number;
  strength: number;
  flattenTargetElev: number;
  /** 平顶核硬度 0–0.95：u <= hardness 恒权 1，其余平滑归零 */
  hardness: number;
  /** 推平模式落笔自动锁定起笔海拔 */
  autoLockStartElev: boolean;
  /** 阶地模式步高（米） */
  terraceStepM: number;
}

export interface TreeBrushSettings {
  radiusM: number;
  /** 撒点间距系数（× 半径） */
  spacingM: number;
  minR: number;
  maxR: number;
  eraseMode: boolean;
}

export interface HydraulicPreset {
  kind: HydraulicKind;
  sluices: number;
  slips: number;
  autoSnap: boolean;
}

export interface StructurePreset {
  kind: StructureKind;
  widthM: number;
  depthM: number;
  roofKind: StructureRoofKind;
}

export interface StudioState {
  project: TownProject;
  compiledScene: CompiledSceneBase | null;
  isCompiling: boolean;
  activeTool: ToolId;
  activeTab: InspectorTabId;
  selection: SelectionTarget | null;
  viewport: {
    widthPx: number;
    heightPx: number;
    dpr: number;
    panX: number;
    panY: number;
    zoom: number;
    worldSizeM: number;
  };
  brush: SculptBrushSettings;
  treeBrush: TreeBrushSettings;
  hydraulicPreset: HydraulicPreset;
  structurePreset: StructurePreset;
  lastToolInGroup: Record<ToolGroupId, ToolId>;
  drawZoneContentType: TownProject['zones'][number]['contentType'];
  drawRoadTier: TownProject['roads'][number]['tier'];
  drawLinearShapeType: 'ridge' | 'valley' | 'scarp';
  drawWaterMode: 'lake' | 'sea' | 'open_canal' | 'qanat_canal';
  drawReefMode: 'reef' | 'ford';
  activeLandmarkKey: string;
  activeLandmarkLabel: string;
  backendOnline: boolean;
  terraxDataAvailable: boolean;
  geoModalOpen: boolean;
  toastMessage: string | null;
  registerSceneCompiler: (runner: SceneCompilerRunner | null) => void;
  loadProject: (rawOrProject: unknown, resetHistory?: boolean) => void;
  loadPreset: (key: 'losrumura' | 'changhu' | 'palong' | 'blank') => void;
  mutateProject: (recipe: (draft: WritableDraft<TownProject>) => void, recompile?: boolean) => void;
  setCompiledScene: (scene: CompiledSceneBase | null) => void;
  requestRecompile: () => Promise<void>;
  rerollZone: (zoneId: string) => void;
  setSelectionZ: (mode: 'top' | 'bottom' | 'up' | 'down') => void;
  rerollAllUnlockedZones: () => void;
  beginContinuousEdit: () => void;
  endContinuousEdit: (recompileOnEnd?: boolean) => void;
  undoProject: () => void;
  redoProject: () => void;
  setActiveTool: (tool: ToolId) => void;
  setDrawReefMode: (mode: 'reef' | 'ford') => void;
  setActiveTab: (tab: InspectorTabId) => void;
  setSelection: (sel: SelectionTarget | null) => void;
  updateViewport: (patch: Partial<StudioState['viewport']>) => void;
  updateBrush: (patch: Partial<SculptBrushSettings>) => void;
  updateTreeBrush: (patch: Partial<TreeBrushSettings>) => void;
  setHydraulicPreset: (patch: Partial<HydraulicPreset>) => void;
  setStructurePreset: (patch: Partial<StructurePreset>) => void;
  setBackendStatus: (online: boolean, terraxAvailable: boolean) => void;
  setGeoModalOpen: (open: boolean) => void;
  showToast: (msg: string | null) => void;
}
