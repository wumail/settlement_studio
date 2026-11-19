import type { Vec2 } from '../schema/geometry.types';
import type { CanalStyle } from '../schema/entity.schema';
import { mixHex, type PaintContext } from './paintContext';
import { pointInPolygon } from '../core/math/polygon';
import { pointToPolylineDist } from '../core/obstacles/collisionAudit';

interface CanalLook {
  readonly fillOpacity: number;
  readonly centerWidthM: number;
  readonly dash?: ReadonlyArray<number>;
  readonly tint: number;
}

const CANAL_LOOK: Readonly<Record<CanalStyle, CanalLook>> = {
  open: { fillOpacity: 1, centerWidthM: 1.2, tint: 0 },
  stone_clean: { fillOpacity: 1, centerWidthM: 1.2, tint: 0 },
  irrigation: { fillOpacity: 0.78, centerWidthM: 1.0, dash: [9, 4], tint: 0.12 },
  drainage_dashed: { fillOpacity: 0.26, centerWidthM: 0.8, dash: [5, 4], tint: 0.4 },
  foul_outfall: { fillOpacity: 0.5, centerWidthM: 0.9, dash: [2, 5], tint: 0.62 },
  qanat: { fillOpacity: 0.3, centerWidthM: 0.9, dash: [8, 6], tint: 0.5 },
};

export function paintWater(ctx: PaintContext, onlyId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const wb of scene.hydro.waterBodies) {
    if (onlyId !== undefined && wb.id !== onlyId) continue;
    backend.drawPolygon(wb.shorePoly.map(ctx.pt), {
      fill: pal.waterFill,
      stroke: pal.inkDark,
      lineWidth: ctx.px(1.0),
    });
    for (const ripple of wb.ripples) {
      backend.drawPolyline(ripple.map(ctx.pt), { stroke: pal.waterRipple, lineWidth: ctx.px(0.7) }, true);
    }
  }
  for (const river of scene.hydro.rivers) {
    if (onlyId !== undefined && river.id !== onlyId) continue;
    backend.drawPolygon(river.bankPolygon.map(ctx.pt), {
      fill: pal.waterFill,
      stroke: pal.inkDark,
      lineWidth: ctx.px(0.9),
    });
    for (const ripple of river.ripples) {
      backend.drawPolyline(ripple.map(ctx.pt), {
        stroke: pal.waterRipple,
        lineWidth: ctx.px(0.7),
        opacity: 0.9,
      });
    }
  }
}

export function paintReefsFords(ctx: PaintContext, onlyId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const reef of scene.hydro.reefs) {
    if (onlyId !== undefined && reef.id !== onlyId) continue;
    backend.drawPolygon(reef.foamRing.map(ctx.pt), {
      stroke: pal.waterRipple,
      lineWidth: ctx.px(0.8),
      dash: [3, 3],
    });
    for (const rock of reef.rocks) {
      backend.drawPolygon(rock.points.map(ctx.pt), {
        fill: pal.reefFill,
        stroke: pal.inkDark,
        lineWidth: ctx.px(0.6),
      });
    }
  }
  for (const ford of scene.hydro.fordCrossings) {
    if (onlyId !== undefined && ford.id !== onlyId) continue;
    const fr = Math.max(8, ford.riverWidthM * 0.4);
    const dots: Vec2[][] = [];
    for (let row = -1; row <= 1; row += 2) {
      for (let i = -2; i <= 2; i += 1) {
        const c = ctx.pt([
          ford.x + ford.tangent[0] * i * 0.18 * fr + ford.normal[0] * row * 0.32 * fr,
          ford.y + ford.tangent[1] * i * 0.18 * fr + ford.normal[1] * row * 0.32 * fr,
        ]);
        dots.push([
          [c[0] - 1.6, c[1] - 1.6],
          [c[0] + 1.6, c[1] - 1.6],
          [c[0] + 1.6, c[1] + 1.6],
          [c[0] - 1.6, c[1] + 1.6],
        ]);
      }
    }
    backend.drawBatchPolygons(dots, { fill: pal.inkDark, opacity: 0.65 });
  }
}

/** 5 类明渠样式：石砌净渠 / 灌溉 / 排碱虚线 / 污尾渠 / 坎儿井（暗渠 + 竖井串） */
export function paintCanals(ctx: PaintContext, onlyId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  for (const canal of scene.hydro.canals) {
    if (onlyId !== undefined && canal.id !== onlyId) continue;
    const look = CANAL_LOOK[canal.style] ?? CANAL_LOOK.stone_clean;
    const qanat = canal.style === 'qanat';
    const base = qanat ? '#3d6a74' : pal.waterFill;
    const fill = look.tint > 0 ? mixHex(base, pal.inkDark, look.tint) : base;
    backend.drawPolygon(canal.bankPolygon.map(ctx.pt), {
      fill: qanat ? '#3d6a74' : fill,
      opacity: look.fillOpacity,
      stroke: pal.inkDark,
      lineWidth: ctx.px(qanat ? 0.6 : 0.7),
    });
    if (canal.style === 'stone_clean' || canal.style === 'open') {
      backend.drawPolyline(canal.centerline.map(ctx.pt), {
        stroke: pal.paperBg,
        lineWidth: ctx.px(0.6),
        opacity: 0.55,
      });
    }
    backend.drawPolyline(canal.centerline.map(ctx.pt), {
      stroke: qanat ? '#3d6a74' : mixHex(fill, pal.inkDark, 0.35),
      lineWidth: ctx.px(look.centerWidthM),
      dash: look.dash ? [...look.dash] : undefined,
      opacity: 0.9,
    });
    for (const shaft of canal.shaftPoints) {
      const c = ctx.pt([shaft.x, shaft.y]);
      backend.drawCircle(c[0], c[1], ctx.px(shaft.radiusM), {
        fill: pal.paperBg,
        stroke: '#3d6a74',
        lineWidth: ctx.px(0.9),
      });
    }
  }
}

/** 4 类桥梁：石拱 / 木桥 / 双桥头堡 / 涉水渡口（渡口由覆写降级产生） */
export function paintBridges(ctx: PaintContext, onlyBridgeId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  // 路即桥：桥面、栏杆、拱线一概不画，路面直接跨水即成桥。
  // 仅 fortified_twin 的双桥头堡保留堡体（它们是带足印的独立防御工事）。
  for (const bridge of scene.hydro.bridges) {
    if (onlyBridgeId !== undefined && bridge.id !== onlyBridgeId) continue;
    for (const fort of bridge.forts ?? []) {
      // 桥头堡与既有 citadel / 内城围垣重叠（含压边）即不再叠画第二层堡体，消除叠套观感
      const nested = ctx.project.zones.some((zone) => {
        if (zone.contentType !== 'citadel' && zone.contentType !== 'walled_city') return false;
        if (pointInPolygon(fort.center[0], fort.center[1], zone.points)) return true;
        if (fort.polygon.some((corner) => pointInPolygon(corner[0], corner[1], zone.points))) return true;
        if (zone.points.some((corner) => pointInPolygon(corner[0], corner[1], fort.polygon))) return true;
        // 压边或贴墙同样算叠套：堡体任一顶点距围垣 <= 24m（约半个堡身）一律让位给既有城垣
        const ring = zone.points[0] ? [...zone.points, zone.points[0]] : [...zone.points];
        return fort.polygon.some((corner) => pointToPolylineDist(corner[0], corner[1], ring) <= 24);
      });
      if (nested) continue;
      backend.drawPolygon(fort.polygon.map(ctx.pt), {
        fill: pal.wallFill,
        stroke: pal.wallStroke,
        lineWidth: ctx.px(1.0),
      });
      const inner = Math.max(2, ctx.px(3.4));
      for (const corner of fort.polygon) {
        const c = ctx.pt(corner);
        backend.drawCircle(c[0], c[1], inner, { fill: pal.wallFill, stroke: pal.wallStroke, lineWidth: 0.6 });
      }
    }
  }
}
