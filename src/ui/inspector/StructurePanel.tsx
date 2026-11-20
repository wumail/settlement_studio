import type { SelectionTarget } from '../../schema/geometry.types';
import { type StructureKind, type StructureRoofKind } from '../../schema/v3.entity.schema';
import { useStudioStore } from '../../store/useStudioStore';
import { deleteSelection } from '../appHotkeys';
import { NumberField, PanelSection, SelectField, TextField } from './FormControls';
import { LayerOrderField } from './LayerOrderField';

const STRUCTURE_LABELS: ReadonlyArray<{ value: StructureKind; label: string }> = [
  { value: 'rect', label: '长殿公仓 rect' },
  { value: 'l_hall', label: 'L 形厅 l_hall' },
  { value: 'u_court', label: 'U 形合院 u_court' },
  { value: 'round_altar', label: '圆坛 round_altar' },
  { value: 'courtyard', label: '合院建筑群 courtyard' },
];

const ROOF_LABELS: ReadonlyArray<{ value: StructureRoofKind; label: string }> = [
  { value: 'inner', label: '内城色 inner' },
  { value: 'town', label: '关厢色 town' },
  { value: 'citadel', label: '堡寨色 citadel' },
];

interface LayerRow {
  readonly key: string;
  readonly label: string;
  readonly selection: SelectionTarget;
}

/** 对象图层列表：城坊 / 水工 / 建筑群 / 桥梁覆写，点选即联动画布高亮 */
function ObjectList() {
  const project = useStudioStore((state) => state.project);
  const selection = useStudioStore((state) => state.selection);
  const setSelection = useStudioStore((state) => state.setSelection);
  const rows: LayerRow[] = [];
  for (const zone of project.zones) {
    if (zone.contentType !== 'walled_city' && zone.contentType !== 'citadel' && zone.contentType !== 'market') continue;
    rows.push({ key: `z:${zone.id}`, label: `城坊 · ${zone.name}`, selection: { type: 'zone', id: zone.id, name: zone.name } });
  }
  for (const weir of project.weirs) rows.push({ key: `w:${weir.id}`, label: `分水堰 · ${weir.name}`, selection: { type: 'weir', id: weir.id, name: weir.name } });
  for (const dock of project.docks) rows.push({ key: `d:${dock.id}`, label: `码头 · ${dock.name}`, selection: { type: 'dock', id: dock.id, name: dock.name } });
  for (const mill of project.watermills) rows.push({ key: `m:${mill.id}`, label: `水力工坊 · ${mill.name}`, selection: { type: 'watermill', id: mill.id, name: mill.name } });
  for (const item of project.structures) rows.push({ key: `s:${item.id}`, label: `建筑群 · ${item.name}`, selection: { type: 'structure', id: item.id, name: item.name } });
  for (const bridge of project.bridgeOverrides) {
    const label = { stone_arch: '石拱', timber: '木桥', fortified_twin: '双桥头堡', ford: '渡口' }[bridge.style];
    rows.push({ key: `b:${bridge.id}`, label: `桥梁 · ${label}`, selection: { type: 'bridge', id: bridge.id, name: '桥梁覆写' } });
  }
  return (
    <PanelSection title={`对象图层 (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-[11px] leading-5 text-ink-muted">用 K 放水工、X 放建筑群、D 选桥位后即在此列出。</p>
      ) : null}
      <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => setSelection(row.selection)}
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-[10.5px] ${
              selection?.id === row.selection.id ? 'bg-pine text-on-accent' : 'text-ink-secondary hover:bg-card'
            }`}
          >
            <span className="truncate">{row.label}</span>
            <span className="ml-2 font-mono text-[9px] opacity-70">{row.selection.type}</span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}

/** 水工 / 核心建筑群 / 桥梁覆写精细属性卡（V3-S2.7） */
export function StructurePanel() {
  const project = useStudioStore((state) => state.project);
  const selection = useStudioStore((state) => state.selection);
  const mutate = useStudioStore((state) => state.mutateProject);
  const weir = selection?.type === 'weir' ? project.weirs.find((item) => item.id === selection.id) : undefined;
  const dock = selection?.type === 'dock' ? project.docks.find((item) => item.id === selection.id) : undefined;
  const mill = selection?.type === 'watermill' ? project.watermills.find((item) => item.id === selection.id) : undefined;
  const structure = selection?.type === 'structure' ? project.structures.find((item) => item.id === selection.id) : undefined;
  const bridge = selection?.type === 'bridge' ? project.bridgeOverrides.find((item) => item.id === selection.id) : undefined;

  return (
    <div className="flex flex-col">
      <LayerOrderField />
      <ObjectList />
      {weir ? (
        <PanelSection title="选中分水堰">
          <TextField label="名称" value={weir.name} onChange={(v) => mutate((d) => { const t = d.weirs.find((i) => i.id === weir.id); if (t) t.name = v; }, false)} />
          <NumberField label="闸孔数" value={weir.sluices} min={1} max={8} onChange={(v) => mutate((d) => { const t = d.weirs.find((i) => i.id === weir.id); if (t) t.sluices = Math.round(v); }, true)} />
          <NumberField label="堰体宽" value={weir.widthM} min={3} max={24} onChange={(v) => mutate((d) => { const t = d.weirs.find((i) => i.id === weir.id); if (t) t.widthM = v; }, true)} />
          <p className="text-[10px] text-ink-muted">画布蓝色虚线框提供旋转柄与面宽对拉柄。</p>
        </PanelSection>
      ) : null}
      {dock ? (
        <PanelSection title="选中码头">
          <TextField label="名称" value={dock.name} onChange={(v) => mutate((d) => { const t = d.docks.find((i) => i.id === dock.id); if (t) t.name = v; }, false)} />
          <NumberField label="滑道数" value={dock.slips} min={1} max={8} onChange={(v) => mutate((d) => { const t = d.docks.find((i) => i.id === dock.id); if (t) t.slips = Math.round(v); }, true)} />
          <NumberField label="长度" value={dock.lengthM} min={12} max={120} onChange={(v) => mutate((d) => { const t = d.docks.find((i) => i.id === dock.id); if (t) t.lengthM = v; }, true)} />
          <NumberField label="宽度" value={dock.widthM} min={4} max={24} onChange={(v) => mutate((d) => { const t = d.docks.find((i) => i.id === dock.id); if (t) t.widthM = v; }, true)} />
          <NumberField label="朝向角" value={dock.angleDeg} min={-180} max={180} onChange={(v) => mutate((d) => { const t = d.docks.find((i) => i.id === dock.id); if (t) t.angleDeg = v; }, true)} />
        </PanelSection>
      ) : null}
      {mill ? (
        <PanelSection title="选中水力工坊">
          <TextField label="名称" value={mill.name} onChange={(v) => mutate((d) => { const t = d.watermills.find((i) => i.id === mill.id); if (t) t.name = v; }, false)} />
          <NumberField label="面宽" value={mill.widthM} min={8} max={40} onChange={(v) => mutate((d) => { const t = d.watermills.find((i) => i.id === mill.id); if (t) t.widthM = v; }, true)} />
          <NumberField label="进深" value={mill.depthM} min={6} max={30} onChange={(v) => mutate((d) => { const t = d.watermills.find((i) => i.id === mill.id); if (t) t.depthM = v; }, true)} />
          <SelectField label="水轮侧" value={mill.wheelSide} options={[{ value: 'left' as const, label: '左岸' }, { value: 'right' as const, label: '右岸' }]} onChange={(v) => mutate((d) => { const t = d.watermills.find((i) => i.id === mill.id); if (t) t.wheelSide = v; }, true)} />
        </PanelSection>
      ) : null}
      {structure ? (
        <PanelSection title="选中核心建筑群">
          <TextField label="名称" value={structure.name} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.name = v; }, false)} />
          <SelectField label="形制" value={structure.kind} options={STRUCTURE_LABELS} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.kind = v; }, true)} />
          <NumberField label="面宽 m" value={structure.widthM} min={8} max={160} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.widthM = v; }, true)} />
          <NumberField label="进深 m" value={structure.depthM} min={8} max={160} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.depthM = v; }, true)} />
          <NumberField label="旋转角" value={structure.angleDeg} min={-180} max={180} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.angleDeg = v; }, true)} />
          <SelectField label="屋顶色" value={structure.roofKind} options={ROOF_LABELS} onChange={(v) => mutate((d) => { const t = d.structures.find((i) => i.id === structure.id); if (t) t.roofKind = v; }, true)} />
        </PanelSection>
      ) : null}
      {bridge ? (
        <PanelSection title="选中桥梁">
          <SelectField label="桥型" value={bridge.style} options={[{ value: 'stone_arch' as const, label: '石拱' }, { value: 'timber' as const, label: '木桥' }, { value: 'fortified_twin' as const, label: '双桥头堡' }, { value: 'ford' as const, label: '涉水渡口' }]} onChange={(v) => mutate((d) => { const t = d.bridgeOverrides.find((i) => i.id === bridge.id); if (t) t.style = v; }, true)} />
          {bridge.style === 'fortified_twin' ? (
            <NumberField label="堡边长 m" value={bridge.fortSizeM} min={14} max={48} onChange={(v) => mutate((d) => { const t = d.bridgeOverrides.find((i) => i.id === bridge.id); if (t) t.fortSizeM = v; }, true)} />
          ) : null}
          <p className="text-[10px] leading-4 text-ink-muted">路即桥：路面直接跨水，不再单独绘制桥面；仅双桥头堡保留堡体。</p>
        </PanelSection>
      ) : null}
      {!weir && !dock && !mill && !structure && !bridge ? (
        <PanelSection title="选中对象">
          <p className="text-[11px] leading-5 text-ink-muted">在画布点选水工、建筑群或桥梁，或在上方图层列表定位。</p>
        </PanelSection>
      ) : null}
      {selection ? (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => deleteSelection()}
            className="w-full rounded border border-brass px-2 py-1 text-[10.5px] text-status-warn hover:bg-card"
          >
            删除选中对象（Delete）
          </button>
        </div>
      ) : null}
    </div>
  );
}
