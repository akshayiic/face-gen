/**
 * "Realistic skin" (Style tab → Colouring): one choice that sets the settings which together make skin read as skin
 * and not as a smooth shell: the fine skin texture (lib/skinMicro.ts), pore depth, uneven tone, veins, pink eye rims,
 * lip lines, the shadow under the eyes and a touch of broken capillaries. Each preset sets all of them, so switching
 * between them is exact; anything else (blush, freckles, makeup, age …) is left as the visitor set it. Moving any of
 * these sliders by hand afterwards leaves no preset chosen ("Custom").
 *
 * The values were set by comparison with a studio-grade face (a skin pack's maps: its colour is smooth, nearly all the
 * fine detail is in a normal map, the lips are glossier than the cheeks, the lids are pink and shaded).
 */
import type { SkinDetails } from "@/lib/skinDetails";

export type RealismKeys = "microDetail" | "pores" | "variation" | "veins" | "eyeRims" | "lipLines" | "underEye" | "capillaries";
export type RealismPatch = Pick<SkinDetails, RealismKeys>;

export const REALISM_PRESETS: { id: string; label: string; tip: string; patch: RealismPatch }[] = [
  { id: "off", label: "Smooth", tip: "Plain smooth skin", patch: { microDetail: 0, pores: 1, variation: 1, veins: 0.4, eyeRims: 0.25, lipLines: 0, underEye: 1, capillaries: 0 } },
  { id: "natural", label: "Natural", tip: "Fine texture, a little pore and tone detail", patch: { microDetail: 0.6, pores: 1.1, variation: 1.1, veins: 0.4, eyeRims: 0.3, lipLines: 0.3, underEye: 1.05, capillaries: 0 } },
  { id: "realistic", label: "Realistic", tip: "Fine texture, visible pores, lip lines, pink lids", patch: { microDetail: 1, pores: 1.3, variation: 1.3, veins: 0.5, eyeRims: 0.45, lipLines: 0.6, underEye: 1.15, capillaries: 0.1 } },
  { id: "hyper", label: "Hyper-real", tip: "Everything up: close-up skin", patch: { microDetail: 1.6, pores: 1.6, variation: 1.5, veins: 0.6, eyeRims: 0.6, lipLines: 1, underEye: 1.3, capillaries: 0.2 } },
];

/** The preset these settings match (every value within a hair), or null for a custom mix. */
export function detectRealism(d: SkinDetails): string | null {
  for (const p of REALISM_PRESETS) {
    if ((Object.keys(p.patch) as RealismKeys[]).every((k) => Math.abs(d[k] - p.patch[k]) < 0.011)) return p.id;
  }
  return null;
}
