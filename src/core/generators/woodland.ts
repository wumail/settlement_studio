import type { Vec2 } from '../../schema/geometry.types';
import { computePolygonAreaSigned, computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../math/polygon';
import { type ZoneGeneratorInput, type SafeTree, guardSafeTree } from '../obstacles/guardSafe';

const TWO_PI = Math.PI * 2;

interface TreeNode {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

function tryPlant(
  input: ZoneGeneratorInput,
  x: number,
  y: number,
  r: number,
  out: TreeNode[],
): SafeTree | null {
  const tree = guardSafeTree(x, y, r, 'woodland', input.zone, input.obstacleCtx);
  if (!tree) return null;
  input.targetResult.trees.push(tree);
  out.push({ x: tree.x, y: tree.y, r: tree.r });
  return tree;
}

function minGapTo(x: number, y: number, r: number, nodes: ReadonlyArray<TreeNode>): number {
  let best = Number.POSITIVE_INFINITY;
  for (const n of nodes) best = Math.min(best, Math.hypot(x - n.x, y - n.y) - (r + n.r));
  return best;
}

/** 围绕主心铺设紧凑环形伴生树群，杜绝细长枝条，形成饱满云朵林团 */
function packCloudHub(
  input: ZoneGeneratorInput,
  hub: TreeNode,
  ringCount: number,
  minR: number,
  spanR: number,
  grove: TreeNode[],
): void {
  const { rng } = input;
  const baseAng = rng() * TWO_PI;
  for (let i = 0; i < ringCount; i += 1) {
    const ang = baseAng + (i * TWO_PI) / ringCount + (rng() - 0.5) * 0.65;
    const r = minR + rng() * spanR;
    const dist = (0.64 + rng() * 0.1) * (hub.r + r);
    const nx = hub.x + Math.cos(ang) * dist;
    const ny = hub.y + Math.sin(ang) * dist;
    if (grove.some((n) => Math.hypot(nx - n.x, ny - n.y) < 0.42 * (r + n.r))) continue;
    tryPlant(input, nx, ny, r, grove);
  }
}

/**
 * 单个有机林团：
 * - 紧凑公园（areaHa <= 2.6）：4–11 棵融合主木（~0.72×(r1+r2)）+ 1–3 棵游离小苗；
 * - 大片山地林（areaHa > 2.6）：2–3 个交叠饱满云核共 14–24 棵融合大树（锚树 5.4–8.0m，0.68×(r1+r2)）。
 */
function plantGrove(
  input: ZoneGeneratorInput,
  cx: number,
  cy: number,
  allPlaced: TreeNode[],
  isLargeForest: boolean,
): void {
  const { rng } = input;
  const grove: TreeNode[] = [];
  const r0 = (isLargeForest ? 5.4 : 5.0) + rng() * (isLargeForest ? 2.6 : 2.2);
  if (!tryPlant(input, cx, cy, r0, grove)) return;

  if (isLargeForest) {
    const hubCount = 3 + Math.floor(rng() * 2);
    const hubs: TreeNode[] = [grove[0]!];
    let dir = rng() * TWO_PI;
    for (let h = 1; h < hubCount; h += 1) {
      dir += (rng() - 0.5) * 1.3;
      const prev = hubs.at(-1)!;
      const hr = 5.6 + rng() * 2.4;
      const dist = (0.85 + rng() * 0.3) * (prev.r + hr);
      const planted = tryPlant(input, prev.x + Math.cos(dir) * dist, prev.y + Math.sin(dir) * dist, hr, grove);
      if (planted) hubs.push({ x: planted.x, y: planted.y, r: planted.r });
    }
    for (const hub of hubs) {
      packCloudHub(input, hub, 4 + Math.floor(rng() * 3), 4.8, 2.6, grove);
    }
  } else {
    const spineCount = 2 + Math.floor(rng() * 3);
    let cur = grove[0]!;
    let theta = rng() * TWO_PI;
    for (let i = 0; i < spineCount; i += 1) {
      theta += (rng() - 0.5) * 1.1;
      const r = 4.6 + rng() * 2.2;
      const dist = 0.72 * (cur.r + r);
      const planted = tryPlant(input, cur.x + Math.cos(theta) * dist, cur.y + Math.sin(theta) * dist, r, grove);
      if (planted) cur = { x: planted.x, y: planted.y, r: planted.r };
    }
    const flankCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < flankCount; i += 1) {
      const anchor = grove[Math.floor(rng() * grove.length)];
      if (!anchor) continue;
      const r = 3.6 + rng() * 1.4;
      const ang = theta + (rng() < 0.5 ? 1 : -1) * (1.0 + rng() * 1.1);
      const fx = anchor.x + Math.cos(ang) * 0.72 * (anchor.r + r);
      const fy = anchor.y + Math.sin(ang) * 0.72 * (anchor.r + r);
      if (!grove.some((n) => Math.hypot(fx - n.x, fy - n.y) < 0.45 * (r + n.r))) {
        tryPlant(input, fx, fy, r, grove);
      }
    }
  }

  const satCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < satCount; i += 1) {
    const anchor = grove[Math.floor(rng() * grove.length)];
    if (!anchor) continue;
    const r = 2.4 + rng() * 0.9;
    const ang = rng() * TWO_PI;
    const dist = (1.18 + rng() * 0.42) * (anchor.r + r);
    const sx = anchor.x + Math.cos(ang) * dist;
    const sy = anchor.y + Math.sin(ang) * dist;
    if (minGapTo(sx, sy, r, grove) > 0.08 * r) {
      tryPlant(input, sx, sy, r, grove);
    }
  }
  for (const n of grove) allPlaced.push(n);
}

/** 沿园界/林缘铺设断续弯带树篱，保留草地豁口 */
function plantPerimeterRibbons(input: ZoneGeneratorInput, allPlaced: TreeNode[]): void {
  const { zone, rng } = input;
  const pts = zone.points;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 28) continue;
    const ux = dx / len;
    const uy = dy / len;
    const midX = (a[0] + b[0]) * 0.5;
    const midY = (a[1] + b[1]) * 0.5;
    const sign = pointInPolygon(midX - uy * 4, midY + ux * 4, pts) ? 1 : -1;
    const inX = -uy * sign;
    const inY = ux * sign;

    let cursor = 8 + rng() * 12;
    while (cursor < len - 12) {
      if (rng() > 0.68) {
        cursor += 15 + rng() * 16;
        continue;
      }
      const ribbonLen = Math.min(len - 8 - cursor, 26 + rng() * 34);
      if (ribbonLen < 16) break;
      const ribbon: TreeNode[] = [];
      let pos = cursor;
      let prevR = 4.4 + rng() * 1.8;
      let inset = 5.5 + rng() * 4.5;
      let first = true;
      while (pos <= cursor + ribbonLen) {
        const isEdge = first || pos + 9 > cursor + ribbonLen;
        const r = isEdge ? 3.6 + rng() * 1.4 : 4.8 + rng() * 2.1;
        inset = Math.max(4.5, Math.min(13.5, inset + (rng() - 0.5) * 4.8));
        const px = a[0] + ux * pos + inX * inset;
        const py = a[1] + uy * pos + inY * inset;
        if (first || Math.hypot(px - (ribbon.at(-1)?.x ?? px), py - (ribbon.at(-1)?.y ?? py)) >= 0.65 * (prevR + r)) {
          const planted = tryPlant(input, px, py, r, ribbon);
          if (planted && !isEdge && rng() < 0.62) {
            const fr = 3.8 + rng() * 1.4;
            const fDist = 0.72 * (planted.r + fr);
            tryPlant(input, planted.x + inX * fDist, planted.y + inY * fDist, fr, ribbon);
          }
          prevR = r;
          first = false;
        }
        pos += (0.68 + rng() * 0.08) * (prevR + 4.5);
      }
      if (ribbon.length >= 2 && rng() < 0.6) {
        const anchor = ribbon[Math.floor(rng() * ribbon.length)]!;
        const sr = 2.4 + rng() * 0.9;
        const sd = (1.2 + rng() * 0.4) * (anchor.r + sr);
        const sx = anchor.x + inX * sd + (rng() - 0.5) * 4;
        const sy = anchor.y + inY * sd + (rng() - 0.5) * 4;
        if (minGapTo(sx, sy, sr, ribbon) > 0.1 * sr) tryPlant(input, sx, sy, sr, ribbon);
      }
      for (const n of ribbon) allPlaced.push(n);
      cursor += ribbonLen + 14 + rng() * 16;
    }
  }
}

/**
 * woodland 疏林/公园：
 * 沿林缘铺设断续弯带 + 林内 4–11 棵紧凑交叠树团（间距 ~ 0.72×(r1+r2) 融合成云），
 * 刻意留出 40–55% 开阔草坪空地，再辅以零星游离小苗。
 */
export function compileWoodlandZone(input: ZoneGeneratorInput): void {
  const { zone, rng } = input;
  const placed: TreeNode[] = [];
  const areaHa = Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
  const isLargeForest = areaHa > 2.6;
  if (!isLargeForest) plantPerimeterRibbons(input, placed);

  const step = isLargeForest ? Math.min(54, 34 + Math.sqrt(areaHa) * 4.5) : 33 + (1 - zone.density) * 12;
  const skipProb = isLargeForest ? 0.28 : areaHa > 0.75 ? 0.16 : 0;
  const minClear = isLargeForest ? Math.max(22, step * 0.42) : Math.max(18, step * 0.54);
  const box = computePolygonBBox(zone.points);

  for (let y = box[1] + step * 0.35; y <= box[3] - step * 0.25; y += step) {
    for (let x = box[0] + step * 0.35; x <= box[2] - step * 0.25; x += step) {
      if (skipProb > 0 && rng() < skipProb) continue;
      const cx = x + (rng() - 0.5) * step * 0.65;
      const cy = y + (rng() - 0.5) * step * 0.65;
      if (!pointInPolygon(cx, cy, zone.points)) continue;
      if (placed.some((n) => Math.hypot(cx - n.x, cy - n.y) < minClear)) continue;
      plantGrove(input, cx, cy, placed, isLargeForest);
    }
  }

  if (placed.length === 0) {
    const c: Vec2 = computePolygonCentroid(zone.points);
    if (pointInPolygon(c[0], c[1], zone.points)) plantGrove(input, c[0], c[1], placed, isLargeForest);
    if (placed.length === 0) {
      for (let y = box[1] + 10; y <= box[3] - 10; y += 16) {
        for (let x = box[0] + 10; x <= box[2] - 10; x += 16) {
          if (!pointInPolygon(x, y, zone.points)) continue;
          plantGrove(input, x, y, placed, isLargeForest);
          if (placed.length > 0) return;
        }
      }
    }
  }
}

/** exclusion 禁建保护区：零屋零田零树，仅记录多边形供编辑态虚线渲染 */
export function compileExclusionZone(input: ZoneGeneratorInput): void {
  input.targetResult.exclusionPoly = input.zone.points;
}
