import type { ViewportState } from '../schema/geometry.types';

export interface StageBlitPlan {
  /** 视口四周超采边距（CSS px） */
  readonly margin: number;
  /** 位图对应的桶化平移（贴图复用基准） */
  readonly bucketX: number;
  readonly bucketY: number;
  /** 离屏位图尺寸（CSS px，含四周 margin） */
  readonly cacheWidthPx: number;
  readonly cacheHeightPx: number;
  /** 位图内部绘制使用的 pan：整体右下移 margin，使贴图原点落在 (-margin, -margin) */
  readonly cachePanX: number;
  readonly cachePanY: number;
  /** 位图左上角在主画布上的设备像素坐标 */
  readonly destX: number;
  readonly destY: number;
}

/**
 * 离屏静态层贴图几何（纯函数，供 stageRender 与单测共用）。
 *
 * 不变式：`destX / dpr + cachePanX === vp.panX`（Y 同理），
 * 即世界原点经位图落到主画布的位置必须与直接绘制完全一致，且位图必须完整覆盖视口。
 */
export function planStageBlit(
  vp: ViewportState,
  widthPx: number,
  heightPx: number,
  dpr: number,
): StageBlitPlan {
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));
  const margin = Math.max(48, Math.round(Math.min(160, Math.min(width, height) * 0.25)));
  const bucketX = Math.round(vp.panX / margin) * margin;
  const bucketY = Math.round(vp.panY / margin) * margin;
  return {
    margin,
    bucketX,
    bucketY,
    cacheWidthPx: width + margin * 2,
    cacheHeightPx: height + margin * 2,
    cachePanX: bucketX + margin,
    cachePanY: bucketY + margin,
    destX: Math.round((vp.panX - bucketX - margin) * dpr),
    destY: Math.round((vp.panY - bucketY - margin) * dpr),
  };
}
