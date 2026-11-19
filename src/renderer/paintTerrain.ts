import type { Polygon } from '../schema/geometry.types';
import { mixHex, type PaintContext } from './paintContext';

const TINT_STOPS = 7;

/** 分层设色色阶：低漫滩冷青 → 纸色中性 → 高处暖砂褐，全部由调色板派生 */
export function tintColorFor(band: number, ctx: PaintContext): string {
  const pal = ctx.pal;
  const cold = mixHex(pal.waterFill, pal.paperBg, 0.8);
  const mid = mixHex(pal.paperBg, pal.farmlandFill, 0.32);
  const warm = mixHex('#c9a06a', pal.paperBg, 0.28);
  const t = Math.max(0, Math.min(TINT_STOPS - 1, band)) / (TINT_STOPS - 1);
  if (t <= 0.34) return mixHex(cold, mid, t / 0.34);
  return mixHex(mid, warm, (t - 0.34) / 0.66);
}

export function paintTerrainTint(ctx: PaintContext): void {
  const shading = ctx.scene?.shading;
  if (!shading || shading.bands.length === 0) return;
  for (const band of shading.bands) {
    if (band.polygons.length === 0) continue;
    ctx.backend.drawBatchPolygons(
      band.polygons.map((poly: Polygon) => poly.map(ctx.pt)),
      { fill: tintColorFor(band.band, ctx), fillOpacity: 0.55 },
    );
  }
}

export function paintHachures(ctx: PaintContext): void {
  const hachures = ctx.scene?.shading?.hachures;
  if (!hachures || hachures.length === 0) return;
  const segments = hachures.map((seg) => [ctx.pt([seg[0][0], seg[0][1]]), ctx.pt([seg[1][0], seg[1][1]])] as const);
  ctx.backend.drawSegments(segments, {
    stroke: ctx.pal.contourLine,
    lineWidth: 0.65,
    opacity: 0.72,
    lineCap: 'butt',
  });
}
