import { type CompiledScene, compileSettlementScene, rerollZoneScene } from '../core/compileScene';
import type { TownProject } from '../schema/project.schema';

export interface CompileWorkerRequest {
  readonly requestId: number;
  readonly kind: 'compile_full' | 'reroll_zone';
  readonly project: TownProject;
  readonly zoneId?: string;
  readonly seed?: number;
}

export interface CompileWorkerResponse {
  readonly requestId: number;
  readonly ok: boolean;
  readonly scene?: CompiledScene;
  readonly updatedSeed?: number;
  readonly error?: string;
}

interface WorkerScope {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<CompileWorkerRequest>) => void,
  ) => void;
  postMessage: (message: CompileWorkerResponse) => void;
}

const scope = self as unknown as WorkerScope;

/** 最近一次全量编译场景：reroll 时复用其余选区既有屋宇，避免整图重编 */
let lastScene: CompiledScene | null = null;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'compile failed';
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (!request || typeof request.requestId !== 'number') return;
  try {
    if (request.kind === 'reroll_zone' && request.zoneId) {
      const result = rerollZoneScene(request.project, request.zoneId, lastScene ?? undefined, request.seed);
      lastScene = result.scene;
      scope.postMessage({
        requestId: request.requestId,
        ok: true,
        scene: result.scene,
        updatedSeed: result.updatedSeed,
      });
      return;
    }
    const scene = compileSettlementScene(request.project);
    lastScene = scene;
    scope.postMessage({
      requestId: request.requestId,
      ok: true,
      scene,
    });
  } catch (err) {
    scope.postMessage({ requestId: request.requestId, ok: false, error: describe(err) });
  }
});
