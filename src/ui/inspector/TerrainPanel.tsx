import { useStudioStore } from '../../store/useStudioStore';
import type { SculptBrushMode } from '../../schema/geometry.types';
import { NumberField, PanelSection, RangeField, SelectField, ToggleField } from './ZonePanel';

const BRUSH_MODES: ReadonlyArray<{ value: SculptBrushMode; label: string }> = [
  { value: 'raise', label: '隆起 raise' },
  { value: 'lower', label: '下压 lower' },
  { value: 'smooth', label: '平滑 smooth' },
  { value: 'flatten', label: '推平 flatten' },
];

/** 地形与等高线属性卡：全局坡面/等高距/截断区间/齿线开关/四模式笔刷/选中图元参数 */
export function TerrainPanel() {
  const project = useStudioStore((state) => state.project);
  const brush = useStudioStore((state) => state.brush);
  const selection = useStudioStore((state) => state.selection);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const updateBrush = useStudioStore((state) => state.updateBrush);
  const terrain = project.terrain;
  const patch = (recipe: (target: typeof terrain) => void): void => {
    mutateProject((draft) => {
      recipe(draft.terrain);
    }, false);
  };
  const shape = selection?.type === 'terrainShape' ? terrain.shapes.find((item) => item.id === selection.id) ?? null : null;

  return (
    <div className="flex flex-col">
      <PanelSection title="基底坡面">
        <NumberField label="基准高程" value={terrain.baseElev} step={1} onChange={(value) => patch((t) => { t.baseElev = value; })} />
        <RangeField label="坡降" value={terrain.slopeMagM} min={0} max={120} step={0.5} suffix="m" onChange={(value) => patch((t) => { t.slopeMagM = value; })} />
        <RangeField label="坡向" value={terrain.slopeDirDeg} min={0} max={359} step={1} digits={0} suffix="°" onChange={(value) => patch((t) => { t.slopeDirDeg = value; })} />
      </PanelSection>

      <PanelSection title="等高线">
        <RangeField label="等高距" value={terrain.contourStep} min={1} max={40} step={1} digits={0} suffix="m" onChange={(value) => patch((t) => { t.contourStep = value; })} />
        <NumberField label="计曲线间隔" value={terrain.indexEvery} min={1} max={20} onChange={(value) => patch((t) => { t.indexEvery = Math.max(1, Math.round(value)); })} />
        <NumberField label="最低截断" value={terrain.minContourElev} step={1} onChange={(value) => patch((t) => { t.minContourElev = value; })} />
        <NumberField label="最高截断" value={terrain.maxContourElev} step={1} onChange={(value) => patch((t) => { t.maxContourElev = value; })} />
        <ToggleField label="显示等高线" checked={terrain.showContours} onChange={(value) => mutateProject((draft) => { draft.terrain.showContours = value; })} />
        <ToggleField label="陡坎短齿线 (4.0m)" checked={terrain.showScarpTicks} onChange={(value) => mutateProject((draft) => { draft.terrain.showScarpTicks = value; })} />
        <RangeField label="齿线坡度阈值" value={terrain.scarpSlopeThresholdDeg} min={10} max={60} step={1} digits={0} suffix="°" onChange={(value) => patch((t) => { t.scarpSlopeThresholdDeg = value; })} />
      </PanelSection>

      <PanelSection title="微雕笔刷 (B)">
        <SelectField label="模式" value={brush.mode} options={BRUSH_MODES} onChange={(value) => updateBrush({ mode: value })} />
        <RangeField label="半径" value={brush.radiusM} min={8} max={240} step={2} digits={0} suffix="m" onChange={(value) => updateBrush({ radiusM: value })} />
        <RangeField label="强度" value={brush.strength} min={0.05} max={2} step={0.05} digits={2} onChange={(value) => updateBrush({ strength: value })} />
        <RangeField label="推平目标高程" value={brush.flattenTargetElev} min={-200} max={3000} step={5} digits={0} suffix="m" onChange={(value) => updateBrush({ flattenTargetElev: value })} />
        <p className="text-[10px] leading-4 text-ink-muted">Alt + 左键在画布吸取任意点实时海拔作为推平目标。</p>
      </PanelSection>

      <PanelSection title="选中地形图元">
        {shape && !('points' in shape) ? (
          <>
            <NumberField label="中心 X" value={shape.cx} step={1} onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.cx = value; })} />
            <NumberField label="中心 Y" value={shape.cy} step={1} onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.cy = value; })} />
            <RangeField label="长半轴 rx" value={shape.rx} min={25} max={1600} step={5} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.rx = value; })} />
            <RangeField label="短半轴 ry" value={shape.ry} min={25} max={1600} step={5} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.ry = value; })} />
            <RangeField label="旋转角" value={shape.angleDeg} min={-180} max={180} step={1} digits={0} suffix="°" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.angleDeg = value; })} />
            <RangeField label="高差" value={shape.deltaElev} min={-120} max={220} step={1} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.deltaElev = value; })} />
            <RangeField label="偏心焦点 X" value={shape.focusX} min={-0.72} max={0.72} step={0.01} digits={2} onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.focusX = value; })} />
            <RangeField label="偏心焦点 Y" value={shape.focusY} min={-0.72} max={0.72} step={0.01} digits={2} onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && (s.type === 'hill' || s.type === 'basin')) s.focusY = value; })} />
          </>
        ) : shape && 'points' in shape ? (
          <>
            <RangeField label="高差" value={shape.deltaElev} min={-120} max={220} step={1} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && 'points' in s) s.deltaElev = value; })} />
            <RangeField label="左坡宽" value={shape.widthLeft} min={20} max={600} step={5} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && 'points' in s) s.widthLeft = value; })} />
            <RangeField label="右坡宽" value={shape.widthRight} min={20} max={600} step={5} digits={0} suffix="m" onChange={(value) => patch((t) => { for (const s of t.shapes) if (s.id === shape.id && 'points' in s) s.widthRight = value; })} />
            <p className="text-[10px] text-ink-muted">折线控制点 {shape.points.length} 个</p>
          </>
        ) : (
          <p className="text-[11px] leading-5 text-ink-muted">用 H 拖出山包/盆地，或用 G 连续落点绘制脊、沟与陡坎。</p>
        )}
      </PanelSection>
    </div>
  );
}
