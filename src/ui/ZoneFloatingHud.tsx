import { useStudioStore } from '../store/useStudioStore';
import { ZONE_CONTENT_TYPES, type ZoneContentType } from '../schema/project.schema';

const CONTENT_LABELS: Readonly<Record<ZoneContentType, string>> = {
  walled_city: '内城',
  town_blocks: '关厢',
  village: '村寨',
  citadel: '堡寨',
  market: '集场',
  farmland: '条田',
  saltpan: '盐畦',
  woodland: '疏林',
  exclusion: '禁建',
};

/** 选中选区时浮于画布顶部中央的抽卡胶囊条：改名 / 换类型 / 重抽 / 面积 / 锁定 */
export function ZoneFloatingHud() {
  const selection = useStudioStore((state) => state.selection);
  const zone = useStudioStore((state) =>
    state.selection?.type === 'zone' ? state.project.zones.find((item) => item.id === state.selection?.id) : undefined,
  );
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const rerollZone = useStudioStore((state) => state.rerollZone);

  if (selection?.type !== 'zone' || !zone) return null;
  const areaHa = Math.abs(
    zone.points.reduce((sum, point, index) => {
      const next = zone.points[(index + 1) % zone.points.length];
      return next ? sum + point[0] * next[1] - next[0] * point[1] : sum;
    }, 0),
  ) / 20000;

  return (
    <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-brass bg-panel/95 px-2.5 py-1.5 shadow-md backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-terracotta" />
      <input
        value={zone.name}
        onChange={(event) =>
          mutateProject((draft) => {
            const target = draft.zones.find((item) => item.id === zone.id);
            if (target) target.name = event.target.value;
          }, false)
        }
        className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-medium text-ink hover:border-brass focus:border-pine focus:bg-input focus:outline-none"
      />
      <select
        value={zone.contentType}
        onChange={(event) =>
          mutateProject((draft) => {
            const target = draft.zones.find((item) => item.id === zone.id);
            if (target) target.contentType = event.target.value as ZoneContentType;
          })
        }
        className="h-6 rounded border border-brass bg-input px-1 text-[11px] text-ink-secondary"
      >
        {ZONE_CONTENT_TYPES.map((type) => (
          <option key={type} value={type}>
            {CONTENT_LABELS[type]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={zone.locked}
        onClick={() => rerollZone(zone.id)}
        className="h-6 rounded bg-pine px-2 text-[11px] text-on-accent hover:bg-pine-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {zone.locked ? '🔒 已锁定' : '重抽此选区 (R)'}
      </button>
      <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">{areaHa.toFixed(2)} ha</span>
      <label className="flex items-center gap-1 text-[10px] text-ink-muted">
        <input
          type="checkbox"
          checked={zone.locked}
          onChange={(event) =>
            mutateProject((draft) => {
              const target = draft.zones.find((item) => item.id === zone.id);
              if (target) target.locked = event.target.checked;
            }, false)
          }
          className="h-3 w-3 accent-pine"
        />
        锁定
      </label>
      <button
        type="button"
        onClick={() => useStudioStore.getState().setSelection(null)}
        className="text-[13px] leading-none text-ink-muted hover:text-ink"
        aria-label="关闭选区胶囊"
      >
        ×
      </button>
    </div>
  );
}
