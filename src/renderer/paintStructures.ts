import type { BuiltStructure } from '../core/generators/customStructures';
import { mixHex, SERIF_FONT, type PaintContext } from './paintContext';

/** 水工结构件：分水堰（堰体 + 闸墩 + 溢流白浪）/ 滑道坞 / 木栈桥 / 水力工坊 */
export function paintHydraulicWorks(ctx: PaintContext, onlyId?: string): void {
  const works = ctx.scene?.hydraulic;
  if (!works) return;
  const { backend, pal } = ctx;
  for (const weir of works.weirs) {
    if (onlyId !== undefined && weir.id !== onlyId) continue;
    backend.drawPolygon(weir.bodyPolygon.map(ctx.pt), {
      fill: pal.wallFill,
      stroke: pal.inkDark,
      lineWidth: ctx.px(1.0),
    });
    for (const pier of weir.pierPolygons) {
      backend.drawPolygon(pier.map(ctx.pt), {
        fill: pal.roadFill,
        stroke: pal.inkDark,
        lineWidth: ctx.px(0.7),
      });
    }
    for (const foam of weir.foamLines) {
      backend.drawPolyline(foam.map(ctx.pt), {
        stroke: pal.waterRipple,
        lineWidth: ctx.px(0.9),
        opacity: 0.95,
      });
    }
  }
  for (const dock of works.docks) {
    if (onlyId !== undefined && dock.id !== onlyId) continue;
    backend.drawPolygon(dock.apronPolygon.map(ctx.pt), {
      fill: dock.kind === 'wooden_pier' ? pal.bridgeDeck : pal.roadFill,
      stroke: pal.inkDark,
      lineWidth: ctx.px(0.9),
    });
    if (dock.deckPolygon) {
      backend.drawPolygon(dock.deckPolygon.map(ctx.pt), {
        fill: pal.bridgeDeck,
        stroke: pal.inkDark,
        lineWidth: ctx.px(0.9),
      });
      for (const pile of dock.pilePoints) {
        const c = ctx.pt(pile);
        backend.drawCircle(c[0], c[1], ctx.px(0.9), { fill: pal.inkDark, opacity: 0.75 });
      }
    }
    backend.drawSegments(
      dock.slipLines.map((line) => [ctx.pt(line[0] ?? [0, 0]), ctx.pt(line[1] ?? [0, 0])] as const),
      { stroke: pal.inkDark, lineWidth: ctx.px(0.6), opacity: 0.55, lineCap: 'butt' },
    );
  }
  for (const mill of works.watermills) {
    if (onlyId !== undefined && mill.id !== onlyId) continue;
    backend.drawPolygon(mill.bodyPolygon.map(ctx.pt), {
      fill: pal.roofTown,
      stroke: pal.inkDark,
      lineWidth: ctx.px(1.0),
    });
    const c = ctx.pt(mill.wheelCenter);
    backend.drawCircle(c[0], c[1], ctx.px(mill.wheelRadiusM), {
      fill: 'none',
      stroke: pal.inkDark,
      lineWidth: ctx.px(1.1),
    });
    backend.drawCircle(c[0], c[1], ctx.px(mill.wheelRadiusM * 0.55), {
      stroke: pal.inkDark,
      lineWidth: ctx.px(0.6),
      opacity: 0.7,
    });
    backend.drawSegments(
      mill.spokes.map((spoke) => [ctx.pt(spoke[0]), ctx.pt(spoke[1])] as const),
      { stroke: pal.inkDark, lineWidth: ctx.px(0.55), opacity: 0.6, lineCap: 'butt' },
    );
  }
}

export function structureRoofColor(kind: BuiltStructure['roofKind'], pal: PaintContext['pal']): string {
  if (kind === 'inner') return pal.roofInner;
  if (kind === 'town') return pal.roofTown;
  // 核心建筑群用暖赭金派生色，严禁炭黑墙色（会读成一块黑疙瘩）
  return mixHex(pal.roofInner, '#b58e4a', 0.45);
}

/** 核心建筑群：阴影 + 实形 + 圆坛内环台基 + 屋脊 + 名号（受 pure 模式控制） */
export function paintStructures(ctx: PaintContext, withLabels: boolean, onlyId?: string): void {
  const all = ctx.scene?.structures;
  if (!all || all.length === 0) return;
  const structures = onlyId === undefined ? all : all.filter((item) => item.id === onlyId);
  if (structures.length === 0) return;
  const { backend, pal } = ctx;
  backend.drawBatchPolygons(
    structures.map((item) => item.shadow.map(ctx.pt)),
    { fill: 'rgba(43, 37, 32, 0.16)' },
  );
  for (const item of structures) {
    const fill = structureRoofColor(item.roofKind, pal);
    backend.drawPolygon(item.polygon.map(ctx.pt), {
      fill,
      stroke: pal.inkDark,
      lineWidth: ctx.px(1.2),
    });
    if (item.innerRing) {
      backend.drawPolygon(item.innerRing.map(ctx.pt), {
        fill: 'none',
        stroke: pal.inkDark,
        lineWidth: ctx.px(0.7),
        dash: [4, 3],
      });
    }
    if (item.ridge) {
      backend.drawSegments(
        [[ctx.pt(item.ridge[0]), ctx.pt(item.ridge[1])]],
        { stroke: pal.inkDark, lineWidth: ctx.px(0.8), opacity: 0.65 },
      );
    }
    if (!withLabels || ctx.labelOpacity <= 0) continue;
    // 缩放过小时不标注，避免全图视角下核心建筑名互相压盖（放大到足印 >= 46px 才出字）
    if (ctx.px(item.widthM) < 46) continue;
    const c = ctx.pt([item.x, item.y]);
    backend.drawText(item.name, c[0], c[1] + ctx.px(item.depthM * 0.5) + 10, {
      fontFamily: SERIF_FONT,
      fontSizePx: 10,
      fill: pal.inkSecondary,
      baseline: 'middle',
      align: 'center',
      haloColor: pal.paperBg,
      haloWidthPx: 2.2,
      opacity: ctx.labelOpacity,
    });
  }
}
