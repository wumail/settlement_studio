import type { Polygon, Polyline, Vec2 } from '../schema/geometry.types';
import type { ZoneExclusionStyle } from '../schema/entity.schema';
import { mixHex, type PaintContext } from './paintContext';
import type { ResolvedPalette } from '../schema/palette.schema';
import { PAINTED_TREE_ZONE } from '../core/obstacles/guardSafe';

function ringOf(poly: Polygon): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

/** 禁建圈：黑石界碑串 + 细虚线（plague_stones）/ 草甸 / 排碱虚线 / 素圈 */
function samePolygon(a: Polygon, b: Polygon): boolean {
  if (a.length !== b.length) return false;
  const p = a[0];
  const q = b[0];
  return Boolean(p && q && Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6);
}

export function paintExclusion(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  const polys = scene?.exclusionPolys ?? [];
  for (const poly of polys) {
    const zone = ctx.project.zones.find(
      (item) =>
        item.contentType === 'exclusion' &&
        (zoneId === undefined || item.id === zoneId) &&
        samePolygon(item.points, poly),
    );
    if (zoneId !== undefined && !zone) continue;
    const style: ZoneExclusionStyle = zone?.exclusionStyle ?? 'plague_stones';
    const pts = poly;
    const ring = ringOf(pts).map(ctx.pt);
    if (style === 'plague_stones') {
      // 封墟土色微晕：圈内凄荒苍白灰黄，与圈外田畴拉开一层极淡底
      backend.drawPolygon(pts.map(ctx.pt), {
        fill: mixHex(pal.farmlandFill, pal.paperBg, 0.45),
        fillOpacity: 0.55,
      });
    }
    if (style === 'meadow') {
      backend.drawPolygon(pts.map(ctx.pt), {
        fill: mixHex(pal.treeFill, pal.paperBg, 0.72),
        fillOpacity: 0.55,
      });
    } else if (style === 'marsh') {
      backend.drawPolygon(pts.map(ctx.pt), {
        fill: mixHex(pal.waterFill, pal.paperBg, 0.78),
        fillOpacity: 0.6,
      });
      const dashes: Array<readonly [Vec2, Vec2]> = [];
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
      for (let y = minY + 5; y < maxY; y += 9) {
        for (let x = minX + 5; x < maxX; x += 14) {
          dashes.push([ctx.pt([x, y]), ctx.pt([x + 5, y])]);
        }
      }
      backend.drawSegments(dashes, { stroke: pal.waterRipple, lineWidth: 0.5, opacity: 0.5, lineCap: 'butt' });
    }
    backend.drawPolyline(ring, {
      stroke: pal.inkDark,
      lineWidth: style === 'plague_stones' ? 0.6 : 0.6,
      dash: style === 'plague_stones' ? [2.5, 6.5] : [7, 6],
      opacity: style === 'plague_stones' ? 0.55 : 0.7,
    });
    if (style !== 'plague_stones') continue;
    const stones: Array<readonly [Vec2, Vec2]> = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.floor(len / ctx.px(24)));
      for (let k = 0; k < steps; k += 1) {
        const t = (k + 0.5) / steps;
        stones.push([[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [a[0] + (b[0] - a[0]) * t + 1, a[1] + (b[1] - a[1]) * t]]);
      }
    }
    backend.drawSegments(stones, { stroke: pal.inkDark, lineWidth: ctx.px(4.8), lineCap: 'round', opacity: 0.9 });
  }
}

/** 四阶柔色：休耕浅麦 → 常态 → 麦金 → 熟褐/青苗，10%–22% 极轻混调不抢线稿 */
function farmlandToneColor(pal: ResolvedPalette, toneShift: number): string {
  if (toneShift < -0.35) {
    const t = 0.16 + Math.min(1, (-0.35 - toneShift) / 0.65) * 0.06;
    return mixHex(pal.farmlandFill, pal.paperBg, t);
  }
  if (toneShift < 0.15) return mixHex(pal.farmlandFill, pal.paperBg, 0.05);
  if (toneShift < 0.55) {
    const t = 0.12 + ((toneShift - 0.15) / 0.4) * 0.06;
    return mixHex(pal.farmlandFill, pal.roofTown, t);
  }
  const t = 0.1 + Math.min(1, (toneShift - 0.55) / 0.45) * 0.06;
  return mixHex(pal.farmlandFill, pal.treeFill, t);
}

/** 条田：极淡田埂底色 + 四阶柔色内块 + 柔和耕垄（无深黑外框） */
export function paintFarmland(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const plot of scene.farmlandPlots) {
    if (zoneId !== undefined && plot.zoneId !== zoneId) continue;
    const fill = farmlandToneColor(pal, plot.toneShift ?? 0);
    backend.drawPolygon(plot.polygon.map(ctx.pt), {
      fill: mixHex(pal.farmlandFill, pal.paperBg, 0.42),
      opacity: 0.78,
    });
    backend.drawPolygon(plot.innerPolygon.map(ctx.pt), {
      fill,
      opacity: 0.9,
      stroke: mixHex(pal.farmlandFill, pal.inkDark, 0.18),
      lineWidth: 0.45,
    });
    for (const furrow of plot.furrows) {
      backend.drawPolyline(furrow.map(ctx.pt), {
        stroke: mixHex(fill, pal.inkDark, 0.24),
        lineWidth: 0.38,
        opacity: 0.34,
      });
    }
  }
}

export function paintSaltpan(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const cell of scene.saltpanCells) {
    if (zoneId !== undefined && cell.zoneId !== zoneId) continue;
    backend.drawPolygon(cell.polygon.map(ctx.pt), {
      fill: pal.saltpanFill,
      fillOpacity: cell.opacity,
      stroke: pal.paperBg,
      lineWidth: ctx.px(0.7),
    });
  }
}

export function paintAprons(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const apron of scene.marketAprons) {
    if (zoneId !== undefined && apron.zoneId !== zoneId) continue;
    backend.drawPolygon(apron.points.map(ctx.pt), {
      fill: apron.kind === 'parade_ground' ? '#e3d6bc' : '#e8dcc4',
      opacity: 0.72,
      stroke: pal.inkDark,
      lineWidth: 0.4,
    });
  }
}

/** 村径 / 内部巷道：浅米白路面 + 虚线中轴（V2 漏绘修复） */
export function paintLanes(ctx: PaintContext): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const lane of scene.lanes) {
    if (lane.length < 2) continue;
    backend.drawPolyline(lane.map(ctx.pt), { stroke: pal.roadFill, lineWidth: ctx.px(2.4), opacity: 0.9 });
    backend.drawPolyline(lane.map(ctx.pt), {
      stroke: pal.inkMuted,
      lineWidth: 0.5,
      dash: [4, 4],
      opacity: 0.45,
    });
  }
  for (const fence of scene.gardenFences) {
    backend.drawPolyline(fence.points.map(ctx.pt), {
      stroke: pal.inkDark,
      lineWidth: 0.5,
      dash: [4, 3],
      opacity: 0.6,
    });
  }
}

/** 三级道路：全部路缘先于全部路面（零黑叉），lane 再叠虚线中轴 */
export function paintRoads(ctx: PaintContext, onlyIds?: string | ReadonlySet<string>): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  const roads = onlyIds === undefined
    ? scene.hydro.roads
    : typeof onlyIds === 'string'
      ? scene.hydro.roads.filter((r) => r.id === onlyIds)
      : scene.hydro.roads.filter((r) => onlyIds.has(r.id));
  if (roads.length === 0) return;
  for (const road of roads) {
    backend.drawPolyline(road.centerline.map(ctx.pt), {
      stroke: '#5b4a38',
      lineWidth: ctx.px(road.widthM + 2.2),
      lineJoin: 'round',
    });
  }
  for (const road of roads) {
    backend.drawPolyline(road.centerline.map(ctx.pt), {
      stroke: pal.roadFill,
      lineWidth: ctx.px(road.widthM),
      lineJoin: 'round',
    });
  }
  for (const road of roads) {
    if (road.tier !== 'lane') continue;
    backend.drawPolyline(road.centerline.map(ctx.pt), {
      stroke: pal.inkDark,
      lineWidth: 0.5,
      dash: [3, 4],
      opacity: 0.55,
    });
  }
}

/** 三步融合树冠：投影 → 轮廓 → 树冠，区树与涂抹树合并同批绘制；支持按 zoneId 独立叠层 */
export function paintTrees(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene, project } = ctx;
  if (!scene) return;
  const zoneTrees = zoneId === PAINTED_TREE_ZONE
    ? []
    : scene.trees.filter(
        (tree) => tree.zoneId !== PAINTED_TREE_ZONE && (zoneId === undefined || tree.zoneId === zoneId),
      );
  const rejects = new Set(scene.paintedTreeRejects ?? []);
  const painted = zoneId === undefined || zoneId === PAINTED_TREE_ZONE
    ? project.paintedTrees
        .filter((tree) => !rejects.has(tree.id))
        .map((tree) => ({ zoneId: PAINTED_TREE_ZONE, x: tree.x, y: tree.y, r: tree.r, kind: tree.kind }))
    : [];
  const trees = [...zoneTrees, ...painted];
  if (trees.length === 0) return;
  backend.drawCirclesMergedPass(
    trees.map((t) => {
      const c = ctx.pt([t.x + 2.2, t.y + 2.2]);
      return { cx: c[0], cy: c[1], r: ctx.px(t.r + 1.0) };
    }),
    'rgba(43, 37, 32, 0.15)',
  );
  backend.drawCirclesMergedPass(
    trees.map((t) => {
      const c = ctx.pt([t.x, t.y]);
      return { cx: c[0], cy: c[1], r: ctx.px(t.r + 1.8) };
    }),
    pal.treeOutline,
  );
  backend.drawCirclesMergedPass(
    trees.map((t) => {
      const c = ctx.pt([t.x, t.y]);
      return { cx: c[0], cy: c[1], r: ctx.px(t.r) };
    }),
    pal.treeFill,
  );
}
