/**
 * The strand shaders (lib/groom.ts buildGroom). Vertex: one camera-facing ribbon per strand, at least ~1 px wide and
 * faded by how much of that pixel the strand really covers, child strands placed round their parent, the roots moved
 * with the skin and lashes turned with the lid, and frizz: strands wandering off their line towards the tips and a few
 * flying away from the head (uFrizz, head hair). Fragment: Kajiya-Kay hair lighting from the scene's directional lights,
 * the self-shadow baked per point (re-baked when the style is re-shaped: lib/hairShadow.ts bakeHairShade) and the
 * root → tip colour ramp; light shining through backlit strands (uTT); glints along the secondary highlight; and a shine
 * control (uShine).
 */

export const VERTEX = /* glsl */ `
uniform highp sampler2D uPos;
uniform highp sampler2D uRoot;
uniform int uTexW;
uniform int uStrands;
uniform int uPoints;
uniform float uChildR;
uniform float uWidth;
uniform float uTipW;
uniform float uMinPx;
uniform float uPxScale;
uniform float uCoverMin;
uniform vec3 uCentre;
uniform float uEyeFollow;
uniform vec3 uEyeL; // the eye centres now (they move with the face's shape) …
uniform vec3 uEyeR;
uniform vec3 uEyeL0; // … and on the average face
uniform vec3 uEyeR0;
uniform highp sampler2D uShapePts; // brows: per point, the face shape's offset there minus at the hair's root …
uniform float uShapeFollow; // … on (1) or off (0) (lib/groomFollow.ts followShapePoints)
uniform highp sampler2D uLid; // per lash: the extra turn (radians at full weight) for each of 16 lid-folding targets …
uniform float uLidW[16]; // … and those targets' current weights (lib/groom.ts lidFix)
attribute vec2 aVert; // x: point index along the strand, y: ribbon side (-1 / 1)
varying float vT;
varying float vRamp;
varying float vLong;
varying float vShade;
varying float vCover;
varying float vRand;
varying float vLock;
varying float vRootFade;
varying vec3 vTan;
varying vec3 vViewPos;
uniform float uRampLen;
uniform float uFrizz;
uniform float uLashLen, uLashCurl; // lashes: × their length, and how far the tips curl (up on the upper lid, down below)
uniform float uNatural; // head hair: roots sunk into the scalp and thin, tips of uneven length (1); anything else 0
uniform float uTrunc; // … how much of a strand's length its tip may lose (the layers of a cut)
uniform float uSink; // … how deep (m) a root starts under the skin
varying float vRootD;

vec4 fetchP(int s, int k) {
  int i = s * uPoints + k;
  return texelFetch(uPos, ivec2(i % uTexW, i / uTexW), 0);
}
// the strand at u (0 = root, 1 = tip) along its polyline: a shortened strand is the same line cut earlier
vec4 sampleP(int s, float u) {
  float f = clamp(u, 0.0, 1.0) * float(uPoints - 1);
  int i0 = int(floor(f));
  return mix(fetchP(s, i0), fetchP(s, min(i0 + 1, uPoints - 1)), f - float(i0));
}
float hash(float n) { return fract(sin(n) * 43758.5453123); }
// a lash point (index k) longer or shorter from its root, and curled: the tip goes up and forward (down and forward below)
// (the lower lashes follow far less: a long, curled lower lash reads as a smudge on the cheek)
vec3 lashFix(vec3 p, int k, vec3 r0, float up) {
  float t = float(k) / float(uPoints - 1);
  float w = up > 0.0 ? 1.0 : 0.3;
  float len = mix(1.0, uLashLen, w);
  p = r0 + (p - r0) * len;
  return p + vec3(0.0, up * 0.8, 0.6) * (uLashCurl * w * 0.0045 * t * t * len);
}

void main() {
  int s = gl_InstanceID % uStrands;
  int c = gl_InstanceID / uStrands;
  int k = int(aVert.x);
  float id = float(s) * 7.13 + float(c) * 131.71;
  vec4 P = fetchP(s, k);
  vec3 a = fetchP(s, max(k - 1, 0)).xyz;
  vec3 b = fetchP(s, min(k + 1, uPoints - 1)).xyz;
  if (uTrunc > 0.0) {
    // hair is cut in layers and its ends differ: each child strand stops a different way along its parent's line (the
    // parents mostly keep the silhouette). The ribbon is laid again over the shorter strand, so it still tapers to a point.
    float span = clamp(distance(fetchP(s, uPoints - 1).xyz, fetchP(s, 0).xyz) / 0.12, 0.25, 1.0); // short hair loses less
    float tEnd = 1.0 - uTrunc * span * (c > 0 ? pow(hash(id + 41.0), 1.5) : 0.2 * hash(id + 41.0));
    float u = float(k) / float(uPoints - 1), du = 1.0 / float(uPoints - 1);
    P = sampleP(s, u * tEnd);
    a = sampleP(s, max(u - du, 0.0) * tEnd).xyz;
    b = sampleP(s, min(u + du, 1.0) * tEnd).xyz;
  }
  vec4 rootT = texelFetch(uRoot, ivec2(s % uTexW, s / uTexW), 0); // xyz: the root's offset; w: lashes' shape turn
  vec3 off = rootT.xyz;
  if (uShapeFollow > 0.5) {
    // a brow hair keeps its distance from its own skin when the face's shape bends the skin under it
    int i0 = s * uPoints + k, ia = s * uPoints + max(k - 1, 0), ib = s * uPoints + min(k + 1, uPoints - 1);
    P.xyz += texelFetch(uShapePts, ivec2(i0 % uTexW, i0 / uTexW), 0).xyz;
    a += texelFetch(uShapePts, ivec2(ia % uTexW, ia / uTexW), 0).xyz;
    b += texelFetch(uShapePts, ivec2(ib % uTexW, ib / uTexW), 0).xyz;
  }
  if (uLashLen != 1.0 || uLashCurl != 0.0) {
    vec3 r0l = fetchP(s, 0).xyz;
    float upSide = r0l.y > (r0l.x > 0.0 ? uEyeL0.y : uEyeR0.y) ? 1.0 : -1.0; // upper or lower lid
    P.xyz = lashFix(P.xyz, k, r0l, upSide);
    a = lashFix(a, max(k - 1, 0), r0l, upSide);
    b = lashFix(b, min(k + 1, uPoints - 1), r0l, upSide);
  }
  if (uEyeFollow > 0.5) {
    // A closing lid slides round the eyeball: turn the lash about the eye's horizontal axis by the angle its root
    // travelled round the eye centre, so a closed lid's lashes point down, not up across the lid.
    vec3 r0 = fetchP(s, 0).xyz;
    // (round the eye centre where it is now: deep-set or big eyes move it, and the lid moves with it)
    vec3 c = r0.x > 0.0 ? uEyeL : uEyeR;
    vec3 c0 = r0.x > 0.0 ? uEyeL0 : uEyeR0;
    float da = uEyeFollow * (atan(r0.y + off.y - c.y, r0.z + off.z - c.z) - atan(r0.y - c0.y, r0.z - c0.z));
    // and away from skin the face's shape brought towards the lash (a deep-set eye's overhang: followSkin)
    da += rootT.w;
    // and clear of a lid folded down over the lash line (angry, a squint): the baked turn × each target's weight
    vec4 l0 = texelFetch(uLid, ivec2((s * 4) % uTexW, (s * 4) / uTexW), 0);
    vec4 l1 = texelFetch(uLid, ivec2((s * 4 + 1) % uTexW, (s * 4 + 1) / uTexW), 0);
    vec4 l2 = texelFetch(uLid, ivec2((s * 4 + 2) % uTexW, (s * 4 + 2) / uTexW), 0);
    vec4 l3 = texelFetch(uLid, ivec2((s * 4 + 3) % uTexW, (s * 4 + 3) / uTexW), 0);
    da += dot(l0, vec4(uLidW[0], uLidW[1], uLidW[2], uLidW[3])) + dot(l1, vec4(uLidW[4], uLidW[5], uLidW[6], uLidW[7]))
      + dot(l2, vec4(uLidW[8], uLidW[9], uLidW[10], uLidW[11])) + dot(l3, vec4(uLidW[12], uLidW[13], uLidW[14], uLidW[15]));
    float cs = cos(da), sn = sin(da);
    vec3 v;
    v = P.xyz - r0; P.xyz = r0 + vec3(v.x, v.z * sn + v.y * cs, v.z * cs - v.y * sn);
    v = a - r0; a = r0 + vec3(v.x, v.z * sn + v.y * cs, v.z * cs - v.y * sn);
    v = b - r0; b = r0 + vec3(v.x, v.z * sn + v.y * cs, v.z * cs - v.y * sn);
  }
  vec3 T = normalize(b - a + vec3(1e-7));
  float t = float(k) / float(uPoints - 1);
  vec3 pos = P.xyz + off;
  if (c > 0) {
    // a child strand: around its parent, closer towards the tip (clumping), with its own slow wobble
    vec3 ref = normalize(P.xyz - uCentre);
    vec3 n1 = normalize(cross(T, ref));
    vec3 n2 = cross(n1, T);
    float th = hash(id) * 6.2831853;
    float r = uChildR * sqrt(hash(id + 3.1)) * (1.0 - 0.7 * t);
    pos += n1 * cos(th) * r + n2 * abs(sin(th)) * r * 0.5;
    float far = clamp(distance(P.xyz, fetchP(s, 0).xyz) / 0.12, 0.0, 1.0); // wobble by real length, not by t
    pos += n1 * sin(t * (5.0 + 6.0 * hash(id + 5.3)) + hash(id + 7.7) * 6.2831853) * uChildR * 0.3 * far * far;
  }
  if (uFrizz > 0.0) {
    // frizz: every strand wanders off its line, more towards the tip; a few fly away from the head
    float fl = clamp(distance(P.xyz, fetchP(s, 0).xyz) / 0.12, 0.0, 1.0);
    vec3 out2 = normalize(P.xyz - uCentre);
    vec3 m1 = normalize(cross(T, out2));
    vec3 m2 = cross(m1, T);
    float fz = uFrizz * 0.0026 * fl * (0.4 + hash(id + 13.0));
    pos += (m1 * sin(t * 31.0 + hash(id + 2.0) * 6.2831853) + m2 * cos(t * 23.0 + hash(id + 4.0) * 6.2831853)) * fz;
    // a few flyaways (they read as dark pen lines against the backdrop when there are many)
    if (hash(id + 19.0) < 0.03 * uFrizz) pos += out2 * uFrizz * 0.018 * fl * fl * (0.4 + hash(id + 23.0));
  }
  if (uNatural > 0.5 && k < 2) {
    // the root starts under the skin, a different depth for every strand: the skin hides the first stretch, so the hairline
    // is ragged and each strand comes out of the scalp at its own point, instead of starting on it
    float sink = uSink * (0.35 + 1.1 * hash(float(s) * 1.37 + 4.1)) * (k == 0 ? 1.0 : 0.3);
    pos -= normalize(P.xyz - uCentre) * sink;
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 tv = normalize((modelViewMatrix * vec4(T, 0.0)).xyz);
  vec3 side = normalize(cross(tv, normalize(-mv.xyz)));
  float want = uWidth * mix(1.0, uTipW, t) * mix(1.0, mix(0.5, 1.0, smoothstep(0.0, 0.1, t)), uNatural); // a root is finer than its strand
  float w = max(want, uMinPx * (-mv.z) * uPxScale);
  vCover = max(want / w, uCoverMin);
  mv.xyz += side * (0.5 * w * aVert.y);
  gl_Position = projectionMatrix * mv;
  vT = t;
  vRamp = clamp(distance(P.xyz, fetchP(s, 0).xyz) / uRampLen, 0.0, 1.0); // root → tip colour over real length
  vLong = clamp(distance(fetchP(s, uPoints - 1).xyz, fetchP(s, 0).xyz) / 0.15, 0.0, 1.0); // 1 = a long strand
  vShade = P.w;
  vRand = hash(id + 11.0);
  vLock = hash(float(s) * 3.71 + 0.5); // one value per lock: the parent and all its children
  // a child strand fades in over its first few points (each its own distance): the hairline thins out into baby hairs
  // instead of ending in a hard edge where the roots stop
  vRootD = distance(P.xyz, fetchP(s, 0).xyz);
  vRootFade = c > 0 ? smoothstep(0.0, 0.16, t - 0.05 * hash(id + 31.0)) : 1.0;
  if (uNatural > 0.5) {
    // each hair thickens from nothing over its own first few millimetres (up to ~2 cm): along the hairline single hairs
    // come out of the skin and the edge thins into baby hairs; under the hair it is hidden anyway. (alpha = 0.2 + 0.8 × this)
    float fl = 0.003 + 0.017 * hash(id + 57.0);
    vRootFade = (smoothstep(0.0, fl, vRootD) - 0.2) / 0.8;
  }
  vTan = tv;
  vViewPos = mv.xyz;
}
`;

export const FRAGMENT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
uniform vec3 uHairShadow; // root colour, raw sRGB (lib/hair.ts strandColours)
uniform vec3 uHairHighlight; // tip colour, raw sRGB
uniform sampler2D uHairTex; // an uploaded hair texture (lib/surfaceTextures.ts): roots at the top, tips at the bottom …
uniform float uHairTexAmt; // … and how much it counts (0: none)
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uUpView;
uniform float uDiffuse, uSpec1, uSpec2, uShift1, uShift2, uExp1, uExp2, uJitter, uShadowFloor, uTipFade, uTipSpec, uRampAmount;
uniform float uShine, uTT, uGlint, uSheenTint, uLock, uRootDark;
varying float vRootD;
varying float vT;
varying float vRamp;
varying float vLong;
varying float vShade;
varying float vCover;
varying float vRand;
varying float vLock;
varying float vRootFade;
varying vec3 vTan;
varying vec3 vViewPos;

float kk(vec3 T, vec3 H, float e) {
  float th = dot(T, H);
  return pow(sqrt(max(0.0, 1.0 - th * th)), e);
}

void main() {
  vec3 rootC = sRGBTransferEOTF(vec4(uHairShadow, 1.0)).rgb;
  vec3 tipC = sRGBTransferEOTF(vec4(uHairHighlight, 1.0)).rgb;
  vec3 albedo = mix(rootC, tipC, pow(vRamp, 0.8) * uRampAmount);
  // each strand (and child) one column of the texture, root to tip along its length (lib/export/strands.ts samples the same)
  if (uHairTexAmt > 0.0) albedo = mix(albedo, texture2D(uHairTex, vec2(vRand, vT)).rgb, uHairTexAmt);
  albedo *= 1.0 + (vRand - 0.5) * uJitter;
  vec3 T = normalize(vTan);
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(V - T * dot(V, T));
  float shade = mix(uShadowFloor, 1.0, vShade) * mix(1.0, 0.7 + 0.5 * vLock, uLock); // locks: some darker, some lit
  shade *= mix(1.0 - uRootDark, 1.0, smoothstep(0.0, 0.035, vRootD)); // the roots lie in the scalp's shadow: the hair has depth
  vec3 colour = albedo * mix(uGround, uSky, 0.5 + 0.5 * dot(N, uUpView)) * shade;
  // glints: the secondary highlight sparkles along the strand (its scales catch the light unevenly)
  float glint = mix(1.0, 0.35 + 1.3 * fract(sin(floor(vT * 36.0 + vRand * 91.0) * 12.9898) * 43758.5453), uGlint);
  // dark hair's highlights are blue-white (a black mirror shows the sky), light hair's follow its own colour
  vec3 sheenC = mix(vec3(1.0), vec3(0.7, 0.84, 1.18), clamp(1.0 - 3.0 * dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * uSheenTint);
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 L = directionalLights[i].direction;
    vec3 Lc = directionalLights[i].color;
    float tl = dot(T, L);
    float diff = sqrt(max(0.0, 1.0 - tl * tl)) * (0.35 + 0.65 * clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0));
    vec3 H = normalize(L + V);
    float s1 = kk(normalize(T + N * (uShift1 + (vRand - 0.5) * 0.08)), H, uExp1);
    float s2 = kk(normalize(T + N * uShift2), H, uExp2);
    float facing = smoothstep(-0.3, 0.4, dot(N, L));
    colour += Lc * shade * (albedo * diff * uDiffuse + facing * uShine * (uSpec1 * mix(1.0, uTipSpec, vRamp) * sheenC * s1 + uSpec2 * s2 * glint * albedo));
    // light through the strand from behind (the rims): a warm glow on the edges of the hair
    float back = pow(clamp(dot(-L, V), 0.0, 1.0), 4.0);
    colour += Lc * albedo * back * uTT * (0.6 + 0.4 * vRand) * sqrt(albedo + 0.02);
  }
  #endif
  // Long hair thins out at the tips; short hair ends bluntly (faded short tips dither into speckle).
  float alpha = vCover * mix(0.2, 1.0, vRootFade) * (1.0 - uTipFade * vLong * smoothstep(0.85, 1.0, vT));
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
