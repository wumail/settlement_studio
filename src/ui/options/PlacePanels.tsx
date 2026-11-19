import { type HydraulicKind, STRUCTURE_KINDS, type StructureKind } from '../../schema/v3.entity.schema';
import { useStudioStore } from '../../store/useStudioStore';
import { BarDivider, BarHint, NumBox, Segmented, Slider, Toggle } from './controls';

const HYDRAULIC_OPTIONS: ReadonlyArray<{ value: HydraulicKind; label: string }> = [
  { value: 'weir', label: '分水堰' },
  { value: 'dock_slipway', label: '滑道坞' },
  { value: 'dock_pier', label: '木栈桥' },
  { value: 'watermill', label: '水力工坊' },
  { value: 'reef', label: '底礁' },
  { value: 'ford', label: '渡口' },
];

const STRUCTURE_LABELS: Readonly<Record<StructureKind, string>> = {
  rect: '长殿公仓',
  l_hall: 'L 形厅',
  u_court: 'U 形合院',
  round_altar: '圆坛',
};

/** 水工结构件：六类子型 + 闸孔数 + 岸线自动吸附 */
export function HydraulicOptions() {
  const preset = useStudioStore((state) => state.hydraulicPreset);
  const setPreset = useStudioStore((state) => state.setHydraulicPreset);
  return (
    <>
      <Segmented
        ariaLabel="水工子类型"
        value={preset.kind}
        options={HYDRAULIC_OPTIONS}
        onChange={(kind) => setPreset({ kind })}
      />
      <BarDivider />
      {preset.kind === 'weir' ? (
        <Slider label="闸孔" value={preset.sluices} min={1} max={8} step={1} onChange={(sluices) => setPreset({ sluices: Math.round(sluices) })} />
      ) : null}
      {preset.kind === 'dock_slipway' || preset.kind === 'dock_pier' ? (
        <Slider label="滑道数" value={preset.slips} min={1} max={8} step={1} onChange={(slips) => setPreset({ slips: Math.round(slips) })} />
      ) : null}
      <Toggle label="自动吸附水岸" checked={preset.autoSnap} onChange={(autoSnap) => setPreset({ autoSnap })} />
      <BarHint>落点自动对齐最近河道走向与法向</BarHint>
    </>
  );
}

/** 核心建筑群：形制 / 宽深 / 屋顶色角色 */
export function StructureOptions() {
  const preset = useStudioStore((state) => state.structurePreset);
  const setPreset = useStudioStore((state) => state.setStructurePreset);
  return (
    <>
      <Segmented
        ariaLabel="建筑形制"
        value={preset.kind}
        options={STRUCTURE_KINDS.map((kind) => ({ value: kind, label: STRUCTURE_LABELS[kind] }))}
        onChange={(kind) => setPreset({ kind })}
      />
      <BarDivider />
      <NumBox label="宽" value={preset.widthM} min={8} max={160} onChange={(widthM) => setPreset({ widthM })} />
      <NumBox label="深" value={preset.depthM} min={8} max={160} onChange={(depthM) => setPreset({ depthM })} />
      <Segmented
        ariaLabel="屋顶色角色"
        value={preset.roofKind}
        options={[
          { value: 'inner', label: '内城' },
          { value: 'town', label: '关厢' },
          { value: 'citadel', label: '堡寨' },
        ]}
        onChange={(roofKind) => setPreset({ roofKind })}
      />
    </>
  );
}
