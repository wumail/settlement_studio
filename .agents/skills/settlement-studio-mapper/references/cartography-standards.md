# Cartography Standards & Visual Self-Audit Checklist

## 1. Scale & Composition Heuristics

Choose `worldSizeM` and zone sizes so buildings remain readable at publication scale (`1400–2000px`) without turning into dust or giant slabs:

| Settlement Tier | `worldSizeM` | Core Area | River Width | Main Highway Width | Typical Contour Step |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Gorge Outpost / Fortified Village | `1600–2200 m` | `3–10 ha` | `25–55 m` | `8–10 m` | `5–8 m` |
| Lakeside / Crossroads Market Town | `2400–2800 m` | `15–35 ha` | `40–80 m` | `10–12 m` | `3–5 m` |
| Walled Regional Capital | `3000–3600 m` | `30–65 ha` | `65–120 m` | `11–14 m` | `4–6 m` |

### Zone Sizing & Parameter Guidelines
- **`walled_city`**: Use `polygon_13` or `octagonal` (`20–55 ha`), `wallThicknessM: 5–7`, `density: 0.72–0.85`, `streetWidthM: 7.5–9`. Avoid sharp concave spikes (`insetPolygonSafe` shrinks walls inward).
- **`citadel`**: Nest inside or adjacent to `walled_city` (`2–8 ha`), pair with explicit `upsert_structure` (`l_hall`, `u_court`, `rect`, `round_altar`) so key ceremonial halls have clear architectural silhouettes.
- **`town_blocks`**: Place outside city gates or along highways (`4–18 ha`), keep `frayOuter: true` for natural organic fade-out toward fields.
- **`market`**: Use `stalls` for dense bazaar rows (`2–6 ha`), `timber_yard` for lumber/cargo depots, `port_apron` directly behind docks.
- **`farmland`**: Group into 3–6 distinct tracts (`6–24 ha` each, never above the `35 ha` red line) with varied `seed` so strip orientation contrasts organically across tracts; furrow direction now derives from the neighbouring road / canal / contour tangent, so place fields alongside those features.
- **`woodland` & `paintedTrees`**: Place dense `woodland` zones on protected groves or valley edges (`3–12 ha`) and use `scatter_trees` on hillsides (`25–70` trees) to frame topographic ridges without hiding contour legibility.
- **`exclusion`**: Always give narrative empty buffers (`meadow`, `marsh`, `plague_stones`) explicit style so open spaces look intentional rather than unfinished.

### Palette & Tone Selection
- `watabou_classic`: Warm parchment & terracotta — default for temperate riverine/agrarian towns.
- `nordic_fjord`: Cool slate & pine — high-latitude, alpine gorge, or iron-mine fortresses.
- `arid_oasis`: Warm ochre & turquoise — dry plateaus, qanat-fed oases, desert caravan posts.
- `gazetteer_ink`: Minimal monochrome ink — formal archival/chronicle illustrations.

## 1.1 Cross-Element Real-Scale Red Lines

Every settlement, field tract and camp on the same sheet must read at the **same human scale**. Check the footprint and the building output before rendering:

| Element Class | Recommended `contentType` | Footprint | `buildingScale` | Typical Output | Cartographic Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Temporary camp / forest watchpost (10–30 people) | `village` | `0.25–0.8 ha` | `0.65–0.85` | `6–14` huts | May embed a `0.08–0.25 ha` ring-stone / fire-pit `exclusion`; never inflate to multiple hectares |
| Dispersed hamlet / bridgehead cluster | `village` or small `town_blocks` | `1.5–4.0 ha` | `0.85–1.0` | `15–55` houses | Stretch as a ribbon along a road, stream bank or contour; keep a naturally thinning outer edge |
| Border town / gate suburb | `walled_city` + `town_blocks` | `14–25 ha` | `0.95–1.05` | `250–480` houses | Pair the walled core with a `1.5–3.5 ha` `citadel` and a `2–4 ha` `market` |
| Regional capital / prefectural city | `walled_city` + outer `town_blocks` | `30–55 ha` | `1.0–1.1` | `500–950` houses | Requires a `3000–3600 m` sheet; keep the walled core at `15%–30%` of the sheet with generous margins |
| Standalone field belt | `farmland` | `6–24 ha` (hard red line `> 35 ha`) | n/a | `12–55` strip plots | Split into 3–6 belts along valleys / highways, keep `frayOuter: true` |
| Woodland belt / sacred grove | `woodland` | `3–12 ha` | n/a | `40–160` canopies | Frame ridges without hiding contour legibility |

Ratio red lines:
- Any `town_blocks`/`walled_city` between `14–24 ha` must yield `>= 240` roofs (mean footprint `80–260 m²`); fewer means the block network is too coarse.
- Any `village` below `1.2 ha` with more than `45` roofs per hectare is over-packed: lower `density` or adjust `buildingScale`.
- Any single `farmland` zone above `35 ha` should be split — one giant tract always loses furrow direction and obstacle clearance.
- A `walled_city` below `4 ha` cannot hold a wall, a citadel and a market: use `citadel` or `village` instead.

## 2. Dual-Scale Visual Self-Audit Checklist

Run this checklist on **every** rendered full map (`--grid`) and zoomed crop (`--crop-zone` / `--crop-entity`) before final export:

### A. Macro Composition (Full Map)
- [ ] **Balanced figure-ground**: Urban core occupies ~15–30% of map area; terrain contours, rivers, fields, and open margins breathe naturally.
- [ ] **Zero empty-zone surprises**: Every non-`exclusion` zone visibly contains expected buildings, stalls, trees, furrows, or saltpans (cross-check `brief.zones` for zero `empty_warning`).
- [ ] **Furniture & margins clean**: Title cartouche (top-left), compass (top-right), scale bar (bottom-left), legend (bottom-right), and `guided` index box (opposite corner) do not cover the primary citadel or core river junction.
- [ ] **Contours clean**: Contours remain subtle (`contourOpacity` `0.25–0.40`) and never bleed across rivers or lakes.
- [ ] **Full-sheet relief**: With `macroReliefAmpM` (`12` default when `terrainNoiseAmpM > 0`) and `valleyCarveRatio` (`5.5` default) the whole sheet shows gently continuous contours — plains are never a blank sheet with isolated hills, and contours bend upstream through river valleys.
- [ ] **Supplementary contours**: Half-interval dotted lines (`showSupplementaryContours: true`, `supplementaryMaxSlopeDeg: 6.5`) appear only on gentle slopes, never carry elevation labels, and vanish on scarps / ridges above the slope limit.

### B. Micro Craft (Zoomed Close-up Crops)
- [ ] **Weirs span bank-to-bank**: Both ends of each weir anchor cleanly into opposite riverbanks, orthogonal to flow.
- [ ] **Docks face water**: Slipway ramps / wooden piers point into the river/lake channel (never reversed inland).
- [ ] **Watermills hug banks**: Mill footprint sits dry on the bank parallel to the channel, wheel side facing water.
- [ ] **Road-gate continuity**: Highways entering a `walled_city` cut clean gates through the wall and extend out to map edges or destinations without abrupt dead-ends inside empty terrain.
- [ ] **Zero label collisions**: In `standard` mode, zone and landmark labels do not stack on top of each other; if dense (`> 8` rich annotations), switch primary presentation to `guided` mode with numbered badges (`badgeNum: 1..N`) and concise `subtitle` descriptions.
- [ ] **Zero collisions**: `brief.stats.collisionPassed === true` (`collisionHits === 0`).
