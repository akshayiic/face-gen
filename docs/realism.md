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
