import { useStudioStore } from '../../store/useStudioStore';
import { ZONE_CONTENT_TYPES, type ZoneContentType } from '../../schema/project.schema';

import { FORM_BUTTON_CLASS as BTN, NumberField, PanelSection, RangeField, SelectField, TextField, ToggleField } from './FormControls';
import { LayerOrderField } from './LayerOrderField';

export { NumberField, PanelSection, RangeField, SelectField, TextField, ToggleField };

const CONTENT_LABELS: Readonly<Record<ZoneContentType, string>> = {
  walled_city: '内城城垣',
  town_blocks: '关厢坊巷',
  village: '散居村寨',
  citadel: '堡寨官署',
  market: '集场货市',
  farmland: '条田垄亩',
  saltpan: '晒盐卤畦',
  woodland: '成片疏林',
  exclusion: '禁建保护区',
};

/** 选区属性卡：名称/类型/种子/密度/坡度/街宽/墙厚/敌台间距/锁定与重抽 */
export function ZonePanel() {
  const project = useStudioStore((state) => state.project);
  const selection = useStudioStore((state) => state.selection);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const setSelection = useStudioStore((state) => state.setSelection);
  const rerollZone = useStudioStore((state) => state.rerollZone);
  const rerollAll = useStudioStore((state) => state.rerollAllUnlockedZones);
  const zone = selection?.type === 'zone' ? project.zones.find((item) => item.id === selection.id) ?? null : null;

  const patch = (recipe: (target: (typeof project.zones)[number]) => void, recompile = true): void => {
    if (!zone) return;
    mutateProject((draft) => {
      const target = draft.zones.find((item) => item.id === zone.id);
      if (target) recipe(target);
    }, recompile);
  };

  return (
    <div className="flex flex-col">
      <LayerOrderField />
      <PanelSection title="选中选区">
        {zone ? (
          <>
            <TextField label="名称" value={zone.name} onChange={(value) => patch((target) => { target.name = value; }, false)} />
            <SelectField
              label="类型"
              value={zone.contentType}
              options={ZONE_CONTENT_TYPES.map((value) => ({ value, label: CONTENT_LABELS[value] }))}
              onChange={(value) => patch((target) => { target.contentType = value; })}
            />
            <NumberField label="种子" value={zone.seed} onChange={(value) => patch((target) => { target.seed = Math.round(value); })} />
            <RangeField label="密度" value={zone.density} min={0.2} max={1} step={0.01} digits={2} onChange={(value) => patch((target) => { target.density = value; }, false)} />
            <RangeField label="最大坡度" value={zone.maxSlopeDeg} min={4} max={60} step={0.5} suffix="°" onChange={(value) => patch((target) => { target.maxSlopeDeg = value; }, false)} />
            <RangeField label="街宽" value={zone.streetWidthM} min={3} max={24} step={0.5} suffix="m" onChange={(value) => patch((target) => { target.streetWidthM = value; }, false)} />
            <RangeField label="墙厚" value={zone.wallThicknessM} min={1.5} max={16} step={0.5} suffix="m" onChange={(value) => patch((target) => { target.wallThicknessM = value; }, false)} />
            <RangeField label="敌台间距" value={zone.towerIntervalM} min={30} max={320} step={5} suffix="m" onChange={(value) => patch((target) => { target.towerIntervalM = value; }, false)} />
            <ToggleField label="锁定种子" checked={zone.locked} onChange={(value) => mutateProject((draft) => { const target = draft.zones.find((item) => item.id === zone.id); if (target) target.locked = value; }, false)} />
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                disabled={zone.locked}
                className={`${BTN} flex-1 bg-pine text-on-accent hover:bg-pine-hover disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={() => rerollZone(zone.id)}
              >
                {zone.locked ? '已锁定种子' : '重抽此选区 (R)'}
              </button>
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  mutateProject((draft) => { draft.zones = draft.zones.filter((item) => item.id !== zone.id); });
                  setSelection(null);
                }}
              >
                删除
              </button>
            </div>
          </>
        ) : (
          <p className="text-[11px] leading-5 text-ink-muted">用 Z 工具框定新区块，或在下方列表点选已有选区。</p>
        )}
      </PanelSection>

      <PanelSection title={`全部选区 (${project.zones.length})`}>
        <button type="button" className={`${BTN} w-full`} onClick={() => rerollAll()}>
          重抽全部未锁定选区
        </button>
        <ul className="max-h-64 overflow-auto">
          {project.zones.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelection({ type: 'zone', id: item.id, name: item.name })}
                className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] hover:bg-card ${
                  zone?.id === item.id ? 'bg-card text-pine' : 'text-ink-secondary'
                }`}
              >
                <span className="truncate">{item.name}</span>
                <span className="ml-2 shrink-0 text-[10px] text-ink-muted">{CONTENT_LABELS[item.contentType]}</span>
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>
    </div>
  );
}
