import type { SculptBrushMode } from '../../schema/geometry.types';
import { useStudioStore } from '../../store/useStudioStore';
import { BarDivider, BarHint, BarLabel, NumBox, Segmented, Slider, Toggle } from './controls';

const MODES: ReadonlyArray<{ value: SculptBrushMode; label: string }> = [
  { value: 'raise', label: '隆起' },
  { value: 'lower', label: '下压' },
  { value: 'flatten', label: '推平' },
  { value: 'terrace', label: '阶地' },
  { value: 'ramp', label: '斜坡' },
  { value: 'smooth', label: '平滑' },
  { value: 'erase', label: '擦除' },
];

/** 地形笔刷参数：七模式 + 半径 + 硬度 + 强度 + 推平锁高 / 阶地步高 */
export function BrushOptions() {
  const brush = useStudioStore((state) => state.brush);
  const updateBrush = useStudioStore((state) => state.updateBrush);
  return (
    <>
      <Segmented
        ariaLabel="笔刷模式"
        value={brush.mode}
        options={MODES}
        onChange={(mode) => updateBrush({ mode })}
      />
      <BarDivider />
      <Slider label="半径" value={brush.radiusM} min={8} max={280} step={2} suffix="m" onChange={(radiusM) => updateBrush({ radiusM })} />
      <Slider label="硬度" value={brush.hardness} min={0} max={0.95} step={0.01} digits={2} onChange={(hardness) => updateBrush({ hardness })} />
      <Slider label="强度" value={brush.strength} min={0.05} max={2} step={0.05} digits={2} onChange={(strength) => updateBrush({ strength })} />
      {brush.mode === 'flatten' ? (
        <>
          <BarDivider />
          <Toggle label="自动锁起笔海拔" checked={brush.autoLockStartElev} onChange={(autoLockStartElev) => updateBrush({ autoLockStartElev })} />
          <NumBox label="目标" value={Math.round(brush.flattenTargetElev)} min={-200} max={3000} step={5} onChange={(flattenTargetElev) => updateBrush({ flattenTargetElev })} />
          <BarHint>Alt + 点击吸取海拔</BarHint>
        </>
      ) : null}
      {brush.mode === 'terrace' ? (
        <>
          <BarDivider />
          <Slider label="阶地步高" value={brush.terraceStepM} min={2} max={20} step={1} suffix="m" onChange={(terraceStepM) => updateBrush({ terraceStepM })} />
        </>
      ) : null}
      {brush.mode === 'ramp' ? <BarHint>拖出起止点，松手一次拉平斜坡</BarHint> : null}
    </>
  );
}

/** 等高线推拉：半径与力度解除 90 / 0.85 硬编码 */
export function ContourOptions() {
  const brush = useStudioStore((state) => state.brush);
  const updateBrush = useStudioStore((state) => state.updateBrush);
  return (
    <>
      <Slider label="影响半径" value={brush.radiusM} min={8} max={280} step={2} suffix="m" onChange={(radiusM) => updateBrush({ radiusM })} />
      <BarDivider />
      <Slider label="推拉力度" value={brush.strength} min={0.05} max={2} step={0.05} digits={2} onChange={(strength) => updateBrush({ strength })} />
      <BarHint>Shift 临时平滑 · Alt 反向</BarHint>
    </>
  );
}

/** 林木笔刷：涂抹 / 擦除、半径、间距疏密与冠幅区间 */
export function TreeOptions() {
  const treeBrush = useStudioStore((state) => state.treeBrush);
  const updateTreeBrush = useStudioStore((state) => state.updateTreeBrush);
  return (
    <>
      <Segmented
        ariaLabel="林木笔刷模式"
        value={treeBrush.eraseMode ? 'erase' : 'paint'}
        options={[
          { value: 'paint', label: '涂抹' },
          { value: 'erase', label: '擦除' },
        ]}
        onChange={(mode) => updateTreeBrush({ eraseMode: mode === 'erase' })}
      />
      <BarDivider />
      <Slider label="半径" value={treeBrush.radiusM} min={8} max={280} step={2} suffix="m" onChange={(radiusM) => updateTreeBrush({ radiusM })} />
      <Slider label="间距" value={treeBrush.spacingM} min={0.3} max={1.5} step={0.05} digits={2} onChange={(spacingM) => updateTreeBrush({ spacingM })} />
      <Slider label="冠幅小" value={treeBrush.minR} min={2.5} max={12} step={0.1} digits={1} suffix="m" onChange={(minR) => updateTreeBrush({ minR: Math.min(minR, treeBrush.maxR) })} />
      <Slider label="冠幅大" value={treeBrush.maxR} min={4} max={16} step={0.1} digits={1} suffix="m" onChange={(maxR) => updateTreeBrush({ maxR: Math.max(maxR, treeBrush.minR) })} />
      <BarHint>按住 Alt 临时擦除</BarHint>
    </>
  );
}

/** 通用：把当前工具的组内参数标题显示出来，避免选项栏过于空旷 */
export function ToolOptionsTitle(props: { label: string }) {
  return <BarLabel>{props.label}</BarLabel>;
}
