import type { Polyline, Vec2 } from '../schema/geometry.types';
import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import type { HydroRoadPackage } from '../core/hydro/reefRoadBridge';
import { computePolygonBBox, computePolygonCentroid, pointInPolygon } from '../core/math/polygon';
import { sampleCatmullRom } from '../core/math/spline';
import {
  DEG,
  type GeoAnchor,
  normalizeDeg,
  samplePolylineAtT,
  sampleRiverWidthAtT,
} from './geometryPolyline';

export {
  DEG,
  normalizeDeg,
  samplePolylineAtT,
  sampleRiverWidthAtT,
  computeSnappedWeir,
} from './geometryPolyline';
export type { GeoAnchor, PolylineSample, RelativeShape, RiverLike } from './geometryPolyline';
export { buildRelativePolygon } from './geometryShape';

export interface DockSnapParams {
  readonly targetId: string;
  readonly targetKind?: 'river' | 'waterBody';
  readonly t: number;
  readonly bank?: 'left' | 'right';
  readonly kind?: 'slipway' | 'wooden_pier';
  readonly slips?: number;
  readonly spacingM?: number;
  readonly lengthM?: number;
  readonly widthM?: number;
  readonly insetM?: number;
}

/** 码头吸附：河岸 / 湖岸。uy（局部 +y）才是栈桥 / 滑道伸入水面的方向，故角度再减 90° */
export function computeSnappedDock(
  project: TownProject,
  scene: CompiledScene | null,
  params: DockSnapParams,
): { x: number; y: number; angleDeg: number; widthM: number } {
  const inset = Math.max(0, params.insetM ?? 2);
  const bank = params.bank ?? 'left';
  if ((params.targetKind ?? 'river') === 'river') {
    const hydro = scene?.hydro as HydroRoadPackage | undefined;
    const river = hydro?.rivers.find((item) => item.id === params.targetId);
    if (river) {
      const sample = samplePolylineAtT(river.centerline, params.t);
      const width = river.widthAtU(params.t);
      const bankNormal = bank === 'left' ? sample.leftNormal : sample.rightNormal;
      const towardWater: Vec2 = [-bankNormal[0], -bankNormal[1]];
      const offset = Math.max(0, width * 0.5 - inset);
      return {
        x: sample.point[0] + bankNormal[0] * offset,
        y: sample.point[1] + bankNormal[1] * offset,
        angleDeg: normalizeDeg(Math.atan2(towardWater[1], towardWater[0]) * DEG - 90),
        widthM: width,
      };
    }
    const source = project.rivers.find((item) => item.id === params.targetId);
    if (!source) throw new Error(`snap_dock: 找不到河道 ${params.targetId}`);
    const sample = samplePolylineAtT(source.points, params.t);
    const width = sampleRiverWidthAtT(source, params.t);
    const bankNormal = bank === 'left' ? sample.leftNormal : sample.rightNormal;
    const offset = Math.max(0, width * 0.5 - inset);
    const towardWater: Vec2 = [-bankNormal[0], -bankNormal[1]];
    return {
      x: sample.point[0] + bankNormal[0] * offset,
      y: sample.point[1] + bankNormal[1] * offset,
      angleDeg: normalizeDeg(Math.atan2(towardWater[1], towardWater[0]) * DEG - 90),
      widthM: width,
    };
  }
  const hydro = scene?.hydro as HydroRoadPackage | undefined;
  const builtBody = hydro?.waterBodies.find((item) => item.id === params.targetId);
  const body = builtBody ?? project.waterBodies.find((item) => item.id === params.targetId);
  if (!body) throw new Error(`snap_dock: 找不到水体 ${params.targetId}`);
  const ring: Polyline = 'shorePoly' in body ? body.shorePoly : body.points;
  const closed: Polyline = [...ring, ring[0] ?? [0, 0]];
  const sample = samplePolylineAtT(closed, params.t);
  let inward: Vec2 = sample.rightNormal;
  const probe: Vec2 = [sample.point[0] + inward[0] * 2, sample.point[1] + inward[1] * 2];
  if (!pointInPolygon(probe[0], probe[1], ring)) inward = sample.leftNormal;
  return {
    x: sample.point[0] - inward[0] * inset,
    y: sample.point[1] - inward[1] * inset,
    angleDeg: normalizeDeg(Math.atan2(inward[1], inward[0]) * DEG - 90),
    widthM: 0,
  };
}

export interface WatermillSnapParams {
  readonly targetId: string;
  readonly targetKind?: 'river' | 'canal';
  readonly t: number;
  readonly bank?: 'left' | 'right';
  readonly wheelSide?: 'left' | 'right';
  readonly widthM?: number;
  readonly depthM?: number;
  readonly bankOffsetM?: number;
}

/**
 * 水力工坊：屋体稳坐干岸，+ux 指向水心，水轮（wheelSide='left'）贴岸临水。
 * buildWatermill 中水轮位于 -ux*side（left → +ux），故 angleDeg 必须让 ux 对水。
 */
export function computeSnappedWatermill(project: TownProject, params: WatermillSnapParams): {
  x: number;
  y: number;
  angleDeg: number;
  wheelSide: 'left' | 'right';
} {
  const bank = params.bank ?? 'left';
  const bankOffset = Math.max(0, params.bankOffsetM ?? 2);
  const millWidth = Math.max(8, params.widthM ?? 18);
  if ((params.targetKind ?? 'river') === 'river') {
    const river = project.rivers.find((item) => item.id === params.targetId);
    if (!river) throw new Error(`snap_watermill: 找不到河道 ${params.targetId}`);
    const sample = samplePolylineAtT(river.points, params.t);
    const width = sampleRiverWidthAtT(river, params.t);
    const bankNormal = bank === 'left' ? sample.leftNormal : sample.rightNormal;
    const towardWater: Vec2 = [-bankNormal[0], -bankNormal[1]];
    const offset = width * 0.5 + millWidth * 0.5 + bankOffset;
    return {
      x: sample.point[0] + bankNormal[0] * offset,
      y: sample.point[1] + bankNormal[1] * offset,
      angleDeg: normalizeDeg(Math.atan2(towardWater[1], towardWater[0]) * DEG),
      wheelSide: params.wheelSide ?? 'left',
    };
  }
  const canal = project.canals.find((item) => item.id === params.targetId);
  if (!canal) throw new Error(`snap_watermill: 找不到水渠 ${params.targetId}`);
  const sample = samplePolylineAtT(canal.points, params.t);
  const bankNormal = bank === 'left' ? sample.leftNormal : sample.rightNormal;
  const towardWater: Vec2 = [-bankNormal[0], -bankNormal[1]];
  const offset = canal.widthM * 0.5 + millWidth * 0.5 + bankOffset;
  return {
    x: sample.point[0] + bankNormal[0] * offset,
    y: sample.point[1] + bankNormal[1] * offset,
    angleDeg: normalizeDeg(Math.atan2(towardWater[1], towardWater[0]) * DEG),
    wheelSide: params.wheelSide ?? 'left',
  };
}

/** 统一锚点解析：坐标 / 河岸 / 选区边 / 实体 / 图幅边界 */
export function resolveAnchorPoint(project: TownProject, scene: CompiledScene | null, anchor: GeoAnchor): Vec2 {
  if (Array.isArray(anchor)) return [anchor[0], anchor[1]];
  const world = project.meta.worldSizeM;
  if ('riverId' in anchor) {
    const river = project.rivers.find((item) => item.id === anchor.riverId);
    if (!river) throw new Error(`anchor: 找不到河道 ${anchor.riverId}`);
    const sample = samplePolylineAtT(river.points, anchor.t);
    if (anchor.bank === 'center' || !anchor.bank) return sample.point;
    const width = sampleRiverWidthAtT(river, anchor.t);
    const n = anchor.bank === 'left' ? sample.leftNormal : sample.rightNormal;
    const off = width * 0.5 + (anchor.offsetM ?? 0);
    return [sample.point[0] + n[0] * off, sample.point[1] + n[1] * off];
  }
  if ('zoneId' in anchor) {
    const zone = project.zones.find((item) => item.id === anchor.zoneId);
    if (!zone) throw new Error(`anchor: 找不到选区 ${anchor.zoneId}`);
    const [minX, minY, maxX, maxY] = computePolygonBBox(zone.points);
    const off = anchor.offsetM ?? 0;
    const side = anchor.side ?? 'center';
    if (side === 'center') return computePolygonCentroid(zone.points);
    if (side === 'north') return [(minX + maxX) * 0.5, minY - off];
    if (side === 'south') return [(minX + maxX) * 0.5, maxY + off];
    if (side === 'west') return [minX - off, (minY + maxY) * 0.5];
    return [maxX + off, (minY + maxY) * 0.5];
  }
  if ('entityId' in anchor) {
    const id = anchor.entityId;
    const weir = project.weirs.find((item) => item.id === id);
    if (weir) return [(weir.pStart[0] + weir.pEnd[0]) * 0.5, (weir.pStart[1] + weir.pEnd[1]) * 0.5];
    const dock = project.docks.find((item) => item.id === id);
    if (dock) return [dock.x, dock.y];
    const mill = project.watermills.find((item) => item.id === id);
    if (mill) return [mill.x, mill.y];
    const structure = project.structures.find((item) => item.id === id);
    if (structure) return [structure.x, structure.y];
    const landmark = project.landmarks.find((item) => item.id === id);
    if (landmark) return [landmark.x, landmark.y];
    const bridge = scene?.hydro.bridges.find((item) => item.id === id);
    if (bridge) return [bridge.x, bridge.y];
    throw new Error(`anchor: 找不到实体 ${id}`);
  }
  if ('edge' in anchor) {
    const ratio = Math.max(0.05, Math.min(0.95, anchor.ratio));
    if (anchor.edge === 'north') return [world * ratio, 0];
    if (anchor.edge === 'south') return [world * ratio, world];
    if (anchor.edge === 'west') return [0, world * ratio];
    return [world, world * ratio];
  }
  throw new Error('anchor: 无法识别的锚点');
}

/** 连接道路：锚点 → 平滑折线（curveOffsetM 在首尾弦中点加垂直弧） */
export function buildRoadPolyline(
  project: TownProject,
  scene: CompiledScene | null,
  from: GeoAnchor,
  to: GeoAnchor,
  via: ReadonlyArray<GeoAnchor>,
  curveOffsetM = 0,
): Polyline {
  const points: Vec2[] = [resolveAnchorPoint(project, scene, from)];
  for (const anchor of via) points.push(resolveAnchorPoint(project, scene, anchor));
  points.push(resolveAnchorPoint(project, scene, to));
  if (points.length === 2 && Math.abs(curveOffsetM) > 1e-6) {
    const a = points[0];
    const b = points[1];
    if (a && b) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      points.splice(1, 0, [
        (a[0] + b[0]) * 0.5 - (dy / len) * curveOffsetM,
        (a[1] + b[1]) * 0.5 + (dx / len) * curveOffsetM,
      ]);
    }
  }
  const smooth = sampleCatmullRom(points, 8, false);
  const out: Vec2[] = [];
  for (const p of smooth) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-7) out.push([p[0], p[1]]);
  }
  const first = points[0];
  const lastPoint = points[points.length - 1];
  if (first && out.length > 0) out[0] = [first[0], first[1]];
  if (lastPoint && out.length > 0) out[out.length - 1] = [lastPoint[0], lastPoint[1]];
  return out;
}
