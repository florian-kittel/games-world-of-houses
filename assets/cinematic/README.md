# Cinematic top-down assets

Created with the built-in imagegen tool on 2026-10-26. These are generated
game resources, not extracted footage or assets from Game of Thrones.

- `terrain.png`: 2 × 2 atlas: meadow, forest / mountain, farmland.
- `structures.png`: transparent 2 × 2 atlas: castle, farm / logging lodge, mine.

## Generation prompts

Terrain:
> Use case: stylized-concept. Asset type: production texture atlas for a realistic top-down medieval strategy game. Create one square image divided precisely into a 2 by 2 grid of equal square texture samples, no borders no gutters no text. Top left: seamless aerial muted olive green windswept meadow, fine grasses and earthy mottling, no trees or rocks. Top right: seamless aerial dense northern evergreen forest canopy seen directly from above, tiny realistic spruce crowns, deep green, no ground gaps. Bottom left: seamless aerial grey rugged rocky mountain ridges with fine crags and moss, no snow. Bottom right: seamless aerial harvested medieval farmland, thin irregular parallel ochre brown furrows. All four quadrants fill their entire square. Orthographic straight-down aerial photography / photorealistic terrain materials, consistent cloudy northern light from upper left, restrained natural colours, dark medieval prestige fantasy mood similar to Game of Thrones. No perspective horizon, no buildings, no lettering, no outlines, no pixel art. Output 1024 square or larger.

Structures (transparent background enabled):
> Use case: stylized-concept. Production game sprite atlas on TRANSPARENT background, square image, precisely 2 by 2 equal cells. Each object isolated and fully inside its own cell with 12 percent empty padding. Top left: realistic northern medieval grey stone castle, enclosing square curtain wall, four round towers, central slate-roofed keep and tiny courtyard. Top right: small medieval farmstead with two thatched cottages, barn, hay cart. Bottom left: medieval timber logging lodge with stacked cut logs and lean-to. Bottom right: stone quarry mine entrance with timber supports, ore cart and rubble. Aerial orthographic top-down view, camera nearly directly overhead, all roofs visible, no horizon. Photorealistic miniature architecture with weathered stone, moss, dark slate, aged wood; overcast daylight from upper left, grounded medieval fantasy in Game of Thrones mood. Muted realistic materials, readable silhouettes. True alpha background including spaces between objects, no ground squares, no labels, no text, no grid, no pixel art, no cartoon.

## Rendering

`js/cinematic.js` composites terrain once into a canvas at twice the map resolution.
Mirrored texture repeats and blurred terrain masks soften tile boundaries; convex
water corners are rounded. World geometry, save format and simulation are unchanged.
Building tiers change marker size. City/castle, farm/sheep farm and the two mine
types currently share artwork; harbor and small resource/unit/building UI icons
retain the original artwork. If either atlas fails to load, its legacy renderer
remains available. The style is a photographic 2D treatment, not a 3D engine.

Manual check: start a seeded world, pause, inspect terrain, select a castle,
open/close its management overlay, zoom/pan, reload and continue. Check console
errors and offline asset URLs when changing the service-worker revision.
