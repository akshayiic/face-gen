/**
 * Quality tiers: high / medium / low. A plain store (no React): the start tier comes from a quick device probe ("Auto"),
 * drei's PerformanceMonitor drops it a step when the frame rate sags (Scene.tsx), and the visitor can pin one: the
 * Quality choice in the Camera block (kept on this device) or `?quality=high|medium|low` in the address (which wins).
 * A pinned tier never drops. Each feature reads its switch from TIERS, so tuning what a tier costs happens in one table.
 *
 * Order of sacrifice on a slow device: detail normals first, then texture sizes (the low
 * tier downloads the @512 maps), and last the canvas resolution (Scene.tsx). No tier uses screen-space AO (three's
 * GTAOPass): it shows no visible gain over the baked AO, and its post chain washes the picture out.
 *
 * The realism features by tier: the key light's shadow map (size in texels, 0 = off), hair shadows on the skin and
 * clothes (lib/hairShadow.ts), and the camera finish (lib/finish.ts) with its depth-of-field taps.
 */
export type Tier = "high" | "medium" | "low";

export const TIERS = {
  high: { detailNormals: true, textureSize: 1024, shadowMap: 2048, hairShadow: true, finish: true, dofTaps: 24 },
  medium: { detailNormals: true, textureSize: 1024, shadowMap: 1024, hairShadow: true, finish: true, dofTaps: 12 },
  low: { detailNormals: false, textureSize: 512, shadowMap: 0, hairShadow: false, finish: false, dofTaps: 0 },
} as const;

const ORDER: Tier[] = ["low", "medium", "high"];

/** The visitor's pick: the device's own ("auto") or a tier. */
export type QualityChoice = "auto" | Tier;

/** `auto`: the tier the probe chose for this device (what "Auto" returns to); `choice`: what is picked now. */
export const quality = { tier: "medium" as Tier, pinned: false, probed: false, auto: "medium" as Tier, choice: "auto" as QualityChoice };

const SAVED = "ftv-quality";
const isTier = (v: unknown): v is Tier => v === "high" || v === "medium" || v === "low";
const choiceListeners = new Set<() => void>();
/** Fires when the pick changes (the tier's own changes are onTier). */
export function onQualityChoice(fn: () => void): () => void {
  choiceListeners.add(fn);
  return () => choiceListeners.delete(fn);
}

/**
 * Pick a tier ("auto": the device's own, which may drop again if the frame rate sags). Kept on this device (localStorage),
 * so the next visit starts there. A `?quality=` in the address still wins at load.
 */
export function setQualityChoice(choice: QualityChoice): void {
  quality.choice = choice;
  quality.pinned = choice !== "auto";
  try {
    if (typeof window !== "undefined") {
      if (choice === "auto") window.localStorage.removeItem(SAVED);
      else window.localStorage.setItem(SAVED, choice);
    }
  } catch {
    /* private mode: for this visit only */
  }
  setTier(choice === "auto" ? quality.auto : choice);
  for (const fn of choiceListeners) fn();
}

const listeners = new Set<(tier: Tier) => void>();
export function onTier(fn: (tier: Tier) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const tierSettings = () => TIERS[quality.tier];

export function setTier(tier: Tier): void {
  if (tier === quality.tier) return;
  quality.tier = tier;
  for (const fn of listeners) fn(tier);
}

/** One step down (PerformanceMonitor decline). False when already at the bottom or pinned. */
export function dropTier(): boolean {
  const i = ORDER.indexOf(quality.tier);
  if (quality.pinned || i <= 0) return false;
  setTier(ORDER[i - 1]);
  return true;
}

/**
 * The start tier from what the device tells us (Scene.tsx calls this once, with the WebGL context). Phones and
 * tablets start at medium, small-memory or software/old mobile GPUs at low, desktops with a real GPU at high.
 */
export function probeTier(gl: WebGLRenderingContext | WebGL2RenderingContext): Tier {
  if (quality.probed) return quality.tier;
  quality.probed = true;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const weakGpu = /swiftshader|llvmpipe|software|mali-[gt][0-7]\d|adreno \(tm\) [3-5]\d\d|powervr|intel\(r\) (hd|uhd) graphics [2-6]\d\d/.test(renderer);
  const tier: Tier = weakGpu || memory <= 2 ? "low" : touch || memory <= 4 ? "medium" : "high";
  quality.auto = tier;
  // a pick wins over the probe: the address's, then the one kept on this device
  let pick: unknown = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("quality") : null;
  if (!isTier(pick)) {
    try {
      pick = typeof window !== "undefined" ? window.localStorage.getItem(SAVED) : null;
    } catch {
      pick = null;
    }
  }
  if (isTier(pick)) {
    quality.pinned = true;
    quality.choice = pick;
    setTier(pick);
    return pick;
  }
  setTier(tier);
  return tier;
}
