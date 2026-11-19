import rawChanghu from '../../projects/长湖_复市镇.worldtown.json';
import rawLosrumura from '../../projects/起点城_Losrumura.worldtown.json';
import rawPalong from '../../projects/帕隆_峡谷铁寨.worldtown.json';
import { type TownProject, normalizeProject } from './project.schema';

export type PresetKey = 'losrumura' | 'changhu' | 'palong' | 'blank';

export interface PresetDescriptor {
  readonly key: PresetKey;
  readonly filename: string;
  readonly label: string;
  readonly build: () => TownProject;
}

export const BUILTIN_PRESETS: ReadonlyArray<PresetDescriptor> = [
  {
    key: 'losrumura',
    filename: '起点城_Losrumura.worldtown.json',
    label: '起点都城 Lōsrūmūra（河阶台地换装都城）',
    build: () => normalizeProject(structuredClone(rawLosrumura)),
  },
  {
    key: 'changhu',
    filename: '长湖_复市镇.worldtown.json',
    label: '长湖复市镇 Simibihmāh（暗渠盐池与禁建疫圈）',
    build: () => normalizeProject(structuredClone(rawChanghu)),
  },
  {
    key: 'palong',
    filename: '帕隆_峡谷铁寨.worldtown.json',
    label: '帕隆双生铁寨（深切峡谷、底礁渡口与陡坎齿线）',
    build: () => normalizeProject(structuredClone(rawPalong)),
  },
  {
    key: 'blank',
    filename: '空白新建聚落.worldtown.json',
    label: '空白测绘图纸（2400m 标准图幅）',
    build: () => createBlankProject(),
  },
];

export function createBlankProject(): TownProject {
  return normalizeProject({
    schemaVersion: '2.0.0',
    meta: {
      id: 'proj_blank',
      name: '新建聚落测绘图',
      subtitle: '2400m 标准测绘平面图',
      worldSizeM: 2400,
      terraxAnchor: null,
      updatedAt: new Date().toISOString(),
    },
  });
}

export function createPresetProject(key: PresetKey = 'losrumura'): TownProject {
  const found = BUILTIN_PRESETS.find((p) => p.key === key);
  const fallback = BUILTIN_PRESETS[0];
  if (found) return found.build();
  if (!fallback) return createBlankProject();
  return fallback.build();
}

/** 按文件名反查预设键，供后端 `/api/projects` 返回项与前端预设对齐 */
export function findPresetByFilename(filename: string): PresetDescriptor | undefined {
  return BUILTIN_PRESETS.find((p) => p.filename === filename);
}
