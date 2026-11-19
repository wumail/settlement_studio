import { useEffect, useRef, type ReactNode } from 'react';
import { useStudioStore } from '../../store/useStudioStore';

const LABEL = 'shrink-0 whitespace-nowrap text-[11px] font-medium text-ink-secondary';
const INPUT =
  'h-7 rounded-md border border-brass/80 bg-input px-2 text-[11px] text-ink transition-colors focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine/15';
const BTN =
  'h-7 rounded-md border border-brass/80 bg-card px-2 text-[11px] text-ink-secondary transition-colors hover:bg-card-hover';
const STEP_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

/** 浅纸本卡片分区：左侧黄铜短竖线 + 舒展留白，层次一眼可读 */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-brass/70 px-3 py-2.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        <span className="h-2.5 w-[2px] rounded-full bg-brass-strong/80" />
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** 纤细测绘仪表滑块：3px 黄铜底轨 + 松针绿实心圆钮（样式见 atelier.css） */
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
  // 旧工程/场景回灌可能缺字段：绝不因 undefined.toFixed 让整块检视器白屏
  const value = Number.isFinite(props.value) ? props.value : props.min;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className={LABEL}>{props.label}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-muted">
          {value.toFixed(props.digits ?? 1)}
          {props.suffix ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={value}
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
        className="atelier-range mt-1 w-full"
      />
    </label>
  );
}

/** 数字输入：标签永不折行，输入框固定 w-24 */
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
        className={`${INPUT} w-24 shrink-0 text-right font-mono tabular-nums`}
      />
    </label>
  );
}

/** 名称等长文本：占满剩余宽度且可收缩，绝不把标签挤竖排 */
export function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        className={`${INPUT} min-w-0 flex-1`}
      />
    </label>
  );
}

/** 药丸滑动开关：替代原生绿色方框 checkbox */
export function ToggleField(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-[16px] w-[30px] shrink-0 rounded-full border transition-colors duration-150 ${
          props.checked ? 'border-pine bg-pine' : 'border-brass-strong bg-card'
        }`}
      >
        <span
          className={`absolute top-[1.5px] h-[11px] w-[11px] rounded-full bg-white shadow-sm transition-[left] duration-150 ${
            props.checked ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </button>
    </label>
  );
}

/** 下拉：固定 w-36，箭头由 atelier.css 统一绘制 */
export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL}>{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
        className={`${INPUT} atelier-select w-36 shrink-0 pr-6`}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export { BTN as FORM_BUTTON_CLASS };
