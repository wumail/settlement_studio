import { useStudioStore } from '../../store/useStudioStore';
import { NumberField, PanelSection, SelectField } from './FormControls';
import { LayerOrderField } from './LayerOrderField';

const ROAD_TIERS: ReadonlyArray<{ value: 'highway' | 'street' | 'lane'; label: string }> = [
  { value: 'highway', label: '干道 highway 14m' },
  { value: 'street', label: '街路 street 9m' },
  { value: 'lane', label: '巷道 lane 5m' },
];

/** 水系与道路属性卡：仅保留选中要素精确参数（绘图子模式已由顶部选项栏接管） */
export function HydroRoadPanel() {
  const project = useStudioStore((state) => state.project);
  const selection = useStudioStore((state) => state.selection);
  const updateViewportState = useStudioStore((state) => state.mutateProject);

  const river = selection?.type === 'river' ? project.rivers.find((item) => item.id === selection.id) : undefined;
  const body = selection?.type === 'waterBody' ? project.waterBodies.find((item) => item.id === selection.id) : undefined;
  const canal = selection?.type === 'canal' ? project.canals.find((item) => item.id === selection.id) : undefined;
  const road = selection?.type === 'road' ? project.roads.find((item) => item.id === selection.id) : undefined;
  const reef = selection?.type === 'reef' ? project.reefs.find((item) => item.id === selection.id) : undefined;
  const ford = selection?.type === 'ford' ? project.fords.find((item) => item.id === selection.id) : undefined;

  const editRiver = (recipe: (target: (typeof project.rivers)[number]) => void, recompile = false): void => {
    if (!river) return;
    updateViewportState((draft) => {
      const target = draft.rivers.find((item) => item.id === river.id);
      if (target) recipe(target);
    }, recompile);
  };
  const editCanal = (recipe: (target: (typeof project.canals)[number]) => void, recompile = false): void => {
    if (!canal) return;
    updateViewportState((draft) => {
      const target = draft.canals.find((item) => item.id === canal.id);
      if (target) recipe(target);
    }, recompile);
  };
  const editRoad = (recipe: (target: (typeof project.roads)[number]) => void, recompile = false): void => {
    if (!road) return;
    updateViewportState((draft) => {
      const target = draft.roads.find((item) => item.id === road.id);
      if (target) recipe(target);
    }, recompile);
  };
  const editReef = (recipe: (target: (typeof project.reefs)[number]) => void, recompile = false): void => {
    if (!reef) return;
    updateViewportState((draft) => {
      const target = draft.reefs.find((item) => item.id === reef.id);
      if (target) recipe(target);
    }, recompile);
  };

  return (
    <div className="flex flex-col">
      <PanelSection title="选中水系要素">
        {river ? (
          <>
            <NumberField label="上游河宽" value={river.widthStartM} min={6} max={600} onChange={(value) => editRiver((target) => { target.widthStartM = value; })} />
            <NumberField label="下游河宽" value={river.widthEndM} min={6} max={600} onChange={(value) => editRiver((target) => { target.widthEndM = value; })} />
            <NumberField label="下切深度" value={river.carveDepthM} min={0} max={120} onChange={(value) => editRiver((target) => { target.carveDepthM = value; })} />
            <NumberField label="贴岸水纹" value={river.rippleLines} min={0} max={3} onChange={(value) => editRiver((target) => { target.rippleLines = Math.max(0, Math.min(3, Math.round(value))); })} />
          </>
        ) : null}
        {body ? (
          <>
            <SelectField label="水体类型" value={body.kind} options={[{ value: 'lake' as const, label: '湖泊' }, { value: 'sea' as const, label: '海域' }]} onChange={(value) => updateViewportState((draft) => { const target = draft.waterBodies.find((item) => item.id === body.id); if (target) target.kind = value; }, true)} />
            <NumberField label="内缩水纹" value={body.rippleLines} min={0} max={3} onChange={(value) => updateViewportState((draft) => { const target = draft.waterBodies.find((item) => item.id === body.id); if (target) target.rippleLines = Math.max(0, Math.min(3, Math.round(value))); }, false)} />
          </>
        ) : null}
        {canal ? (
          <>
            <NumberField label="渠宽" value={canal.widthM} min={1.2} max={60} step={0.5} onChange={(value) => editCanal((target) => { target.widthM = value; })} />
            <SelectField label="渠型" value={canal.style} options={[
              { value: 'stone_clean' as const, label: '石砌净渠' },
              { value: 'open' as const, label: '明渠 open' },
              { value: 'irrigation' as const, label: '灌溉支渠' },
              { value: 'drainage_dashed' as const, label: '排碱截渗' },
              { value: 'foul_outfall' as const, label: '污尾渠' },
              { value: 'qanat' as const, label: '坎儿井 qanat' },
            ]} onChange={(value) => editCanal((target) => { target.style = value; }, true)} />
            <p className="text-[10px] text-ink-muted">坎儿井沿弧长每 45m 自动生成白底深青竖井环。</p>
          </>
        ) : null}
      </PanelSection>

      <PanelSection title="选中道路 / 礁石 / 渡口">
        {road ? (
          <>
            <SelectField label="路级" value={road.tier} options={ROAD_TIERS} onChange={(value) => editRoad((target) => { target.tier = value; }, true)} />
            <NumberField label="路宽" value={road.widthM} min={2} max={60} step={0.5} onChange={(value) => editRoad((target) => { target.widthM = value; })} />
          </>
        ) : null}
        {reef ? (
          <>
            <NumberField label="礁石半径" value={reef.radiusM} min={4} max={120} onChange={(value) => editReef((target) => { target.radiusM = value; })} />
            <NumberField label="礁石簇数" value={reef.count} min={1} max={3} onChange={(value) => editReef((target) => { target.count = Math.max(1, Math.min(3, Math.round(value))); })} />
            <NumberField label="旋转角" value={reef.angleDeg} min={-180} max={180} onChange={(value) => editReef((target) => { target.angleDeg = value; })} />
          </>
        ) : null}
        {ford ? (
          <NumberField
            label="渡口豁免半径"
            value={ford.radiusM}
            min={6}
            max={120}
            onChange={(value) =>
              updateViewportState((draft) => {
                const target = draft.fords.find((item) => item.id === ford.id);
                if (target) target.radiusM = value;
              }, false)
            }
          />
        ) : null}
        {!river && !body && !canal && !road && !reef && !ford ? (
          <p className="text-[11px] leading-5 text-ink-muted">用 W / L / D / K 工具绘制，或在画布点选已有水系与道路要素。</p>
        ) : null}
      </PanelSection>

      <PanelSection title="要素统计">
        <div className="grid grid-cols-2 gap-1 text-[10px] text-ink-muted">
          <span>河道 {project.rivers.length}</span>
          <span>湖海 {project.waterBodies.length}</span>
          <span>水渠 {project.canals.length}</span>
          <span>道路 {project.roads.length}</span>
          <span>礁石 {project.reefs.length}</span>
          <span>渡口 {project.fords.length}</span>
        </div>
      </PanelSection>
      <LayerOrderField />
    </div>
  );
}
