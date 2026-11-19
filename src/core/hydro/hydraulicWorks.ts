import type { Polygon, Polyline, Vec2 } from '../../schema/geometry.types';
import type { TownProject } from '../../schema/project.schema';
import { orientedAxes, orientedRect, scalePolygonAbout } from '../math/oriented';

export interface BuiltWeir {
  readonly id: string;
  readonly name: string;
  readonly center: Vec2;
  readonly angleDeg: number;
  readonly spanM: number;
  readonly widthM: number;
  readonly bodyPolygon: Polygon;
  readonly pierPolygons: ReadonlyArray<Polygon>;
  readonly foamLines: ReadonlyArray<Polyline>;
}

export interface BuiltDock {
  readonly id: string;
  readonly name: string;
  readonly kind: 'slipway' | 'wooden_pier';
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
  readonly apronPolygon: Polygon;
  readonly deckPolygon: Polygon | null;
  readonly slipLines: ReadonlyArray<Polyline>;
  readonly pilePoints: ReadonlyArray<Vec2>;
}

export interface BuiltWatermill {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
  readonly bodyPolygon: Polygon;
  readonly wheelCenter: Vec2;
  readonly wheelRadiusM: number;
  readonly spokes: ReadonlyArray<readonly [Vec2, Vec2]>;
}

export interface HydraulicWorks {
  readonly weirs: ReadonlyArray<BuiltWeir>;
  readonly docks: ReadonlyArray<BuiltDock>;
  readonly watermills: ReadonlyArray<BuiltWatermill>;
  /** 全部刚性足印（堰体/闸墩/岸坪/栈桥/工坊屋体），用于障碍场与拾取 */
  readonly footprints: ReadonlyArray<Polygon>;
}

export interface BankSnap {
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
  readonly dist: number;
}

function ringOf(poly: Polygon): Polyline {
  const first = poly[0];
  return first ? [...poly, first] : [];
}

/** 最近岸线吸附：遍历河岸/湖岸闭合环，返回法向外侧点与指向水域的角 */
export function snapPointToWaterBank(
  rivers: ReadonlyArray<{ readonly bankPolygon: Polygon }>,
  waterBodies: ReadonlyArray<{ readonly shorePoly: Polygon }>,
  canals: ReadonlyArray<{ readonly bankPolygon: Polygon; readonly style: string }>,
  x: number,
  y: number,
  maxDistM = 160,
): BankSnap | null {
  let best: BankSnap | null = null;
  const rings: Array<{ ring: Polyline; inside: boolean }> = [];
  for (const river of rivers) rings.push({ ring: ringOf(river.bankPolygon), inside: false });
  for (const lake of waterBodies) rings.push({ ring: ringOf(lake.shorePoly), inside: false });
  for (const canal of canals) {
    if (canal.style === 'qanat') continue;
    rings.push({ ring: ringOf(canal.bankPolygon), inside: false });
  }
  for (const { ring } of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const dist = Math.hypot(x - px, y - py);
      if (dist > maxDistM) continue;
      if (best && dist >= best.dist) continue;
      const len = Math.sqrt(len2);
      const nx = -dy / len;
      const ny = dx / len;
      const toPoint: Vec2 = [x - px, y - py];
      const side = toPoint[0] * nx + toPoint[1] * ny >= 0 ? 1 : -1;
      best = {
        x: px,
        y: py,
        angleDeg: (Math.atan2(-nx * side, ny * side) * 180) / Math.PI,
        dist,
      };
    }
  }
  return best;
}

function buildWeir(project: TownProject, index: number): BuiltWeir {
  const source = project.weirs[index];
  if (!source) throw new Error('weir missing');
  const dx = source.pEnd[0] - source.pStart[0];
  const dy = source.pEnd[1] - source.pStart[1];
  const span = Math.max(8, Math.hypot(dx, dy));
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const center: Vec2 = [(source.pStart[0] + source.pEnd[0]) * 0.5, (source.pStart[1] + source.pEnd[1]) * 0.5];
  const body = orientedRect(center[0], center[1], span, source.widthM, angleDeg);
  const { ux, uy } = orientedAxes(angleDeg);
  const piers: Polygon[] = [];
  const gaps = source.sluices + 1;
  for (let i = 1; i < gaps; i += 1) {
    const t = i / gaps - 0.5;
    const cx = center[0] + ux[0] * span * t;
    const cy = center[1] + ux[1] * span * t;
    piers.push(orientedRect(cx, cy, 2.4, source.widthM * 1.25, angleDeg));
  }
  const foam: Polyline[] = [];
  for (let i = 0; i < source.sluices; i += 1) {
    const t = (i + 0.5) / gaps - 0.5;
    const baseX = center[0] + ux[0] * span * t + uy[0] * source.widthM * 0.85;
    const baseY = center[1] + ux[1] * span * t + uy[1] * source.widthM * 0.85;
    const pts: Vec2[] = [];
    for (let k = 0; k < 5; k += 1) {
      const wobble = (k % 2 === 0 ? 1 : -1) * 0.9;
      pts.push([
        baseX + uy[0] * k * 3.2 + ux[0] * wobble,
        baseY + uy[1] * k * 3.2 + ux[1] * wobble,
      ]);
    }
    foam.push(pts);
  }
  return {
    id: source.id,
    name: source.name,
    center,
    angleDeg,
    spanM: span,
    widthM: source.widthM,
    bodyPolygon: body,
    pierPolygons: piers,
    foamLines: foam,
  };
}

function buildDock(project: TownProject, index: number): BuiltDock {
  const source = project.docks[index];
  if (!source) throw new Error('dock missing');
  const { ux, uy } = orientedAxes(source.angleDeg);
  const apronLen = source.kind === 'wooden_pier' ? source.lengthM * 0.34 : source.lengthM;
  const apron = orientedRect(source.x, source.y, source.widthM, apronLen, source.angleDeg);
  const inset = scalePolygonAbout(apron, source.x, source.y, 0.86);
  let deck: Polygon | null = null;
  const piles: Vec2[] = [];
  if (source.kind === 'wooden_pier') {
    const pierLen = source.lengthM * 0.66;
    const deckCx = source.x + uy[0] * (apronLen * 0.5 + pierLen * 0.5);
    const deckCy = source.y + uy[1] * (apronLen * 0.5 + pierLen * 0.5);
    deck = orientedRect(deckCx, deckCy, source.widthM * 0.62, pierLen, source.angleDeg);
    for (let i = 1; i <= 3; i += 1) {
      const t = (i / 4) * pierLen;
      for (const side of [-1, 1]) {
        piles.push([
          deckCx + uy[0] * (t - pierLen * 0.5) + ux[0] * source.widthM * 0.24 * side,
          deckCy + uy[1] * (t - pierLen * 0.5) + ux[1] * source.widthM * 0.24 * side,
        ]);
      }
    }
  }
  const slips: Polyline[] = [];
  const slipCount = source.kind === 'slipway' ? source.slips : 0;
  for (let i = 1; i <= slipCount; i += 1) {
    const off = (i / (slipCount + 1) - 0.5) * source.widthM * 0.82;
    const half = apronLen * 0.44;
    const cx = source.x + ux[0] * off;
    const cy = source.y + ux[1] * off;
    slips.push([
      [cx - uy[0] * half, cy - uy[1] * half],
      [cx + uy[0] * half, cy + uy[1] * half],
    ]);
  }
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    x: source.x,
    y: source.y,
    angleDeg: source.angleDeg,
    apronPolygon: inset,
    deckPolygon: deck,
    slipLines: slips,
    pilePoints: piles,
  };
}

function buildWatermill(project: TownProject, index: number): BuiltWatermill {
  const source = project.watermills[index];
  if (!source) throw new Error('watermill missing');
  const body = orientedRect(source.x, source.y, source.widthM, source.depthM, source.angleDeg);
  const { ux } = orientedAxes(source.angleDeg);
  const side = source.wheelSide === 'left' ? -1 : 1;
  const radius = Math.max(3.2, source.depthM * 0.42);
  const wheelCenter: Vec2 = [
    source.x - ux[0] * (source.widthM * 0.5 + radius * 0.55) * side,
    source.y - ux[1] * (source.widthM * 0.5 + radius * 0.55) * side,
  ];
  const spokes: Array<readonly [Vec2, Vec2]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = (Math.PI / 8) * i * 2;
    spokes.push([
      [wheelCenter[0] - Math.cos(ang) * radius, wheelCenter[1] - Math.sin(ang) * radius],
      [wheelCenter[0] + Math.cos(ang) * radius, wheelCenter[1] + Math.sin(ang) * radius],
    ]);
  }
  return {
    id: source.id,
    name: source.name,
    x: source.x,
    y: source.y,
    angleDeg: source.angleDeg,
    bodyPolygon: body,
    wheelCenter,
    wheelRadiusM: radius,
    spokes,
  };
}

export function buildHydraulicWorks(project: TownProject): HydraulicWorks {
  const weirs = project.weirs.map((_, i) => buildWeir(project, i));
  const docks = project.docks.map((_, i) => buildDock(project, i));
  const watermills = project.watermills.map((_, i) => buildWatermill(project, i));
  const footprints: Polygon[] = [];
  for (const weir of weirs) {
    footprints.push(weir.bodyPolygon);
    for (const pier of weir.pierPolygons) footprints.push(pier);
  }
  for (const dock of docks) {
    footprints.push(dock.apronPolygon);
    if (dock.deckPolygon) footprints.push(dock.deckPolygon);
  }
  for (const mill of watermills) footprints.push(mill.bodyPolygon);
  return { weirs, docks, watermills, footprints };
}
