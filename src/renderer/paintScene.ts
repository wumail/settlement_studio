import { computePolygonCentroid } from '../core/math/polygon';
import type { CompiledSceneBase, Polygon, SelectionTarget, Vec2, ViewportState } from '../schema/geometry.types';
import { type LegendItem, resolveEffectiveLegend } from '../schema/legend.schema';
import { getActivePalette, type ResolvedPalette } from '../schema/palette.schema';
import type { TownProject } from '../schema/project.schema';
import { sampleElevation } from '../core/terrain/elevationField';
import { paintFurniture } from './furnitureLayout';
import { paintLegendGlyph } from './paintLegendGlyph';
import { paintSelectionHandles } from './paintHandles';
import { type RenderBackend, type TextStyle, worldRectToScreen, worldToScreen } from './RenderBackend';

export interface PaintSceneOptions {
  readonly isExport?: boolean;
  readonly cleanPaper?: boolean;
  readonly includeCartouche?: boolean;
  readonly selection?: SelectionTarget | null;
  readonly hoverContourId?: string | null;
  readonly draftPoints?: ReadonlyArray<Vec2>;
  readonly brushCursor?: { readonly x: number; readonly y: number; readonly radiusM: number } | null;
  readonly measureSegment?: readonly [Vec2, Vec2] | null;
}

const SERIF = '"Palatino Linotype", "Book Antiqua", "Songti SC", serif';

function textStyle(size: number, fill: string, extra?: Partial<TextStyle>): TextStyle {
  return { fontFamily: SERIF, fontSizePx: size, fill, baseline: 'middle', ...extra };
}

function glyphItemFor(project: TownProject, key: string, glyphType: string, label: string): LegendItem {
  const found = project.legend.items.find((item) => item.key === key);
  if (found) return found;
  return { key, isCustom: true, glyphType, label, color: '', colorLocked: false, strokeColor: '', visible: true, autoPresent: true, order: 999 };
}

/** 唯一地图绘制源：Watabou 14 层画家算法，Canvas 与 SVG 共享同一套指令流 */
export function paintScene(
  backend: RenderBackend,
  project: TownProject,
  scene: CompiledSceneBase | null,
  vp: ViewportState,
  options: PaintSceneOptions = {},
): void {
  const pal: ResolvedPalette = getActivePalette(project.palette);
  const frame = worldRectToScreen(vp);
  const pt = (v: Vec2): Vec2 => worldToScreen(v[0], v[1], vp);
  const mapPoly = (pts: Polygon): Vec2[] => pts.map(pt);
  const px = (m: number): number => Math.max(0.35, m * vp.zoom);
  const clip = (id: string, draw: () => void): void => {
    backend.beginLayer(id);
    backend.pushClipRect(frame.x, frame.y, frame.w, frame.h);
    draw();
    backend.popClip();
    backend.endLayer();
  };

  backend.beginLayer('paper-bg');
  backend.drawPaperBackground(pal.paperBg, options.cleanPaper !== true);
  backend.endLayer();

  clip('land-plots', () => {
    if (!scene) return;
    for (const plot of scene.farmlandPlots) {
      backend.drawPolygon(mapPoly(plot.innerPolygon), { fill: pal.farmlandFill, opacity: 0.88, stroke: pal.inkDark, lineWidth: px(0.5) });
      for (const furrow of plot.furrows) backend.drawPolyline(furrow.map(pt), { stroke: pal.inkDark, lineWidth: px(0.32), opacity: 0.32 });
    }
    for (const cell of scene.saltpanCells) backend.drawPolygon(mapPoly(cell.polygon), { fill: pal.saltpanFill, fillOpacity: cell.opacity, stroke: pal.paperBg, lineWidth: px(0.7) });
    for (const apron of scene.marketAprons) backend.drawPolygon(mapPoly(apron.points), { fill: '#e8dcc4', opacity: 0.7 });
  });

  clip('contours', () => {
    if (!scene) return;
    const labels = scene.terrain.contours.length <= 90;
    for (const contour of scene.terrain.contours) {
      backend.drawPolyline(contour.points.map(pt), {
        stroke: options.hoverContourId === contour.id ? pal.waterFill : pal.contourLine,
        lineWidth: contour.isIndex ? 1.45 : 0.75,
        opacity: contour.isIndex ? 0.86 : 0.5,
      });
      if (!labels || !contour.isIndex || contour.points.length <= 6) continue;
      const anchor = contour.points[Math.floor(contour.points.length / 2)];
      if (!anchor) continue;
      const s = pt(anchor);
      backend.drawText(`${Math.round(contour.elev)}m`, s[0] + 3, s[1] - 3, textStyle(9, pal.inkMuted, { haloColor: pal.paperBg, haloWidthPx: 2.2 }));
    }
    backend.drawSegments(
      scene.terrain.scarpTicks.map((tick) => [pt([tick.x1, tick.y1]), pt([tick.x2, tick.y2])] as const),
      { stroke: pal.contourLine, lineWidth: 0.75, opacity: 0.85 },
    );
  });

  clip('water-bodies', () => {
    if (!scene) return;
    for (const wb of scene.hydro.waterBodies) {
      backend.drawPolygon(mapPoly(wb.shorePoly), { fill: pal.waterFill, stroke: pal.inkDark, lineWidth: px(1.0) });
      for (const ripple of wb.ripples) backend.drawPolyline(ripple.map(pt), { stroke: pal.waterRipple, lineWidth: px(0.7) }, true);
    }
    for (const river of scene.hydro.rivers) {
      backend.drawPolygon(mapPoly(river.bankPolygon), { fill: pal.waterFill, stroke: pal.inkDark, lineWidth: px(0.9) });
      for (const ripple of river.ripples) backend.drawPolyline(ripple.map(pt), { stroke: pal.waterRipple, lineWidth: px(0.7), opacity: 0.9 });
    }
  });

  clip('reefs-fords', () => {
    if (!scene) return;
    for (const reef of scene.hydro.reefs) {
      backend.drawPolygon(mapPoly(reef.foamRing), { stroke: pal.waterRipple, lineWidth: px(0.8), dash: [3, 3] });
      for (const rock of reef.rocks) backend.drawPolygon(mapPoly(rock.points), { fill: pal.reefFill, stroke: pal.inkDark, lineWidth: px(0.6) });
    }
    for (const ford of scene.hydro.fordCrossings) {
      const fr = Math.max(8, ford.riverWidthM * 0.4);
      const dots: Vec2[][] = [];
      for (let row = -1; row <= 1; row += 2) {
        for (let i = -2; i <= 2; i += 1) {
          const c = pt([
            ford.x + ford.tangent[0] * i * 0.18 * fr + ford.normal[0] * row * 0.32 * fr,
            ford.y + ford.tangent[1] * i * 0.18 * fr + ford.normal[1] * row * 0.32 * fr,
          ]);
          dots.push([[c[0] - 1.6, c[1] - 1.6], [c[0] + 1.6, c[1] - 1.6], [c[0] + 1.6, c[1] + 1.6], [c[0] - 1.6, c[1] + 1.6]]);
        }
      }
      backend.drawBatchPolygons(dots, { fill: pal.inkDark, opacity: 0.65 });
    }
  });

  clip('canals', () => {
    if (!scene) return;
    for (const canal of scene.hydro.canals) {
      const qanat = canal.style === 'qanat';
      backend.drawPolygon(mapPoly(canal.bankPolygon), { fill: qanat ? '#3d6a74' : pal.waterFill, opacity: qanat ? 0.3 : 1, stroke: pal.inkDark, lineWidth: px(0.6) });
      backend.drawPolyline(canal.centerline.map(pt), {
        stroke: qanat ? '#3d6a74' : pal.waterRipple,
        lineWidth: px(qanat ? 0.9 : 1.2),
        dash: qanat ? [8, 6] : undefined,
      });
      for (const shaft of canal.shaftPoints) {
        const c = pt([shaft.x, shaft.y]);
        backend.drawCircle(c[0], c[1], px(shaft.radiusM), { fill: pal.paperBg, stroke: '#3d6a74', lineWidth: px(0.9) });
      }
    }
  });

  clip('roads-streets', () => {
    if (!scene) return;
    for (const fence of scene.gardenFences) {
      backend.drawPolyline(fence.points.map(pt), { stroke: pal.inkDark, lineWidth: px(0.5), dash: [4, 3], opacity: 0.65 });
    }
    for (const street of scene.internalStreets) backend.drawPolyline(street.map(pt), { stroke: pal.roadFill, lineWidth: px(3.0), opacity: 0.92 });
    for (const road of scene.hydro.roads) {
      backend.drawPolyline(road.centerline.map(pt), { stroke: '#5b4a38', lineWidth: px(road.widthM + 2.2), lineJoin: 'round' });
    }
    for (const road of scene.hydro.roads) {
      backend.drawPolyline(road.centerline.map(pt), { stroke: pal.roadFill, lineWidth: px(road.widthM), lineJoin: 'round' });
    }
    for (const road of scene.hydro.roads) {
      if (road.tier === 'lane') backend.drawPolyline(road.centerline.map(pt), { stroke: pal.inkDark, lineWidth: px(0.5), dash: [3, 4], opacity: 0.55 });
    }
  });

  clip('bridges', () => {
    if (!scene) return;
    for (const bridge of scene.hydro.bridges) {
      backend.drawPolygon(mapPoly(bridge.corners), { fill: pal.bridgeDeck, stroke: pal.inkDark, lineWidth: px(0.8) });
      backend.drawSegments(
        [[pt(bridge.parapetLeft[0]), pt(bridge.parapetLeft[1])], [pt(bridge.parapetRight[0]), pt(bridge.parapetRight[1])]],
        { stroke: pal.inkDark, lineWidth: px(1.4) },
      );
      for (const wing of bridge.abutments) backend.drawSegments([[pt(wing[0]), pt(wing[1])]], { stroke: pal.inkDark, lineWidth: px(0.7) });
    }
  });

  clip('buildings', () => {
    if (!scene) return;
    backend.drawBatchPolygons(
      scene.buildings.map((b) => mapPoly(b.points.map((q) => [q[0] + 1.8, q[1] + 1.8] as Vec2))),
      { fill: 'rgba(43, 37, 32, 0.18)' },
    );
    backend.drawBatchPolygons(
      scene.buildings.filter((b) => b.roofKind === 'inner').map((b) => mapPoly(b.points)),
      { fill: pal.roofInner, stroke: pal.inkDark, lineWidth: px(1.05) },
    );
    backend.drawBatchPolygons(
      scene.buildings.filter((b) => b.roofKind === 'town').map((b) => mapPoly(b.points)),
      { fill: pal.roofTown, stroke: pal.inkDark, lineWidth: px(1.05) },
    );
    for (const b of scene.buildings) {
      if (b.ridge) backend.drawSegments([[pt(b.ridge[0]), pt(b.ridge[1])]], { stroke: pal.inkDark, lineWidth: px(0.6), opacity: 0.5 });
    }
  });

  clip('walls-wells', () => {
    if (!scene) return;
    for (const wall of scene.walls) {
      const path = wall.polyline.map(pt);
      backend.drawPolyline(path, { stroke: pal.wallStroke, lineWidth: px(wall.thicknessM + 1.0) }, wall.closed);
      backend.drawPolyline(path, { stroke: pal.wallFill, lineWidth: px(wall.thicknessM) }, wall.closed);
      for (const tower of wall.towers) {
        const c = pt([tower.x, tower.y]);
        backend.drawCircle(c[0], c[1], px(tower.radiusM), { fill: pal.wallFill, stroke: pal.wallStroke, lineWidth: px(0.7) });
      }
      for (const gate of wall.gates) {
        backend.drawPolygon(mapPoly(gate.polygon), {
          fill: pal.paperBg,
          stroke: pal.wallStroke,
          lineWidth: px(1.1),
        });
        const a = (gate.angleDeg * Math.PI) / 180;
        const nx = -Math.sin(a);
        const ny = Math.cos(a);
        const inner = gate.thicknessM * 0.55;
        backend.drawSegments(
          [
            [pt([gate.x - nx * inner, gate.y - ny * inner]), pt([gate.x + nx * inner, gate.y + ny * inner])],
          ],
          { stroke: pal.wallFill, lineWidth: px(1.4) },
        );
      }
    }
    for (const well of scene.wells) {
      const c = pt([well.x, well.y]);
      backend.drawCircle(c[0], c[1], px(well.radiusM), { fill: pal.paperBg, stroke: pal.inkDark, lineWidth: px(0.9) });
      backend.drawCircle(c[0], c[1], px(well.radiusM * 0.45), { stroke: pal.waterFill, lineWidth: px(0.6) });
    }
  });

  clip('trees-canopy', () => {
    if (!scene) return;
    const trees = scene.trees;
    backend.drawCirclesMergedPass(trees.map((t) => { const c = pt([t.x + 2.2, t.y + 2.2]); return { cx: c[0], cy: c[1], r: px(t.r + 1.0) }; }), 'rgba(43, 37, 32, 0.15)');
    backend.drawCirclesMergedPass(trees.map((t) => { const c = pt([t.x, t.y]); return { cx: c[0], cy: c[1], r: px(t.r + 1.8) }; }), pal.treeOutline);
    backend.drawCirclesMergedPass(trees.map((t) => { const c = pt([t.x, t.y]); return { cx: c[0], cy: c[1], r: px(t.r) }; }), pal.treeFill);
  });

  backend.beginLayer('landmarks-labels');
  backend.pushClipRect(frame.x, frame.y, frame.w, frame.h);
  if (scene) {
    for (const landmark of project.landmarks) {
      const c = pt([landmark.x, landmark.y]);
      backend.drawCircle(c[0], c[1], px(9), { fill: pal.paperBg, stroke: pal.inkDark, lineWidth: px(0.8), opacity: 0.95 });
      const item = glyphItemFor(project, landmark.legendKey, landmark.glyphType, landmark.label);
      paintLegendGlyph(backend, item, c[0] - px(7), c[1] - px(4.5), px(14), px(9), pal);
      if (landmark.showLabel) {
        backend.drawText(landmark.label, c[0] + px(12), c[1], textStyle(11, pal.labelInk, { haloColor: pal.paperBg, haloWidthPx: 2.6 }));
      }
    }
    if (vp.zoom > 0.28) {
      for (const zone of scene.zones) {
        const c = pt(computePolygonCentroid(zone.points));
        backend.drawText(zone.name, c[0] + px(6), c[1] + px(14), textStyle(10, pal.inkMuted, { italic: true, haloColor: pal.paperBg, haloWidthPx: 2.2 }));
      }
      for (const river of scene.hydro.rivers) {
        const mid = river.centerline[Math.floor(river.centerline.length / 2)];
        if (!mid) continue;
        const c = pt(mid);
        backend.drawText(river.name, c[0], c[1] - px(8), textStyle(11, pal.waterFill, { italic: true, haloColor: pal.paperBg, haloWidthPx: 2.4 }));
      }
    }
  }
  backend.popClip();
  backend.endLayer();

  if (options.includeCartouche !== false) {
    backend.beginLayer('cartouche');
    paintFurniture(backend, {
      project,
      palette: pal,
      selection: options.selection,
      legend: resolveEffectiveLegend(
        project.legend,
        (scene as { legend?: TownProject['legend'] } | null)?.legend ?? null,
      ),
      frame,
      widthPx: vp.widthPx,
      heightPx: vp.heightPx,
      zoom: vp.zoom,
    });
    backend.endLayer();
  }

  if (options.isExport !== true) {
    backend.beginLayer('ui-overlay');
    paintSelectionHandles(backend, project, options.selection ?? null, pal, vp);
    const draft = options.draftPoints ?? [];
    if (draft.length >= 2) backend.drawPolyline(draft.map(pt), { stroke: pal.accentTerracotta, lineWidth: 1.6, dash: [6, 4] });
    if (options.brushCursor) {
      const c = pt([options.brushCursor.x, options.brushCursor.y]);
      backend.drawCircle(c[0], c[1], px(options.brushCursor.radiusM), { stroke: pal.accentTerracotta, lineWidth: 1.2, dash: [5, 4] });
    }
    if (options.measureSegment) {
      const [a, b] = options.measureSegment;
      const sa = pt(a);
      const sb = pt(b);
      backend.drawSegments([[sa, sb]], { stroke: pal.accentTerracotta, lineWidth: 1.4, dash: [7, 5] });
      const field = (scene as { terrain?: { terrainData?: Parameters<typeof sampleElevation>[0] } } | null)
        ?.terrain?.terrainData;
      const distM = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dz = field ? sampleElevation(field, b[0], b[1]) - sampleElevation(field, a[0], a[1]) : 0;
      const slopeDeg = distM > 1e-6 ? (Math.atan2(dz, distM) * 180) / Math.PI : 0;
      backend.drawText(
        `${distM.toFixed(0)} m · ΔZ ${dz >= 0 ? '+' : ''}${dz.toFixed(1)} m · ${slopeDeg.toFixed(1)}°`,
        (sa[0] + sb[0]) * 0.5,
        (sa[1] + sb[1]) * 0.5 - 8,
        textStyle(10, pal.inkDark, { align: 'center', haloColor: pal.paperBg, haloWidthPx: 2.4 }),
      );
    }
    backend.endLayer();
  }
}
