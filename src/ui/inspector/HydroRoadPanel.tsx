import { useStudioStore } from '../../store/useStudioStore';
import { NumberField, PanelSection, SelectField } from './ZonePanel';

type WaterMode = 'lake' | 'sea' | 'open_canal' | 'qanat_canal';

const WATER_MODES: ReadonlyArray<{ value: WaterMode; label: string }> = [
  { value: 'lake', label: '湖泊 lake' },
  { value: 'sea', label: '海域 sea' },
  { value: 'open_canal', label: '明渠 open' },
  { value: 'qanat_canal', label: '坎儿井 qanat' },
];

const ROAD_TIERS: ReadonlyArray<{ value: 'highway' | 'street' | 'lane'; label: string }> = [
  { value: 'highway', label: '干道 highway 14m' },
  { value: 'street', label: '街路 street 9m' },
  { value: 'lane', label: '巷道 lane 5m' },
];

const LINEAR_TYPES: ReadonlyArray<{ value: 'ridge' | 'valley' | 'scarp'; label: string }> = [
  { value: 'ridge', label: '山脊 ridge' },
  { value: 'valley', label: '冲沟 valley' },
  { value: 'scarp', label: '陡坎 scarp' },
];

/** 水系礁石道路桥梁属性卡：绘图子模式 + 选中要素参数编辑 */
export function HydroRoadPanel() {
  const project = useStudioStore((state) => state.project);
  const selection = useStudioStore((state) => state.selection);
  const drawWaterMode = useStudioStore((state) => state.drawWaterMode);
  const drawRoadTier = useStudioStore((state) => state.drawRoadTier);
  const drawLinearShapeType = useStudioStore((state) => state.drawLinearShapeType);
  const drawReefMode = useStudioStore((state) => state.drawReefMode);
  const setActiveTool = useStudioStore((state) => state.setActiveTool);
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
      <PanelSection title="绘图子模式">
        <SelectField label="水域 (L)" value={drawWaterMode as WaterMode} options={WATER_MODES} onChange={(value) => {
          useStudioStore.setState({ drawWaterMode: value });
          setActiveTool('draw_water_area');
        }} />
        <SelectField label="道路 (D)" value={drawRoadTier} options={ROAD_TIERS} onChange={(value) => {
          useStudioStore.setState({ drawRoadTier: value });
          setActiveTool('draw_road');
        }} />
        <SelectField label="线性地形 (G)" value={drawLinearShapeType} options={LINEAR_TYPES} onChange={(value) => {
          useStudioStore.setState({ drawLinearShapeType: value });
          setActiveTool('add_ridge');
        }} />
        <SelectField label="礁石/渡口 (K)" value={drawReefMode} options={[{ value: 'reef' as const, label: '底礁 reef' }, { value: 'ford' as const, label: '涉水渡口 ford' }]} onChange={(value) => {
          useStudioStore.getState().setDrawReefMode(value);
          setActiveTool('place_reef');
        }} />
      </PanelSection>

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
            <SelectField label="渠型" value={canal.style} options={[{ value: 'open' as const, label: '明渠 open' }, { value: 'qanat' as const, label: '坎儿井 qanat' }]} onChange={(value) => editCanal((target) => { target.style = value; }, true)} />
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
    </div>
  );
}
