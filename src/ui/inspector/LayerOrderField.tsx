import { useStudioStore } from '../../store/useStudioStore';
import { zIndexOf } from '../../store/zOrder';
import { PanelSection } from './FormControls';

const BTN =
  'h-7 flex-1 whitespace-nowrap rounded-md border border-brass/80 bg-card text-[10.5px] text-ink-secondary transition-colors hover:bg-card-hover disabled:opacity-40';

/** 叠放层级：把当前选中物体在整幅图的绘制顺序中上移/下移，可跨道路、屋宇与林木压盖 */
export function LayerOrderField() {
  const selection = useStudioStore((state) => state.selection);
  const project = useStudioStore((state) => state.project);
  const setSelectionZ = useStudioStore((state) => state.setSelectionZ);
  const z = zIndexOf(project, selection);
  if (!selection || z === null) return null;
  return (
    <PanelSection title="叠放层级">
      <div className="flex items-center gap-1">
        <button type="button" className={BTN} onClick={() => setSelectionZ('bottom')}>置底</button>
        <button type="button" className={BTN} onClick={() => setSelectionZ('down')}>下移</button>
        <button type="button" className={BTN} onClick={() => setSelectionZ('up')}>上移</button>
        <button type="button" className={BTN} onClick={() => setSelectionZ('top')}>置顶</button>
      </div>
      <p className="text-[10px] leading-4 text-ink-muted">
        当前 z = <span className="font-mono tabular-nums">{z}</span> · 0 为默认层，数值越大越靠上（可压过道路与屋宇）
      </p>
    </PanelSection>
  );
}
