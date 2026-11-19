import { useStudioStore } from '../store/useStudioStore';

export interface CursorTelemetry {
  readonly wx: number;
  readonly wy: number;
  readonly elevM: number | null;
  readonly slopeDeg: number | null;
  readonly visible: boolean;
}

export const EMPTY_TELEMETRY: CursorTelemetry = {
  wx: 0,
  wy: 0,
  elevM: null,
  slopeDeg: null,
  visible: false,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-ink-secondary">{value}</span>
    </span>
  );
}

/** 底部读数状态栏：世界坐标 / 海拔 / 坡度 / 缩放 / 要素计数 / 离线徽章 / 零穿模绿灯 */
export function StatusBar({ telemetry }: { telemetry: CursorTelemetry }) {
  const scene = useStudioStore((state) => state.compiledScene);
  const viewport = useStudioStore((state) => state.viewport);
  const backendOnline = useStudioStore((state) => state.backendOnline);
  const isCompiling = useStudioStore((state) => state.isCompiling);
  const report = scene?.collisionReport ?? null;

  return (
    <footer className="flex h-[30px] shrink-0 items-center gap-4 overflow-hidden border-t border-brass bg-panel px-3 text-ink">
      <Stat label="X" value={telemetry.visible ? `${telemetry.wx.toFixed(1)} m` : '—'} />
      <Stat label="Y" value={telemetry.visible ? `${telemetry.wy.toFixed(1)} m` : '—'} />
      <Stat label="海拔" value={telemetry.elevM === null ? '—' : `${telemetry.elevM.toFixed(1)} m`} />
      <Stat label="坡度" value={telemetry.slopeDeg === null ? '—' : `${telemetry.slopeDeg.toFixed(1)}°`} />
      <Stat label="缩放" value={`${Math.round(viewport.zoom * 100)}%`} />
      <Stat label="选区" value={`${scene?.stats.zoneCount ?? 0}`} />
      <Stat label="屋宇" value={`${scene?.stats.buildingCount ?? 0}`} />
      <Stat label="桥梁" value={`${scene?.stats.bridgeCount ?? 0}`} />
      <span className="flex-1" />
      <span
        className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${
          backendOnline ? 'bg-pine/10 text-pine' : 'bg-card text-ink-muted'
        }`}
      >
        {backendOnline ? '后端在线' : '离线独立模式'}
      </span>
      <span
        className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${
          report === null
            ? 'bg-card text-ink-muted'
            : report.passed
              ? 'bg-status-ok/12 text-status-ok'
              : 'bg-status-warn/12 text-status-warn'
        }`}
      >
        {report === null
          ? isCompiling
            ? '核验中…'
            : '核验中…'
          : report.passed
            ? `✓ 零穿模核验 (0 冲突)`
            : `✗ 冲突 ${report.totalHits}`}
      </span>
    </footer>
  );
}
