---
name: settlement-studio-mapper
description: >-
  Use this skill when authoring, editing, auditing, or exporting historical-style
  settlement maps with Settlement Studio via its headless CLI (`npm run studio`)
  or MCP tools (`studio_open`..`studio_save`). Covers terrain/hydro skeleton setup,
  semantic hydraulic snapping, relative zone placement, compiler diagnostics, and
  dual-scale multimodal visual self-audit (full map + zoomed close-up crops).
---

# Settlement Studio Mapper

Author publication-grade settlement maps through Settlement Studio's headless semantic engine instead of hand-editing raw `.worldtown.json` coordinates.

## Core Principles

1. **Never guess coordinates blindly**: Always run `inspect` (Spatial Radar) first to see the 8×8 buildability grid (`prime` / `marginal` / `steep` / `water`) and river arc-length anchors (`t = 0..1`).
2. **Use semantic snapping for hydraulics & roads**: Place weirs, docks, watermills, and cross-gate roads via `snap_weir`, `snap_dock`, `snap_watermill`, and `connect_road` so geometry aligns orthogonally/tangentially to riverbanks and city gates.
3. **Always close the visual loop**: Never treat a map as finished from JSON alone. Render a full preview with `--grid` plus close-up `--crop-zone` / `--crop-entity` PNGs, inspect them visually (`read_file` in CLI mode, or native image block in MCP mode), and run at least 1–2 refinement passes.
4. **Preserve protected reference files**: Never overwrite protected baseline `.worldtown.json` files unless the user explicitly asks.

## Interface Parity (CLI vs MCP)

All commands run from the `settlement_studio/` directory. Prefer CLI when batching ops or scripting; prefer MCP when running interactive single-zone refinements inside an MCP client.

| Step | CLI (`npm run studio -- ...`) | MCP Tool |
| :--- | :--- | :--- |
| Initialize / Open | `init --out <file> [--preset blank] [--world-size 2400] [--geo-file <geo.json>]` | `studio_open` |
| Spatial Radar & Audit | `inspect <file>` | `studio_inspect` |
| Point Elevation / Snap Query | `query <file> --x <m> --y <m>` | `studio_query_point` |
| Apply Semantic Ops Batch | `apply <file> --ops <ops.json\|-> [--out <file>]` | `studio_apply_ops` |
| Visual Preview (Full / Crop) | `render <file> --out <p.png> [--mode standard\|guided\|clean] [--grid] [--crop-zone <id>\|--crop-entity <id>]` | `studio_render_preview` |
| Publication Export (No Grid) | `export <file> --out-svg <m.svg> [--out-png <m.png>] [--mode standard\|guided] [--width 2000]` | `studio_save` |

For exact JSON schemas and examples of all 21 semantic ops, read [references/ops-cheatsheet.md](./references/ops-cheatsheet.md).
For scale heuristics, palette selection, and visual quality criteria, read [references/cartography-standards.md](./references/cartography-standards.md).

## Standard 5-Step Map Authoring Workflow

### Step 1 — Bootstrap & Read the Spatial Radar
1. Initialize the project file with `init` (optionally passing `--geo-file <geo.json>` when external DEM/river bootstrap data is available) and set `worldSizeM` to match the settlement tier (`1600–2200m` for villages/forts, `2400–2800m` for market towns, `3000–3600m` for walled regional capitals).
2. Run `inspect` immediately and note:
   - Which 8×8 cells are `prime` (flat, dry — reserve for walled cities, citadels, markets, core town blocks) vs `marginal` (gentle slopes — farmland, outer suburbs) vs `steep` (hills/ridges — woodland, scarps, vistas).
   - Main river `t` anchors (`0.0` upstream → `1.0` downstream) and channel widths.

### Step 2 — Macro Terrain & Hydro Skeleton (Pass 1 Ops)
Submit an initial ops batch establishing only the physical landscape:
- `set_meta` (title, subtitle, worldSizeM) & `set_terrain` (baseElev, slopeMagM, slopeDirDeg, contourStep, contourOpacity `0.28–0.38`, `showHypsometricTint: true`, `showHachures: true`).
- `upsert_terrain_shape` for signature landforms (`hill`, `ridge`, `valley`, `scarp`, `basin`) placed outside the prime urban footprint.
- `upsert_river` / `upsert_water_body` (with realistic meandering points and varying `widthsM`) and `upsert_canal` (`stone_clean`, `irrigation`, `qanat`, `drainage_dashed`, `foul_outfall`).
- Run `render --grid` and inspect the landscape skeleton before placing buildings.

### Step 3 — Core Fortifications, Hydraulics, Zones & Roads (Pass 2 Ops)
Build from rigid anchors outward so every element respects the zero-collision obstacle SDF:
1. **Hydraulics first**: `snap_weir`, `snap_dock`, `snap_watermill` anchored to exact river/waterbody/canal `t` positions.
2. **Core settlements & ceremonial structures**: `place_zone` for `walled_city` / `citadel` (prefer `polygon_13` or `octagonal` on `prime` terrain) and `upsert_structure` (`rect`, `l_hall`, `u_court`, `round_altar`) inside citadels or key plazas.
3. **Suburbs, markets, fields & woodland**: `place_zone` for `town_blocks`, `market` (`stalls` / `timber_yard` / `port_apron`), `farmland`, `saltpan`, `woodland`, `village`, and `exclusion` (`plague_stones` / `meadow` / `marsh`).
4. **Road network & bridge overrides**: `connect_road` linking gates, docks, weirs, markets, and map boundaries (`edge:north|south|east|west`). Check `brief.bridges` and use `upsert_bridge_override` only where a `fortified_twin` gatehouse bridge or `ford` is narratively required.
5. **Landmarks & finishing touches**: `upsert_landmark` (assign `badgeNum` + concise `subtitle` for `guided` mode), `scatter_trees` for natural hillside clusters, `set_palette` and `set_legend`.

### Step 4 — Compile Diagnostics & Dual-Scale Visual Self-Audit
1. Check `brief` returned by `apply`:
   - `stats.collisionPassed` MUST be `true` (`collisionHits === 0`).
   - Zero `empty_warning` zones: if any zone reports `steep_slope`, raise `maxSlopeDeg` slightly or move it onto a `prime`/`marginal` cell; if `water_overlap` or `blocked_by_obstacles`, shift anchor or enlarge area.
   - Resolve any `warnings` (overlapping non-nested zones or crowded landmarks `< 65m` apart).
2. Render and visually inspect with `read_file` (or MCP image):
   - **Full map** with `--grid` (`standard` and, if numbered landmarks exist, `guided`).
   - **2–4 zoomed crops** (`--crop-zone` / `--crop-entity`) focusing on the walled city gates, main hydraulic works (weirs/docks), and densest market/label area.
3. Verify every item on the Visual Checklist in [references/cartography-standards.md](./references/cartography-standards.md). Fix any misalignment, label crowding, awkward dock orientation, or sparse/empty corner via a targeted refinement ops batch (`apply` + `reroll_zone` if a specific block layout looks unbalanced).

### Step 5 — Clean Publication Export
Once diagnostics and visual inspection pass cleanly:
1. Run `export` (which enforces `gridOverlay: false`) to produce final `.svg` and `.png` artifacts in the requested display modes (`standard` and/or `guided`).
2. Report the output paths, key stats (`buildingCount`, `zoneCount`, `bridgeCount`, `collisionPassed`), and any remaining aesthetic trade-offs to the user.
