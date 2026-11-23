# Realism tools

What the app has for photographic faces, where each lives, and how to bring in a scanned face's maps.

## Skin (Style tab → Colouring)

| Control | What it does | Code |
|---|---|---|
| Wrinkles | Forehead lines, frown lines, crow's feet, under-eye lines, nose-to-mouth folds, marionette lines, lip lines and neck rings at any age, on top of what Age gives | `lib/age.ts`, `lib/skinDetails.ts` |
| Expression lines | The same lines deepening with the expression: raised brows crease the forehead, a frown the "11s", a smile or squint the crow's feet and folds, a pucker the lip lines. Read every frame from the expression weights | `lib/age.ts` `updateExpressionWrinkles` |
| Sun damage | Redder, browner, uneven skin where the sun reaches; deeper pores | `lib/skinShader.ts` (weathering) |
| Sun spots | Bigger, ragged brown spots on the cheeks, forehead and temples | 〃 |
| Broken capillaries | Fine red veins on the nose wings and cheeks | 〃 |
| Oiliness | The T-zone's shine, from matte to greasy | 〃 |
| Sweat | A wet film and droplets on the forehead, nose and upper lip | 〃 |
| Grime | Dirt in the creases and in patches; matte | 〃 |

## Realistic skin, makeup and lashes (Style tab → Colouring)

| Control | What it does | Code |
|---|---|---|
| Realistic skin: Smooth, Natural, Realistic, Hyper-real | One click sets the group of values that make skin read as skin: fine skin texture, pore depth, tone variation, veins, pink eye rims, lip lines, the shadow under the eyes, a little redness. Moving any of them by hand leaves "custom" | `lib/skinRealism.ts` |
| Fine skin texture | The micro relief of skin (cells about 0.45 mm across, with pores) laid over the face: light breaks up on it as on a real face. It fades with distance by itself. Medium and high quality only | `lib/skinMicro.ts`, `lib/skinShader.ts` |
| Your micro normal map | Optional: a tileable skin micro normal map of your own replaces the built-in texture. Read in the browser, kept in the tab and the config file, never uploaded. Tile size and "invert the relief" for maps that read inside out | `lib/skinMicro.ts` |
| Lip lines | Fine vertical furrows across both lips | `lib/skinShader.ts` |
| Blush colour and spread | A choice of colours; the spread takes the blush from the cheek apples across the bridge of the nose | `lib/skinDetails.ts` |
| Eye liner (strength, wing, colour), eye shadow (strength, colour) | A smudged liner on the lash lines with a wing at the outer corner; shadow on the lids | `lib/skinShader.ts` |
| Lash length, curl, fullness | Longer or shorter lashes, curled up or drooping, fewer or more of them (the lash style is chosen under Hair, brows and beard) | `lib/lashLook.ts`, `lib/groom.ts` |

Hair (Style tab → Hair → Wear it): **Density** (fewer or more strands), **Strand thickness**, Volume, Flyaways and Shine. Dark hair now has blue-white highlights.

### Calibration

The fine skin texture and the defaults were checked against a studio-grade face (a skin pack: 8K colour, 12K normal, a tileable micro normal). What that pack shows, and what the app now does about it:

- The colour map is smooth: cheek skin (210, 157, 131) varies by about 3–5 levels. All the fine detail is in the normal map. So realism comes from relief and light, not from painting pores into the colour.
- The micro normal is a network of cells with finer lines inside them: mean slope 0.26, rms 0.30, cells about 0.4 mm. The built-in texture is generated to that relief (`MICRO.rmsSlope`, checked by a test).
- Lips are much glossier than cheeks (roughness about 0.35 against 0.57) and a deep rose (about 171, 83, 84); eyelids are shaded and lined with a soft smudge.

## Scars and marks (Style tab)

Pick a kind (scar, cut, pockmarks, burn, bruise), click on the face, then set its size, width, angle and how healed it is. Up to 12. Each is a decal on the rest skin, so it stays on the same spot whatever the sliders do. Code: `lib/marks.ts` (state), `lib/skinPick.ts` (the click), `lib/skinShader.ts` (drawing).

## Shape (Shape tab)

- **Fine shape**: local sliders the 24 whole-head components can't make: nostril flare, nose hump, nose tip, cheek hollows, temples, nose-to-mouth folds, hooded eyelids, eye bags, jaw corners, chin cleft, Adam's apple; and Asymmetry (soft random differences between the sides, with Shuffle).
- **Sculpt**: brushes on the face (Raise, Lower, Smooth, Grab, Erase), size, strength and mirroring, with Undo and Clear. The camera holds still while sculpting; Esc stops.

Both are one offset per skin vertex (`lib/sculpt.ts`). Hair, brows, beards, glasses and clothes follow it, and it's in the .glb export. It fades out within a few mm of the inside of the mouth and the eyeballs so the lips and lids never tear. The fine shape is in the rebuild link. The sculpt is too big for a link, so it travels in the config file only (Config → Save config).

## Camera (Style tab → Camera)

- **Light**: Studio (soft), Hard sun (high in front: deep shade under the brows, nose and chin, every pore and line shows), Side light.
- **Skin translucency**: a screen-space subsurface blur of the skin only (widest in red), so light softens under the skin as in a photo.
- **Clarity**: local contrast and fine sharpening, the crisp look of a retouched portrait.

Code: `lib/finish.ts`, `lib/finishSettings.ts`, `components/scene/Lighting.tsx`. Medium and high quality only.

## Bringing in a scanned face

The app's head has its own UV layout, so a scan's maps have to be transferred onto it once:

1. Export this head with a neutral face: reset the face, then **Export .glb**.
2. Line the scan up with the head. A non-rigid wrap gives the best result (R3DS Wrap, or by hand in Blender). For a rough start, `--fit` matches the bounding boxes.
3. Bake the maps onto the head's layout:

   ```
   blender -b --factory-startup -P pipeline/blender/bake_scan.py -- \
     --target character.glb --source scan.obj \
     --albedo albedo.png --normal normal.png --roughness rough.png --cavity cavity.png \
     --out out/scan --size 4096
   ```

4. In the app, under Style → Colouring:
   - **Skin texture**: upload `skin_albedo.png`, choose *Painted map (UV)* and turn *Keep tone* off.
   - **Scanned skin maps**: upload `skin_normal.png`, `skin_rough.png` and `skin_cavity.png`, and set each one's strength.

**Config → Save config** keeps all of it, the images included.
