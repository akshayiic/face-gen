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
 *
 * Nothing here changes the swatches: redness and translucency multiply whatever tone is chosen (lib/skin.ts).
 * The maps load after the head is on screen (Head.tsx); until then the skin is plain.
 * Tweak here: SKIN_SHADE (most values are uniforms: change them live through __faceToVoice.skinShade).
 */
import { type BufferAttribute, Color, Float32BufferAttribute, type MeshPhysicalMaterial, RepeatWrapping, ShaderChunk, type Texture, Vector3, Vector4 } from "three";

import { patchAgeShader } from "@/lib/age";
import { applyHairShadowTier, HAIR_SHADOW_DECL, hairAmbientChunk, hairLitChunk, hairShadowUniforms, updateHairShadowView } from "@/lib/hairShadow";
import { tierSettings } from "@/lib/quality";
import { skinRig } from "@/lib/skin";
import { skinSurface } from "@/lib/skinSurface";
import { loadKtx2, TEXTURES_BASE, tieredUrl } from "@/lib/textures";

export const SKIN_SHADE = {
  aoIndirect: 1.0, // how much the baked AO darkens the environment light (three's aoMapIntensity)
  aoDirect: 0.6, // … and the key/fill/rim lights (0 = not at all, 1 = as much as the environment)
  scalp: 0.85, // how far fully covered scalp goes towards the hair's root colour …
  scalpDarken: 0.7, // … darkened this much (the scalp sits in the hair's shadow)
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
uniform float uBlush, uFreckles, uPores, uUnderEye;
uniform vec4 uMoles[${MAX_MOLES}];
uniform int uMoleCount;
uniform sampler2D uSkinTex;
uniform float uSkinTexAmt, uSkinTexTile, uSkinTexMode, uSkinTexMatch;
uniform vec3 uSkinTexMean;
uniform float uMottle, uVeins, uCrease, uRoughVar, uCavity;
uniform vec3 uCreaseTint, uLobes, uSssNormal, uShadowTint;
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
  {
    // round the eyes (vRest is in mm): under the eye (towards the inner corner) and the upper lid crease
    vec2 e = vec2(abs(vRest.x) - 30.9, vRest.y - 303.2);
    float under = exp(-pow((e.x + 3.0) / 15.0, 2.0) - pow((e.y + 11.0) / 7.0, 2.0));
    float crease = 0.5 * exp(-pow(e.x / 16.0, 2.0) - pow((e.y - 9.0) / 4.5, 2.0));
    float front = smoothstep(55.0, 80.0, vRest.z);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.73, 0.77), clamp((under + crease) * front * uUnderEye, 0.0, 1.0) * uEyeShadow);
  }
#ifdef USE_SKIN_TEX
  // its own colours (a painted map): over everything the tone made
  if (uSkinTexMatch < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, skinTexC, uSkinTexAmt);
#endif
  {
    // blush: the apples of the cheeks, soft-edged, never on the lips
    vec2 bc = vec2(abs(vRest.x) - 44.0, vRest.y - 271.0);
    float cheek = exp(-dot(bc, bc) / (2.0 * 15.0 * 15.0)) * smoothstep(55.0, 85.0, vRest.z);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.68, 0.7), clamp(cheek * uBlush * (1.0 - skinLip), 0.0, 1.0));
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
  roughnessFactor = mix(roughnessFactor, uLipRough, skinLip);
  roughnessFactor *= 1.0 + uRoughVar * (ageNoise(vRest * 0.3 + 5.0) - 0.5) * 2.0;
#endif
`;

const OIL = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= mix(skinReg.b * skinReg.b, uLipSheen, skinLip); // the oily T-zone, and moist lips
#endif
`;

const DETAIL = /* glsl */ `
#include <normal_fragment_maps>
skinSmoothN = normal; // before pores and wrinkles (lib/age.ts adds the wrinkles after this step)
#ifdef SKIN_DETAIL
{
  vec3 w = pow(abs(normalize(vSkinN)), vec3(4.0));
  w /= w.x + w.y + w.z;
  vec3 q = vRest / uDetailTile;
  float hd = texture2D(uSkinDetail, q.zy).r * w.x + texture2D(uSkinDetail, q.xz).r * w.y + texture2D(uSkinDetail, q.xy).r * w.z;
  // pores on the face only (oiliness above the scalp/neck's 0.3), none on thin skin (ears, eyelids), few on the lips
  float depth = uDetailDepth * uPores * smoothstep(0.3, 0.6, skinReg.b) * skinReg.a * (1.0 - 0.7 * smoothstep(0.7, 0.95, skinReg.g));
  normal = ageBump(-vViewPosition, normal, (hd - 0.5) * depth, faceDirection);
  // the pits hide the shine: no highlight at the bottom of a pore
  skinCavity = mix(1.0, smoothstep(0.1, 0.5, hd), clamp(depth / max(uDetailDepth, 1e-4), 0.0, 1.0) * uCavity);
}
#endif
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

const AO_DIRECT = /* glsl */ `
#include <aomap_fragment>
#ifdef USE_AOMAP
  float aoDirect = mix(1.0, ambientOcclusion, uAoDirect);
  reflectedLight.directDiffuse *= aoDirect;
  reflectedLight.directSpecular *= aoDirect;
#endif
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
    shader.vertexShader = "attribute float aHairCover;\nvarying float vHairCover;\nvarying vec3 vSkinN;\n" +
      shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\nvHairCover = aHairCover;\nvSkinN = normal;");
    shader.fragmentShader = DECL + HAIR_SHADOW_DECL + shader.fragmentShader
      .replace("#include <color_fragment>", REGIONS)
      .replace("#include <roughnessmap_fragment>", ROUGHNESS)
      .replace("#include <lights_physical_fragment>", OIL)
      .replace("#include <normal_fragment_maps>", DETAIL)
      .replace("#include <lights_physical_pars_fragment>", PHYSICAL_PARS)
      .replace("#include <lights_fragment_begin>", hairLitChunk("vRest", SKIN_SHADOW))
      .replace("#include <aomap_fragment>", AO_DIRECT)
      .replace("#include <alphamap_fragment>", SCALP);
  };
  material.customProgramCacheKey = () => "skin-v13";
  // the hair's shadow (lib/hairShadow.ts): head-space matrices for the camera drawing it, on the tiers that have it
  material.onBeforeRender = (_r, _s, camera) => updateHairShadowView(camera);
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
