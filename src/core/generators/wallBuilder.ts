import type {
  GateStructure,
  Polygon,
  Polyline,
  Vec2,
  WallSegment,
  WallTowerPoint,
  WaterGate,
} from '../../schema/geometry.types';
import { intersectSegmentsExact } from '../math/polygon';
import type { ZoneGeneratorInput } from '../obstacles/guardSafe';
import {
  type Opening,
  densifyRing,
  gatePolygon,
  mergeOpenings,
  pointAtArc,
  sliceRing,
  waterGatePolygon,
} from './wallGeometry';

export type { GateStructure, WallSegment } from '../../schema/geometry.types';

export interface WallSystem {
  readonly walls: ReadonlyArray<WallSegment>;
  readonly gates: ReadonlyArray<GateStructure>;
  readonly waterGates: ReadonlyArray<WaterGate>;
  readonly towers: ReadonlyArray<WallTowerPoint>;
}

const RING_STEP_M = 16;
const GATE_TOWER_RADIUS = 5.2;
const GATE_TOWER_INSET_M = 2.6;
const WATER_GATE_MARGIN_M = 1.25;

interface RawGate {
  readonly x: number;
  readonly y: number;
  readonly arc: number;
  readonly roadId: string;
  readonly roadName: string;
  readonly roadWidthM: number;
  readonly halfGap: number;
}

interface RawWaterGate {
  readonly x: number;
  readonly y: number;
  readonly arc: number;
  readonly canalId: string;
  readonly canalName: string;
  readonly canalWidthM: number;
  readonly halfGap: number;
}

function ringTangent(
  ring: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  at: number,
): Vec2 {
  const before = pointAtArc(ring, arc, total, at - 1.0);
  const after = pointAtArc(ring, arc, total, at + 1.0);
  const len = Math.hypot(after[0] - before[0], after[1] - before[1]);
  return len > 1e-9 ? [(after[0] - before[0]) / len, (after[1] - before[1]) / len] : [1, 0];
}

/**
 * 阶段一城垣环构建器：16m 步长加密选区边界，与平滑路网/明渠逐段精确求交。
 * 道路 → 城门门楼与敌台；明渠（非 qanat）→ 拱形水门豁口（宽 = canal.widthM + 2.5m），
 * 全部豁口按弧长合并后切环，彻底杜绝水渠横切死墙。
 */
export function buildZoneWallSystem(input: ZoneGeneratorInput): WallSystem {
  const { zone, project, obstacleCtx } = input;
  const thickness = Math.max(1.5, zone.wallThicknessM);
  const { ring, arc, total } = densifyRing(zone.points, RING_STEP_M);
  if (ring.length < 3 || total <= 0) return { walls: [], gates: [], waterGates: [], towers: [] };

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
    const wrapped = gateArcs.some(
      (v) => Math.abs(v - g.arc) < 4.0 || Math.abs(Math.abs(v - g.arc) - total) < 4.0,
    );
    if (wrapped) continue;
    gateArcs.push(g.arc);
    const tangent = ringTangent(ring, arc, total, g.arc);
    gates.push({
      id: `gate_${zone.id}_${gates.length + 1}`,
      x: g.x,
      y: g.y,
      arc: g.arc,
      angleDeg: (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI,
      gapHalf: g.halfGap,
      thicknessM: thickness,
      polygon: gatePolygon(
        [g.x, g.y],
        tangent,
        g.halfGap + GATE_TOWER_INSET_M,
        thickness * 0.9,
      ),
      roadId: g.roadId,
      roadName: g.roadName,
      roadWidthM: g.roadWidthM,
      towers: [
        pointAtArc(ring, arc, total, g.arc - g.halfGap - GATE_TOWER_INSET_M),
        pointAtArc(ring, arc, total, g.arc + g.halfGap + GATE_TOWER_INSET_M),
      ],
    });
  }

  const rawWater: RawWaterGate[] = [];
  for (const canal of project.canals) {
    if (canal.style === 'qanat') continue;
    const built = obstacleCtx.canalsBuilt.find((item) => item.id === canal.id);
    const pts = built?.centerline ?? canal.points;
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
        rawWater.push({
          x: hit.x,
          y: hit.y,
          arc: (arc[i] ?? 0) + segLen * hit.t,
          canalId: canal.id,
          canalName: canal.name,
          canalWidthM: canal.widthM,
          halfGap: 0.5 * (canal.widthM + 2.5),
        });
      }
    }
  }

  rawWater.sort((p, q) => p.arc - q.arc);
  const waterGates: WaterGate[] = [];
  const waterArcs: number[] = [];
  for (const w of rawWater) {
    const wrapped = waterArcs.some(
      (v) => Math.abs(v - w.arc) < 5.0 || Math.abs(Math.abs(v - w.arc) - total) < 5.0,
    );
    if (wrapped) continue;
    waterArcs.push(w.arc);
    const tangent = ringTangent(ring, arc, total, w.arc);
    const nx = -tangent[1];
    const ny = tangent[0];
    const mid = pointAtArc(ring, arc, total, w.arc);
    const bulgeM = 1.8;
    waterGates.push({
      id: `wgate_${zone.id}_${waterGates.length + 1}`,
      canalId: w.canalId,
      canalName: w.canalName,
      canalWidthM: w.canalWidthM,
      x: w.x,
      y: w.y,
      arc: w.arc,
      angleDeg: (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI,
      gapHalf: w.halfGap,
      thicknessM: thickness,
      polygon: waterGatePolygon(
        [w.x, w.y],
        tangent,
        w.halfGap + WATER_GATE_MARGIN_M,
        thickness * 0.85,
      ),
      archRing: [
        pointAtArc(ring, arc, total, w.arc - w.halfGap - WATER_GATE_MARGIN_M),
        [mid[0] + nx * bulgeM, mid[1] + ny * bulgeM],
        pointAtArc(ring, arc, total, w.arc + w.halfGap + WATER_GATE_MARGIN_M),
      ],
    });
  }

  const towers: WallTowerPoint[] = [];
  const walls: WallSegment[] = [];
  const pushTower = (x: number, y: number, kind: 'tower' | 'gate_tower'): WallTowerPoint => {
    const key = `${Math.round(x * 10)}_${Math.round(y * 10)}`;
    const existing = towers.find(
      (item) => `${Math.round(item.x * 10)}_${Math.round(item.y * 10)}` === key,
    );
    if (existing) return existing;
    const tower: WallTowerPoint = { x, y, radiusM: GATE_TOWER_RADIUS, kind };
    towers.push(tower);
    return tower;
  };

  const openings: Opening[] = [
    ...gates.map((g) => ({ id: g.id, kind: 'gate' as const, arc: g.arc, halfGap: g.gapHalf })),
    ...waterGates.map((w) => ({ id: w.id, kind: 'water' as const, arc: w.arc, halfGap: w.gapHalf })),
  ];

  if (openings.length === 0) {
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
      waterGates: [],
      towers: sectionTowers,
    };
    walls.push(wall);
    obstacleCtx.wallsBuilt.push({ id: wall.id, thicknessM: thickness, polyline: wall.polyline });
    return { walls, gates, waterGates, towers };
  }

  const intervals = mergeOpenings(openings, total);
  for (let i = 0; i < intervals.length; i += 1) {
    const current = intervals[i];
    const next = intervals[(i + 1) % intervals.length];
    if (!current || !next) continue;
    const fromS = current.end;
    const toS = i + 1 === intervals.length ? next.start + total : next.start;
    const polyline = sliceRing(ring, arc, total, fromS, toS);
    if (polyline.length < 2) continue;
    const sectionGates = gates.filter((g) => current.ids.includes(g.id));
    const sectionWater = waterGates.filter((w) => current.ids.includes(w.id));
    const sectionTowers: WallTowerPoint[] = [];
    if (sectionGates.length > 0) {
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
      gates: sectionGates,
      waterGates: sectionWater,
      towers: sectionTowers,
    };
    walls.push(wall);
    obstacleCtx.wallsBuilt.push({ id: wall.id, thicknessM: thickness, polyline });
  }

  return { walls, gates, waterGates, towers };
}

/** 明渠穿墙水门查询（渲染与测试共用） */
export function collectWaterGates(walls: ReadonlyArray<WallSegment>): WaterGate[] {
  const out: WaterGate[] = [];
  for (const wall of walls) out.push(...wall.waterGates);
  return out;
}

/** 水门门洞轮廓批量导出（障碍场注册用） */
export function waterGateFootprints(walls: ReadonlyArray<WallSegment>): Polygon[] {
  return collectWaterGates(walls).map((gate) => gate.polygon);
}

/** 兼容旧渲染：门洞折线（拱形饰线） */
export function waterGateArches(walls: ReadonlyArray<WallSegment>): Polyline[] {
  return collectWaterGates(walls).map((gate) => gate.archRing);
}
