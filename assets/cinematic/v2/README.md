# Cinematic v2

32 active assets generated individually with the built-in imagegen tool on
2026-10-26. Initial studies: [prompts.json](prompts.json). The production sites,
canopies and rocks were then corrected to strict overhead views after visual
review: [topdown/prompts.json](topdown/prompts.json). The runtime manifest selects
those corrected files. Castles have also been replaced with overhead roof plans;
their additional prompts are in [castle-roof-prompts.json](topdown/castle-roof-prompts.json).
The earlier prototype and Classic assets are preserved in their original paths.

| Files | Count | Role |
|---|---:|---|
| `grass-01.png`, `grass-02.png` | 2 | Low-contrast grass/moss ground |
| `topdown/forest-01.png` … `forest-03.png` | 3 | Overhead spruce, fir and pine crowns with alpha |
| `topdown/rock-01.png` … `rock-03.png` | 3 | Overhead grey crags/outcrops with alpha |
| `topdown/rock-ore-01.png`, `rock-ore-02.png` | 2 | Dark, steep iron-bearing crags adjacent to iron mines |
| `topdown/rock-quarry-01.png`, `rock-quarry-02.png` | 2 | Pale angular limestone adjacent to stone quarries |
| `field-01.png` | 1 | Horizontal ploughed furrows |
| `water-01.png` | 1 | Slate-blue lake surface |
| `topdown/castle-01.png` … `castle-03.png` | 3 | Roof plans: palisaded manor, stone castle, fortified stronghold |
| `topdown/woodcutter-01.png` … `woodcutter-03.png` | 3 | Roof plans: cabin, expanded lodge, logging yard |
| `topdown/ironmine-01.png` … `ironmine-03.png` | 3 | Overhead ore/winch mining stages |
| `topdown/stonemine-01.png` … `stonemine-03.png` | 3 | Overhead open limestone quarry stages |
| `topdown/farmstead-01.png` … `farmstead-03.png` | 3 | Roof plans: farmhouse, barns and harvest storage |
| `topdown/sheepfarm-01.png` … `sheepfarm-03.png` | 3 | Roof plans, sheep backs and fenced pens |

Source PNGs retain their generated resolution and alpha. All have at least
1024 pixels on their shorter edge; exact dimensions are recorded by
`tools/build-asset-map.cjs` in `docs/asset-map.json`. Each development state has
its own file; states are not manufactured by scaling the same drawing.

## Orientation and repetition

The corrected prompts specify a perpendicular 90-degree overhead camera,
roof/ground plans rather than oblique dioramas, northern medieval materials,
light from upper left and transparent footprints, including all three castle
states. No runtime rotation or mirroring is used. The initial
oblique production-site studies remain in this folder for traceability, but
are not loaded or precached by the game. Their replacements live in `topdown/`.

The renderer (`js/cinematic-v2.js`) chooses forest/rock variants by a stable
coordinate hash, avoids identical immediate left/upper neighbours when enough
variants are available, and varies position and scale slightly. Trees overlap,
are sorted by ground position, and include occasional interior clearings.
Only flat material sample edges are feathered; foliage and rock silhouettes
keep their original alpha/detail. Overlapping meadow and water samples conceal
source texture boundaries without mirrored repeats. Water/shore geometry is
procedural and respects the existing water cells; this version does not use
18 newly generated coast sprites. A continuous marching-squares contour replaces
the former separately rounded water cells. Two corner-cutting passes and stable
coherent bends soften stair steps, including concave banks. Even-odd filling
preserves islands and separate diagonal ponds. A variable translucent earth/gravel
bank, shoreline pebbles and three shallow-water bands blend the existing water
and ground materials. Geometry is computed once in world coordinates and shared
by chunks and zoom levels, so chunk edges cannot reset the coast shape.
`docs/previews/cinematic-shorelines.png` shows a lake, bay, island and small pond.

## Detail and memory

Mineral-rock prompts: [topdown/mineral-rock-prompts.json](topdown/mineral-rock-prompts.json).
The renderer receives the existing structure list at initialisation and mode
switches. All eight touching mountain cells use the matching rock family;
non-mountain cells and more distant rocks are unchanged. Shared iron/quarry
neighbours choose one of the two families with a stable coordinate hash,
independent of structure order, ownership or upgrade level. Missing mineral
images fall back to normal crags. No map tiles or save fields are modified.
Both families retain neutral rubble edges, upper-left light, the same scale
and alpha silhouettes, allowing overlap with existing rocks without rotation.

The terrain is rendered in 8 × 8-cell chunks with an apron and one world-pixel of
opaque edge bleed, preventing hairlines at fractional screen scales.
Chunk density follows zoom and device pixel ratio up to 6 pixels/world pixel.
An LRU cache is capped at 64 MiB of chunk RGBA pixels. Very wide views may reduce
density so the visible working set fits, avoiding repeated chunk eviction.
That cap excludes source images, soft material canvases and browser overhead.
The screen canvas accounts for device pixel ratio up to 2; camera and pointer
coordinates remain in CSS pixels. No flattened 1280px landscape is enlarged
against full-resolution structures anymore.

The loader currently loads both modes' images at startup; source PNGs increase
download/decode size. Classic still uses its original tiles and development
stages. Unsupported reserve city/harbor calls retain the Classic fallback.
The Cinematic construction menu uses ten approved close-up icons from `../ui/`.
Cinematic resource and population icons also use dedicated images from `../ui/`.
Cinematic unit portraits likewise use dedicated images from `../ui/`.
Classic and other game overlays retain their existing rendering.

Cinematic offensive marches (attack, gather, capture) use a screen-sized faction
shield in a red circular frame. Two offset red waves expand and fade beneath it,
using real time independently of game speed. Tokens render above scenery and
labels; route colours and support/supply markers retain their existing meaning.
`docs/attack-marker-preview.html` previews the same renderer with all six sigil
patterns. Classic retains its original circular march dots.
Returning armies use the same faction shield with a grey frame and grey route,
without pulse waves. The movement's stored owner determines the heraldry, even
when the return starts at an enemy castle or structure.

Checks:

```
node tools/test-graphics-mode.cjs
node tools/test-cinematic-v2.cjs
node tools/build-asset-map.cjs
```
