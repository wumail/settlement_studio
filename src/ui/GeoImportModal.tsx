import { useState } from 'react';
import { X } from 'lucide-react';
import { normalizeProject } from '../schema/project.schema';
import { useStudioStore } from '../store/useStudioStore';

interface GeoBootstrap {
  readonly ok: boolean;
  readonly elevM: number;
  readonly isLand: boolean;
  readonly owner: number;
  readonly lakeLabel: string;
  readonly slopeDirDeg: number;
  readonly slopeMagM: number;
  readonly grid: { readonly row: number; readonly col: number };
  readonly nearbyRivers: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly category: string;
    readonly minDistKm: number;
  }>;
  readonly suggestedRivers: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly localPoints: ReadonlyArray<readonly [number, number]>;
  }>;
}

const QUICK_ANCHORS: ReadonlyArray<{ label: string; lon: number; lat: number; span: number }> = [
  { label: '起点城 42.51 / 35.19', lon: 42.51, lat: 35.19, span: 2800 },
  { label: '长湖 35.61 / 28.53', lon: 35.61, lat: 28.53, span: 2400 },
  { label: '帕隆 29.04 / 14.58', lon: 29.04, lat: 14.58, span: 2000 },
];

/** TERRAX 经纬度地理上下文检索与一键锚定底图弹窗 */
export function GeoImportModal() {
  const setGeoModalOpen = useStudioStore((state) => state.setGeoModalOpen);
  const loadProject = useStudioStore((state) => state.loadProject);
  const [lon, setLon] = useState('42.51');
  const [lat, setLat] = useState('35.19');
  const [spanM, setSpanM] = useState('2800');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GeoBootstrap | null>(null);

  const probe = (): void => {
    setLoading(true);
    setError(null);
    const query = `lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&span_m=${encodeURIComponent(spanM)}`;
    fetch(`/api/geo/bootstrap?${query}`)
      .then((response) => (response.ok ? (response.json() as Promise<GeoBootstrap>) : Promise.reject(new Error('HTTP'))))
      .then((payload) => setData(payload))
      .catch(() => setError('无法连接后端地理桥接；请以离线独立模式继续手工测绘。'))
      .finally(() => setLoading(false));
  };

  const confirm = (): void => {
    if (!data) return;
    const span = Math.max(600, Math.min(8000, Number(spanM) || 2400));
    const river = data.suggestedRivers[0];
    const project = normalizeProject({
      meta: {
        name: `锚定底图 ${data.grid.row} / ${data.grid.col}`,
        subtitle: `lon ${lon} · lat ${lat} · 海拔 ${data.elevM.toFixed(1)} m`,
        worldSizeM: span,
        terraxAnchor: {
          lon: Number(lon),
          lat: Number(lat),
          elevM: data.elevM,
          regionNote: data.lakeLabel || (data.isLand ? 'B 大陆陆地' : '大洋'),
        },
        updatedAt: new Date().toISOString(),
      },
      terrain: {
        baseElev: Math.round(data.elevM),
        slopeMagM: Math.max(2, Math.min(60, data.slopeMagM || 16)),
        slopeDirDeg: data.slopeDirDeg,
        contourStep: 5,
      },
      rivers:
        river && river.localPoints.length >= 2
          ? [
              {
                id: `riv_${river.id}`,
                name: river.label,
                points: river.localPoints.map((point) => [point[0], point[1]] as [number, number]),
                widthStartM: 30,
                widthEndM: 44,
                carveDepthM: 6,
                rippleLines: 3,
              },
            ]
          : [],
    });
    loadProject(project, true);
    setGeoModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 backdrop-blur-sm">
      <div className="w-[480px] rounded-lg border border-brass bg-panel shadow-xl">
        <header className="flex items-center justify-between border-b border-brass px-4 py-2.5">
          <h2 className="font-map-serif text-[14px] font-semibold text-ink">TERRAX 经纬度地理引导</h2>
          <button type="button" onClick={() => setGeoModalOpen(false)} aria-label="关闭" className="text-ink-muted hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex gap-1">
            {QUICK_ANCHORS.map((anchor) => (
              <button
                key={anchor.label}
                type="button"
                onClick={() => {
                  setLon(String(anchor.lon));
                  setLat(String(anchor.lat));
                  setSpanM(String(anchor.span));
                  setData(null);
                }}
                className="rounded border border-brass bg-card px-1.5 py-1 text-[10px] text-ink-secondary hover:bg-card-hover"
              >
                {anchor.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-ink-muted">经度 lon</span>
              <input value={lon} onChange={(event) => setLon(event.target.value)} className="h-7 rounded border border-brass bg-input px-2 font-mono text-[11px] text-ink focus:border-pine focus:outline-none" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-ink-muted">纬度 lat</span>
              <input value={lat} onChange={(event) => setLat(event.target.value)} className="h-7 rounded border border-brass bg-input px-2 font-mono text-[11px] text-ink focus:border-pine focus:outline-none" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-ink-muted">图幅跨度 m</span>
              <input value={spanM} onChange={(event) => setSpanM(event.target.value)} className="h-7 rounded border border-brass bg-input px-2 font-mono text-[11px] text-ink focus:border-pine focus:outline-none" />
            </label>
          </div>
          <button type="button" onClick={probe} disabled={loading} className="h-7 rounded bg-pine text-[11px] text-on-accent hover:bg-pine-hover disabled:opacity-50">
            {loading ? '检索中…' : '检索 TERRAX 地理上下文'}
          </button>

          {error ? <p className="rounded border border-status-warn/40 bg-status-warn/10 px-2 py-1 text-[10px] text-status-warn">{error}</p> : null}

          {data ? (
            <div className="rounded border border-brass bg-card px-2 py-1.5 text-[10px] leading-5 text-ink-secondary">
              <div className="grid grid-cols-2 gap-x-3">
                <span>栅格行 / 列：{data.grid.row} / {data.grid.col}</span>
                <span>真值海拔：{data.elevM.toFixed(1)} m</span>
                <span>海陆：{data.isLand ? '陆地' : '大洋'}（owner {data.owner}）</span>
                <span>湖沼：{data.lakeLabel || '—'}</span>
                <span>坡向：{data.slopeDirDeg.toFixed(1)}°</span>
                <span>坡降：{data.slopeMagM.toFixed(1)} m</span>
              </div>
              <div className="mt-1 border-t border-brass pt-1">
                邻近河流：
                {data.nearbyRivers.length === 0
                  ? ' 无'
                  : data.nearbyRivers
                      .slice(0, 3)
                      .map((river) => `${river.label} (${river.minDistKm.toFixed(1)} km)`)
                      .join('、')}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-brass px-4 py-2">
          <button type="button" onClick={() => setGeoModalOpen(false)} className="h-7 rounded border border-brass bg-card px-3 text-[11px] text-ink-secondary hover:bg-card-hover">
            取消
          </button>
          <button type="button" onClick={confirm} disabled={!data} className="h-7 rounded bg-terracotta px-3 text-[11px] text-on-accent hover:opacity-90 disabled:opacity-40">
            生成锚定底图工程
          </button>
        </footer>
      </div>
    </div>
  );
}
