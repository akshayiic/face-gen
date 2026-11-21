"use client";

/**
 * Studio lighting with zero downloads. The environment is a small procedural photo studio built from glowing
 * panels and rendered once through PMREM: a big warm softbox front-left (the key), a dimmer card on the right (the
 * fill), two tall strips behind the head (the rims that outline the hair and jaw), a soft top light, and a warm floor
 * bounce, all in a dim room. Skin, eyes and hair pick up soft reflections of these shapes. Three directional lights
 * add crisp shape on top: key, fill and rim, matching the panels. The key casts a soft shadow (one small shadow map on
 * the medium and high tiers, lib/quality.ts): the nose on the cheek, the jaw on the neck, the lids on the eyes, the
 * collar on the throat. Hair can't go into it (custom strands): lib/hairShadow.ts shades the skin under it. Contact
 * darkness comes from the baked AO (lib/skinShader.ts).
 *
 * Tweak the numbers in LIGHTING. `__faceToVoice.lighting.rig.toneMapping("agx" | "aces" |
 * "neutral", exposure)` switches tone mapping live for comparisons.
 *
 * The light (Style tab → Camera, lib/finishSettings.ts `light`) swaps the three lights for a preset in LIGHT_PRESETS:
 * the soft studio above, a hard sun from high in front (deep shade under the brows, nose and chin, crisp shadow edges:
 * the light that shows every pore and line), or a low side light (half the face in shadow).
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type ToneMapping,
  type WebGLRenderer,
} from "three";

import { setCorneaEnvironment } from "@/lib/eyeShader";
import { finishSettings, type LightPreset, onFinishChange } from "@/lib/finishSettings";
import { revealedSnapshot, subscribeRevealed } from "@/lib/headLoad";
import { onTier, tierSettings } from "@/lib/quality";

type V3 = [number, number, number];
type Panel = { position: V3; size: [number, number]; color: string; intensity: number };

export const LIGHTING = {
  // ACES looks the most natural at matched face brightness (Neutral turns the skin orange-peach, AgX grey). The
  // exposure is high because the studio is dim and the key is the main light, not the environment.
  toneMapping: "aces" as ToneMappingName,
  exposure: 1.4,
  environmentIntensity: 0.5,
  /** The procedural studio seen by reflections and image-based light (metres, around the head). */
  studio: {
    room: "#1a1816", // the studio's walls: dark, so the panels do the lighting
    roomIntensity: 1,
    panels: {
      key: { position: [-2.4, 1.9, 2.4], size: [2.4, 2.4], color: "#fff1e2", intensity: 5.5 },
      fill: { position: [2.8, 0.5, 2.0], size: [2.4, 2.0], color: "#eef0f4", intensity: 1.4 },
      // the rims: strongest on the far side from the key, so hair and jaw separate from the backdrop
      rimLeft: { position: [-2.0, 1.4, -2.6], size: [0.6, 3.0], color: "#e8eeff", intensity: 2.5 },
      rimRight: { position: [2.2, 1.4, -2.4], size: [0.7, 3.2], color: "#e8eeff", intensity: 7 },
      top: { position: [0, 3.2, 0.2], size: [1.6, 1.6], color: "#ffffff", intensity: 0.8 },
      floor: { position: [0, -2.4, 1.0], size: [5.0, 5.0], color: "#d9c3ad", intensity: 0.22 },
    } satisfies Record<string, Panel>,
  },
  /** Directional lights for crisp shape (they also make the speculars that the panels only blur). */
  key: { position: [-1.3, 1.3, 2.0] as V3, intensity: 1.8, color: "#fff4ea" },
  fill: { position: [1.8, 0.3, 0.9] as V3, intensity: 0.3, color: "#e8ecf2" },
  rim: { position: [1.3, 1.4, -1.7] as V3, intensity: 1.6, color: "#eef3ff" },
  /** The key's shadow: a square this big round the head (half its side, m), its depth range, how soft its edge is (mm,
   * a big softbox) and the biases that keep the skin from shadowing itself. */
  keyShadow: { half: 0.34, near: 1.4, far: 3.9, softMm: 2.5, bias: -0.0002, normalBias: 0.0012 },
  /** What the lights aim at (the middle of the face), so their direction does not depend on the origin. */
  target: [0, 0.27, 0.05] as V3,
};

type Light = { position: V3; intensity: number; color: string };
type Preset = { key: Light; fill: Light; rim: Light; environmentIntensity: number; exposure: number; softMm: number };
const studioPreset = (): Preset => ({
  key: { ...LIGHTING.key }, fill: { ...LIGHTING.fill }, rim: { ...LIGHTING.rim },
  environmentIntensity: LIGHTING.environmentIntensity, exposure: LIGHTING.exposure, softMm: LIGHTING.keyShadow.softMm,
});

/** The lights for each preset (the studio is LIGHTING as it ships). */
export const LIGHT_PRESETS: Record<LightPreset, Preset> = {
  studio: studioPreset(),
  sun: {
    key: { position: [-0.45, 2.7, 1.5], intensity: 3.2, color: "#fff0dc" },
    fill: { position: [1.8, 0.3, 0.9], intensity: 0.12, color: "#dfe6f2" },
    rim: { position: [1.3, 1.4, -1.7], intensity: 0.9, color: "#fff4e6" },
    environmentIntensity: 0.28,
    exposure: 1.3,
    softMm: 0.8,
  },
  side: {
    key: { position: [-2.4, 0.9, 0.5], intensity: 2.6, color: "#ffeedd" },
    fill: { position: [1.8, 0.3, 0.9], intensity: 0.06, color: "#e8ecf2" },
    rim: { position: [1.6, 1.2, -1.6], intensity: 2.2, color: "#e8eeff" },
    environmentIntensity: 0.22,
    exposure: 1.35,
    softMm: 1.5,
  },
};

/** Put a preset's lights into LIGHTING and onto the scene. */
export function applyLightPreset(name: LightPreset): void {
  const p = LIGHT_PRESETS[name] ?? LIGHT_PRESETS.studio;
  LIGHTING.key = { ...p.key };
  LIGHTING.fill = { ...p.fill };
  LIGHTING.rim = { ...p.rim };
  LIGHTING.environmentIntensity = p.environmentIntensity;
  LIGHTING.exposure = p.exposure;
  LIGHTING.keyShadow.softMm = p.softMm;
  lightingRig.apply();
}

/**
 * The key's shadow map for the current tier (none on low), once the head is revealed: the loader's bubble morph moves
 * vertices in the shader (lib/morphShader.ts), which the shadow's depth pass doesn't see.
 */
function applyKeyShadow(light: DirectionalLight): void {
  const size = tierSettings().shadowMap;
  light.castShadow = size > 0 && revealedSnapshot();
  if (!size) return;
  const s = LIGHTING.keyShadow;
  const cam = light.shadow.camera;
  cam.left = cam.bottom = -s.half;
  cam.right = cam.top = s.half;
  cam.near = s.near;
  cam.far = s.far;
  cam.updateProjectionMatrix();
  if (light.shadow.mapSize.x !== size) {
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }
  light.shadow.radius = s.softMm / 1000 / ((2 * s.half) / size); // in texels
  light.shadow.bias = s.bias;
  light.shadow.normalBias = s.normalBias;
}

export type ToneMappingName = "agx" | "aces" | "neutral";
const TONE: Record<ToneMappingName, ToneMapping> = { agx: AgXToneMapping, aces: ACESFilmicToneMapping, neutral: NeutralToneMapping };

/**
 * Live tuning (debug handle): edit LIGHTING, then `apply()` (lights, exposure, environment strength) or `rebuild()`
 * (the studio panels). `toneMapping(name, exposure)` switches tone mapping; materials recompile on the next frame.
 */
export const lightingRig = {
  gl: null as WebGLRenderer | null,
  scene: null as Scene | null,
  lights: {} as Partial<Record<"key" | "fill" | "rim", DirectionalLight>>,
  rebuildStudio: null as null | (() => void),
  toneMapping(name: ToneMappingName = LIGHTING.toneMapping, exposure = LIGHTING.exposure): void {
    LIGHTING.toneMapping = name;
    LIGHTING.exposure = exposure;
    const gl = lightingRig.gl;
    if (!gl) return;
    gl.toneMapping = TONE[name];
    gl.toneMappingExposure = exposure;
  },
  apply(): void {
    lightingRig.toneMapping();
    if (lightingRig.scene) {
      lightingRig.scene.environmentIntensity = LIGHTING.environmentIntensity;
      setCorneaEnvironment(lightingRig.scene);
    }
    for (const k of ["key", "fill", "rim"] as const) {
      const light = lightingRig.lights[k];
      if (!light) continue;
      light.position.set(...LIGHTING[k].position);
      light.intensity = LIGHTING[k].intensity;
      light.color.set(LIGHTING[k].color);
    }
    if (lightingRig.lights.key) applyKeyShadow(lightingRig.lights.key);
  },
  rebuild(): void {
    lightingRig.rebuildStudio?.();
  },
};

/** The studio as a tiny three scene: a dim box room with emissive panels facing the head. */
function studioScene(): Scene {
  const s = LIGHTING.studio;
  const scene = new Scene();
  const room = new Mesh(new BoxGeometry(10, 8, 10), new MeshBasicMaterial({ color: new Color(s.room).multiplyScalar(s.roomIntensity), side: DoubleSide }));
  room.position.y = 1;
  scene.add(room);
  for (const p of Object.values(s.panels)) {
    const panel = new Mesh(new PlaneGeometry(...p.size), new MeshBasicMaterial({ color: new Color(p.color).multiplyScalar(p.intensity), side: DoubleSide }));
    panel.position.set(...p.position);
    panel.lookAt(0, 0.27, 0);
    scene.add(panel);
  }
  return scene;
}

/** Tone mapping + the studio environment on the renderer and scene; returns the cleanup. */
function installStudio(gl: WebGLRenderer, scene: Scene): () => void {
  lightingRig.gl = gl;
  lightingRig.scene = scene;
  lightingRig.toneMapping();
  let env: Texture | null = null;
  const build = () => {
    const pmrem = new PMREMGenerator(gl);
    const studio = studioScene();
    env?.dispose();
    env = pmrem.fromScene(studio, 0.03).texture;
    scene.environment = env;
    scene.environmentIntensity = LIGHTING.environmentIntensity;
    setCorneaEnvironment(scene); // the cornea's own copy, so its brightness applies (lib/eyeShader.ts)
    pmrem.dispose();
    studio.traverse((o) => {
      if ((o as Mesh).isMesh) {
        (o as Mesh).geometry.dispose();
        ((o as Mesh).material as MeshBasicMaterial).dispose();
      }
    });
  };
  build();
  lightingRig.rebuildStudio = build;
  // The environment exists only on the GPU (a render target): a lost context (sleep, a GPU reset) takes it with it and
  // three restores it empty, which leaves the head darker and flat. Rendered again once three has restored its state.
  const canvas = gl.domElement;
  canvas.addEventListener("webglcontextrestored", build);
  return () => {
    canvas.removeEventListener("webglcontextrestored", build);
    scene.environment = null;
    env?.dispose();
    lightingRig.gl = lightingRig.scene = lightingRig.rebuildStudio = null;
  };
}

export function Lighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => installStudio(gl, scene), [gl, scene]);

  // Every directional light aims at the head, not the origin.
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  useEffect(() => {
    lightingRig.lights = { key: key.current ?? undefined, fill: fill.current ?? undefined, rim: rim.current ?? undefined };
    const lights = [key.current, fill.current, rim.current].filter((l): l is DirectionalLight => !!l);
    for (const light of lights) {
      light.target.position.set(...LIGHTING.target);
      scene.add(light.target);
    }
    const keyLight = key.current;
    if (keyLight) applyKeyShadow(keyLight);
    const offTier = onTier(() => keyLight && applyKeyShadow(keyLight));
    const offRevealed = subscribeRevealed(() => keyLight && applyKeyShadow(keyLight));
    // the light preset (Style tab → Camera)
    let preset = finishSettings.light;
    if (preset !== "studio") applyLightPreset(preset);
    const offPreset = onFinishChange(() => {
      if (finishSettings.light === preset) return;
      preset = finishSettings.light;
      applyLightPreset(preset);
    });
    return () => {
      offTier();
      offRevealed();
      offPreset();
      for (const light of lights) scene.remove(light.target);
      lightingRig.lights = {};
    };
  }, [scene]);

  return (
    <>
      <directionalLight ref={key} position={LIGHTING.key.position} intensity={LIGHTING.key.intensity} color={LIGHTING.key.color} />
      <directionalLight ref={fill} position={LIGHTING.fill.position} intensity={LIGHTING.fill.intensity} color={LIGHTING.fill.color} />
      <directionalLight ref={rim} position={LIGHTING.rim.position} intensity={LIGHTING.rim.intensity} color={LIGHTING.rim.color} />
    </>
  );
}
