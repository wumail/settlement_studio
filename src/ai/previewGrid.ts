import type { BBox, ViewportState } from '../schema/geometry.types';

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * AI 审图坐标标尺网：只在 gridOverlay=true 时追加到 SVG 顶层。
 * 浅色虚线 + 顶/左世界坐标刻度，让多模态模型能直接读出偏移量。
 */
export function appendGridOverlay(
  svg: string,
  vp: ViewportState,
  bounds: BBox,
  stepM: number,
): string {
  const [minX, minY, maxX, maxY] = bounds;
  const step = Math.max(25, stepM);
  const vertical: string[] = [];
  const horizontal: string[] = [];
  const labels: string[] = [];
  const w = vp.widthPx;
  const h = vp.heightPx;
  const startX = Math.ceil(minX / step) * step;
  for (let x = startX; x <= maxX + 1e-6; x += step) {
    const sx = vp.panX + x * vp.zoom;
    if (sx < 0 || sx > w) continue;
    vertical.push(`<line x1="${num(sx)}" y1="0" x2="${num(sx)}" y2="${num(h)}"/>`);
    labels.push(`<text x="${num(sx + 3)}" y="12">${Math.round(x)}</text>`);
  }
  const startY = Math.ceil(minY / step) * step;
  for (let y = startY; y <= maxY + 1e-6; y += step) {
    const sy = vp.panY + y * vp.zoom;
    if (sy < 0 || sy > h) continue;
    horizontal.push(`<line x1="0" y1="${num(sy)}" x2="${num(w)}" y2="${num(sy)}"/>`);
    labels.push(`<text x="4" y="${num(sy - 3)}">${Math.round(y)}</text>`);
  }
  const layer = `<g id="layer-ai-grid"><g fill="none" stroke="#1f4e5f" stroke-opacity="0.28" stroke-dasharray="4 4" stroke-width="0.7">${vertical.join('')}${horizontal.join('')}</g><g font-family="sans-serif" font-size="10" fill="#1f4e5f" fill-opacity="0.62">${labels.join('')}</g></g>`;
  return svg.replace('</svg>', `${layer}</svg>`);
}
