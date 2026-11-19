import type { TownProject } from '../schema/project.schema';
import type { CompiledScene } from '../core/compileScene';
import { TerrainShapeSchema } from '../schema/entity.schema';
import type { AiOp } from './opSchemas';
import type { MutableProject } from './opHelpers';
import { applyDefined, scatterTreePoints, tierWidth, upsertWith, withoutOp } from './opHelpers';
import {
  buildRelativePolygon,
  buildRoadPolyline,
  normalizeDeg,
  resolveAnchorPoint,
} from './geometrySnap';

type Op<K extends AiOp['op']> = Extract<AiOp, { op: K }>;

function viewOf(draft: MutableProject): TownProject {
  return draft as unknown as TownProject;
}

export function applyProjectOp(draft: MutableProject, op: AiOp, scene: CompiledScene | null): string {
  switch (op.op) {
    case 'set_meta': return setMeta(draft, op);
    case 'set_terrain': return setTerrain(draft, op);
    case 'upsert_terrain_shape': return upsertTerrainShape(draft, op);
    case 'apply_geo_bootstrap': return applyGeoBootstrap(draft, op);
    case 'upsert_river': return upsertRiver(draft, op);
    case 'upsert_water_body': return upsertWaterBody(draft, op);
    case 'upsert_canal': return upsertCanal(draft, op);
    case 'place_zone': return placeZone(draft, op, scene);
    case 'connect_road': return connectRoad(draft, op, scene);
    case 'upsert_road': return upsertRoad(draft, op);
    case 'upsert_structure': return upsertStructure(draft, op, scene);
    case 'upsert_landmark': return upsertLandmark(draft, op, scene);
    case 'scatter_trees': return scatterTrees(draft, op, scene);
    default: return op.op;
  }
}

function setMeta(draft: MutableProject, op: Op<'set_meta'>): string {
  if (op.name !== undefined) draft.meta.name = op.name;
  if (op.subtitle !== undefined) draft.meta.subtitle = op.subtitle;
  if (op.worldSizeM !== undefined) draft.meta.worldSizeM = op.worldSizeM;
  if (op.geoAnchor !== undefined) {
    draft.meta.terraxAnchor = op.geoAnchor
      ? { lon: op.geoAnchor.lon, lat: op.geoAnchor.lat, elevM: op.geoAnchor.elevM, ...(op.geoAnchor.regionNote !== undefined ? { regionNote: op.geoAnchor.regionNote } : {}) }
      : null;
  }
  return 'set_meta';
}

function setTerrain(draft: MutableProject, op: Op<'set_terrain'>): string {
  applyDefined(draft.terrain, op);
  return 'set_terrain';
}

function upsertTerrainShape(draft: MutableProject, op: Op<'upsert_terrain_shape'>): string {
  const shape = TerrainShapeSchema.parse(withoutOp(op));
  upsertWith(draft.terrain.shapes, shape.id, () => shape, (target) => {
    applyDefined(target, shape);
  });
  return `upsert_terrain_shape:${shape.id}`;
}

function applyGeoBootstrap(draft: MutableProject, op: Op<'apply_geo_bootstrap'>): string {
  const payload = op.payload;
  draft.terrain.baseElev = payload.elevM;
  draft.terrain.slopeDirDeg = payload.slopeDirDeg;
  draft.terrain.slopeMagM = payload.slopeMagM;
  if (payload.query?.spanM !== undefined) {
    draft.meta.worldSizeM = payload.query.spanM;
  }
  if (op.clearExistingRivers) draft.rivers.splice(0, draft.rivers.length);
  if (op.importRivers) {
    for (const river of payload.suggestedRivers) {
      const points = river.localPoints.map(([x, y]) => [x, y] as const);
      upsertWith(draft.rivers, river.id, () => ({
        id: river.id,
        zIndex: 0,
        name: river.label,
        points: points.map(([x, y]) => [x, y] as [number, number]),
        widthStartM: river.widthStartM ?? 28,
        widthEndM: river.widthEndM ?? 46,
        widthsM: [],
        carveDepthM: 6,
        rippleLines: 3,
      }), (target) => {
        target.name = river.label;
        target.points = points.map(([x, y]) => [x, y] as [number, number]);
        if (river.widthStartM !== undefined) target.widthStartM = river.widthStartM;
        if (river.widthEndM !== undefined) target.widthEndM = river.widthEndM;
      });
    }
  }
  if (payload.query?.lon !== undefined && payload.query.lat !== undefined) {
    draft.meta.terraxAnchor = {
      lon: payload.query.lon,
      lat: payload.query.lat,
      elevM: payload.elevM,
      ...(payload.regionNote !== undefined ? { regionNote: payload.regionNote } : {}),
    };
  }
  return `apply_geo_bootstrap:${payload.suggestedRivers.length}`;
}

function upsertRiver(draft: MutableProject, op: Op<'upsert_river'>): string {
  const fields = withoutOp(op);
  upsertWith(draft.rivers, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '',
    points: op.points.map(([x, y]) => [x, y] as [number, number]),
    widthStartM: op.widthStartM ?? 28,
    widthEndM: op.widthEndM ?? 46,
    widthsM: op.widthsM ? [...op.widthsM] : [],
    carveDepthM: op.carveDepthM ?? 6,
    rippleLines: op.rippleLines ?? 3,
  }), (target) => applyDefined(target, fields));
  return `upsert_river:${op.id}`;
}

function upsertWaterBody(draft: MutableProject, op: Op<'upsert_water_body'>): string {
  const fields = withoutOp(op);
  upsertWith(draft.waterBodies, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '',
    kind: op.kind,
    points: op.points.map(([x, y]) => [x, y] as [number, number]),
    rippleLines: op.rippleLines ?? 3,
  }), (target) => applyDefined(target, fields));
  return `upsert_water_body:${op.id}`;
}

function upsertCanal(draft: MutableProject, op: Op<'upsert_canal'>): string {
  const fields = withoutOp(op);
  upsertWith(draft.canals, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '',
    style: op.style ?? 'stone_clean',
    points: op.points.map(([x, y]) => [x, y] as [number, number]),
    widthM: op.widthM ?? 6,
  }), (target) => applyDefined(target, fields));
  return `upsert_canal:${op.id}`;
}

function placeZone(draft: MutableProject, op: Op<'place_zone'>, scene: CompiledScene | null): string {
  const view = viewOf(draft);
  let points: import('../schema/geometry.types').Vec2[] | null = op.points
    ? op.points.map(([x, y]) => [x, y] as [number, number])
    : null;
  if (!points && op.relative) {
    const center = resolveAnchorPoint(view, scene, op.relative.anchor);
    points = buildRelativePolygon(
      center,
      op.relative.shape,
      op.relative.areaHa,
      op.relative.aspectRatio,
      op.relative.rotationDeg,
      op.seed ?? 1,
      view.meta.worldSizeM,
    );
  }
  if (!points) throw new Error(`place_zone:${op.id} 缺少 points 或 relative`);
  const { relative: _relative, ...zoneFields } = withoutOp(op);
  upsertWith(draft.zones, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '新增选区',
    contentType: op.contentType,
    points: (points ?? []).map(([x, y]) => [x, y] as [number, number]),
    seed: op.seed ?? 1,
    locked: false,
    density: op.density ?? 0.72,
    maxSlopeDeg: op.maxSlopeDeg ?? 24,
    streetWidthM: op.streetWidthM ?? 7.5,
    wallThicknessM: op.wallThicknessM ?? 5.5,
    towerIntervalM: op.towerIntervalM ?? 110,
    frayOuter: op.frayOuter ?? true,
    marketMode: op.marketMode ?? 'stalls',
    exclusionStyle: op.exclusionStyle ?? 'plague_stones',
    ribbonSpine: [],
    corridorWidthM: 110,
    buildingScale: op.buildingScale,
  }), (target) => {
    target.points = (points ?? []).map(([x, y]) => [x, y] as [number, number]);
    applyDefined(target, zoneFields);
  });
  return `place_zone:${op.id}`;
}

function connectRoad(draft: MutableProject, op: Op<'connect_road'>, scene: CompiledScene | null): string {
  const view = viewOf(draft);
  const tier = op.tier ?? 'street';
  const points = buildRoadPolyline(view, scene, op.from, op.to, op.via, op.curveOffsetM ?? 0);
  upsertWith(draft.roads, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '连接道路',
    tier,
    points,
    widthM: op.widthM ?? tierWidth(tier),
  }), (target) => {
    target.points = points;
    if (op.name !== undefined) target.name = op.name;
    if (op.tier !== undefined) target.tier = op.tier;
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `connect_road:${op.id}`;
}

function upsertRoad(draft: MutableProject, op: Op<'upsert_road'>): string {
  const tier = op.tier ?? 'street';
  const fields = withoutOp(op);
  upsertWith(draft.roads, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '',
    tier,
    points: op.points.map(([x, y]) => [x, y] as [number, number]),
    widthM: op.widthM ?? tierWidth(tier),
  }), (target) => applyDefined(target, fields));
  return `upsert_road:${op.id}`;
}

function upsertStructure(draft: MutableProject, op: Op<'upsert_structure'>, scene: CompiledScene | null): string {
  const view = viewOf(draft);
  const anchor = op.anchor ? resolveAnchorPoint(view, scene, op.anchor) : null;
  const x = op.x ?? anchor?.[0];
  const y = op.y ?? anchor?.[1];
  upsertWith(draft.structures, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    name: op.name ?? '核心建筑',
    x: x ?? 0,
    y: y ?? 0,
    angleDeg: op.angleDeg ?? 0,
    widthM: op.widthM ?? 36,
    depthM: op.depthM ?? 24,
    kind: op.kind ?? 'rect',
    roofKind: op.roofKind ?? 'citadel',
    ...(op.zoneId !== undefined ? { zoneId: op.zoneId } : {}),
  }), (target) => {
    if (x !== undefined) target.x = x;
    if (y !== undefined) target.y = y;
    if (op.name !== undefined) target.name = op.name;
    if (op.angleDeg !== undefined) target.angleDeg = normalizeDeg(op.angleDeg);
    if (op.widthM !== undefined) target.widthM = op.widthM;
    if (op.depthM !== undefined) target.depthM = op.depthM;
    if (op.kind !== undefined) target.kind = op.kind;
    if (op.roofKind !== undefined) target.roofKind = op.roofKind;
    if (op.zoneId !== undefined) target.zoneId = op.zoneId;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `upsert_structure:${op.id}`;
}

function upsertLandmark(draft: MutableProject, op: Op<'upsert_landmark'>, scene: CompiledScene | null): string {
  const view = viewOf(draft);
  const anchor = op.anchor ? resolveAnchorPoint(view, scene, op.anchor) : null;
  const x = op.x ?? anchor?.[0];
  const y = op.y ?? anchor?.[1];
  upsertWith(draft.landmarks, op.id, () => ({
    id: op.id,
    zIndex: op.zIndex ?? 0,
    legendKey: '',
    glyphType: op.glyphType ?? 'stele',
    label: op.label,
    x: x ?? 0,
    y: y ?? 0,
    showLabel: op.showLabel ?? true,
    sizePx: op.sizePx ?? 15,
    ...(op.badgeNum !== undefined ? { badgeNum: op.badgeNum } : {}),
    subtitle: op.subtitle ?? '',
  }), (target) => {
    target.label = op.label;
    if (x !== undefined) target.x = x;
    if (y !== undefined) target.y = y;
    if (op.glyphType !== undefined) target.glyphType = op.glyphType;
    if (op.showLabel !== undefined) target.showLabel = op.showLabel;
    if (op.sizePx !== undefined) target.sizePx = op.sizePx;
    if (op.badgeNum !== undefined) target.badgeNum = op.badgeNum;
    if (op.subtitle !== undefined) target.subtitle = op.subtitle;
    if (op.zIndex !== undefined) target.zIndex = op.zIndex;
  });
  return `upsert_landmark:${op.id}`;
}

function scatterTrees(draft: MutableProject, op: Op<'scatter_trees'>, scene: CompiledScene | null): string {
  const view = viewOf(draft);
  const anchor = resolveAnchorPoint(view, scene, op.anchor);
  const seed = op.seed ?? 1;
  const result = scatterTreePoints(
    anchor,
    op.radiusM,
    op.count,
    seed,
    view.meta.worldSizeM,
    op.minR ?? 3.6,
    op.maxR ?? 8.2,
    op.kind ?? 'woodland',
  );
  for (let i = draft.paintedTrees.length - 1; i >= 0; i -= 1) {
    if (draft.paintedTrees[i]?.id.startsWith(result.prefix)) draft.paintedTrees.splice(i, 1);
  }
  for (const tree of result.trees) draft.paintedTrees.push(tree);
  return `scatter_trees:${result.trees.length}`;
}
