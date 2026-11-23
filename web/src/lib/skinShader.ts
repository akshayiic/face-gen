/**
 * The skin's shader: three's MeshPhysicalMaterial plus our patches, composed in one onBeforeCompile.
 *  - Age (lib/age.ts): wrinkles, tone and roughness for the Age slider.
 *  - Ambient occlusion: `skin_regions` R (baked in Blender by `uv run bake-ao`). three applies an aoMap to the
 *    environment light only; real creases also hide part of the key light, so `aoDirect` darkens the direct light too.
 *  - Skin regions (`uv run skin-maps`, the same texture): G = redness (lips, nose, ears, cheeks, eyelids) tints the
 *    tone, B = oiliness sets the roughness, a faint oily sheen (clearcoat) and the pore depth, A = thickness: where it
 *    is low (ears, nose wings, eyelids) the rim lights glow red through the skin.
 *  - Subsurface look without a render pass: the direct light wraps further round the form in red than in blue, so the
 *    terminator goes warm and soft instead of grey and hard; red light sees the surface without pores and wrinkles
 *    (light scattered in skin blurs them away in red first); the key's shadow edge goes warm the same way.
 *  - Two specular lobes (a tight highlight and a broad sheen, as measured on real skin), no shine in the pores, and a
 *    roughness that varies across the face in patches.
 *  - Uneven tone: patches of browner and redder skin at three sizes, redder creases, faint veins (lib/skinDetails.ts
 *    sets how much). Real skin is never one colour; a single flat tone is most of what reads as "CG".
 *  - The hair's shadow on the skin and its ambient occlusion (lib/hairShadow.ts), medium and high tiers.
 *  - Pores and fine lines: `skin_detail`, a tileable height map laid on the rest position from three sides (no UVs,
 *    no stretching), bumped with screen-space derivatives. Medium and high tiers only (lib/quality.ts).
 *  - Lips: a soft vermilion edge into the skin, their own roughness and a moist highlight (the clearcoat).
 *  - Round the eyes: darker, slightly cooler skin under the eyes and in the upper lid crease.
 *  - Skin details (lib/skinDetails.ts): cheek blush, freckles over the nose and cheeks (cell noise on the rest position),
 *    moles (up to MAX_MOLES spots placed on the rest skin, slightly raised), and scales for the pores and the shadow
 *    under the eyes.
 *  - An uploaded skin texture (lib/surfaceTextures.ts): painted in the head's UV layout (wrapped by the UVs) or a photo
 *    of skin tiled over the head from three sides. "Keep tone" uses only its variation round its own average colour,
 *    so the chosen tone, redness and lips stay; otherwise its own colours replace the tone.
 *  - Scalp under procedural hair: a per-vertex `aHairCover` (0..1, lib/groom.ts writes it from the strand roots) takes
 *    the skin towards the hair's root colour, so gaps between strands show hair-dark scalp, not bare skin.
 *  - Weathering (lib/skinDetails.ts): sun damage (redder, browner, leathery skin where the sun reaches), sun spots,
 *    broken capillaries on the nose and cheeks, how oily the T-zone is, sweat (a wet film and droplets) and grime (dirt
 *    in the creases and in patches).
 *  - Scars and marks (lib/marks.ts): up to MAX_MARKS decals on the rest skin, each projected from its own spot and
 *    direction: scars (raised and pink when fresh, flat, pale and shiny when healed), cuts (blood, then scab), acne
 *    pockmarks, burns and bruises. Each has its colour, height (bumped like the pores) and roughness.
 *  - Scanned maps in the head's UV layout (lib/surfaceTextures.ts): a tangent-space normal map (tangents from the UVs'
 *    screen derivatives), a roughness map and a cavity map, each with its own strength.
 *  - Fine skin texture (lib/skinMicro.ts, SKIN_MICRO): a tiled slope map of the micro relief of skin (cells ~0.45 mm,
 *    pores) laid over the face from three sides: bumped by the slope · the position's screen derivative, pits slightly
 *    darker and without shine, a little roughness variation. Fades with distance through the map's mips.
 *  - Lip lines: fine vertical furrows across both lips (lipLineH), faded out when a line is under ~3 pixels.
 *  - Blush with its own colour, from the apples of the cheeks to across the bridge of the nose; eye makeup: a smudged
 *    liner on the lash lines with a wing at the outer corner, and shadow on the lids (coordinates from the landmarks of
 *    the ageing data: the eye opening is an ellipse of 12 × 4.6 mm).
 *  - Its alpha is uSkinAlpha: 0.5 only while the camera finish draws it (lib/finish.ts), to mark the skin for the
 *    subsurface blur; 1 everywhere else.
 *
 * Nothing here changes the swatches: redness and translucency multiply whatever tone is chosen (lib/skin.ts).
 * The maps load after the head is on screen (Head.tsx); until then the skin is plain.
 * Tweak here: SKIN_SHADE (most values are uniforms: change them live through __faceToVoice.skinShade).
 */
import { type BufferAttribute, Color, Float32BufferAttribute, type MeshPhysicalMaterial, RepeatWrapping, ShaderChunk, type Texture, Vector3, Vector4 } from "three";

import { patchAgeShader, updateExpressionWrinkles } from "@/lib/age";
import { applyHairShadowTier, HAIR_SHADOW_DECL, hairAmbientChunk, hairLitChunk, hairShadowUniforms, updateHairShadowView } from "@/lib/hairShadow";
import { tierSettings } from "@/lib/quality";
import { skinRig } from "@/lib/skin";
import { skinSurface } from "@/lib/skinSurface";
import { loadKtx2, TEXTURES_BASE, tieredUrl } from "@/lib/textures";

export const SKIN_SHADE = {
  aoIndirect: 1.0, // how much the baked AO darkens the environment light (three's aoMapIntensity)
  aoDirect: 0.6, // … and the key/fill/rim lights (0 = not at all, 1 = as much as the environment)
  scalp: 1.0, // how far fully covered scalp goes towards the hair's root colour (1: no bare skin between the roots) …
  scalpDarken: 0.85, // … darkened this much (the scalp sits in the hair's shadow)
  // regions
  redness: 0.5, // how strongly G tints the skin (multiplies the tone, so dark tones get a subtle flush)
  redTint: [1.0, 0.74, 0.74], // linear RGB multiplier at full redness
  lips: 0.55, // extra tint where G is lip-strong
  lipTint: [0.92, 0.62, 0.66],
  lipEdge: [0.55, 0.97] as [number, number], // where in G the lip tint starts and is full (wide: a soft vermilion edge)
  lipRough: 0.34, // the lips' roughness …
  lipSheen: 1.4, // … and their moist highlight (clearcoat, × oilSheen)
  eyeShadow: 0.55, // darker, cooler skin under the eyes and in the upper lid crease
  blotch: 0.35, // how uneven the redness is (low-frequency noise, 0 = smooth)
  roughDry: 0.8, // roughness where B = 0 (cheeks, neck) …
  roughOily: 0.52, // … and B = 1 (nose, forehead, lips)
  oilSheen: 0.15, // clearcoat strength at B = 1 (a soft second highlight on the T-zone)
  oilSheenRoughness: 0.32,
  // subsurface look
  // per-channel light wrap (red reaches furthest round the form); normalised, so it softens the terminator without
  // brightening the tone (0.22/0.08/0.04 turned shadow edges orange)
  wrap: [0.1, 0.04, 0.02],
  translucency: 0.3, // back-light through thin skin (A)
  transColour: [1.0, 0.4, 0.3], // the blood colour of light that went through
  transPower: 3.0, // how tight the glow is round the light direction
  transDistort: 0.3, // how much the surface normal bends the light on its way through
  // pores
  // mm: the height of the pore/line texture on the face (deepest in the oily T-zone; exaggerated: at true depth they
  // vanish below a pixel)
  detailDepth: 0.16,
  detailTile: 30, // mm one tile covers (pipeline/config/skin.toml [detail] tile_mm)
  // stubble
  stubbleTile: 12, // mm one follicle tile covers (pipeline/config/stubble.toml [follicles])
  stubbleCover: 0.9, // the most a stubble patch covers the skin
  stubbleDarken: 0.4, // stubs read darker than the hair colour (short, dense, in their own shadow)
  stubbleBump: 0.08, // mm: how far the stubs raise the surface at full length
  // realism
  crease: 0.4, // creases and folds (low AO) take a deeper, redder colour, as blood shows where skin folds
  creaseTint: [0.9, 0.8, 0.78],
  roughVar: 0.25, // ± roughness across the face (a few mm patches: the skin is never evenly matte)
  cavity: 0.85, // how much the pores hide the shine (specular occlusion by the pore texture)
  // two specular lobes, like measured skin: a sharp one (× roughness) and a broad one, and the sharp one's share
  lobes: [0.72, 1.45, 0.78],
  // per channel (R, G, B): how much the diffuse light sees the smooth surface instead of the pores and wrinkles. Light
  // that enters skin travels furthest in red, which blurs small bumps away in red and keeps them in blue.
  sssNormal: [1.0, 0.55, 0.15],
  // the key's shadow per channel (shadow^tint): the penumbra goes warm, as light scattered in the skin leaks into it
  shadowTint: [0.55, 0.9, 1.08],
};

const v3 = (a: number[]) => new Vector3(a[0], a[1], a[2]);

/** The most moles the shader draws (a uniform array). */
export const MAX_MOLES = 16;
/** The most scars and marks it draws (lib/marks.ts). */
export const MAX_MARKS = 12;

export const skinUniforms = {
  uAoDirect: { value: SKIN_SHADE.aoDirect },
  uScalpColour: { value: new Color(0, 0, 0) }, // raw sRGB; lib/groom.ts points it at the hair's root colour
  uScalp: { value: SKIN_SHADE.scalp },
  uScalpDarken: { value: SKIN_SHADE.scalpDarken },
  uRedness: { value: SKIN_SHADE.redness },
  uRedTint: { value: v3(SKIN_SHADE.redTint) },
  uLips: { value: SKIN_SHADE.lips },
  uLipTint: { value: v3(SKIN_SHADE.lipTint) },
  uLipRough: { value: SKIN_SHADE.lipRough },
  uLipSheen: { value: SKIN_SHADE.lipSheen },
  uEyeShadow: { value: SKIN_SHADE.eyeShadow },
  uBlotch: { value: SKIN_SHADE.blotch },
  uRoughDry: { value: SKIN_SHADE.roughDry },
  uRoughOily: { value: SKIN_SHADE.roughOily },
  uWrap: { value: v3(SKIN_SHADE.wrap) },
  uTrans: { value: SKIN_SHADE.translucency },
  uTransColour: { value: v3(SKIN_SHADE.transColour) },
  uTransPower: { value: SKIN_SHADE.transPower },
  uTransDistort: { value: SKIN_SHADE.transDistort },
  uDetailDepth: { value: SKIN_SHADE.detailDepth },
  uDetailTile: { value: SKIN_SHADE.detailTile },
  uSkinDetail: { value: null as Texture | null },
  // stubble (facial hair "stubble" styles, lib/addons.ts): coverage mask in the skin UVs + a tileable follicle texture
  uStubbleMap: { value: null as Texture | null },
  uStubbleDetail: { value: null as Texture | null },
  uStubbleLen: { value: 0.5 },
  uStubbleShadow: { value: 0.15 },
  uStubbleColour: { value: new Color("#1a120c") }, // raw sRGB, by reference: the facial hair's colour set (lib/hair.ts)
  uStubbleTile: { value: SKIN_SHADE.stubbleTile },
  // skin details (lib/skinDetails.ts): plain amounts; the pores and the eye shadow scale SKIN_SHADE's own values
  uBlush: { value: 0 },
  uFreckles: { value: 0 },
  uPores: { value: 1 },
  uUnderEye: { value: 1 },
  uEyeRims: { value: 0.25 }, // lib/skinDetails.ts eyeRims
  uMoles: { value: Array.from({ length: MAX_MOLES }, () => new Vector4()) }, // xyz: rest position (mm), w: radius (mm)
  uMoleCount: { value: 0 },
  // an uploaded skin texture (lib/surfaceTextures.ts), drawn while the material has USE_SKIN_TEX
  uSkinTex: { value: null as Texture | null },
  uSkinTexAmt: { value: 1 },
  uSkinTexTile: { value: 60 }, // mm one tile covers (tiled mode)
  uSkinTexMode: { value: 0 }, // 0: the head's UVs, 1: tiled from three sides
  uSkinTexMatch: { value: 1 }, // 1: keep the tone (use the texture's variation only)
  uSkinTexMean: { value: new Vector3(0.5, 0.5, 0.5) }, // the texture's average colour, linear
  // tone variation and veins (lib/skinDetails.ts), and the realism settings in SKIN_SHADE
  uMottle: { value: 1 },
  uVeins: { value: 0.4 },
  uCrease: { value: SKIN_SHADE.crease },
  uCreaseTint: { value: v3(SKIN_SHADE.creaseTint) },
  uRoughVar: { value: SKIN_SHADE.roughVar },
  uCavity: { value: SKIN_SHADE.cavity },
  uLobes: { value: v3(SKIN_SHADE.lobes) },
  uSssNormal: { value: v3(SKIN_SHADE.sssNormal) },
  uShadowTint: { value: v3(SKIN_SHADE.shadowTint) },
  // weathering (lib/skinDetails.ts): 0 = none; oiliness 1 = the shader's own
  uSun: { value: 0 },
  uSunSpots: { value: 0 },
  uCapillaries: { value: 0 },
  uOil: { value: 1 },
  uSweat: { value: 0 },
  uGrime: { value: 0 },
  // lip makeup (lib/skinDetails.ts): lipstick colour (raw sRGB) and amount, liner strength and colour (automatic: a
  // darker shade of the lipstick or of the lips' own colour), and the finish (0 matte … 1 as the lips are … 2 gloss)
  uLipColour: { value: new Color(0, 0, 0) },
  uLipAmt: { value: 0 },
  uLipLiner: { value: 0 },
  uLipLinerColour: { value: new Color(0, 0, 0) },
  uLipLinerAuto: { value: 1 },
  uLipGloss: { value: 1 },
  // scars and marks (lib/marks.ts): A = rest position (mm) + type, B = rest normal + angle (rad), C = length, width
  // (mm), healing (0 fresh … 1 old), seed
  uMarkA: { value: Array.from({ length: MAX_MARKS }, () => new Vector4()) },
  uMarkB: { value: Array.from({ length: MAX_MARKS }, () => new Vector4()) },
  uMarkC: { value: Array.from({ length: MAX_MARKS }, () => new Vector4()) },
  uMarkCount: { value: 0 },
  // scanned maps in the head's UV layout (lib/surfaceTextures.ts), drawn while the material has their define
  uSkinNormalMap: { value: null as Texture | null },
  uSkinNormalAmt: { value: 1 },
  uSkinRoughMap: { value: null as Texture | null },
  uSkinRoughAmt: { value: 1 },
  uSkinCavityMap: { value: null as Texture | null },
  uSkinCavityAmt: { value: 1 },
  // 0.5 while the camera finish draws the skin (its subsurface blur's mask, lib/finish.ts), else 1
  uSkinAlpha: { value: 1 },
  // fine skin texture (lib/skinMicro.ts) and the makeup and lip details (lib/skinDetails.ts)
  uSkinMicro: { value: null as Texture | null },
  uMicro: { value: 0 },
  uMicroTile: { value: 7.2 }, // mm one tile covers
  uLipLines: { value: 0 },
  // face form (lib/skinDetails.ts): philtrum, cupid's bow, mouth line, shadow under the lower lip, collarbone, jaw shadow, ears
  uPhiltrum: { value: 0 },
  uCupid: { value: 0 },
  uMouthLine: { value: 0 },
  uUnderLip: { value: 1 },
  uCollarbone: { value: 0 },
  uJawShade: { value: 1 },
  uEarDetail: { value: 0 },
  uFormOn: { value: 0 },
  uBlushTint: { value: new Vector3(1.0, 0.68, 0.7) }, // what the blush multiplies the skin by
  uBlushSpread: { value: 0 },
  uLiner: { value: 0 },
  uLinerWing: { value: 0.5 },
  uLinerColour: { value: new Color(0, 0, 0) }, // raw sRGB
  uShadow: { value: 0 },
  uShadowColour: { value: new Color(0, 0, 0) },
};

/** Push SKIN_SHADE into the uniforms after editing it (debug handle; the oil sheen lives on the material). */
export function applySkinShade(material?: MeshPhysicalMaterial | null): void {
  const u = skinUniforms;
  const s = SKIN_SHADE;
  u.uAoDirect.value = s.aoDirect;
  u.uScalp.value = s.scalp;
  u.uScalpDarken.value = s.scalpDarken;
  u.uRedness.value = s.redness;
  u.uRedTint.value.copy(v3(s.redTint));
  u.uLips.value = s.lips;
  u.uLipTint.value.copy(v3(s.lipTint));
  u.uLipRough.value = s.lipRough;
  u.uLipSheen.value = s.lipSheen;
  u.uEyeShadow.value = s.eyeShadow;
  u.uBlotch.value = s.blotch;
  u.uRoughDry.value = s.roughDry;
  u.uRoughOily.value = s.roughOily;
  u.uWrap.value.copy(v3(s.wrap));
  u.uTrans.value = s.translucency;
  u.uTransColour.value.copy(v3(s.transColour));
  u.uTransPower.value = s.transPower;
  u.uTransDistort.value = s.transDistort;
  u.uDetailDepth.value = s.detailDepth;
  u.uDetailTile.value = s.detailTile;
  u.uCrease.value = s.crease;
  u.uCreaseTint.value.copy(v3(s.creaseTint));
  u.uRoughVar.value = s.roughVar;
  u.uCavity.value = s.cavity;
  u.uLobes.value.copy(v3(s.lobes));
  u.uSssNormal.value.copy(v3(s.sssNormal));
  u.uShadowTint.value.copy(v3(s.shadowTint));
  if (material?.aoMap) {
    material.clearcoat = s.oilSheen;
    material.clearcoatRoughness = s.oilSheenRoughness;
    material.aoMapIntensity = s.aoIndirect;
  }
}

const DECL = /* glsl */ `
uniform float uAoDirect;
uniform vec3 uScalpColour;
uniform float uScalp, uScalpDarken;
uniform float uRedness, uLips, uBlotch, uRoughDry, uRoughOily;
uniform vec3 uRedTint, uLipTint;
uniform float uLipRough, uLipSheen, uEyeShadow;
uniform vec3 uWrap, uTransColour;
uniform float uTrans, uTransPower, uTransDistort;
uniform float uDetailDepth, uDetailTile;
uniform sampler2D uSkinDetail;
uniform sampler2D uStubbleMap, uStubbleDetail;
uniform float uStubbleLen, uStubbleShadow, uStubbleTile;
uniform vec3 uStubbleColour;
uniform float uBlush, uFreckles, uPores, uUnderEye, uEyeRims;
uniform vec4 uMoles[${MAX_MOLES}];
uniform int uMoleCount;
uniform sampler2D uSkinTex;
uniform float uSkinTexAmt, uSkinTexTile, uSkinTexMode, uSkinTexMatch;
uniform vec3 uSkinTexMean;
uniform float uMottle, uVeins, uCrease, uRoughVar, uCavity;
uniform vec3 uCreaseTint, uLobes, uSssNormal, uShadowTint;
uniform float uSun, uSunSpots, uCapillaries, uOil, uSweat, uGrime;
uniform vec3 uLipColour, uLipLinerColour; // raw sRGB (lip makeup, lib/skinDetails.ts)
uniform float uLipAmt, uLipLiner, uLipLinerAuto, uLipGloss;
uniform vec4 uMarkA[${MAX_MARKS}], uMarkB[${MAX_MARKS}], uMarkC[${MAX_MARKS}];
uniform int uMarkCount;
uniform sampler2D uSkinNormalMap, uSkinRoughMap, uSkinCavityMap;
uniform float uSkinNormalAmt, uSkinRoughAmt, uSkinCavityAmt;
uniform float uSkinAlpha;
uniform sampler2D uSkinMicro;
uniform float uMicro, uMicroTile, uLipLines, uBlushSpread, uLiner, uLinerWing, uShadow;
uniform float uPhiltrum, uCupid, uMouthLine, uUnderLip, uCollarbone, uJawShade, uEarDetail, uFormOn;
uniform vec3 uBlushTint, uLinerColour, uShadowColour;
// the fine skin texture, read once in the colour step and bumped in the normal step: each projection plane's slope,
// the blend between planes, how much it counts here, the pore mask and the roughness variation
vec2 skinMG0 = vec2(0.0), skinMG1 = vec2(0.0), skinMG2 = vec2(0.0);
vec3 skinMW = vec3(0.0);
float skinMicroAmt = 0.0, skinMicroPore = 0.0, skinMicroRough = 0.5;
float formH = 0.0; // the face form's height (mm: philtrum, mouth line, collarbone), set in the colour step
float formLift = 1.0; // x the diffuse light (lifts the shadow under the lower lip)
float lipLineH = 0.0; // the lip lines' height (−1 in a groove … 0), × lipLines in the normal step
float markH = 0.0; // the marks' and sweat's height (mm), set in the colour step, bumped in the normal step
float markRough = 1.0; // × roughness (scars shine, scabs are matte)
float markSmooth = 0.0; // 0..1: no pores here (scar tissue)
float weatherRough = 0.0; // roughness pushed towards grime's matte (> 0) or sweat's wet (< 0)
float sweatWet = 0.0;
varying float vHairCover;
varying vec3 vSkinN;
float skinMole = 0.0; // how much this is mole (0..1), set in the colour step, raised in the normal step
vec3 skinSmoothN = vec3(0.0, 0.0, 1.0); // the normal before pores and wrinkles (view space), set in the normal step
float skinCavity = 1.0; // the shine left in the pores (1 = all), set in the normal step
vec3 skinHash3(vec3 c) {
  return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
// Freckles: one candidate spot per 2.4 mm cell (3D, on the rest position: a round spot wherever the surface cuts one),
// kept with probability density, each with its own size and depth of colour.
float skinFreckles(vec3 p, float density) {
  vec3 g = p / 2.4;
  vec3 i = floor(g);
  float f = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 c = i + vec3(float(x), float(y), float(z));
        vec3 h = skinHash3(c);
        if (fract(h.x * 17.13 + h.y * 3.7) > density) continue;
        float r = 0.16 + 0.22 * fract(h.z * 11.7);
        float d = length(g - c - h);
        f = max(f, (1.0 - smoothstep(r * 0.45, r, d)) * (0.55 + 0.45 * fract(h.y * 7.31)));
      }
  return f;
}
vec4 skinReg = vec4(1.0, 0.0, 0.5, 1.0); // AO, redness, oiliness, thickness (neutral until the maps arrive)
float stubbleH = 0.0; // stubble's bump height (0..-1) and how matte it makes the skin, set in the colour step
float stubbleRough = 0.0;
float skinLip = 0.0; // how much this is lip (0..1, a soft edge)
`;

// After three's colour: read the regions once, tint by redness (uneven, like real flushing) and the lips, and darken
// round the eyes.
const REGIONS = /* glsl */ `
#include <color_fragment>
#ifdef USE_AOMAP
  skinReg = texture2D(aoMap, vAoMapUv);
#ifdef USE_SKIN_TEX
  // the uploaded texture: by the head's UVs (painted for this head) or tiled over it from three sides (a skin photo)
  vec3 skinTexC;
  if (uSkinTexMode < 0.5) skinTexC = texture2D(uSkinTex, vAoMapUv).rgb;
  else {
    vec3 tw = pow(abs(normalize(vSkinN)), vec3(4.0));
    tw /= tw.x + tw.y + tw.z;
    vec3 tq = vRest / uSkinTexTile;
    skinTexC = texture2D(uSkinTex, tq.zy).rgb * tw.x + texture2D(uSkinTex, tq.xz).rgb * tw.y + texture2D(uSkinTex, tq.xy).rgb * tw.z;
  }
  // keep tone: only its variation round its own average, under the tone's redness, lips and shadows
  if (uSkinTexMatch > 0.5) diffuseColor.rgb *= mix(vec3(1.0), clamp(skinTexC / max(uSkinTexMean, vec3(0.01)), 0.0, 3.0), uSkinTexAmt);
#endif
  {
    // uneven tone: patches of more melanin (browner, darker) and more blood (redder) at three sizes, as real skin is
    // never one colour; both multiply the tone, so they keep to it on every swatch
    float m1 = ageNoise(vRest * 0.045 + 3.1) - 0.5; // ~2 cm
    float m2 = ageNoise(vRest * 0.15 + 17.3) - 0.5; // ~6 mm
    float m3 = ageNoise(vRest * 0.5 + 41.7) - 0.5; // ~2 mm
    float mel = (m1 * 0.65 + m3 * 0.5) * uMottle;
    float haem = (m2 + 0.4 * m1) * uMottle;
    diffuseColor.rgb *= max(vec3(0.0), vec3(1.0) - mel * vec3(0.16, 0.22, 0.28) + haem * vec3(0.1, -0.08, -0.06));
    // folds and creases go deeper and redder
    diffuseColor.rgb *= mix(vec3(1.0), uCreaseTint, clamp((1.0 - skinReg.r) * uCrease, 0.0, 1.0));
  }
  if (uVeins > 0.0) {
    // veins: faint blue-green lines under thin skin (the temples, under the inner eyes, the sides of the neck), from
    // the ridges of a warped noise
    vec3 vp = vRest * 0.05;
    vp += vec3(ageNoise(vp * 1.7 + 11.0), ageNoise(vp * 1.7 + 23.0), ageNoise(vp * 1.7 + 37.0)) * 1.2;
    float ridge = max(1.0 - abs(ageNoise(vp) * 2.0 - 1.0), 0.85 * (1.0 - abs(ageNoise(vp * 2.2 + 5.0) * 2.0 - 1.0)));
    float vein = pow(ridge, 14.0);
    vec2 tq = vec2(abs(vRest.x) - 60.0, vRest.y - 322.0);
    float where = exp(-dot(tq, tq) / (2.0 * 14.0 * 14.0));
    vec2 uq = vec2(abs(vRest.x) - 25.0, vRest.y - 289.0);
    where = max(where, 0.8 * exp(-dot(uq, uq) / (2.0 * 7.0 * 7.0)));
    where = max(where, 0.7 * smoothstep(115.0, 145.0, vRest.y) * (1.0 - smoothstep(185.0, 215.0, vRest.y)) * smoothstep(18.0, 42.0, abs(vRest.x)));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.84, 0.92, 1.03), clamp(vein * where * uVeins, 0.0, 1.0));
  }
  float blotch = mix(1.0, 0.55 + 0.9 * ageNoise(vRest * 0.08), uBlotch);
  diffuseColor.rgb *= mix(vec3(1.0), uRedTint, clamp(skinReg.g * blotch, 0.0, 1.0) * uRedness);
  skinLip = smoothstep(${SKIN_SHADE.lipEdge[0].toFixed(2)}, ${SKIN_SHADE.lipEdge[1].toFixed(2)}, skinReg.g);
  diffuseColor.rgb *= mix(vec3(1.0), uLipTint, skinLip * uLips);
  if (uLipAmt > 0.0 || uLipLiner > 0.0) {
    // lip makeup: the lipstick over the lips' own region, and a liner on the vermilion border (the band where the
    // redness map rises from skin to lip)
    // (the redness map is high on the nose, ears and eyelids too: only inside the mouth's box, in rest-skin mm)
    float lipBox = smoothstep(212.0, 220.0, vRest.y) * (1.0 - smoothstep(250.0, 257.0, vRest.y)) * (1.0 - smoothstep(27.0, 34.0, abs(vRest.x))) * smoothstep(88.0, 100.0, vRest.z);
    // the map's lip edge is stair-stepped and noisy: the border and the lipstick's edge read a blurred copy of it
    float lipG = skinReg.g;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5235988; // 30°
      lipG += texture2D(aoMap, vAoMapUv + vec2(cos(a), sin(a)) * (i % 2 == 0 ? 0.0035 : 0.0018)).g;
    }
    lipG /= 13.0;
    float lipSolid = smoothstep(0.55, 0.8, lipG) * lipBox;
    float lipRing = smoothstep(0.28, 0.5, lipG) * (1.0 - smoothstep(0.5, 0.78, lipG)) * lipBox;
    vec3 lipC = sRGBTransferEOTF(vec4(uLipColour, 1.0)).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, lipC, lipSolid * uLipAmt);
    vec3 linerC = uLipLinerAuto > 0.5 ? (uLipAmt > 0.0 ? lipC : diffuseColor.rgb) * 0.5 : sRGBTransferEOTF(vec4(uLipLinerColour, 1.0)).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, linerC, clamp(lipRing * uLipLiner * 1.4, 0.0, 1.0));
  }
  if (uLipLines > 0.0) {
    // lip lines: fine vertical furrows across both lips, tilting out a little from the mouth's middle, each line its own
    // length, some positions with none; faded out when a line is under ~3 pixels
    float lipZone = smoothstep(212.0, 220.0, vRest.y) * (1.0 - smoothstep(250.0, 257.0, vRest.y)) * (1.0 - smoothstep(27.0, 34.0, abs(vRest.x))) * smoothstep(88.0, 100.0, vRest.z);
    float lx = vRest.x * (1.0 + 0.045 * abs(vRest.y - 231.0)) / 0.52 + 0.7 * (ageNoise(vec3(vRest.y * 0.45, 3.0, vRest.x * 0.08)) - 0.5);
    float lc = floor(lx);
    float groove = pow(0.5 + 0.5 * cos(6.2831853 * lx), 5.0) * step(0.3, skinHash3(vec3(lc, 4.0, 1.0)).x) * smoothstep(0.25, 0.7, ageNoise(vec3(lc * 1.7, vRest.y * 0.35, 9.0)));
    float lpx = max(length(fwidth(vRest)), 1e-4); // mm per pixel here
    lipLineH = -groove * skinLip * lipZone * (1.0 - smoothstep(0.06, 0.2, lpx));
    diffuseColor.rgb *= 1.0 - 0.18 * uLipLines * (-lipLineH);
  }
  if (uFormOn > 0.5) {
    // face form, in rest-skin mm (head space): the places a smooth scan leaves blank. Heights go to the normal step
    float fx = abs(vRest.x);
    float fz = smoothstep(100.0, 118.0, vRest.z);
    // philtrum: the groove from the nose to the lip, two raised columns either side of it
    float pw = smoothstep(238.0, 242.0, vRest.y) * (1.0 - smoothstep(255.0, 259.0, vRest.y)) * fz;
    float pg = exp(-pow(fx / 2.1, 2.0)), pc = exp(-pow((fx - 4.6) / 1.5, 2.0));
    formH += uPhiltrum * pw * (0.45 * pc - 0.4 * pg);
    diffuseColor.rgb *= 1.0 - 0.07 * uPhiltrum * pw * pg;
    // cupid's bow: the upper lip's top edge dips at the middle between two peaks, a small tubercle under the dip
    float bowY = 240.3 - 1.4 * exp(-pow(fx / 2.4, 2.0)) + 1.1 * exp(-pow((fx - 3.9) / 1.7, 2.0)) - 0.0035 * fx * fx;
    float bowLine = exp(-pow((vRest.y - bowY) / 0.65, 2.0)) * (1.0 - smoothstep(14.0, 20.0, fx)) * fz;
    diffuseColor.rgb *= 1.0 - 0.13 * uCupid * bowLine;
    formH += uCupid * 0.3 * exp(-pow(fx / 2.6, 2.0)) * exp(-pow((vRest.y - 236.0) / 2.4, 2.0)) * fz;
    // the mouth line: where the lips meet, a dark line, deepest at the middle and fading before the corners
    float mouthY = 232.3 + 0.006 * fx * fx;
    float mouthLine = exp(-pow((vRest.y - mouthY) / 0.55, 2.0)) * (1.0 - smoothstep(20.0, 29.0, fx)) * fz;
    formH -= uMouthLine * 0.3 * mouthLine;
    diffuseColor.rgb *= 1.0 - 0.3 * uMouthLine * mouthLine;
    // under the lower lip: the baked occlusion and the key's shadow there are lifted (1 = as scanned)
    float underZone = exp(-pow((vRest.y - 219.0) / 6.5, 2.0)) * (1.0 - smoothstep(10.0, 24.0, fx)) * fz;
    formLift = 1.0 + 0.55 * (1.0 - uUnderLip) * underZone;
    // collarbone: a ridge on each side of the base of the neck, the hollow above it, the notch between them
    float cy = 122.0 + 0.045 * (fx - 14.0);
    float cm = smoothstep(10.0, 16.0, fx) * (1.0 - smoothstep(76.0, 90.0, fx)) * smoothstep(20.0, 36.0, vRest.z) * (1.0 - smoothstep(142.0, 150.0, vRest.y)) * smoothstep(92.0, 102.0, vRest.y);
    float cdy = vRest.y - cy;
    float cRidge = exp(-pow(cdy / 4.0, 2.0)), cFossa = exp(-pow((cdy - 10.0) / 5.5, 2.0));
    float cNotch = exp(-(pow(vRest.x / 6.0, 2.0) + pow((vRest.y - 124.0) / 6.0, 2.0))) * smoothstep(20.0, 36.0, vRest.z);
    float cBelow = exp(-pow((cdy + 7.0) / 4.5, 2.0));
    formH += uCollarbone * (cm * (3.6 * cRidge - 2.4 * cFossa - 0.8 * cBelow) - 2.5 * cNotch);
    diffuseColor.rgb *= 1.0 - uCollarbone * (0.16 * cm * cFossa + 0.07 * cm * cBelow + 0.1 * cNotch);
    // the shadow under the jaw: skin under the chin and behind the jaw's angle darkens, most just under the edge
    float jawY = 199.0 + 0.36 * max(0.0, fx - 20.0);
    float jawDown = smoothstep(0.3, -0.4, normalize(vSkinN).y); // surfaces facing down: the chin's underside
    float jawNeck = smoothstep(jawY - 70.0, jawY - 4.0, vRest.y); // the neck, darker the nearer the jaw
    float jawShade = (1.0 - smoothstep(jawY - 6.0, jawY + 6.0, vRest.y)) * max(jawDown, 0.6 * jawNeck) * (1.0 - smoothstep(60.0, 80.0, fx)) * smoothstep(140.0, 165.0, vRest.y);
    diffuseColor.rgb *= 1.0 - 0.42 * uJawShade * jawShade;
    // the ears: the creases the baked occlusion finds go darker and redder, the bowl of the ear pinker
    float earM = smoothstep(66.0, 74.0, fx) * (1.0 - smoothstep(26.0, 36.0, vRest.z)) * smoothstep(236.0, 248.0, vRest.y) * (1.0 - smoothstep(312.0, 322.0, vRest.y));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.46, 0.46), clamp((1.0 - skinReg.r) * 1.8 * earM * uEarDetail, 0.0, 0.85));
    float concha = exp(-(pow((fx - 82.0) / 7.0, 2.0) + pow((vRest.y - 282.0) / 9.0, 2.0) + pow((vRest.z - 8.0) / 10.0, 2.0)));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.66, 0.64), clamp(concha * earM * uEarDetail * 0.8, 0.0, 0.8));
  }
  {
    // round the eyes (vRest is in mm): under the eye (towards the inner corner) and the upper lid crease
    vec2 e = vec2(abs(vRest.x) - 30.9, vRest.y - 303.2);
    float under = exp(-pow((e.x + 3.0) / 15.0, 2.0) - pow((e.y + 11.0) / 7.0, 2.0));
    float crease = 0.5 * exp(-pow(e.x / 16.0, 2.0) - pow((e.y - 9.0) / 4.5, 2.0));
    float front = smoothstep(55.0, 80.0, vRest.z);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.73, 0.77), clamp((under + crease) * front * uUnderEye, 0.0, 1.0) * uEyeShadow);
    // the lid edges: thin, blood-rich skin just round the eye opening (an ellipse between the corners) goes pink
    vec2 o = vec2((abs(vRest.x) - 32.2) / 12.5, (vRest.y - 300.6) / 4.6);
    float ell = length(o);
    float rim = exp(-pow((ell - 1.12) / 0.2, 2.0)) * front * (0.75 + 0.25 * smoothstep(0.3, -0.6, o.x)); // a little more at the inner corner
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.68, 0.68), clamp(rim * uEyeRims, 0.0, 1.0));
    if (uLiner > 0.0 || uShadow > 0.0) {
      // eye makeup. dmm: how far (mm) outside the eye opening's edge this is; the opening is the ellipse above
      float dmm = (ell - 1.0) * ell / max(length(vec2(o.x / 12.5, o.y / 4.6)), 1e-3);
      float upper = smoothstep(-0.1, 0.35, o.y);
      float outer = smoothstep(-0.9, 0.9, o.x);
      if (uLiner > 0.0) {
        // a smudged liner on the lash lines: thick and dark above, thin and light below, the wing at the outer corner
        float thick = (0.5 + 0.9 * outer) * (0.7 + 0.6 * uLiner);
        float band = smoothstep(-0.5, 0.15, dmm) * (1.0 - smoothstep(thick * 0.6, thick * 1.3, dmm)) * smoothstep(-1.15, -0.65, o.x);
        float lowerBand = smoothstep(-0.5, 0.1, dmm) * (1.0 - smoothstep(0.25, 0.7, dmm)) * smoothstep(-0.2, 0.7, o.x) * 0.45;
        vec2 wd = normalize(vec2(1.0, 0.38));
        vec2 wp = vec2(abs(vRest.x) - 43.4, vRest.y - 300.4);
        float wu = dot(wp, wd), wv = dot(wp, vec2(-wd.y, wd.x));
        float wl = 3.0 + 9.0 * uLinerWing;
        float wing = smoothstep(-0.5, 0.5, wu) * (1.0 - smoothstep(wl - 1.5, wl, wu)) * (1.0 - smoothstep(mix(1.1, 0.12, clamp(wu / wl, 0.0, 1.0)) * 0.7, mix(1.1, 0.12, clamp(wu / wl, 0.0, 1.0)) * 1.15, abs(wv))) * step(0.01, uLinerWing);
        float halo = exp(-pow(dmm / (1.5 + 1.8 * uLiner), 2.0)) * upper * 0.28; // the smoke round it
        vec3 linerC = sRGBTransferEOTF(vec4(uLinerColour, 1.0)).rgb;
        float lm = clamp(band * upper + lowerBand * (1.0 - upper) + wing + halo, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, linerC, lm * front * clamp(uLiner * 1.6, 0.0, 1.0));
      }
      if (uShadow > 0.0) {
        // shadow on the lid: from the lash line up towards the crease, over the eye's width
        float sh = upper * smoothstep(0.3, 1.4, dmm) * (1.0 - smoothstep(4.5, 8.5, dmm)) * smoothstep(-1.05, -0.55, o.x) * (1.0 - smoothstep(0.95, 1.6, o.x));
        vec3 shadowC = sRGBTransferEOTF(vec4(uShadowColour, 1.0)).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, shadowC, clamp(sh * front * uShadow * 0.75, 0.0, 1.0));
      }
    }
  }
#ifdef USE_SKIN_TEX
  // its own colours (a painted map): over everything the tone made
  if (uSkinTexMatch < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, skinTexC, uSkinTexAmt);
#endif
  {
    // blush: the apples of the cheeks, soft-edged, never on the lips
    // (spread: the apples widen, and a flush comes over the bridge of the nose)
    vec2 bc = vec2(abs(vRest.x) - 44.0, vRest.y - 271.0);
    float sg = 15.0 + 9.0 * uBlushSpread;
    vec2 nb = vec2(vRest.x / 9.0, (vRest.y - 279.0) / 17.0);
    float cheek = max(exp(-dot(bc, bc) / (2.0 * sg * sg)), 0.7 * uBlushSpread * exp(-dot(nb, nb))) * smoothstep(55.0, 85.0, vRest.z);
    diffuseColor.rgb *= mix(vec3(1.0), uBlushTint, clamp(cheek * uBlush * (1.0 - skinLip), 0.0, 1.0));
  }
  if (uFreckles > 0.0) {
    // freckles: thickest over the nose bridge and the upper cheeks, a few across the rest of the face
    vec2 fc = vec2(abs(vRest.x) - 36.0, vRest.y - 282.0);
    vec2 fn = vec2(vRest.x, vRest.y - 282.0);
    float where = max(exp(-dot(fc, fc) / (2.0 * 20.0 * 20.0)), exp(-dot(fn, fn) / (2.0 * 13.0 * 13.0)));
    where = max(where, 0.25 * smoothstep(195.0, 230.0, vRest.y) * (1.0 - smoothstep(345.0, 370.0, vRest.y)));
    where *= smoothstep(45.0, 80.0, vRest.z) * (1.0 - skinLip);
    float fr = skinFreckles(vRest, clamp(where * uFreckles * 0.75, 0.0, 0.7));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.56, 0.44), fr * (0.55 + 0.45 * uFreckles));
  }
  for (int i = 0; i < ${MAX_MOLES}; i++) {
    if (i >= uMoleCount) break;
    vec4 m = uMoles[i];
    skinMole = max(skinMole, 1.0 - smoothstep(m.w * 0.6, m.w, distance(vRest, m.xyz)));
  }
  if (skinMole > 0.0) {
    // a mole: dark warm brown, much darker than a freckle; on dark skin still a shade darker than the skin
    vec3 moleC = mix(diffuseColor.rgb * vec3(0.32, 0.22, 0.17), vec3(0.035, 0.018, 0.012), 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, moleC, skinMole);
  }
  {
    // weathering: where the sun reaches (the front of the face, nose, cheeks, forehead, ears' redness), the T-zone, the
    // forehead, the nose and upper lip (sweat)
    float front = smoothstep(55.0, 95.0, vRest.z);
    float forehead = smoothstep(316.0, 328.0, vRest.y) * (1.0 - smoothstep(350.0, 362.0, vRest.y)) * (1.0 - smoothstep(38.0, 55.0, abs(vRest.x))) * front;
    float nose = exp(-pow(vRest.x / 14.0, 2.0) - pow((vRest.y - 275.0) / 22.0, 2.0)) * front;
    float lipTop = exp(-pow(vRest.x / 16.0, 2.0) - pow((vRest.y - 246.0) / 5.0, 2.0)) * front;
    if (uSun > 0.0) {
      float sunWhere = clamp(skinReg.g * 1.3 + 0.6 * forehead + 0.5 * front * smoothstep(200.0, 240.0, vRest.y), 0.0, 1.0) * (1.0 - skinLip);
      float sunPatch = ageNoise(vRest * 0.07 + 9.0) * 0.7 + ageNoise(vRest * 0.3 + 2.0) * 0.3;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.7, 0.62), uSun * sunWhere * (0.35 + 0.65 * sunPatch));
    }
    if (uSunSpots > 0.0) {
      float spotWhere = clamp(0.8 * front * smoothstep(240.0, 270.0, vRest.y) + forehead + 0.5 * smoothstep(40.0, 60.0, abs(vRest.x)) * smoothstep(280.0, 300.0, vRest.y), 0.0, 1.0) * (1.0 - skinLip);
      float sp = skinSpots(vRest, clamp(spotWhere * uSunSpots * 0.55, 0.0, 0.6));
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7, 0.55, 0.42), sp * (0.5 + 0.5 * uSunSpots));
    }
    if (uCapillaries > 0.0) {
      vec3 cp = vRest * 0.2;
      cp += vec3(ageNoise(cp * 1.9 + 3.0), ageNoise(cp * 1.9 + 13.0), ageNoise(cp * 1.9 + 29.0)) * 1.1;
      float cap = pow(max(1.0 - abs(ageNoise(cp) * 2.0 - 1.0), 0.8 * (1.0 - abs(ageNoise(cp * 2.3 + 7.0) * 2.0 - 1.0))), 22.0);
      vec2 ck = vec2(abs(vRest.x) - 38.0, vRest.y - 276.0);
      float capWhere = max(exp(-pow((abs(vRest.x) - 12.0) / 9.0, 2.0) - pow((vRest.y - 266.0) / 12.0, 2.0)), exp(-dot(ck, ck) / (2.0 * 12.0 * 12.0))) * front;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.5, 0.52), clamp(cap * capWhere * uCapillaries * 1.4, 0.0, 0.85));
    }
    if (uSweat > 0.0) {
      float wet = clamp(forehead + 0.8 * nose + 0.8 * lipTop + 0.25 * front, 0.0, 1.0) * uSweat;
      sweatWet = wet;
      markH += skinDroplets(vRest, clamp(0.5 * wet, 0.0, 0.5)) * 0.1;
      diffuseColor.rgb *= 1.0 - 0.08 * wet;
      weatherRough -= wet;
    }
    if (uGrime > 0.0) {
      float dirtPatch = smoothstep(0.35, 0.85, ageNoise(vRest * 0.05 + 21.0) * 0.7 + ageNoise(vRest * 0.21 + 4.0) * 0.3);
      float g = uGrime * clamp(0.6 * dirtPatch + 1.1 * (1.0 - skinReg.r) + 0.12, 0.0, 1.0) * (1.0 - 0.6 * skinLip);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.58, 0.5, 0.43), g * 0.85);
      weatherRough += g;
    }
  }
  for (int i = 0; i < ${MAX_MARKS}; i++) {
    // scars and marks: each a decal projected along its rest normal from its spot (u along it, v across, in mm)
    if (i >= uMarkCount) break;
    vec4 A = uMarkA[i], B = uMarkB[i], C = uMarkC[i];
    vec3 d = vRest - A.xyz;
    float L = C.x, W = C.y, healed = C.z, seed = C.w;
    float reach = 0.5 * L + W + 6.0;
    if (dot(d, d) > reach * reach) continue;
    vec3 n = B.xyz;
    if (abs(dot(d, n)) > 9.0) continue; // the other side of a thin part (an ear, the nose)
    vec3 t0 = normalize(abs(n.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), n) : cross(vec3(1.0, 0.0, 0.0), n));
    vec3 t = cos(B.w) * t0 + sin(B.w) * cross(n, t0);
    float u = dot(d, t), v = dot(d, cross(n, t));
    int type = int(A.w + 0.5);
    vec3 grey = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)));
    if (type == 0 || type == 1) {
      // 0 scar, 1 cut: a meandering line, tapering to its ends
      float s = u / (0.5 * L);
      if (abs(s) > 1.15) continue;
      float wig = (ageNoise(vec3(u * (type == 0 ? 0.18 : 0.25), seed, 1.0)) - 0.5) * W * (type == 0 ? 1.2 : 0.8);
      float taper = sqrt(clamp(1.0 - s * s, 0.0, 1.0));
      float hw = 0.5 * W * taper * (type == 0 ? 0.7 + 0.6 * ageNoise(vec3(u * 0.5, seed, 3.0)) : 1.0);
      float dv = abs(v - wig);
      if (type == 0) {
        float core = 1.0 - smoothstep(hw * 0.55, hw + 0.15, dv);
        float halo = exp(-pow(dv / (hw + 2.5), 2.0)) * taper;
        vec3 fresh = diffuseColor.rgb * vec3(1.0, 0.58, 0.58);
        vec3 old = mix(diffuseColor.rgb, grey * vec3(1.2, 1.06, 1.0) + 0.02, 0.6); // paler: scar tissue has less pigment
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(fresh, old, healed), core);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.84, 0.84), halo * (1.0 - healed) * 0.6);
        // a raised ridge when fresh, flat and a little sunken once healed; stitch marks across a healed one
        float stitch = (1.0 - smoothstep(0.35, 0.6, abs(fract(u / 4.0 + seed) - 0.5) * 4.0)) * (1.0 - smoothstep(hw + 1.2, hw + 2.2, dv)) * taper * step(0.5, fract(seed * 0.37));
        markH += core * mix(0.2, -0.07, healed) + halo * 0.03 * (1.0 - healed) - stitch * 0.05;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * vec3(1.0, 0.7, 0.7), old, healed), stitch * 0.6);
        markRough *= mix(1.0, 0.7, core);
        markSmooth = max(markSmooth, core);
      } else {
        float gaps = smoothstep(0.25, 0.45, ageNoise(vec3(u * 0.35, seed, 9.0)));
        float core = (1.0 - smoothstep(hw * 0.4, hw, dv)) * gaps;
        float swell = exp(-pow(dv / (hw + 2.0), 2.0)) * taper;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.3, 0.025, 0.02), vec3(0.17, 0.065, 0.04), healed), core * 0.92);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.68, 0.66), swell * 0.7 * (1.0 - 0.5 * healed));
        markH += core * mix(-0.12, 0.06, healed) + swell * 0.05;
        markRough = mix(markRough, mix(0.35, 1.25, healed), core); // wet blood, then a matte scab
        markSmooth = max(markSmooth, core);
      }
    } else if (type == 2) {
      // pockmarks: a cluster of pits (L across, each about W)
      float rr = length(vec2(u, v)) / (0.5 * L) + 0.3 * (ageNoise(vec3(u * 0.2, v * 0.2, seed)) - 0.5);
      if (rr > 1.2) continue;
      float fall = 1.0 - smoothstep(0.6, 1.1, rr);
      vec2 g = vec2(u, v) / max(W * 1.6, 0.5);
      vec2 gi = floor(g);
      float pit = 0.0;
      for (int px = -1; px <= 1; px++)
        for (int py = -1; py <= 1; py++) {
          vec2 c = gi + vec2(float(px), float(py));
          vec3 h = skinHash3(vec3(c, seed));
          if (h.z > 0.55) continue;
          pit = max(pit, 1.0 - smoothstep(0.5, 1.0, length(g - c - h.xy) / (0.25 + 0.2 * h.x)));
        }
      pit *= fall;
      markH -= pit * 0.14;
      diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.85, 0.62, 0.6), vec3(0.93, 0.89, 0.88), healed), pit * 0.6);
      markSmooth = max(markSmooth, pit * 0.5);
    } else if (type == 3) {
      // burn: a ragged patch, mottled (pink when fresh; pale and dark patches once healed), uneven and shiny
      float ang = atan(v, u);
      float edge = 0.5 * L * (0.75 + 0.35 * ageNoise(vec3(cos(ang) * 1.5, sin(ang) * 1.5, seed)));
      float inside = 1.0 - smoothstep(edge - 1.5, edge + 0.5, length(vec2(u, v)));
      if (inside <= 0.0) continue;
      float mott = ageNoise(vRest * 0.35 + seed);
      vec3 fresh = diffuseColor.rgb * mix(vec3(1.0, 0.55, 0.52), vec3(0.85, 0.4, 0.38), mott);
      vec3 old = mix(grey * vec3(1.25, 1.08, 1.02) + 0.03, diffuseColor.rgb * vec3(0.8, 0.62, 0.55), smoothstep(0.35, 0.65, mott));
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(fresh, old, healed), inside);
      markH += inside * ((ageNoise(vRest * 0.9 + seed * 2.0) - 0.5) * 0.25 + 0.05);
      markRough = mix(markRough, 0.6, inside);
      markSmooth = max(markSmooth, inside);
    } else {
      // bruise: a soft blotch, purple-blue when fresh, yellow-green as it heals
      float rr = length(vec2(u, v * 1.2)) / (0.5 * L) + 0.35 * (ageNoise(vRest * 0.12 + seed) - 0.5);
      float blot = 1.0 - smoothstep(0.3, 1.0, rr);
      if (blot <= 0.0) continue;
      diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.62, 0.42, 0.62), vec3(0.98, 0.92, 0.62), healed), blot * 0.85);
      markH += blot * 0.04 * (1.0 - healed);
    }
  }
#ifdef USE_SKIN_CAVITY_MAP
  diffuseColor.rgb *= mix(1.0, texture2D(uSkinCavityMap, vAoMapUv).r, 0.5 * uSkinCavityAmt);
#endif
#ifdef SKIN_MICRO
  if (uMicro > 0.0) {
    // the fine skin texture from three sides (the same blend as the pores): slopes (stored 0.5 ± 2 → ×4 − 2 … see
    // lib/skinMicro.ts MICRO.slopeRange), pore mask, roughness variation
    vec3 mw = pow(abs(normalize(vSkinN)), vec3(4.0));
    mw /= mw.x + mw.y + mw.z;
    vec4 m0 = texture2D(uSkinMicro, vRest.zy / uMicroTile);
    vec4 m1 = texture2D(uSkinMicro, vRest.xz / uMicroTile);
    vec4 m2 = texture2D(uSkinMicro, vRest.xy / uMicroTile);
    skinMW = mw;
    skinMG0 = (m0.rg - 0.5) * 4.0;
    skinMG1 = (m1.rg - 0.5) * 4.0;
    skinMG2 = (m2.rg - 0.5) * 4.0;
    skinMicroPore = m0.b * mw.x + m1.b * mw.y + m2.b * mw.z;
    skinMicroRough = m0.a * mw.x + m1.a * mw.y + m2.a * mw.z;
    // on the face's skin (the pores' own mask), a little on the lips, none in scar tissue
    skinMicroAmt = uMicro * max(smoothstep(0.2, 0.5, skinReg.b) * skinReg.a, 0.3 * skinLip) * (1.0 - markSmooth);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.88, 0.84, 0.84), clamp(skinMicroPore * skinMicroAmt, 0.0, 1.0)); // the pits are a touch darker
  }
#endif
#ifdef USE_STUBBLE
  {
    // stubble: the mask says where (and how patchy), the follicle texture (on the rest position from three sides, like
    // the pores) gives the stubs; far away they average into an even shadow, close up they read as hairs
    float sd = texture2D(uStubbleMap, vAoMapUv).r;
    vec3 sw = pow(abs(normalize(vSkinN)), vec3(4.0));
    sw /= sw.x + sw.y + sw.z;
    vec3 sq = vRest / uStubbleTile;
    float stubs = texture2D(uStubbleDetail, sq.zy).r * sw.x + texture2D(uStubbleDetail, sq.xz).r * sw.y + texture2D(uStubbleDetail, sq.xy).r * sw.z;
    // short, dense, shadowed stubs read much darker than the hair colour itself
    vec3 hairC = sRGBTransferEOTF(vec4(uStubbleColour, 1.0)).rgb * ${SKIN_SHADE.stubbleDarken.toFixed(2)};
    // the shaved shadow: hair under the skin, seen through it as a cool, greyed version of the hair colour
    vec3 underC = mix(hairC, vec3(dot(hairC, vec3(0.3, 0.59, 0.11))) * vec3(0.82, 0.9, 1.0), 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(1.0), underC * 3.0, 0.5), clamp(sd * uStubbleShadow, 0.0, 1.0));
    // the stubs themselves
    float cover = sd * uStubbleLen * (0.35 + 1.5 * stubs);
    diffuseColor.rgb = mix(diffuseColor.rgb, hairC, clamp(cover, 0.0, ${SKIN_SHADE.stubbleCover.toFixed(2)}));
    stubbleH = -sd * uStubbleLen * stubs;
    stubbleRough = sd * uStubbleLen;
  }
#endif
#endif
`;

const ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
#ifdef USE_AOMAP
  roughnessFactor = mix(uRoughDry, uRoughOily, skinReg.b);
  roughnessFactor = mix(roughnessFactor, 0.92, stubbleRough); // stubble is matte
  // the lips' finish: 0 matte (rougher), 1 as they are, 2 high gloss (smoother)
  roughnessFactor = mix(roughnessFactor, uLipRough * (uLipGloss < 1.0 ? mix(2.4, 1.0, uLipGloss) : mix(1.0, 0.45, uLipGloss - 1.0)), skinLip);
  roughnessFactor *= 1.0 + uRoughVar * (ageNoise(vRest * 0.3 + 5.0) - 0.5) * 2.0;
#ifdef SKIN_MICRO
  roughnessFactor += (skinMicroRough - 0.5) * 0.22 * skinMicroAmt; // cell tops a little glossier than the furrows
#endif
#ifdef USE_SKIN_ROUGH_MAP
  roughnessFactor = mix(roughnessFactor, texture2D(uSkinRoughMap, vAoMapUv).g, uSkinRoughAmt);
#endif
  // oiliness: 1 is the regions' own T-zone; more spreads it and makes it shinier, 0 is matte all over
  roughnessFactor = mix(roughnessFactor, uRoughDry, clamp(1.0 - uOil, 0.0, 1.0) * skinReg.b);
  roughnessFactor *= 1.0 - 0.3 * clamp(uOil - 1.0, 0.0, 1.0) * smoothstep(0.3, 0.7, skinReg.b);
  roughnessFactor = weatherRough > 0.0 ? mix(roughnessFactor, 0.92, clamp(weatherRough, 0.0, 1.0) * 0.6)
                                       : mix(roughnessFactor, 0.22, clamp(-weatherRough, 0.0, 1.0) * 0.7);
  roughnessFactor = clamp(roughnessFactor * markRough, 0.08, 1.0);
#endif
`;

const OIL = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= mix(skinReg.b * skinReg.b * uOil, uLipSheen * uLipGloss, skinLip); // the oily T-zone, and moist lips (× their finish)
  material.clearcoat = max(material.clearcoat, 0.6 * sweatWet); // a film of sweat
#endif
`;

const DETAIL = /* glsl */ `
#include <normal_fragment_maps>
skinSmoothN = normal; // before pores and wrinkles (lib/age.ts adds the wrinkles after this step)
#if defined(USE_SKIN_NORMAL_MAP) && defined(USE_AOMAP)
{
  // a scanned normal map in the head's UVs: its pores and wrinkles (the red channel's smooth normal stays smooth)
  vec3 mapN = texture2D(uSkinNormalMap, vAoMapUv).xyz * 2.0 - 1.0;
  mapN.xy *= uSkinNormalAmt;
  normal = skinPerturbUv(-vViewPosition, normal, vAoMapUv, mapN, faceDirection);
}
#endif
#if defined(USE_SKIN_CAVITY_MAP) && defined(USE_AOMAP)
skinCavity *= mix(1.0, texture2D(uSkinCavityMap, vAoMapUv).r, uSkinCavityAmt);
#endif
#ifdef SKIN_DETAIL
{
  vec3 w = pow(abs(normalize(vSkinN)), vec3(4.0));
  w /= w.x + w.y + w.z;
  vec3 q = vRest / uDetailTile;
  float hd = texture2D(uSkinDetail, q.zy).r * w.x + texture2D(uSkinDetail, q.xz).r * w.y + texture2D(uSkinDetail, q.xy).r * w.z;
  // pores on the face only (oiliness above the scalp/neck's 0.3), none on thin skin (ears, eyelids), few on the lips
  float depth = uDetailDepth * uPores * smoothstep(0.3, 0.6, skinReg.b) * skinReg.a * (1.0 - 0.7 * smoothstep(0.7, 0.95, skinReg.g));
  depth *= (1.0 - markSmooth) * (1.0 + 0.8 * uSun); // none in scar tissue; deeper in sun-damaged skin
  normal = ageBump(-vViewPosition, normal, (hd - 0.5) * depth, faceDirection);
  // the pits hide the shine: no highlight at the bottom of a pore
  skinCavity *= mix(1.0, smoothstep(0.1, 0.5, hd), clamp(depth / max(uDetailDepth, 1e-4), 0.0, 1.0) * uCavity);
}
#endif
#ifdef SKIN_MICRO
if (uMicro > 0.0) {
  // the fine skin texture: the height change per screen pixel is the slope · the plane position's change, per plane
  float mhx = skinMW.x * dot(skinMG0, dFdx(vRest.zy)) + skinMW.y * dot(skinMG1, dFdx(vRest.xz)) + skinMW.z * dot(skinMG2, dFdx(vRest.xy));
  float mhy = skinMW.x * dot(skinMG0, dFdy(vRest.zy)) + skinMW.y * dot(skinMG1, dFdy(vRest.xz)) + skinMW.z * dot(skinMG2, dFdy(vRest.xy));
  normal = skinBumpGrad(-vViewPosition, normal, vec2(mhx, mhy) * skinMicroAmt, faceDirection);
  skinCavity *= 1.0 - 0.45 * clamp(skinMicroPore * skinMicroAmt, 0.0, 1.0); // no shine at the bottom of a pore
}
#endif
if (uLipLines > 0.0) normal = ageBump(-vViewPosition, normal, lipLineH * 0.085 * uLipLines, faceDirection); // the furrows, ~0.085 mm deep
if (uFormOn > 0.5) normal = ageBump(-vViewPosition, normal, formH, faceDirection); // the face form (philtrum, mouth line, collarbone)
// scars, cuts, burns and sweat droplets (heights from the colour step); a uniform test, so the derivatives stay valid
if (uMarkCount > 0 || uSweat > 0.0) normal = ageBump(-vViewPosition, normal, markH, faceDirection);
#ifdef USE_STUBBLE
normal = ageBump(-vViewPosition, normal, stubbleH * ${SKIN_SHADE.stubbleBump.toFixed(3)}, faceDirection);
#endif
if (skinMole > 0.0) normal = ageBump(-vViewPosition, normal, skinMole * 0.25, faceDirection); // moles are slightly raised
`;

const SCALP = /* glsl */ `
#include <alphamap_fragment>
vec3 scalpC = sRGBTransferEOTF(vec4(uScalpColour, 1.0)).rgb * uScalpDarken;
diffuseColor.rgb = mix(diffuseColor.rgb, scalpC, clamp(vHairCover, 0.0, 1.0) * uScalp);
`;

// Helpers for the weathering and the scanned maps: after DECL and lib/age.ts, so skinHash3 and ageNoise exist
// (installSkinShader puts them just before main).
const HELPERS = /* glsl */ `
// Bump from the change in height per screen pixel (mm) instead of a height: for the fine skin texture, whose slopes are
// stored. Same maths as lib/age.ts ageBump (Mikkelsen's surface gradient).
vec3 skinBumpGrad(vec3 surfPos, vec3 n, vec2 dh, float faceDir) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 d = dh * 0.001; // mm -> m
  return normalize(abs(det) * n - sign(det) * (d.x * r1 + d.y * r2));
}
// Sun spots: one candidate per 6 mm cell (like the freckles, bigger, with ragged edges).
float skinSpots(vec3 p, float density) {
  vec3 g = p / 6.0;
  vec3 i = floor(g);
  float f = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 c = i + vec3(float(x), float(y), float(z));
        vec3 h = skinHash3(c + 7.7);
        if (fract(h.x * 13.7 + h.z * 5.1) > density) continue;
        float r = 0.16 + 0.22 * fract(h.y * 9.3);
        float d = length(g - c - h) + (ageNoise(p * 0.9 + h * 50.0) - 0.5) * 0.18;
        f = max(f, (1.0 - smoothstep(r * 0.45, r, d)) * (0.5 + 0.5 * fract(h.z * 3.3)));
      }
  return f;
}
// Sweat: droplets 0.3–0.8 mm across, one candidate per 2.5 mm cell; returns the droplet's dome (0..1).
float skinDroplets(vec3 p, float density) {
  vec3 g = p / 2.5;
  vec3 i = floor(g);
  float hgt = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 c = i + vec3(float(x), float(y), float(z));
        vec3 h = skinHash3(c + 3.3);
        if (fract(h.y * 7.1 + h.x * 2.3) > density) continue;
        float r = 0.06 + 0.12 * fract(h.z * 5.7);
        float d = length(g - c - h) / r;
        if (d < 1.0) hgt = max(hgt, sqrt(1.0 - d * d));
      }
  return hgt;
}
// Tangent frame from the UVs' screen derivatives (no tangent attribute), for the scanned normal map.
vec3 skinPerturbUv(vec3 eyePos, vec3 n, vec2 uv, vec3 mapN, float faceDir) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : faceDir * inversesqrt(det);
  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + n * mapN.z);
}
`;

const ALPHA = /* glsl */ `
#include <dithering_fragment>
gl_FragColor.a = uSkinAlpha;
`;

const AO_DIRECT = /* glsl */ `
#include <aomap_fragment>
#ifdef USE_AOMAP
  float aoDirect = mix(1.0, ambientOcclusion, uAoDirect);
  reflectedLight.directDiffuse *= aoDirect;
  reflectedLight.directSpecular *= aoDirect;
#endif
reflectedLight.directDiffuse *= formLift;
reflectedLight.indirectDiffuse *= formLift;
reflectedLight.indirectSpecular *= skinCavity;
${hairAmbientChunk("skinSmoothN")}
`;

// Direct diffuse: per channel, the light sees a smoother surface in red than in blue and wraps further round the form
// (the subsurface look without a blur pass), plus light through thin skin from behind.
const LAMBERT = "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );";
const SKIN_DIFFUSE = /* glsl */ `
  vec3 skinNL = mix( vec3( dot( geometryNormal, directLight.direction ) ), vec3( dot( normalize( skinSmoothN ), directLight.direction ) ), uSssNormal );
  // energy-conserving wrap (the same total light as Lambert, spread further round the form)
  vec3 skinIrr = clamp( ( skinNL + uWrap ) / ( ( 1.0 + uWrap ) * ( 1.0 + uWrap ) ), 0.0, 1.0 ) * directLight.color;
  reflectedLight.directDiffuse += skinIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  vec3 skinTH = normalize( directLight.direction + geometryNormal * uTransDistort );
  float skinThrough = pow( clamp( dot( geometryViewDir, -skinTH ), 0.0, 1.0 ), uTransPower );
  reflectedLight.directDiffuse += skinThrough * (1.0 - skinReg.a) * uTrans * uTransColour * material.diffuseContribution * directLight.color;
`;
// Direct specular: two lobes (a tight highlight and a broad sheen, as measured on skin), none at the bottom of pores.
const GGX = "vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );";
const SKIN_GGX = /* glsl */ `
  PhysicalMaterial skinLobe = material;
  skinLobe.roughness = clamp( material.roughness * uLobes.x, 0.06, 1.0 );
  vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, skinLobe ) * uLobes.z;
  skinLobe.roughness = clamp( material.roughness * uLobes.y, 0.06, 1.0 );
  specularBRDF += BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, skinLobe ) * ( 1.0 - uLobes.z );
  specularBRDF *= skinCavity;
`;
function physicalPars(): string {
  let c = ShaderChunk.lights_physical_pars_fragment;
  if (c.includes(LAMBERT)) c = c.replace(LAMBERT, SKIN_DIFFUSE);
  else console.warn("[shader] three's direct diffuse line changed; the subsurface look is off");
  if (c.includes(GGX)) c = c.replace(GGX, SKIN_GGX);
  else console.warn("[shader] three's direct specular line changed; the skin has one specular lobe");
  return c;
}
const PHYSICAL_PARS = physicalPars();

// The key's shadow on the skin: the wrap lights skin a little past where it faces the light, where the shadow map already
// calls it shadowed, so the self-shadow comes in only where the surface faces the light; and the penumbra goes warm.
const SKIN_SHADOW = /* glsl */ `
		{
			float skinSh = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			skinSh = mix( 1.0, skinSh, smoothstep( -0.05, 0.3, dot( normalize( skinSmoothN ), directLight.direction ) ) );
			directLight.color *= pow( vec3( skinSh ), uShadowTint );
		}
`;

export function installSkinShader(material: MeshPhysicalMaterial): void {
  material.onBeforeCompile = (shader) => {
    patchAgeShader(shader); // first: the patches below build on its vRest, ageNoise and ageBump
    Object.assign(shader.uniforms, skinUniforms, hairShadowUniforms);
    // aSculpt: the sculpt and fine-shape offset (lib/sculpt.ts), before the morphs; vRest stays on the rest position
    shader.vertexShader = "attribute float aHairCover;\nattribute vec3 aSculpt;\nvarying float vHairCover;\nvarying vec3 vSkinN;\n" +
      shader.vertexShader
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvHairCover = aHairCover;\nvSkinN = normal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += aSculpt;");
    shader.fragmentShader = DECL + HAIR_SHADOW_DECL + shader.fragmentShader
      .replace("#include <color_fragment>", REGIONS)
      .replace("#include <roughnessmap_fragment>", ROUGHNESS)
      .replace("#include <lights_physical_fragment>", OIL)
      .replace("#include <normal_fragment_maps>", DETAIL)
      .replace("#include <lights_physical_pars_fragment>", PHYSICAL_PARS)
      .replace("#include <lights_fragment_begin>", hairLitChunk("vRest", SKIN_SHADOW))
      .replace("#include <aomap_fragment>", AO_DIRECT)
      .replace("#include <alphamap_fragment>", SCALP)
      .replace("#include <dithering_fragment>", ALPHA)
      .replace("void main() {", HELPERS + "void main() {");
  };
  material.customProgramCacheKey = () => "skin-v15";
  // the hair's shadow (lib/hairShadow.ts): head-space matrices for the camera drawing it, on the tiers that have it
  // and the expression's wrinkles (lib/age.ts), from the weights the face shows this frame
  material.onBeforeRender = (_r, _s, camera) => {
    updateHairShadowView(camera);
    updateExpressionWrinkles();
  };
  applyHairShadowTier(material);
}

/** Pores on or off for the current tier (Head.tsx calls this again when the tier drops). */
export function applySkinTier(material: MeshPhysicalMaterial): void {
  const on = tierSettings().detailNormals && skinUniforms.uSkinDetail.value !== null;
  if (on === !!material.defines?.SKIN_DETAIL) return;
  material.defines ??= {};
  if (on) material.defines.SKIN_DETAIL = "";
  else delete material.defines.SKIN_DETAIL;
  material.needsUpdate = true;
}

/** Fetch the skin's maps for the current quality tier and put them on the material (one recompile). */
export async function loadSkinMaps(material: MeshPhysicalMaterial): Promise<void> {
  const [regions, detail] = await Promise.all([
    loadKtx2(tieredUrl("skin_regions")),
    tierSettings().detailNormals ? loadKtx2(TEXTURES_BASE + "skin_detail.ktx2") : Promise.resolve(null),
  ]);
  material.aoMap = regions;
  if (detail) {
    detail.wrapS = detail.wrapT = RepeatWrapping; // the tile repeats over the face
    detail.needsUpdate = true;
    skinUniforms.uSkinDetail.value = detail;
  }
  applySkinShade(material); // the oil sheen (clearcoat) switches on with the maps
  applySkinTier(material);
  material.needsUpdate = true;
}

/**
 * Stubble on (a facial hair "stubble" style, lib/addons.ts): its mask, the follicle texture and its look; the colour
 * is the facial hair's colour set, by reference, so colour changes and blends follow. One recompile.
 */
export function enableStubble(material: MeshPhysicalMaterial, mask: Texture, detail: Texture, look: { length: number; shadow: number }, colour: Color): void {
  detail.wrapS = detail.wrapT = RepeatWrapping;
  detail.needsUpdate = true;
  skinUniforms.uStubbleMap.value = mask;
  skinUniforms.uStubbleDetail.value = detail;
  skinUniforms.uStubbleLen.value = look.length;
  skinUniforms.uStubbleShadow.value = look.shadow;
  skinUniforms.uStubbleColour.value = colour;
  if (material.defines?.USE_STUBBLE === undefined) {
    material.defines = { ...material.defines, USE_STUBBLE: "" };
    material.needsUpdate = true;
  }
}

/** Stubble off (the style was removed or replaced by one that is not stubble). */
export function disableStubble(material: MeshPhysicalMaterial | null): void {
  if (!material?.defines || material.defines.USE_STUBBLE === undefined) return;
  delete material.defines.USE_STUBBLE;
  material.needsUpdate = true;
}

// --- what the hair and beard pieces paint on the skin, per image of a cross-fade ------------------------------------

/** The scalp tint and the stubble, as the pieces on the head have set them. */
export type SkinPieces = {
  cover: BufferAttribute;
  scalpColour: Color;
  stubble: boolean;
  stubbleMap: Texture | null;
  stubbleDetail: Texture | null;
  stubbleLen: number;
  stubbleShadow: number;
  stubbleColour: Color;
};

function currentSkinPieces(cover: BufferAttribute): SkinPieces {
  const u = skinUniforms;
  return {
    cover,
    scalpColour: u.uScalpColour.value,
    stubble: skinRig.material?.defines?.USE_STUBBLE !== undefined,
    stubbleMap: u.uStubbleMap.value,
    stubbleDetail: u.uStubbleDetail.value,
    stubbleLen: u.uStubbleLen.value,
    stubbleShadow: u.uStubbleShadow.value,
    stubbleColour: u.uStubbleColour.value,
  };
}

/**
 * A copy of the skin's piece state now (lib/pieceFade.ts: the "before" image keeps it while the pieces swap). Null
 * before the head loads. The cover is a separate attribute, uploaded once and then swapped in by reference.
 */
export function snapshotSkinPieces(): SkinPieces | null {
  const live = skinSurface.mesh?.geometry.getAttribute("aHairCover") as BufferAttribute | undefined;
  if (!live) return null;
  return currentSkinPieces(new Float32BufferAttribute((live.array as Float32Array).slice(), 1));
}

/** Put `s` on the skin; returns what it replaced (to put back), or null before the head loads. */
export function applySkinPieces(s: SkinPieces): SkinPieces | null {
  const geometry = skinSurface.mesh?.geometry;
  const live = geometry?.getAttribute("aHairCover") as BufferAttribute | undefined;
  if (!geometry || !live) return null;
  const was = currentSkinPieces(live);
  const u = skinUniforms;
  geometry.setAttribute("aHairCover", s.cover);
  u.uScalpColour.value = s.scalpColour;
  u.uStubbleMap.value = s.stubbleMap;
  u.uStubbleDetail.value = s.stubbleDetail;
  u.uStubbleLen.value = s.stubbleLen;
  u.uStubbleShadow.value = s.stubbleShadow;
  u.uStubbleColour.value = s.stubbleColour;
  const material = skinRig.material;
  if (material && s.stubble !== was.stubble) {
    if (s.stubble) material.defines = { ...material.defines, USE_STUBBLE: "" };
    else delete material.defines!.USE_STUBBLE;
    material.needsUpdate = true;
  }
  return was;
}
