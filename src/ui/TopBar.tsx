import { useEffect, useState, type ReactNode } from 'react';
import { Download, FolderOpen, ImageDown, MapPin, Redo2, Save, Undo2 } from 'lucide-react';
import { exportScenePngBlob, downloadPngFile, downloadProjectJsonFile, downloadSvgFile, openProjectFilePicker, readProjectJsonFromFile } from '../renderer/exportUtils';
import { BUILTIN_PRESETS, type PresetKey } from '../schema/presets';
import { useStudioStore, useTemporalStore } from '../store/useStudioStore';

function IconButton(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-8 items-center gap-1 rounded-md border border-brass bg-card px-2 text-[11px] text-ink-secondary transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

/** 顶部工程栏：标题内联编辑、预设切换、经纬度导入、撤销重做与存取导出 */
export function TopBar() {
  const project = useStudioStore((state) => state.project);
  const scene = useStudioStore((state) => state.compiledScene);
  const backendOnline = useStudioStore((state) => state.backendOnline);
  const terraxDataAvailable = useStudioStore((state) => state.terraxDataAvailable);
  const loadPreset = useStudioStore((state) => state.loadPreset);
  const loadProject = useStudioStore((state) => state.loadProject);
  const mutateProject = useStudioStore((state) => state.mutateProject);
  const beginContinuousEdit = useStudioStore((state) => state.beginContinuousEdit);
  const endContinuousEdit = useStudioStore((state) => state.endContinuousEdit);
  const undoProject = useStudioStore((state) => state.undoProject);
  const redoProject = useStudioStore((state) => state.redoProject);
  const setGeoModalOpen = useStudioStore((state) => state.setGeoModalOpen);
  const pastCount = useTemporalStore((state) => state.pastStates.length);
  const futureCount = useTemporalStore((state) => state.futureStates.length);
  const [serverProjects, setServerProjects] = useState<ReadonlyArray<{ filename: string; name: string }>>([]);

  useEffect(() => {
    if (!backendOnline) {
      setServerProjects([]);
      return;
    }
    let cancelled = false;
    fetch('/api/projects')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const list = (data as { projects?: Array<{ filename?: string; name?: string }> } | null)?.projects ?? [];
        setServerProjects(list.map((item) => ({ filename: String(item.filename ?? ''), name: String(item.name ?? item.filename ?? '') })));
      })
      .catch(() => setServerProjects([]));
    return () => { cancelled = true; };
  }, [backendOnline]);

  const onSaveServer = (): void => {
    const filename = `${project.meta.id || 'project'}.worldtown.json`;
    void fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, project }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('save failed');
        useStudioStore.getState().showToast(`已保存到服务端：${filename}`);
      })
      .catch(() => useStudioStore.getState().showToast('服务端保存失败（离线独立模式不受影响）'));
  };

  const onLoadServer = (filename: string): void => {
    if (!filename) return;
    void fetch(`/api/projects/${encodeURIComponent(filename)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
      .then((loaded: unknown) => {
        loadProject(loaded, true);
        useStudioStore.getState().showToast(`已载入服务端工程：${filename}`);
      })
      .catch(() => useStudioStore.getState().showToast('服务端工程载入失败'));
  };

  const onOpen = (): void => {
    void openProjectFilePicker().then((file) => {
      if (!file) return;
      void readProjectJsonFromFile(file).then((loaded) => loadProject(loaded, true));
    });
  };

  const onExportPng = (): void => {
    void exportScenePngBlob(project, scene, { scale: 2, mode: 'full' })
      .then((blob) => downloadPngFile(blob, project, 2, 'full'))
      .catch(() => useStudioStore.getState().showToast('PNG 导出需要浏览器画布环境'));
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-brass bg-panel px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-pine text-on-accent">
          <MapPin size={14} />
        </span>
        <input
          value={project.meta.name}
          onFocus={() => beginContinuousEdit()}
          onBlur={() => endContinuousEdit(false)}
          onChange={(event) =>
            mutateProject((draft) => {
              draft.meta.name = event.target.value;
            }, false)
          }
          className="w-56 truncate rounded border border-transparent bg-transparent px-1 py-[3px] font-map-serif text-[15px] font-semibold text-ink hover:border-brass focus:border-pine focus:bg-input focus:outline-none"
          aria-label="工程标题"
        />
      </div>

      <select
        value=""
        onChange={(event) => {
          const key = event.target.value as PresetKey;
          if (key) loadPreset(key);
        }}
        className="h-8 rounded-md border border-brass bg-input px-2 text-[11px] text-ink-secondary"
        aria-label="切换内置工程"
      >
        <option value="">切换工程…</option>
        {BUILTIN_PRESETS.map((preset) => (
          <option key={preset.key} value={preset.key}>
            {preset.label}
          </option>
        ))}
      </select>

      <IconButton
        title={terraxDataAvailable ? '导入 TERRAX 经纬度' : 'TERRAX 地理数据离线不可用'}
        disabled={!terraxDataAvailable}
        onClick={() => setGeoModalOpen(true)}
      >
        <MapPin size={13} />
        经纬度导入
      </IconButton>

      <span className="flex-1" />

      <IconButton title="撤销 (⌘Z)" disabled={pastCount === 0} onClick={undoProject}>
        <Undo2 size={13} />
      </IconButton>
      <IconButton title="重做 (⌘⇧Z)" disabled={futureCount === 0} onClick={redoProject}>
        <Redo2 size={13} />
      </IconButton>
      <IconButton title="打开 .worldtown.json" onClick={onOpen}>
        <FolderOpen size={13} />
        打开
      </IconButton>
      <IconButton title="保存 .worldtown.json" onClick={() => downloadProjectJsonFile(project)}>
        <Save size={13} />
        保存
      </IconButton>
      <IconButton title="导出 2x PNG 成图" onClick={onExportPng}>
        <ImageDown size={13} />
        PNG
      </IconButton>
      <IconButton title="导出分层矢量 SVG（含图饰）" onClick={() => downloadSvgFile(project, scene, 'full')}>
        <Download size={13} />
        SVG
      </IconButton>
      <IconButton title="导出 clean SVG（剥离图饰层）" onClick={() => downloadSvgFile(project, scene, 'clean')}>
        <Download size={13} />
        clean
      </IconButton>
      <IconButton title="保存工程到本地服务端 /api/projects" disabled={!backendOnline} onClick={onSaveServer}>
        <Save size={13} />
        存云
      </IconButton>
      <select
        value=""
        disabled={!backendOnline || serverProjects.length === 0}
        onChange={(event) => onLoadServer(event.target.value)}
        className="h-8 max-w-[132px] rounded-md border border-brass bg-input px-1 text-[11px] text-ink-secondary disabled:opacity-40"
        aria-label="载入服务端工程"
      >
        <option value="">服务端工程…</option>
        {serverProjects.map((item) => (
          <option key={item.filename} value={item.filename}>{item.name}</option>
        ))}
      </select>
      <span
        className={`rounded-full px-2 py-[3px] text-[10px] ${
          backendOnline ? 'bg-pine text-on-accent' : 'bg-card text-ink-muted'
        }`}
      >
        {backendOnline ? '在线' : '离线'}
      </span>
    </header>
  );
}
