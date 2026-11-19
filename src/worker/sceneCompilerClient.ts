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
  return new Promise<CompileOutcome>((resolve) => {
    pending.set(requestId, (response) => {
      if (response.requestId !== latestRequestId) {
        resolve({ requestId: response.requestId, stale: true, scene: null });
        return;
      }
      resolve({
        requestId: response.requestId,
        stale: false,
        scene: response.scene ?? null,
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
