import type { Polygon } from '../schema/geometry.types';
import { mixHex, type PaintContext } from './paintContext';

export function paintBuildings(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  const list = zoneId === undefined
    ? scene.buildings
    : scene.buildings.filter((b) => b.zoneId === zoneId);
  if (list.length === 0) return;
  backend.drawBatchPolygons(
    list.map((b) => b.points.map((q) => ctx.pt([q[0] + 1.8, q[1] + 1.8] as const))),
    { fill: 'rgba(43, 37, 32, 0.18)' },
  );
  backend.drawBatchPolygons(
    list.filter((b) => b.roofKind === 'inner').map((b) => b.points.map(ctx.pt)),
    { fill: pal.roofInner, stroke: pal.inkDark, lineWidth: ctx.px(1.05) },
  );
  backend.drawBatchPolygons(
    list.filter((b) => b.roofKind === 'town' && b.kind !== 'stall').map((b) => b.points.map(ctx.pt)),
    { fill: pal.roofTown, stroke: pal.inkDark, lineWidth: ctx.px(1.05) },
  );
  // 摊棚是敞棚而非屋宇：淡一档、细一线，密排成市时读作棚列而不是巧克力板
  backend.drawBatchPolygons(
    list.filter((b) => b.kind === 'stall').map((b) => b.points.map(ctx.pt)),
    {
      fill: mixHex(pal.roofTown, pal.paperBg, 0.42),
      stroke: mixHex(pal.inkDark, pal.paperBg, 0.45),
      lineWidth: ctx.px(0.75),
    },
  );
  for (const b of list) {
    if (!b.ridge || b.kind === 'stall') continue;
    backend.drawSegments(
      [[ctx.pt(b.ridge[0]), ctx.pt(b.ridge[1])]],
      { stroke: pal.inkDark, lineWidth: ctx.px(0.6), opacity: 0.5 },
    );
  }
}

/** 城垣 + 城门门楼 + 拱形水门 + 敌台 + 市井水井 */
export function paintWalls(ctx: PaintContext, zoneId?: string): void {
  const { backend, pal, scene } = ctx;
  if (!scene) return;
  const walls = zoneId === undefined ? scene.walls : scene.walls.filter((w) => w.zoneId === zoneId);
  const wells = zoneId === undefined ? scene.wells : scene.wells.filter((w) => w.zoneId === zoneId);
  for (const wall of walls) {
    const path = wall.polyline.map(ctx.pt);
    backend.drawPolyline(path, { stroke: pal.wallStroke, lineWidth: ctx.px(wall.thicknessM + 1.0) }, wall.closed);
    backend.drawPolyline(path, { stroke: pal.wallFill, lineWidth: ctx.px(wall.thicknessM) }, wall.closed);
    for (const tower of wall.towers) {
      const c = ctx.pt([tower.x, tower.y]);
      backend.drawCircle(c[0], c[1], ctx.px(tower.radiusM), {
        fill: pal.wallFill,
        stroke: pal.wallStroke,
        lineWidth: ctx.px(0.7),
      });
    }
    for (const gate of wall.gates) {
      backend.drawPolygon(gate.polygon.map(ctx.pt) as Polygon, {
        fill: pal.paperBg,
        stroke: pal.wallStroke,
        lineWidth: ctx.px(1.1),
      });
      const a = (gate.angleDeg * Math.PI) / 180;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const inner = gate.thicknessM * 0.55;
      backend.drawSegments(
        [[ctx.pt([gate.x - nx * inner, gate.y - ny * inner]), ctx.pt([gate.x + nx * inner, gate.y + ny * inner])]],
        { stroke: pal.wallFill, lineWidth: ctx.px(1.4) },
      );
    }
    for (const gate of wall.waterGates) {
      backend.drawPolygon(gate.polygon.map(ctx.pt) as Polygon, {
        fill: pal.waterFill,
        fillOpacity: 0.35,
        stroke: pal.wallStroke,
        lineWidth: ctx.px(0.9),
      });
      backend.drawPolyline(gate.archRing.map(ctx.pt), {
        stroke: pal.wallStroke,
        lineWidth: ctx.px(1.2),
        dash: [3, 3],
        opacity: 0.9,
      });
    }
  }
  for (const well of wells) {
    const c = ctx.pt([well.x, well.y]);
    backend.drawCircle(c[0], c[1], ctx.px(well.radiusM), {
      fill: pal.paperBg,
      stroke: pal.inkDark,
      lineWidth: ctx.px(0.9),
    });
    backend.drawCircle(c[0], c[1], ctx.px(well.radiusM * 0.45), {
      stroke: pal.waterFill,
      lineWidth: ctx.px(0.6),
    });
  }
}
