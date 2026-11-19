import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { CUSTOM_GLYPH_TYPES, type LegendConfig, type LegendItem, type LegendPosition, resolveEffectiveLegend } from '../../schema/legend.schema';
import { getActivePalette } from '../../schema/palette.schema';
import { Canvas2DBackend } from '../../renderer/Canvas2DBackend';
import { paintLegendGlyph } from '../../renderer/paintLegendGlyph';
import { useStudioStore } from '../../store/useStudioStore';
import { PanelSection, SelectField, ToggleField } from './ZonePanel';

const POSITIONS: ReadonlyArray<{ value: LegendPosition; label: string }> = [
  { value: 'bottom-right', label: '右下' },
  { value: 'bottom-left', label: '左下' },
  { value: 'top-right', label: '右上' },
  { value: 'top-left', label: '左上' },
];

function GlyphPreview({ item }: { item: LegendItem }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 28, 18);
    const palette = getActivePalette(useStudioStore.getState().project.palette);
    paintLegendGlyph(new Canvas2DBackend(ctx, 28, 18, 1), item, 0, 0, 28, 18, palette);
  }, [item]);
  return <canvas ref={ref} width={28} height={18} className="shrink-0 rounded-sm border border-brass bg-panel" />;
}

/** 图例编辑器：22 类微缩预览、改名/改色/显隐/排序/删除、四角停靠、单双列与自定义徽记 */
export function LegendPanel() {
  const project = useStudioStore((state) => state.project);
  const sceneLegend = useStudioStore((state) => (state.compiledScene as { legend?: LegendConfig } | null)?.legend);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const legend = resolveEffectiveLegend(project.legend, sceneLegend ?? null);

  const editLegend = (recipe: (draft: typeof legend) => void, recompile = true): void => {
    mutateProject((draft) => {
      recipe(draft.legend);
    }, recompile);
  };

  const ensureItems = (draft: { legend: LegendConfig }): void => {
    if (draft.legend.items.length === 0) draft.legend.items = legend.items.map((item) => ({ ...item }));
  };
  const editItem = (index: number, recipe: (item: LegendItem) => void): void => {
    mutateProject((draft) => {
      ensureItems(draft);
      const item = draft.legend.items[index];
      if (item) recipe(item);
    }, false);
  };

  const moveItem = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= legend.items.length) return;
    mutateProject((draft) => {
      ensureItems(draft);
      const items = draft.legend.items;
      const a = items[index];
      const b = items[target];
      if (!a || !b) return;
      const orderA = a.order;
      a.order = b.order;
      b.order = orderA;
      items.sort((left, right) => left.order - right.order);
    }, false);
  };

  return (
    <div className="flex flex-col">
      <PanelSection title="图例框">
        <ToggleField label="显示图例" checked={legend.visible} onChange={(value) => editLegend((draft) => { draft.visible = value; }, false)} />
        <label className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-secondary">抬头标题</span>
          <input value={legend.title} onChange={(event) => editLegend((draft) => { draft.title = event.target.value; }, false)} className="h-7 w-44 rounded border border-brass bg-input px-2 text-[11px] text-ink focus:border-pine focus:outline-none" />
        </label>
        <SelectField label="停靠方位" value={legend.position} options={POSITIONS} onChange={(value) => editLegend((draft) => { draft.position = value; }, false)} />
        <SelectField label="列数" value={legend.columns === 1 ? '1' : '2'} options={[{ value: '1', label: '单列' }, { value: '2', label: '双列' }]} onChange={(value) => editLegend((draft) => { draft.columns = value === '1' ? 1 : 2; }, false)} />
      </PanelSection>

      <PanelSection title={`图例项 (${legend.items.length})`}>
        <ul className="flex max-h-[340px] flex-col gap-1 overflow-auto">
          {legend.items.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-brass">
              <button
                type="button"
                title="设为 M 工具当前徽记"
                onClick={() => useStudioStore.setState({ activeLandmarkKey: item.key, activeLandmarkLabel: item.label })}
                className="shrink-0"
              >
                <GlyphPreview item={item} />
              </button>
              <input
                value={item.label}
                onChange={(event) => editItem(index, (target) => { target.label = event.target.value; })}
                className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[11px] text-ink hover:border-brass focus:border-pine focus:bg-input focus:outline-none"
              />
              <input
                type="color"
                value={item.color && /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#cbb582'}
                onChange={(event) => editItem(index, (target) => { target.color = event.target.value; target.colorLocked = true; })}
                title="改色"
                className="h-5 w-5 shrink-0 cursor-pointer rounded border border-brass bg-input p-0"
              />
              <button type="button" title="显隐" onClick={() => editItem(index, (target) => { target.visible = target.visible === false; })} className="text-ink-muted hover:text-ink">
                {item.visible === false ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button type="button" title="上移" onClick={() => moveItem(index, -1)} className="text-ink-muted hover:text-ink">
                <ArrowUp size={12} />
              </button>
              <button type="button" title="下移" onClick={() => moveItem(index, 1)} className="text-ink-muted hover:text-ink">
                <ArrowDown size={12} />
              </button>
              <button type="button" title="删除" onClick={() => mutateProject((draft) => { ensureItems(draft); draft.legend.items.splice(index, 1); }, false)} className="text-ink-muted hover:text-terracotta">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="新增自定义徽记">
        <div className="grid grid-cols-4 gap-1">
          {CUSTOM_GLYPH_TYPES.map((glyphType) => (
            <button
              key={glyphType}
              type="button"
              onClick={() =>
                mutateProject((draft) => {
                  ensureItems(draft);
                  const order = draft.legend.items.reduce((max, item) => Math.max(max, item.order), 0) + 10;
                  const used = new Set(draft.legend.items.map((item) => item.key));
                  let key = `custom_${glyphType}`;
                  let seq = 2;
                  while (used.has(key)) {
                    key = `custom_${glyphType}_${seq}`;
                    seq += 1;
                  }
                  draft.legend.items.push({
                    key,
                    isCustom: true,
                    glyphType,
                    label: glyphType,
                    color: '',
                    colorLocked: false,
                    strokeColor: '',
                    visible: true,
                    autoPresent: true,
                    order,
                  });
                  draft.meta.updatedAt = new Date().toISOString();
                }, false)
              }
              className="flex h-7 items-center justify-center gap-1 rounded border border-brass bg-card text-[10px] text-ink-secondary hover:bg-card-hover"
            >
              <Plus size={10} />
              {glyphType}
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-4 text-ink-muted">新增徽记后用 M 工具在画布盖章；未盖章的自定义图例在重编译后仍保持显示。</p>
      </PanelSection>
    </div>
  );
}
