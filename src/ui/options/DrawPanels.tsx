import { fitViewportToWorld } from '../../renderer/RenderBackend';
import { ZONE_CONTENT_TYPES, type ZoneContentType } from '../../schema/project.schema';
import { useStudioStore } from '../../store/useStudioStore';
import { deleteSelection } from '../appHotkeys';
import { BarDivider, BarHint, BarLabel, Segmented, Toggle } from './controls';

const ZONE_LABELS: Readonly<Record<ZoneContentType, string>> = {
  walled_city: '内城',
  town_blocks: '关厢',
  village: '村寨',
  citadel: '堡寨',
  market: '集市',
  farmland: '农田',
  saltpan: '盐畦',
  woodland: '林地',
  exclusion: '禁建圈',
};

/** 选区类型 / 道路等级 / 水域模式 / 线性地形类型：直接横排切换 */
export function ZoneOptions() {
  const value = useStudioStore((state) => state.drawZoneContentType);
  return (
    <>
      <BarLabel>选区类型</BarLabel>
      <Segmented
        ariaLabel="选区类型"
        value={value}
        options={ZONE_CONTENT_TYPES.map((type) => ({ value: type, label: ZONE_LABELS[type] }))}
        onChange={(contentType) => useStudioStore.setState({ drawZoneContentType: contentType })}
      />
      <BarHint>多边形落点，回车 / 双击闭合</BarHint>
    </>
  );
}

export function RoadOptions() {
  const value = useStudioStore((state) => state.drawRoadTier);
  return (
    <>
      <BarLabel>道路等级</BarLabel>
      <Segmented
        ariaLabel="道路等级"
        value={value}
        options={[
          { value: 'highway', label: '驿道' },
          { value: 'street', label: '街巷' },
          { value: 'lane', label: '土径' },
        ]}
        onChange={(tier) => useStudioStore.setState({ drawRoadTier: tier })}
      />
      <BarDivider />
      <BarHint>连续落点，双击或回车收尾</BarHint>
    </>
  );
}

export function WaterOptions() {
  const value = useStudioStore((state) => state.drawWaterMode);
  return (
    <>
      <BarLabel>水域模式</BarLabel>
      <Segmented
        ariaLabel="水域模式"
        value={value}
        options={[
          { value: 'lake', label: '湖' },
          { value: 'sea', label: '海' },
          { value: 'open_canal', label: '明渠' },
          { value: 'qanat_canal', label: '暗渠' },
        ]}
        onChange={(mode) => useStudioStore.setState({ drawWaterMode: mode })}
      />
      <BarHint>湖海闭合需 ≥ 400 m²；明渠/暗渠按开放折线落盘</BarHint>
    </>
  );
}

export function RidgeOptions() {
  const value = useStudioStore((state) => state.drawLinearShapeType);
  return (
    <>
      <BarLabel>线性地形</BarLabel>
      <Segmented
        ariaLabel="线性地形类型"
        value={value}
        options={[
          { value: 'ridge', label: '山脊' },
          { value: 'valley', label: '冲沟' },
          { value: 'scarp', label: '陡坎' },
        ]}
        onChange={(kind) => useStudioStore.setState({ drawLinearShapeType: kind })}
      />
      <BarHint>沿走势连续落点，回车收尾</BarHint>
    </>
  );
}

/** 选择工具：当前选中对象快速操作（锁定 / 重抽 / 删除 / 居中缩放） */
export function SelectionOptions() {
  const selection = useStudioStore((state) => state.selection);
  const project = useStudioStore((state) => state.project);
  const viewport = useStudioStore((state) => state.viewport);
  const rerollZone = useStudioStore((state) => state.rerollZone);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const updateViewport = useStudioStore((state) => state.updateViewport);
  const zone = selection?.type === 'zone' ? project.zones.find((item) => item.id === selection.id) : null;
  return (
    <>
      <BarLabel>{selection ? `${selection.type} · ${selection.name ?? selection.id}` : '未选中对象'}</BarLabel>
      <BarDivider />
      <button
        type="button"
        disabled={!zone}
        onClick={() => { if (selection) rerollZone(selection.id); }}
        className="rounded border border-brass px-2 py-[2px] text-[10.5px] text-ink-secondary hover:bg-card disabled:opacity-40"
      >
        重抽
      </button>
      {zone ? (
        <Toggle
          label="锁定"
          checked={zone.locked}
          onChange={(locked) => mutateProject((draft) => {
            const target = draft.zones.find((item) => item.id === zone.id);
            if (target) target.locked = locked;
          })}
        />
      ) : null}
      <button
        type="button"
        disabled={!selection}
        onClick={() => deleteSelection()}
        className="rounded border border-brass px-2 py-[2px] text-[10.5px] text-status-warn hover:bg-card disabled:opacity-40"
      >
        删除
      </button>
      <button
        type="button"
        onClick={() => updateViewport(fitViewportToWorld(viewport, viewport.widthPx, viewport.heightPx, project.meta.worldSizeM))}
        className="rounded border border-brass px-2 py-[2px] text-[10.5px] text-ink-secondary hover:bg-card"
      >
        居中缩放
      </button>
    </>
  );
}

export function LandmarkOptions() {
  const key = useStudioStore((state) => state.activeLandmarkKey);
  const label = useStudioStore((state) => state.activeLandmarkLabel);
  const count = useStudioStore((state) => state.project.landmarks.length);
  return (
    <>
      <BarLabel>{`地标 · ${label}`}</BarLabel>
      <BarDivider />
      <BarHint>{`图例键 ${key} · 已落 ${count} 处`}</BarHint>
      <BarHint>新地标自动附顺序编号，供 guided 导览模式引用</BarHint>
    </>
  );
}
