import { Download, ImageDown } from 'lucide-react';
import {
  BUILTIN_PALETTES,
  CANONICAL_THEME_IDS,
  PALETTE_SLOT_KEYS,
  getActivePalette,
  type CanonicalThemeId,
  type PaletteSlotKey,
} from '../../schema/palette.schema';
import { downloadPngFile, downloadSvgFile, exportScenePngBlob, type ExportMode, type PngScale } from '../../renderer/exportUtils';
import { useStudioStore } from '../../store/useStudioStore';
import { PanelSection } from './FormControls';

const THEME_LABELS: Readonly<Record<CanonicalThemeId, string>> = {
  watabou_classic: 'Watabou 古典',
  nordic_fjord: '北方峡湾',
  arid_oasis: '旱海绿洲',
  gazetteer_ink: '方志墨本',
};

const SLOT_LABELS: Readonly<Record<PaletteSlotKey, string>> = {
  paperBg: '纸底',
  inkDark: '主墨',
  roofInner: '内城屋面',
  roofTown: '关厢屋面',
  roadFill: '路面',
  waterFill: '水体',
  waterRipple: '水纹',
  treeFill: '树冠',
  treeOutline: '树廓',
  contourLine: '等高线',
  farmlandFill: '田畴',
  saltpanFill: '盐畦',
};

/** 4 套主题卡片 + 12 语义色槽拾色器 + 1x/2x/3x × full/clean 导出 */
export function PalettePanel() {
  const project = useStudioStore((state) => state.project);
  const scene = useStudioStore((state) => state.compiledScene);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const palette = getActivePalette(project.palette);
  const overrides = project.palette.overrides;

  const exportPng = (scale: PngScale, mode: ExportMode): void => {
    void exportScenePngBlob(project, scene, { scale, mode })
      .then((blob) => downloadPngFile(blob, project, scale, mode))
      .catch(() => useStudioStore.getState().showToast('PNG 导出需要浏览器画布环境'));
  };

  return (
    <div className="flex flex-col">
      <PanelSection title="内置主题">
        <div className="grid grid-cols-2 gap-1.5">
          {CANONICAL_THEME_IDS.map((themeId) => {
            const theme = BUILTIN_PALETTES[themeId];
            const active = palette.themeId === themeId;
            return (
              <button
                key={themeId}
                type="button"
                onClick={() =>
                  mutateProject((draft) => {
                    draft.palette.themeId = themeId;
                    draft.palette.overrides = {};
                  })
                }
                className={`rounded border p-1.5 text-left transition-colors ${
                  active ? 'border-pine bg-card' : 'border-brass bg-panel hover:bg-card'
                }`}
              >
                <span className="mb-1 flex h-3 overflow-hidden rounded-sm">
                  {[theme.paperBg, theme.roofTown, theme.waterFill, theme.treeFill, theme.contourLine].map((color) => (
                    <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="text-[10px] text-ink-secondary">{THEME_LABELS[themeId]}</span>
              </button>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title="12 语义色槽覆盖">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {PALETTE_SLOT_KEYS.map((slot) => (
            <label key={slot} className="flex items-center justify-between gap-1">
              <span className="truncate text-[10px] text-ink-muted">{SLOT_LABELS[slot]}</span>
              <input
                type="color"
                value={palette[slot]}
                onChange={(event) =>
                  mutateProject((draft) => {
                    draft.palette.overrides[slot] = event.target.value;
                  })
                }
                className="h-5 w-8 shrink-0 cursor-pointer rounded border border-brass bg-input p-0"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => mutateProject((draft) => { draft.palette.overrides = {}; })}
          className="mt-1 h-7 rounded border border-brass bg-card text-[11px] text-ink-secondary hover:bg-card-hover"
        >
          恢复主题默认色
        </button>
      </PanelSection>

      <PanelSection title="高清导出">
        <div className="grid grid-cols-3 gap-1">
          {([1, 2, 3] as const).map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => exportPng(scale, 'full')}
              className="flex h-8 flex-col items-center justify-center rounded border border-brass bg-card text-[10px] text-ink-secondary hover:bg-card-hover"
            >
              <ImageDown size={11} />
              {scale}x 出版
            </button>
          ))}
          {([1, 2, 3] as const).map((scale) => (
            <button
              key={`clean-${scale}`}
              type="button"
              onClick={() => exportPng(scale, 'clean')}
              className="flex h-8 flex-col items-center justify-center rounded border border-brass bg-panel text-[10px] text-ink-muted hover:bg-card"
            >
              <ImageDown size={11} />
              {scale}x 纯底
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => downloadSvgFile(project, scene, 'full')}
          className="mt-1 flex h-8 items-center justify-center gap-1 rounded border border-brass bg-pine text-[11px] text-on-accent hover:bg-pine-hover"
        >
          <Download size={12} />
          导出分层矢量 SVG
        </button>
        <p className="text-[10px] leading-4 text-ink-muted">
          1x = 1600px，2x = 3200px，3x = 4800px；full 含标题牌匾与图例，clean 仅保留地图本体。
        </p>
      </PanelSection>

      <PanelSection title="当前工程">
        <div className="grid grid-cols-2 gap-1 text-[10px] text-ink-muted">
          <span>图幅 {project.meta.worldSizeM} m</span>
          <span>主题 {palette.themeId}</span>
          <span>覆盖 {Object.keys(overrides).length} 槽</span>
          <span>图例 {project.legend.items.length} 项</span>
        </div>
      </PanelSection>
    </div>
  );
}
