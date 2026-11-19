import type { CompiledScene } from '../core/compileScene';
import { compileSettlementScene, rerollZoneScene } from '../core/compileScene';
import type { TownProject } from '../schema/project.schema';
import type { CompileWorkerRequest, CompileWorkerResponse } from './compiler.worker';

export interface CompileOutcome {
  readonly requestId: number;
  readonly stale: boolean;
  readonly scene: CompiledScene | null;
  readonly updatedSeed?: number;
  readonly error?: string;
}

let latestRequestId = 0;
let workerInstance: Worker | null = null;
let workerUnavailable = false;
const pending = new Map<number, (res: CompileWorkerResponse) => void>();
/** 在途请求的原始参数：Worker 载入失败或返回错误时同步兜底，绝不空等 */
const inflight = new Map<number, { project: TownProject; zoneId?: string; prevScene?: CompiledScene; seed?: number }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined' || workerUnavailable) return null;
  if (workerInstance) return workerInstance;
  try {
    const instance = new Worker(new URL('./compiler.worker.ts', import.meta.url), {
      type: 'module',
    });
    instance.addEventListener('message', (event: MessageEvent<CompileWorkerResponse>) => {
      const response = event.data;
      const resolve = pending.get(response.requestId);
      if (!resolve) return;
      pending.delete(response.requestId);
      resolve(response);
    });
    instance.addEventListener('error', () => {
      workerUnavailable = true;
      // Worker 脚本加载/执行失败：立即用同步编译补上在途请求，避免画布永远空白
      for (const [requestId, resolve] of pending) {
        const args = inflight.get(requestId);
        pending.delete(requestId);
        inflight.delete(requestId);
        const fallback = args
          ? runSync(args.project, args.zoneId, args.prevScene, args.seed)
          : { scene: null };
        resolve({ requestId, ok: fallback.scene !== null, scene: fallback.scene ?? undefined, error: fallback.error });
      }
    });
    workerInstance = instance;
    return instance;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function runSync(
  project: TownProject,
  zoneId?: string,
  prevScene?: CompiledScene,
  explicitSeed?: number,
): { scene: CompiledScene | null; updatedSeed?: number; error?: string } {
  try {
    if (zoneId) {
      const result = rerollZoneScene(project, zoneId, prevScene, explicitSeed);
      return { scene: result.scene, updatedSeed: result.updatedSeed };
    }
    return { scene: compileSettlementScene(project) };
  } catch (err) {
    return { scene: null, error: err instanceof Error ? err.message : 'compile failed' };
  }
}

/**
 * 最新请求优先的双模编译客户端：浏览器走 ES Module Worker；
 * Node/Vitest 无 `Worker` 环境在同一 Promise 接口下无缝降级同步编译。
 * 任一时刻仅 `requestId === latestRequestId` 的响应决议为非 stale。
 */
export function compileSceneAsync(
  project: TownProject,
  zoneId?: string,
  prevScene?: CompiledScene,
  explicitSeed?: number,
): Promise<CompileOutcome> {
  latestRequestId += 1;
  const requestId = latestRequestId;
  const worker = getWorker();
  if (!worker) {
    return Promise.resolve().then(() => {
      const result = runSync(project, zoneId, prevScene, explicitSeed);
      return {
        requestId,
        stale: requestId !== latestRequestId,
        scene: result.scene,
        updatedSeed: result.updatedSeed,
        error: result.error,
      };
    });
  }
  inflight.set(requestId, { project, zoneId, prevScene, seed: explicitSeed });
  // 看门狗：Worker 静默无响应（脚本 404 / 模块加载失败 / 被策略拦截）时 0.9s 后同步兜底
  const watchdog = setTimeout(() => {
    if (!pending.has(requestId)) return;
    workerUnavailable = true;
    workerInstance?.terminate();
    workerInstance = null;
    for (const [id, done] of pending) {
      const args = inflight.get(id);
      pending.delete(id);
      inflight.delete(id);
      const fallback = args ? runSync(args.project, args.zoneId, args.prevScene, args.seed) : { scene: null };
      done({ requestId: id, ok: fallback.scene !== null, scene: fallback.scene ?? undefined, error: fallback.error });
    }
  }, 900);
  return new Promise<CompileOutcome>((resolve) => {
    pending.set(requestId, (response) => {
      clearTimeout(watchdog);
      inflight.delete(response.requestId);
      if (response.requestId !== latestRequestId) {
        resolve({ requestId: response.requestId, stale: true, scene: null });
        return;
      }
      if (!response.ok || !response.scene) {
        // Worker 编译抛错：降级为同步编译，保证任何浏览器都能出图
        const fallback = runSync(project, zoneId, prevScene, explicitSeed);
        resolve({
          requestId: response.requestId,
          stale: false,
          scene: fallback.scene,
          updatedSeed: fallback.updatedSeed,
          error: fallback.error ?? response.error,
        });
        return;
      }
      resolve({
        requestId: response.requestId,
        stale: false,
        scene: response.scene,
        updatedSeed: response.updatedSeed,
        error: response.error,
      });
    });
    const message: CompileWorkerRequest = {
      requestId,
      kind: zoneId ? 'reroll_zone' : 'compile_full',
      project,
      zoneId,
      seed: explicitSeed,
    };
    worker.postMessage(message);
  });
}

export function terminateCompilerWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  pending.clear();
}

export function getLatestRequestId(): number {
  return latestRequestId;
}
