# Settlement Studio Semantic Ops Cheatsheet

Reference for `apply <project.worldtown.json> --ops <ops.json>` (CLI) and `studio_apply_ops` (MCP).
All operations are Zod-validated, deterministic, and idempotent by `id` (upsert semantics).

## Anchor Reference Forms (`Anchor`)

Used in `place_zone.relative.anchor`, `connect_road.from/to/via`, `upsert_structure.anchor`, `upsert_landmark.anchor`, and `scatter_trees.anchor`:

```json
[1400, 1200]
{ "riverId": "riv_main", "t": 0.62, "bank": "right", "offsetM": 240 }
{ "zoneId": "zone_inner", "side": "south", "offsetM": 15 }
{ "entityId": "weir_east" }
{ "edge": "south", "ratio": 0.48 }
```

- `bank`: `"left" | "right" | "center"` (left/right relative to river flow direction from `t=0` to `t=1`).
- `side`: `"center" | "north" | "south" | "east" | "west"`.
- `edge`: `"north" | "south" | "east" | "west"`, `ratio ∈ [0.05, 0.95]`.

## Core Operations Catalog

### 1. Metadata, Terrain & External Geo Bootstrap

```json
[
  {
    "op": "set_meta",
    "name": "Riverbend Market Town",
    "subtitle": "Terrace citadel & three-sluice diversion weir (3.0 km)",
    "worldSizeM": 3000
  },
  {
    "op": "apply_geo_bootstrap",
    "payload": {
      "elevM": 480,
      "slopeDirDeg": 205,
      "slopeMagM": 16,
      "query": { "lon": 12.34, "lat": 45.67, "spanM": 3000 },
      "suggestedRivers": []
    },
    "importRivers": true,
    "clearExistingRivers": false
  },
  {
    "op": "set_terrain",
    "contourStep": 4,
    "indexEvery": 3,
    "contourOpacity": 0.32,
    "showContours": true,
    "showHypsometricTint": true,
    "showHachures": true,
    "showScarpTicks": true,
    "scarpSlopeThresholdDeg": 24,
    "terrainNoiseAmpM": 1.6,
    "terrainSeed": 7719
  },
  {
    "op": "upsert_terrain_shape",
    "id": "hill_ne",
    "type": "hill",
    "cx": 2550,
    "cy": 520,
    "rx": 480,
    "ry": 340,
    "angleDeg": 32,
    "deltaElev": 58,
    "focusX": 0.25,
    "focusY": -0.15
  }
]
```

`TerrainShape.type`: `"hill"` (`deltaElev > 0`), `"basin"` (`deltaElev < 0`), `"ridge"`, `"valley"`, `"scarp"` (linear shapes take `points`, `deltaElev`, `widthLeft`, `widthRight`).

### 2. Hydrology & Snapped Hydraulic Works

```json
[
  {
    "op": "upsert_river",
    "id": "riv_main",
    "name": "Main River",
    "points": [[0, 620], [900, 820], [1900, 960], [3000, 1480]],
    "widthStartM": 72,
    "widthEndM": 108,
    "carveDepthM": 10,
    "rippleLines": 3
  },
  {
    "op": "upsert_canal",
    "id": "cn_city",
    "name": "Inner Clean Canal",
    "style": "stone_clean",
    "widthM": 9,
    "points": [[2320, 1180], [1850, 1420], [1120, 1490], [200, 1650]]
  },
  {
    "op": "snap_weir",
    "id": "weir_east",
    "name": "East Diversion Weir",
    "riverId": "riv_main",
    "t": 0.78,
    "sluices": 3,
    "widthM": 10,
    "overhangM": 8
  },
  {
    "op": "snap_dock",
    "id": "dock_north",
    "name": "North Slipway Wharf",
    "targetId": "riv_main",
    "targetKind": "river",
    "t": 0.44,
    "bank": "right",
    "kind": "slipway",
    "slips": 4,
    "spacingM": 16,
    "lengthM": 38,
    "widthM": 8
  },
  {
    "op": "snap_watermill",
    "id": "mill_east",
    "name": "Canal Hammer Mill",
    "targetId": "cn_city",
    "targetKind": "canal",
    "t": 0.28,
    "bank": "left",
    "widthM": 20,
    "depthM": 13
  }
]
```

- `canal.style`: `"stone_clean" | "irrigation" | "drainage_dashed" | "foul_outfall" | "qanat"`.
- `dock.kind`: `"slipway" | "wooden_pier"`.

### 3. Zones, Structures, Roads & Bridge Overrides

```json
[
  {
    "op": "place_zone",
    "id": "zone_inner",
    "name": "Rammed-Earth Inner City",
    "contentType": "walled_city",
    "relative": {
      "anchor": { "riverId": "riv_main", "t": 0.48, "bank": "right", "offsetM": 520 },
      "areaHa": 42,
      "shape": "polygon_13",
      "aspectRatio": 1.25,
      "rotationDeg": -8
    },
    "seed": 101,
    "density": 0.78,
    "maxSlopeDeg": 22,
    "streetWidthM": 8,
    "wallThicknessM": 6,
    "towerIntervalM": 115
  },
  {
    "op": "upsert_structure",
    "id": "st_hall",
    "name": "Council Hall",
    "anchor": { "zoneId": "zone_inner", "side": "east", "offsetM": -140 },
    "widthM": 54,
    "depthM": 38,
    "kind": "l_hall",
    "roofKind": "citadel",
    "zoneId": "zone_inner"
  },
  {
    "op": "connect_road",
    "id": "rd_south",
    "name": "South Highway",
    "tier": "highway",
    "widthM": 12,
    "from": { "zoneId": "zone_inner", "side": "south" },
    "to": { "edge": "south", "ratio": 0.48 }
  },
  {
    "op": "upsert_bridge_override",
    "id": "brov_gate",
    "bridgeId": "br_1",
    "style": "fortified_twin",
    "fortSizeM": 24
  }
]
```

- `contentType`: `"walled_city" | "town_blocks" | "village" | "citadel" | "market" | "farmland" | "saltpan" | "woodland" | "exclusion"`.
- `marketMode`: `"stalls" | "timber_yard" | "port_apron"`.
- `exclusionStyle`: `"plague_stones" | "meadow" | "marsh" | "plain"`.
- `structure.kind`: `"rect" | "l_hall" | "u_court" | "round_altar"`; `roofKind`: `"inner" | "town" | "citadel"`.
- `bridge.style`: `"stone_arch" | "timber" | "fortified_twin" | "ford"`.

### 4. Landmarks, Trees, Reroll, Palette, Legend & Cleanup

```json
[
  {
    "op": "upsert_landmark",
    "id": "lm_1",
    "label": "East Diversion Weir",
    "anchor": { "entityId": "weir_east" },
    "glyphType": "well_shrine",
    "badgeNum": 1,
    "subtitle": "Three-sluice sandstone weir splitting clean & irrigation canals"
  },
  {
    "op": "scatter_trees",
    "anchor": [2480, 620],
    "radiusM": 380,
    "count": 45,
    "minR": 4.0,
    "maxR": 7.5,
    "kind": "woodland",
    "seed": 42
  },
  { "op": "reroll_zone", "zoneId": "zone_inner" },
  { "op": "set_palette", "themeId": "watabou_classic" },
  {
    "op": "set_legend",
    "visible": true,
    "position": "bottom-right",
    "displayMode": "guided",
    "furnitureOpacity": 0.85,
    "labelOpacity": 0.92
  },
  { "op": "remove_entity", "collection": "zones", "id": "zone_unused" }
]
```

- `glyphType`: `"star_fort" | "tower" | "well_shrine" | "ferry_anchor" | "gate_arch" | "market_tent" | "mine_hammer" | "stele"`.
- `themeId`: `"watabou_classic" | "nordic_fjord" | "arid_oasis" | "gazetteer_ink"`.
- `displayMode`: `"standard" | "guided" | "pure"`.
