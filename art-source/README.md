# Artwork sources

Full-resolution Cinematic originals, previous studies, prompts, UI source images,
Classic reference sheets and atlas metadata live here. Moving them here preserved
their bytes. They are development resources, never loaded or precached by the game.

The game uses only `assets/`. Rebuild its approved Cinematic exports with:

```
node tools/build-runtime-assets.cjs <bundled node_modules>
```

The exporter keeps aspect ratio and transparency, uses high-quality resampling,
and encodes lossless PNGs. It never overwrites its sources. Map objects use 512px
width, ground materials 768px, approved UI copies retain their existing dimensions.
The full-resolution `*-source.png` UI originals remain alongside earlier review
copies. The historical READMEs below describe generation and rendering history;
their old runtime-path/resolution statements are superseded by this document.

At tile size 32, zoom 3 and pixel ratio 2, castle sprites need at most 391 physical
pixels across, production buildings 301px, trees 346px and rocks 375px. Ground
samples need up to 768px (water spans four cells). These limits must be revisited
if the renderer's scale factors or zoom/device-pixel-ratio limits change.

`docs/runtime-assets.json` records every source/export pair, source SHA-256,
dimensions and byte sizes. Selected UI preparation tools can rebuild review
copies here; run the runtime exporter afterwards to refresh game assets.

Validation:

```
node tools/test-runtime-assets.cjs
node tools/test-graphics-mode.cjs
node tools/test-cinematic-v2.cjs
node tools/render-cinematic-check.cjs <bundled node_modules>
node tools/render-runtime-asset-comparison.cjs <bundled node_modules>
```

The comparison in `docs/previews/runtime-assets-comparison.png` shows original
and exported sprites side by side at maximum in-game physical pixel dimensions.
