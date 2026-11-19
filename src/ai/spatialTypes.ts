import type { Vec2 } from '../schema/geometry.types';

export interface TerrainGridCell {
  readonly col: number;
  readonly row: number;
  readonly center: Vec2;
  readonly meanElevM: number;
  readonly maxSlopeDeg: number;
  readonly waterFraction: number;
  readonly buildability: 'prime' | 'marginal' | 'steep' | 'water';
}

export interface RiverSampleAnchor {
  readonly t: number;
  readonly point: Vec2;
  readonly widthM: number;
  readonly tangentDeg: number;
  readonly leftNormal: Vec2;
  readonly rightNormal: Vec2;
}

export interface ZoneDiagnostic {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly areaHa: number;
  readonly centroid: Vec2;
  readonly bbox: readonly [number, number, number, number];
  readonly buildingCount: number;
  readonly treeCount: number;
  readonly plotCount: number;
  readonly meanSlopeDeg: number;
  readonly maxSlopeDeg: number;
  readonly status: 'ok' | 'empty_warning';
  readonly emptyReason?: 'steep_slope' | 'water_overlap' | 'too_small' | 'blocked_by_obstacles';
}

export interface NearestRiverInfo {
  readonly riverId: string;
  readonly t: number;
  readonly distM: number;
  readonly bank: 'left' | 'right';
  readonly centerPoint: Vec2;
  readonly bankPoint: Vec2;
  readonly tangentDeg: number;
}

export interface NearestCanalInfo {
  readonly canalId: string;
  readonly t: number;
  readonly distM: number;
  readonly widthM: number;
  readonly centerPoint: Vec2;
  readonly tangentDeg: number;
}

export interface SpatialPointQuery {
  readonly x: number;
  readonly y: number;
  readonly elevM: number;
  readonly slopeDeg: number;
  readonly inWater: boolean;
  readonly inExclusion: boolean;
  readonly nearestRiver: NearestRiverInfo | null;
  readonly nearestCanal: NearestCanalInfo | null;
}

export interface SpatialBrief {
  readonly meta: {
    readonly id: string;
    readonly name: string;
    readonly subtitle: string;
    readonly worldSizeM: number;
  };
  readonly terrain: {
    readonly minElevM: number;
    readonly maxElevM: number;
    readonly contourStepM: number;
    readonly grid8x8: ReadonlyArray<TerrainGridCell>;
  };
  readonly rivers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly lengthM: number;
    readonly anchors: ReadonlyArray<RiverSampleAnchor>;
  }>;
  readonly waterBodies: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly kind: 'lake' | 'sea';
    readonly centroid: Vec2;
    readonly bbox: readonly [number, number, number, number];
  }>;
  readonly canals: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly style: string;
    readonly widthM: number;
    readonly start: Vec2;
    readonly mid: Vec2;
    readonly end: Vec2;
  }>;
  readonly zones: ReadonlyArray<ZoneDiagnostic>;
  readonly structures: ReadonlyArray<{ id: string; name: string; kind: string; x: number; y: number }>;
  readonly hydraulic: {
    readonly weirs: ReadonlyArray<{ id: string; name: string; mid: Vec2 }>;
    readonly docks: ReadonlyArray<{ id: string; name: string; x: number; y: number; angleDeg: number }>;
    readonly watermills: ReadonlyArray<{ id: string; name: string; x: number; y: number; angleDeg: number }>;
  };
  readonly bridges: ReadonlyArray<{ id: string; x: number; y: number; style: string }>;
  readonly landmarks: ReadonlyArray<{ id: string; label: string; x: number; y: number; badgeNum?: number }>;
  readonly stats: {
    readonly buildingCount: number;
    readonly treeCount: number;
    readonly wallCount: number;
    readonly bridgeCount: number;
    readonly collisionPassed: boolean;
    readonly collisionHits: number;
  };
  readonly warnings: ReadonlyArray<string>;
}
