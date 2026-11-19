import type {
  GateStructure,
  Polygon,
  Polyline,
  Vec2,
  WallSegment,
  WallTowerPoint,
} from '../../schema/geometry.types';
import { intersectSegmentsExact } from '../math/polygon';
import type { ZoneGeneratorInput } from '../obstacles/guardSafe';

export type { GateStructure, WallSegment } from '../../schema/geometry.types';

export interface WallSystem {
  readonly walls: ReadonlyArray<WallSegment>;
  readonly gates: ReadonlyArray<GateStructure>;
  readonly towers: ReadonlyArray<WallTowerPoint>;
}

const RING_STEP_M = 16;
const GATE_TOWER_RADIUS = 5.2;
const GATE_TOWER_INSET_M = 2.6;

interface RawGate {
  readonly x: number;
  readonly y: number;
  readonly arc: number;
  readonly roadId: string;
  readonly roadName: string;
  readonly roadWidthM: number;
  readonly halfGap: number;
}

interface GateInterval {
  start: number;
  end: number;
  readonly gates: GateStructure[];
}

function densifyRing(points: Polyline, step: number): { ring: Vec2[]; arc: number[]; total: number } {
  const ring: Vec2[] = [];
  const arc: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      ring.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      arc.push(acc + len * t);
    }
    acc += len;
  }
  return { ring, arc, total: acc };
}

function pointAtArc(ring: ReadonlyArray<Vec2>, arc: ReadonlyArray<number>, total: number, s: number): Vec2 {
  if (ring.length === 0) return [0, 0];
  const safeTotal = total > 1e-9 ? total : 1;
  const target = ((s % safeTotal) + safeTotal) % safeTotal;
  for (let i = 0; i < ring.length; i += 1) {
    const a = arc[i] ?? 0;
    const b = i + 1 < ring.length ? (arc[i + 1] ?? safeTotal) : safeTotal;
    if (target >= a && target <= b) {
      const p = ring[i];
      const q = i + 1 < ring.length ? ring[i + 1] : ring[0];
      if (!p || !q) return [0, 0];
      const span = b - a;
      const t = span > 1e-9 ? (target - a) / span : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    }
  }
  const first = ring[0];
  return first ? [first[0], first[1]] : [0, 0];
}

function sliceRing(
  ring: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  fromS: number,
  toS: number,
): Polyline {
  const span = ((toS - fromS) % total + total) % total;
  if (span < 1e-6) return [];
  const items: Array<{ rel: number; p: Vec2 }> = [];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    if (!p) continue;
    const rel = (((arc[i] ?? 0) - fromS) % total + total) % total;
    if (rel > 1e-6 && rel < span - 1e-6) items.push({ rel, p });
  }
  items.sort((a, b) => a.rel - b.rel);
  return [
    pointAtArc(ring, arc, total, fromS),
    ...items.map((it) => it.p),
    pointAtArc(ring, arc, total, toS),
  ];
}

/** 城门矩形门楼：沿墙切向 halfLen、沿法向 halfDepth 的真实厚度二维多边形 */
function gatePolygon(center: Vec2, tangent: Vec2, halfLen: number, halfDepth: number): Polygon {
  const nx = -tangent[1];
  const ny = tangent[0];
  return [
    [center[0] - tangent[0] * halfLen - nx * halfDepth, center[1] - tangent[1] * halfLen - ny * halfDepth],
    [center[0] + tangent[0] * halfLen - nx * halfDepth, center[1] + tangent[1] * halfLen - ny * halfDepth],
    [center[0] + tangent[0] * halfLen + nx * halfDepth, center[1] + tangent[1] * halfLen + ny * halfDepth],
    [center[0] - tangent[0] * halfLen + nx * halfDepth, center[1] - tangent[1] * halfLen + ny * halfDepth],
  ];
}

/** 把各城门豁口 [arc-halfGap, arc+halfGap] 归一化并按弧长合并重叠区间（含首尾环绕） */
function mergeGateIntervals(gates: ReadonlyArray<GateStructure>, total: number): GateInterval[] {
  const spans: Array<{ start: number; end: number; gate: GateStructure }> = [];
  for (const gate of gates) {
    let start = gate.arc - gate.gapHalf;
    let end = gate.arc + gate.gapHalf;
    if (start < 0) {
      spans.push({ start: start + total, end: total, gate });
      spans.push({ start: 0, end, gate });
      continue;
    }
    if (end > total) {
      spans.push({ start, end: total, gate });
      spans.push({ start: 0, end: end - total, gate });
      continue;
    }
    spans.push({ start, end, gate });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: GateInterval[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 0.5) {
      last.end = Math.max(last.end, span.end);
      if (!last.gates.some((g) => g.id === span.gate.id)) last.gates.push(span.gate);
    } else {
      merged.push({ start: span.start, end: span.end, gates: [span.gate] });
    }
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first && last && first.start <= 0.5 && last.end >= total - 0.5) {
      first.start = last.start - total;
      for (const gate of last.gates) if (!first.gates.some((g) => g.id === gate.id)) first.gates.push(gate);
      merged.pop();
    }
  }
  return merged;
}

/**
 * 阶段一城垣环构建器：以 16m 步长加密选区边界，对平滑后的 roadsBuilt 中心线调用
 * `intersectSegmentsExact` 取真实交点，城门取墙段切向角并生成真实厚度门楼多边形，
 * 豁口区间按弧长合并重叠，彻底杜绝近距双路绕环重画封死城门。
 */
export function buildZoneWallSystem(input: ZoneGeneratorInput): WallSystem {
  const { zone, project, obstacleCtx } = input;
  const thickness = Math.max(1.5, zone.wallThicknessM);
  const { ring, arc, total } = densifyRing(zone.points, RING_STEP_M);
  if (ring.length < 3 || total <= 0) return { walls: [], gates: [], towers: [] };

  const raw: RawGate[] = [];
  for (const road of project.roads) {
    const built = obstacleCtx.roadsBuilt.find((item) => item.id === road.id);
    const pts = built?.centerline ?? road.points;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!a || !b) continue;
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-9) continue;
      for (let j = 0; j < pts.length - 1; j += 1) {
        const c = pts[j];
        const d = pts[j + 1];
        if (!c || !d) continue;
        const hit = intersectSegmentsExact(a, b, c, d);
        if (!hit) continue;
        raw.push({
          x: hit.x,
          y: hit.y,
          arc: (arc[i] ?? 0) + segLen * hit.t,
          roadId: road.id,
          roadName: road.name,
          roadWidthM: road.widthM,
          halfGap: 0.5 * road.widthM + (zone.contentType === 'citadel' ? 3.5 : 4.5),
        });
      }
    }
  }

  raw.sort((p, q) => p.arc - q.arc);
  const gates: GateStructure[] = [];
  const gateArcs: number[] = [];
  for (const g of raw) {
    const wrapped = gateArcs.some((v) => Math.abs(v - g.arc) < 4.0 || Math.abs(Math.abs(v - g.arc) - total) < 4.0);
    if (wrapped) continue;
    gateArcs.push(g.arc);
    const before = pointAtArc(ring, arc, total, g.arc - 1.0);
    const after = pointAtArc(ring, arc, total, g.arc + 1.0);
    const tlen = Math.hypot(after[0] - before[0], after[1] - before[1]);
    const tangent: Vec2 = tlen > 1e-9 ? [(after[0] - before[0]) / tlen, (after[1] - before[1]) / tlen] : [1, 0];
    const leftArc = g.arc - g.halfGap - GATE_TOWER_INSET_M;
    const rightArc = g.arc + g.halfGap + GATE_TOWER_INSET_M;
    gates.push({
      id: `gate_${zone.id}_${gates.length + 1}`,
      x: g.x,
      y: g.y,
      arc: g.arc,
      angleDeg: (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI,
      gapHalf: g.halfGap,
      thicknessM: thickness,
      polygon: gatePolygon([g.x, g.y], tangent, g.halfGap + GATE_TOWER_INSET_M, thickness * 0.9),
      roadId: g.roadId,
      roadName: g.roadName,
      roadWidthM: g.roadWidthM,
      towers: [
        pointAtArc(ring, arc, total, leftArc),
        pointAtArc(ring, arc, total, rightArc),
      ],
    });
  }

  const towers: WallTowerPoint[] = [];
  const walls: WallSegment[] = [];
  const pushTower = (x: number, y: number, kind: 'tower' | 'gate_tower'): WallTowerPoint => {
    const key = `${Math.round(x * 10)}_${Math.round(y * 10)}`;
    const existing = towers.find((item) => `${Math.round(item.x * 10)}_${Math.round(item.y * 10)}` === key);
    if (existing) return existing;
    const tower: WallTowerPoint = { x, y, radiusM: GATE_TOWER_RADIUS, kind };
    towers.push(tower);
    return tower;
  };

  if (gates.length === 0) {
    const sectionTowers: WallTowerPoint[] = [];
    for (let s = 0; s < total; s += Math.max(30, zone.towerIntervalM)) {
      const p = pointAtArc(ring, arc, total, s);
      sectionTowers.push(pushTower(p[0], p[1], 'tower'));
    }
    const wall: WallSegment = {
      id: `wall_${zone.id}_1`,
      zoneId: zone.id,
      thicknessM: thickness,
      polyline: [...ring, ring[0] ?? [0, 0]],
      closed: true,
      gates: [],
      towers: sectionTowers,
    };
    walls.push(wall);
    obstacleCtx.wallsBuilt.push({ id: wall.id, thicknessM: thickness, polyline: wall.polyline });
    return { walls, gates, towers };
  }

  const intervals = mergeGateIntervals(gates, total);
  for (let i = 0; i < intervals.length; i += 1) {
    const current = intervals[i];
    const next = intervals[(i + 1) % intervals.length];
    if (!current || !next) continue;
    const fromS = current.end;
    const toS = i + 1 === intervals.length ? next.start + total : next.start;
    const polyline = sliceRing(ring, arc, total, fromS, toS);
    if (polyline.length < 2) continue;
    const sectionTowers: WallTowerPoint[] = [];
    if (current.gates.length > 0) {
      const outerLeft = pointAtArc(ring, arc, total, current.start - GATE_TOWER_INSET_M);
      const outerRight = pointAtArc(ring, arc, total, current.end + GATE_TOWER_INSET_M);
      sectionTowers.push(pushTower(outerLeft[0], outerLeft[1], 'gate_tower'));
      sectionTowers.push(pushTower(outerRight[0], outerRight[1], 'gate_tower'));
    }
    const spanLen = ((toS - fromS) % total + total) % total;
    for (let s = Math.max(30, zone.towerIntervalM); s < spanLen; s += Math.max(30, zone.towerIntervalM)) {
      const p = pointAtArc(ring, arc, total, fromS + s);
      sectionTowers.push(pushTower(p[0], p[1], 'tower'));
    }
    const wall: WallSegment = {
      id: `wall_${zone.id}_${i + 1}`,
      zoneId: zone.id,
      thicknessM: thickness,
      polyline,
      closed: false,
      gates: current.gates,
      towers: sectionTowers,
    };
    walls.push(wall);
    obstacleCtx.wallsBuilt.push({ id: wall.id, thicknessM: thickness, polyline });
  }

  return { walls, gates, towers };
}
