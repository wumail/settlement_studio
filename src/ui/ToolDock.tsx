import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Anchor,
  Brush,
  Building2,
  Dices,
  Droplets,
  MapPin,
  Milestone,
  Mountain,
  MousePointer2,
  Pencil,
  Route,
  Ruler,
  Square,
  Trees,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import type { ToolId } from '../schema/geometry.types';
import { useStudioStore } from '../store/useStudioStore';
import { TOOL_GROUPS, TOOL_HOTKEYS, TOOL_LABELS, type ToolGroup, type ToolGroupId } from './toolCatalog';

const ICONS: Readonly<Record<ToolId, LucideIcon>> = {
  select: MousePointer2,
  reroll_stamp: Dices,
  sculpt_brush: Brush,
  contour_drag: Activity,
  add_hill: Mountain,
  add_ridge: Pencil,
  draw_river: Waves,
  draw_water_area: Droplets,
  place_hydraulic: Anchor,
  draw_road: Route,
  edit_crossing: Milestone,
  draw_zone: Square,
  place_structure: Building2,
  tree_brush: Trees,
  place_landmark: MapPin,
  measure: Ruler,
};

const LONG_PRESS_MS = 280;

/** 左侧 PS 风格 7 组聚合工具栏：单击选组内记忆工具，右键/角标/长按 280ms 弹出子工具浮层 */
export function ToolDock() {
  const activeTool = useStudioStore((state) => state.activeTool);
  const lastToolInGroup = useStudioStore((state) => state.lastToolInGroup);
  const setActiveTool = useStudioStore((state) => state.setActiveTool);
  const [openGroup, setOpenGroup] = useState<ToolGroupId | null>(null);
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  useEffect(() => {
    if (openGroup === null) return;
    const close = (event: Event): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-tool-dock]')) return;
      setOpenGroup(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenGroup(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pick = (group: ToolGroup): void => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    setOpenGroup(null);
    setActiveTool(lastToolInGroup[group.id] ?? group.defaultTool);
  };

  return (
    <nav data-tool-dock className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-brass bg-panel py-2">
      {TOOL_GROUPS.map((group) => {
        const inside = group.tools.includes(activeTool);
        const shown = inside ? activeTool : lastToolInGroup[group.id] ?? group.defaultTool;
        const Icon = ICONS[shown];
        const active = inside;
        const expanded = openGroup === group.id;
        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() => pick(group)}
              onContextMenu={(event) => {
                event.preventDefault();
                setOpenGroup(group.id);
              }}
              onPointerDown={() => {
                longPressedRef.current = false;
                clearTimer();
                timerRef.current = window.setTimeout(() => {
                  longPressedRef.current = true;
                  setOpenGroup(group.id);
                }, LONG_PRESS_MS);
              }}
              onPointerUp={clearTimer}
              onPointerLeave={clearTimer}
              title={`${group.label} (${group.hotkey})`}
              aria-label={group.label}
              aria-expanded={expanded}
              className={`relative flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                active
                  ? 'border-terracotta bg-terracotta text-on-accent'
                  : 'border-transparent text-ink-secondary hover:border-brass hover:bg-card'
              }`}
            >
              <Icon size={18} strokeWidth={1.8} />
              {group.tools.length > 1 ? (
                <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[8px] leading-none opacity-70">◢</span>
              ) : null}
            </button>
            <button
              type="button"
              aria-label={`展开${group.label}子工具`}
              onClick={(event) => {
                event.stopPropagation();
                longPressedRef.current = false;
                setOpenGroup(expanded ? null : group.id);
              }}
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 cursor-pointer rounded-sm"
            />
            {expanded ? (
              <div className="absolute left-[46px] top-0 z-50 w-56 rounded-md border border-brass bg-panel p-1 shadow-lg">
                <div className="px-2 py-1 text-[10px] tracking-wide text-ink-muted">{group.label} · 组键 {group.hotkey}</div>
                {group.tools.map((tool) => {
                  const ToolIcon = ICONS[tool];
                  const current = tool === activeTool;
                  return (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        setActiveTool(tool);
                        setOpenGroup(null);
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                        current ? 'bg-terracotta text-on-accent' : 'text-ink-secondary hover:bg-card'
                      }`}
                    >
                      <ToolIcon size={14} strokeWidth={1.8} />
                      <span className="flex-1 truncate">{TOOL_LABELS[tool]}</span>
                      <span className={`font-mono text-[10px] ${current ? 'text-on-accent/80' : 'text-ink-muted'}`}>
                        {TOOL_HOTKEYS[tool] || '·'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
