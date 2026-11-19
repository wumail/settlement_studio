import {
  Activity,
  Brush,
  Droplets,
  Gem,
  MapPin,
  Mountain,
  MousePointer2,
  Pencil,
  Route,
  Ruler,
  Square,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { TOOL_IDS, type ToolId } from '../schema/geometry.types';
import { useStudioStore } from '../store/useStudioStore';

interface ToolMeta {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hotkey: string;
}

const TOOL_META: Readonly<Record<ToolId, ToolMeta>> = {
  select: { icon: MousePointer2, label: '选择与手柄微调', hotkey: 'V' },
  contour_drag: { icon: Activity, label: '等高线直接推拉', hotkey: 'C' },
  sculpt_brush: { icon: Brush, label: '高程微雕笔刷', hotkey: 'B' },
  add_hill: { icon: Mountain, label: '放置偏心山包/盆地', hotkey: 'H' },
  add_ridge: { icon: Pencil, label: '绘制山脊/冲沟/陡坎', hotkey: 'G' },
  draw_river: { icon: Waves, label: '绘制纯净变宽河流', hotkey: 'W' },
  draw_water_area: { icon: Droplets, label: '绘制湖海/明暗水渠', hotkey: 'L' },
  place_reef: { icon: Gem, label: '点放基岩礁石/渡口', hotkey: 'K' },
  draw_road: { icon: Route, label: '绘制三级主次干道', hotkey: 'D' },
  draw_zone: { icon: Square, label: '绘制多边形抽卡选区', hotkey: 'Z' },
  place_landmark: { icon: MapPin, label: '点放图例地标戳记', hotkey: 'M' },
  measure: { icon: Ruler, label: '测距与高程剖面', hotkey: 'U' },
};

/** 左侧 12 枚测绘工具坞：严守 NG-01，绝无任何单栋房屋编辑入口 */
export function ToolDock() {
  const activeTool = useStudioStore((state) => state.activeTool);
  const setActiveTool = useStudioStore((state) => state.setActiveTool);

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-brass bg-panel py-2">
      {TOOL_IDS.map((toolId) => {
        const meta = TOOL_META[toolId];
        const Icon = meta.icon;
        const active = activeTool === toolId;
        return (
          <button
            key={toolId}
            type="button"
            onClick={() => setActiveTool(toolId)}
            title={`${meta.label} (${meta.hotkey})`}
            aria-label={meta.label}
            className={`group relative flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
              active
                ? 'border-terracotta bg-terracotta text-on-accent'
                : 'border-transparent text-ink-secondary hover:border-brass hover:bg-card'
            }`}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span className="pointer-events-none absolute left-11 z-30 hidden whitespace-nowrap rounded border border-brass bg-panel px-2 py-1 text-[11px] text-ink shadow-sm group-hover:block">
              {meta.label}
              <span className="ml-1 font-mono text-ink-muted">{meta.hotkey}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
