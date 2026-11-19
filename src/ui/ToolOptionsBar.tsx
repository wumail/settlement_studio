import { useStudioStore } from '../store/useStudioStore';
import { groupOf, TOOL_HOTKEYS, TOOL_LABELS } from './toolCatalog';
import { BrushOptions, ContourOptions, TreeOptions } from './options/BrushPanels';
import { BarHint } from './options/controls';
import {
  LandmarkOptions,
  RidgeOptions,
  RoadOptions,
  SelectionOptions,
  WaterOptions,
  ZoneOptions,
} from './options/DrawPanels';
import { HydraulicOptions, StructureOptions } from './options/PlacePanels';

function optionsFor(tool: string) {
  switch (tool) {
    case 'select':
      return <SelectionOptions />;
    case 'sculpt_brush':
      return <BrushOptions />;
    case 'contour_drag':
      return <ContourOptions />;
    case 'tree_brush':
      return <TreeOptions />;
    case 'place_hydraulic':
      return <HydraulicOptions />;
    case 'place_structure':
      return <StructureOptions />;
    case 'draw_zone':
      return <ZoneOptions />;
    case 'draw_road':
      return <RoadOptions />;
    case 'draw_water_area':
      return <WaterOptions />;
    case 'add_ridge':
      return <RidgeOptions />;
    case 'place_landmark':
      return <LandmarkOptions />;
    case 'reroll_stamp':
      return <BarHint>单击任一选区即可重抽其随机布局，锁定选区不会被重抽</BarHint>;
    case 'add_hill':
      return <BarHint>拖出椭圆生成山包，按住 Shift 拖出盆地</BarHint>;
    case 'edit_crossing':
      return <BarHint>点选 40m 内桥位，循环切换石拱 / 木桥 / 双桥头堡 / 渡口</BarHint>;
    case 'measure':
      return <BarHint>拖出测距线，实时读数含距离、高差与坡度</BarHint>;
    default:
      return <BarHint>沿走势连续落点，双击或回车收尾</BarHint>;
  }
}

/** 顶部 36px 上下文选项栏：随 activeTool 动态横排当前工具高频参数 */
export function ToolOptionsBar() {
  const activeTool = useStudioStore((state) => state.activeTool);
  const group = groupOf(activeTool);
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-2 border-b border-brass/80 bg-card/70 px-2.5 backdrop-blur-[2px]"
      role="toolbar"
      aria-label="工具选项"
    >
      <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-brass/80 bg-panel px-2 py-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
        <span className="whitespace-nowrap text-[10.5px] font-semibold text-ink">{TOOL_LABELS[activeTool]}</span>
        <span className="rounded-sm bg-card px-1 font-mono text-[9.5px] text-ink-muted">{TOOL_HOTKEYS[activeTool] || group.hotkey}</span>
      </span>
      <span className="h-5 w-px shrink-0 bg-brass/70" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap">
        {optionsFor(activeTool)}
      </div>
    </div>
  );
}
