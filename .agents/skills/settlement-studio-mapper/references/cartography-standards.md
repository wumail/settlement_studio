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
- **`farmland`**: Group into 3–6 distinct tracts (`8–35 ha` each) with varied `seed` so furrow angles contrast organically across tracts.
- **`woodland` & `paintedTrees`**: Place dense `woodland` zones on protected groves or valley edges (`3–12 ha`) and use `scatter_trees` on hillsides (`25–70` trees) to frame topographic ridges without hiding contour legibility.
- **`exclusion`**: Always give narrative empty buffers (`meadow`, `marsh`, `plague_stones`) explicit style so open spaces look intentional rather than unfinished.

### Palette & Tone Selection
- `watabou_classic`: Warm parchment & terracotta — default for temperate riverine/agrarian towns.
- `nordic_fjord`: Cool slate & pine — high-latitude, alpine gorge, or iron-mine fortresses.
- `arid_oasis`: Warm ochre & turquoise — dry plateaus, qanat-fed oases, desert caravan posts.
- `gazetteer_ink`: Minimal monochrome ink — formal archival/chronicle illustrations.

## 2. Dual-Scale Visual Self-Audit Checklist

Run this checklist on **every** rendered full map (`--grid`) and zoomed crop (`--crop-zone` / `--crop-entity`) before final export:

### A. Macro Composition (Full Map)
- [ ] **Balanced figure-ground**: Urban core occupies ~15–30% of map area; terrain contours, rivers, fields, and open margins breathe naturally.
- [ ] **Zero empty-zone surprises**: Every non-`exclusion` zone visibly contains expected buildings, stalls, trees, furrows, or saltpans (cross-check `brief.zones` for zero `empty_warning`).
- [ ] **Furniture & margins clean**: Title cartouche (top-left), compass (top-right), scale bar (bottom-left), legend (bottom-right), and `guided` index box (opposite corner) do not cover the primary citadel or core river junction.
- [ ] **Contours clean**: Contours remain subtle (`contourOpacity` `0.25–0.40`) and never bleed across rivers or lakes.

### B. Micro Craft (Zoomed Close-up Crops)
- [ ] **Weirs span bank-to-bank**: Both ends of each weir anchor cleanly into opposite riverbanks, orthogonal to flow.
- [ ] **Docks face water**: Slipway ramps / wooden piers point into the river/lake channel (never reversed inland).
- [ ] **Watermills hug banks**: Mill footprint sits dry on the bank parallel to the channel, wheel side facing water.
- [ ] **Road-gate continuity**: Highways entering a `walled_city` cut clean gates through the wall and extend out to map edges or destinations without abrupt dead-ends inside empty terrain.
- [ ] **Zero label collisions**: In `standard` mode, zone and landmark labels do not stack on top of each other; if dense (`> 8` rich annotations), switch primary presentation to `guided` mode with numbered badges (`badgeNum: 1..N`) and concise `subtitle` descriptions.
- [ ] **Zero collisions**: `brief.stats.collisionPassed === true` (`collisionHits === 0`).
