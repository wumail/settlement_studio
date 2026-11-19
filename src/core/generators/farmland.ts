import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import {
  computePolygonAreaSigned,
  computePolygonBBox,
  computePolygonCentroid,
  pointInPolygon,
} from '../math/polygon';
import { insetPolygonSafe } from '../math/voronoi';
import {
  clearsPolygon,
  clearsPolyline,
  pointToPolylineDist,
  polygonRadiusOf,
} from '../obstacles/collisionAudit';
import { type ZoneGeneratorInput, guardSafeTree } from '../obstacles/guardSafe';
import { sampleObstacleClearance } from '../obstacles/obstacleSdf';
import { sampleSlopeDeg } from '../terrain/elevationField';
import { type SharedBundSegment, subdivideFarmlandStrips } from './farmlandStrips';

const MIN_PLOT_M2 = 900;
const CLEARANCE_M = 0.8;

export function polygonTouchesExclusion(
  poly: Polygon,
  exclusionPolys: ReadonlyArray<Polygon>,
  margin: number,
): boolean {
  if (exclusionPolys.length === 0) return false;
  const c = computePolygonCentroid(poly);
  const radius = polygonRadiusOf(poly, c);
  for (const ex of exclusionPolys) {
    if (!clearsPolygon(poly, c, radius, ex, margin)) return true;
  }
  return false;
}

function ringOf(poly: Polygon): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

/** SDF 缺失时的解析回退：河湖/干道/明渠/城垣/禁建圈逐项精确距离复核 */
function analyticPointOk(input: ZoneGeneratorInput, x: number, y: number): boolean {
  const ctx = input.obstacleCtx;
  for (const r of ctx.riversBuilt) {
    if (pointInPolygon(x, y, r.bankPolygon) || pointToPolylineDist(x, y, ringOf(r.bankPolygon)) < 8) return false;
  }
  for (const b of ctx.waterBodiesBuilt) {
    if (pointInPolygon(x, y, b.shorePoly) || pointToPolylineDist(x, y, ringOf(b.shorePoly)) < 8) return false;
  }
  for (const ex of ctx.exclusionPolys) {
    if (pointInPolygon(x, y, ex) || pointToPolylineDist(x, y, ringOf(ex)) < 2) return false;
  }
  for (const c of ctx.canalsBuilt) if (pointToPolylineDist(x, y, c.centerline) < 0.5 * c.widthM + 4) return false;
  for (const rd of ctx.roadsBuilt) if (pointToPolylineDist(x, y, rd.centerline) < 0.5 * rd.widthM + 2.5) return false;
  for (const w of ctx.wallsBuilt) if (pointToPolylineDist(x, y, w.polyline) < 0.5 * w.thicknessM + 3) return false;
  return true;
}

/**
 * 单点硬约束：障碍净空 >= 0.8m、坡度 <= 选区上限、距图幅边界 >= 8m。
 * SDF 仅为 512² 粗栅格，近障点必须再走一次解析精确复核，杜绝 1–2m 栅格误差压线。
 */
function pointOk(input: ZoneGeneratorInput, x: number, y: number): boolean {
  const ctx = input.obstacleCtx;
  const far = ctx.worldSizeM - 8;
  if (x < 8 || y < 8 || x > far || y > far) return false;
  if (sampleSlopeDeg(input.elevationField, x, y) > input.zone.maxSlopeDeg) return false;
  if (ctx.grid) {
    const clearance = sampleObstacleClearance(ctx.grid, ctx.worldSizeM, x, y);
    if (clearance < CLEARANCE_M) return false;
    if (clearance > 14) return true;
  }
  return analyticPointOk(input, x, y);
}

/** 条田四重守卫：质心/顶点/边中点单点硬校验 + 整边精确避让路/渠/墙/河湖/禁建圈 */
function plotOk(poly: Polygon, input: ZoneGeneratorInput): boolean {
  const c = computePolygonCentroid(poly);
  if (!pointOk(input, c[0], c[1])) return false;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    if (!pointOk(input, a[0], a[1])) return false;
    if (!pointOk(input, (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)) return false;
  }
  const ctx = input.obstacleCtx;
  const radius = polygonRadiusOf(poly, c);
  for (const road of ctx.roadsBuilt) {
    if (!clearsPolyline(poly, c, radius, road.centerline, 0.5 * road.widthM + 1.5)) return false;
  }
  for (const canal of ctx.canalsBuilt) {
    if (!clearsPolyline(poly, c, radius, canal.centerline, 0.5 * canal.widthM + 2.0)) return false;
  }
  for (const wall of ctx.wallsBuilt) {
    if (!clearsPolyline(poly, c, radius, wall.polyline, 0.5 * wall.thicknessM + 2.0)) return false;
  }
  for (const river of ctx.riversBuilt) {
    if (!clearsPolygon(poly, c, radius, river.bankPolygon, 3.0)) return false;
  }
  for (const body of ctx.waterBodiesBuilt) {
    if (!clearsPolygon(poly, c, radius, body.shorePoly, 3.0)) return false;
  }
  return !polygonTouchesExclusion(poly, ctx.exclusionPolys, 2.0);
}

/** 单条田平行耕垄：局部包围盒内按地块自向裁剪等距弦 */
function buildFurrows(poly: Polygon, angleDeg: number, spacingM: number): Polyline[] {
  const c = computePolygonCentroid(poly);
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  const box = computePolygonBBox(poly);
  const halfDiag = 0.5 * Math.hypot(box[2] - box[0], box[3] - box[1]) + spacingM;
  const runs: Polyline[] = [];
  for (let off = -halfDiag; off <= halfDiag; off += spacingM) {
    const px = c[0] - dirY * off;
    const py = c[1] + dirX * off;
    let cur: Vec2[] = [];
    for (let t = -halfDiag; t <= halfDiag; t += 2.0) {
      const x = px + dirX * t;
      const y = py + dirY * t;
      if (pointInPolygon(x, y, poly)) {
        cur.push([x, y]);
      } else {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) runs.push(cur);
  }
  return runs;
}

/** 沿共享田埂成簇树篱：中段锚点 + 4.5–7.8m 密排 2–5 棵，逐棵经 guardSafeTree 守卫 */
function plantHedgerows(
  bunds: ReadonlyArray<SharedBundSegment>,
  plots: ReadonlyArray<Polygon>,
  input: ZoneGeneratorInput,
): void {
  const { zone, rng, targetResult, obstacleCtx } = input;
  for (const bund of bunds) {
    const dx = bund.b[0] - bund.a[0];
    const dy = bund.b[1] - bund.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 22) continue;
    const nearPlot = plots.some(
      (plot) => pointToPolylineDist((bund.a[0] + bund.b[0]) * 0.5, (bund.a[1] + bund.b[1]) * 0.5, ringOf(plot)) < 6,
    );
    if (!nearPlot) continue;
    if (rng() > 0.38) continue;
    const count = 2 + Math.floor(rng() * 4);
    const ux = dx / len;
    const uy = dy / len;
    for (let i = 0; i < count; i += 1) {
      const along = 0.5 + ((i - (count - 1) / 2) * (4.5 + rng() * 3.3)) / len;
      if (along < 0.08 || along > 0.92) continue;
      const lateral = (rng() - 0.5) * 3.0;
      const tx = bund.a[0] + dx * along - uy * lateral;
      const ty = bund.a[1] + dy * along + ux * lateral;
      const tree = guardSafeTree(tx, ty, 3.0 + rng() * 2.0, 'field', zone, obstacleCtx);
      if (tree) targetResult.trees.push(tree);
    }
  }
}

/** farmland 条田：OBB 递归条带切分 + 四重避障（河湖/路/渠/墙/禁建圈/陡坡）+ 田埂树篱簇 */
export function compileFarmlandZone(input: ZoneGeneratorInput): void {
  const { zone, rng, targetResult, obstacleCtx, elevationField } = input;
  const areaHa = Math.abs(computePolygonAreaSigned(zone.points)) / 10000;
  if (areaHa < 0.05) return;
  const { strips, sharedBunds } = subdivideFarmlandStrips({
    zonePolygon: zone.points,
    frayOuter: zone.frayOuter !== false,
    rng,
    elevationField,
    roads: obstacleCtx.roadsBuilt,
    canals: obstacleCtx.canalsBuilt,
  });
  const keptPolys: Polygon[] = [];
  for (const strip of strips) {
    const inner0 = insetPolygonSafe(strip.polygon, 1.4);
    if (inner0.length < 3) continue;
    if (Math.abs(computePolygonAreaSigned(inner0)) < MIN_PLOT_M2) continue;
    let outer = strip.polygon;
    let inner = inner0;
    if (!plotOk(inner0, input)) {
      const center = computePolygonCentroid(inner0);
      if (!pointOk(input, center[0], center[1])) continue;
      const rescued = insetPolygonSafe(inner0, 3.8);
      if (rescued.length < 3 || Math.abs(computePolygonAreaSigned(rescued)) < MIN_PLOT_M2) continue;
      if (!plotOk(rescued, input)) continue;
      const shrunk = insetPolygonSafe(strip.polygon, 3.8);
      if (shrunk.length < 3) continue;
      outer = shrunk;
      inner = rescued;
    }
    const plotArea = Math.abs(computePolygonAreaSigned(inner));
    keptPolys.push(inner);
    targetResult.farmlandPlots.push({
      id: `fp_${zone.id}_${targetResult.farmlandPlots.length + 1}`,
      zoneId: zone.id,
      polygon: outer,
      innerPolygon: inner,
      areaHa: plotArea / 10000,
      angleDeg: strip.angleDeg,
      furrows: buildFurrows(inner, strip.angleDeg, strip.furrowSpacingM),
      toneShift: strip.toneShift,
    });
  }
  plantHedgerows(sharedBunds, keptPolys, input);
}
