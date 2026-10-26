# Cinematic UI icon style pilots

The ten selected icons in `construction-review.json` are approved and used in
the Cinematic construction menu. Classic and missing-image fallback retain the
procedural drawings. Only selected 256px RGBA copies are loaded and precached;
high-resolution sources and rejected studies remain development references.
The `prompts.json` large menu-icon proposal was interrupted and superseded by
close-up style pilots; no complete set from that proposal is integrated.

The original warm woodcutter study is `woodcutter-pilot.png`.
The revised muted studies are `woodcutter-muted-v2.png`, `quarry-muted-v2.png`
and `ironmine-muted-v2.png`. Each has a 256×256 RGBA menu copy and a corresponding
`-source.png` preserving the generated resolution and alpha.

Generated individually with the built-in imagegen tool. Exact prompts are in
`woodcutter-pilot-prompt.json` and `production-muted-v2-prompts.json`.
Downscaling uses high-quality canvas resampling; no colour or content changes
are applied after generation.

Review the revised set at `docs/production-icon-pilot.html`: each menu icon is
shown at 40 CSS pixels and in a separate 96-pixel material view. The first
woodcutter study remains available for comparison.

## Current construction review

`docs/construction-icon-pilot.html` presents the selected ten draft symbols at
40 pixels, with optional 64/96-pixel detail views. `construction-review.json`
records the selected sources and prompt documents. Their 40px menu canvases use
up to 2× backing resolution for high-DPI screens, without changing layout size.

The approved warehouse (`warehouse-building-v3`) defines the camera: the main
front facade is on the right, the left wall recedes left, with a slightly upward
view. Farmhouse, barracks, archery shelter, palisade and tower were regenerated
against that exact image reference. The matching hall drawing is retained.
The three activity symbols use tighter crops. The final pickaxe correction
addresses the misaligned shaft/socket, preserving the head, ore and composition;
the rejected offset wooden stub is removed and the single shaft seats centrally.
The selected mine icon is now `ironmine-right-angle-v5.png`: generated using the
user's real pickaxe photograph as geometry reference, with the head and shaft
visibly at right angles. `ironmine-right-angle-v5-prompt.json` records that edit.
Previous v4 geometry is rejected and retained only as a historical source.

Regenerate 256px review copies from selected full-resolution source PNGs with
`node tools/build-ui-icon-review.cjs <bundled node_modules>`.

## Resource and population icons

`resource-food.png`, `resource-wood.png`, `resource-stone.png`, `resource-iron.png`
and `resource-population.png` are the five active 256px RGBA menu/HUD icons.
The built-in imagegen prompts are recorded in `resource-prompts.json`, and
`resource-icons.json` lists the sources and active copies. All five use the
shared resource renderer in `js/sprites.js`; HUD icons display at 18px and cost
icons at 13px. `docs/resource-icon-preview.html` shows both sizes and 64px details.
Classic retains its atlas symbols and population flag. Changing mode repaints
the HUD and currently displayed cost canvases. The resource data-URL cache is
separated by graphics mode. Missing images retain the atlas/flag fallback.

Regenerate copies and the reference page with
`node tools/build-resource-icons.cjs <bundled node_modules>`.

## Unit portraits

The five active `unit-spear.png`, `unit-sword.png`, `unit-axe.png`,
`unit-archer.png` and `unit-hero.png` are Cinematic head/weapon portraits.
All look slightly right with the weapon on the left. Helmets, hood, bare head,
armour and weapon silhouettes distinguish the types. Prompts are recorded in
`unit-prompts.json`; active files and original sources in `unit-icons.json`.

Copies are fitted without distorting the artwork into 256×308 transparent
portraits. The shared unit canvas painter uses the full existing 30×36, 24×30
or 22×28 base slot, with up to 2× backing resolution. Cinematic enlarges these
to 48×58 for training, 36×45 for sending/reports, and 33×42 for garrisons on
desktop; narrow screens use a smaller enlargement. Classic retains its original
procedural drawings and offsets, also when switching modes. Missing portraits
use those drawings as a fallback. The active five copies are precached offline.

`docs/unit-icon-preview.html` shows training/garrison sizes and enlarged detail.
Regenerate using `node tools/build-unit-icons.cjs <bundled node_modules>`.
