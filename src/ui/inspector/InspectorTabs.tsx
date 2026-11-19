import { useEffect } from 'react';
import type { InspectorTabId } from '../../schema/geometry.types';
import { useStudioStore } from '../../store/useStudioStore';
import { HydroRoadPanel } from './HydroRoadPanel';
import { LegendPanel } from './LegendPanel';
import { PalettePanel } from './PalettePanel';
import { TerrainPanel } from './TerrainPanel';
import { ZonePanel } from './ZonePanel';

const TABS: ReadonlyArray<{ id: InspectorTabId; label: string }> = [
  { id: 'terrain', label: '地形' },
  { id: 'hydro_road', label: '水路' },
  { id: 'zone', label: '选区' },
  { id: 'legend', label: '图例' },
  { id: 'palette', label: '配色导出' },
];

const HYRDO_TYPES = new Set(['river', 'waterBody', 'canal', 'road', 'reef', 'ford']);

/** 右侧 320px 检视器容器：5 标签路由 + 画布点选自动联动切页 */
export function InspectorTabs() {
  const activeTab = useStudioStore((state) => state.activeTab);
  const setActiveTab = useStudioStore((state) => state.setActiveTab);

  useEffect(() => {
    return useStudioStore.subscribe((state, previous) => {
      if (state.selection === previous.selection) return;
      const type = state.selection?.type;
      if (type === 'zone') state.setActiveTab('zone');
      else if (type === 'terrainShape') state.setActiveTab('terrain');
      else if (type && HYRDO_TYPES.has(type)) state.setActiveTab('hydro_road');
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-stretch border-b border-brass">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex-1 text-[11px] transition-colors ${
              activeTab === tab.id ? 'text-pine' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {activeTab === tab.id ? <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-t bg-pine" /> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'terrain' ? <TerrainPanel /> : null}
        {activeTab === 'hydro_road' ? <HydroRoadPanel /> : null}
        {activeTab === 'zone' ? <ZonePanel /> : null}
        {activeTab === 'legend' ? <LegendPanel /> : null}
        {activeTab === 'palette' ? <PalettePanel /> : null}
      </div>
    </div>
  );
}
