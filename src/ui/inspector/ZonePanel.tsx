import { useEffect, useRef, type ReactNode } from 'react';
import { useStudioStore } from '../../store/useStudioStore';
import { ZONE_CONTENT_TYPES, type ZoneContentType } from '../../schema/project.schema';

const LABEL = 'text-[11px] font-medium text-ink-secondary';
const INPUT = 'h-7 w-full rounded border border-brass bg-input px-2 text-[11px] text-ink focus:border-pine focus:outline-none';
const BTN = 'h-7 rounded border border-brass bg-card px-2 text-[11px] text-ink-secondary hover:bg-card-hover';
const STEP_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-brass px-3 py-2">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

export function RangeField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const begin = useStudioStore((state) => state.beginContinuousEdit);
  const end = useStudioStore((state) => state.endContinuousEdit);
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className={LABEL}>{props.label}</span>
        <span className="font-mono text-[10px] text-ink-muted">
          {props.value.toFixed(props.digits ?? 1)}
          {props.suffix ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          begin();
        }}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(true)}
        onKeyDown={(event) => {
          if (STEP_KEYS.has(event.key)) begin();
        }}
        onKeyUp={(event) => {
          if (STEP_KEYS.has(event.key)) end(true);
        }}
        onBlur={() => end(true)}
        className="mt-0.5 w-full"
      />
    </label>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const begin = useStudioStore((state) => state.beginContinuousEdit);
  const end = useStudioStore((state) => state.endContinuousEdit);
  const dirtyRef = useRef(false);
  useEffect(() => () => {
    if (dirtyRef.current) {
      dirtyRef.current = false;
      end(true);
    }
  }, [end]);
  const commit = (): void => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    end(true);
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onFocus={() => { dirtyRef.current = true; begin(); }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
        onChange={(event) => { dirtyRef.current = true; props.onChange(Number(event.target.value)); }}
        className={`${INPUT} w-24 text-right font-mono`}
      />
    </label>
  );
}

export function ToggleField(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} className="h-3.5 w-3.5 accent-pine" />
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as T)} className={`${INPUT} w-36`}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
      <PanelSection title="选中选区">
        {zone ? (
          <>
            <label className="flex items-center justify-between gap-2">
              <span className={LABEL}>名称</span>
              <input value={zone.name} onChange={(event) => patch((target) => { target.name = event.target.value; }, false)} className={`${INPUT} w-44`} />
            </label>
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
