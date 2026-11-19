import type { ReactNode } from 'react';

export function BarLabel(props: { children: ReactNode }) {
  return <span className="shrink-0 whitespace-nowrap text-[10px] tracking-wide text-ink-muted">{props.children}</span>;
}

export function BarDivider() {
  return <span className="h-5 w-px shrink-0 bg-brass/70" aria-hidden="true" />;
}

export function Segmented<T extends string>(props: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-brass/80 bg-panel p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]" role="group" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => props.onChange(option.value)}
          aria-pressed={props.value === option.value}
          className={`whitespace-nowrap rounded px-2 py-[3px] text-[10.5px] transition-colors ${
            props.value === option.value
              ? 'bg-pine text-on-accent shadow-sm'
              : 'text-ink-secondary hover:bg-card'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  digits?: number;
  onChange: (value: number) => void;
}) {
  const digits = props.digits ?? 0;
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      <BarLabel>{props.label}</BarLabel>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="atelier-range w-[78px] cursor-pointer"
        aria-label={props.label}
      />
      <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-ink-secondary">
        {props.value.toFixed(digits)}
        {props.suffix ?? ''}
      </span>
    </label>
  );
}

export function NumBox(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1">
      <BarLabel>{props.label}</BarLabel>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onChange(Math.max(props.min, Math.min(props.max, next)));
        }}
        className="h-6 w-14 rounded-md border border-brass/80 bg-input px-1 font-mono text-[10px] tabular-nums text-ink focus:border-pine focus:outline-none"
        aria-label={props.label}
      />
    </label>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10.5px] text-ink-secondary">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-[14px] w-[26px] shrink-0 rounded-full border transition-colors ${
          props.checked ? 'border-pine bg-pine' : 'border-brass-strong bg-card'
        }`}
      >
        <span
          className={`absolute top-[1px] h-[10px] w-[10px] rounded-full bg-white shadow-sm transition-[left] ${
            props.checked ? 'left-[13px]' : 'left-[1.5px]'
          }`}
        />
      </button>
      {props.label}
    </label>
  );
}

export function BarHint(props: { children: ReactNode }) {
  return <span className="shrink-0 text-[10px] text-ink-muted">{props.children}</span>;
}
