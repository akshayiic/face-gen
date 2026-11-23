"use client";

/**
 * Style tab → Colouring → Eyes and lashes: eye liner (strength, wing, colour), lid shadow (strength, colour) and the
 * lashes' length, curl and fullness. State in lib/skinDetails.ts (part of the skin details: the config file and the
 * rebuild link carry it); the skin shader draws the makeup (lib/skinShader.ts), the lash strands take the lash settings
 * (lib/lashLook.ts, lib/addons.ts). The lash style itself is chosen under Hair, brows and beard.
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { type Swatch, SwatchRow } from "@/components/ui/SwatchRow";
import { onSkinDetailsChange, setSkinDetails, SKIN_DETAILS_DEFAULTS as D, SKIN_DETAILS_SERVER_SNAPSHOT, skinDetailsSnapshot } from "@/lib/skinDetails";

export const EYE_LINER_SHADES: readonly Swatch<string>[] = [
  { id: "#1c1517", label: "Black", hex: "#1c1517" },
  { id: "#3a2a24", label: "Brown", hex: "#3a2a24" },
  { id: "#3a2230", label: "Plum", hex: "#3a2230" },
  { id: "#1f2840", label: "Navy", hex: "#1f2840" },
  { id: "#1f3a2c", label: "Forest", hex: "#1f3a2c" },
];

export const EYE_SHADOW_SHADES: readonly Swatch<string>[] = [
  { id: "#7a5a52", label: "Taupe", hex: "#7a5a52" },
  { id: "#c88a6a", label: "Peach", hex: "#c88a6a" },
  { id: "#b0707a", label: "Rose", hex: "#b0707a" },
  { id: "#8a6038", label: "Bronze", hex: "#8a6038" },
  { id: "#8e6a86", label: "Mauve", hex: "#8e6a86" },
  { id: "#3e3a44", label: "Smoky grey", hex: "#3e3a44" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
const off = (on: boolean) => (on ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity");

export function EyeMakeupControl() {
  const s = useSyncExternalStore(onSkinDetailsChange, skinDetailsSnapshot, () => SKIN_DETAILS_SERVER_SNAPSHOT);
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Eyes and lashes</span>
      </div>
      <RangeRow label="Eye liner" value={s.eyeLiner} min={0} max={1} step={0.05} reset={D.eyeLiner} low="none" high="bold, smoky" format={pct} onChange={(eyeLiner) => setSkinDetails({ eyeLiner })} />
      <div className={off(s.eyeLiner > 0)} aria-disabled={s.eyeLiner <= 0 || undefined}>
        <RangeRow label="Wing" value={s.eyeLinerWing} min={0} max={1} step={0.05} reset={D.eyeLinerWing} low="none" high="long" format={pct} onChange={(eyeLinerWing) => setSkinDetails({ eyeLinerWing })} />
        <SwatchRow title="Liner colour" groupLabel="Eye liner colour" swatches={EYE_LINER_SHADES} current={s.eyeLinerColour} onChoose={(eyeLinerColour) => setSkinDetails({ eyeLinerColour })} />
      </div>
      <RangeRow label="Eye shadow" value={s.eyeShadow} min={0} max={1} step={0.05} reset={D.eyeShadow} low="none" high="deep" format={pct} onChange={(eyeShadow) => setSkinDetails({ eyeShadow })} />
      <div className={off(s.eyeShadow > 0)} aria-disabled={s.eyeShadow <= 0 || undefined}>
        <SwatchRow title="Shadow colour" groupLabel="Eye shadow colour" swatches={EYE_SHADOW_SHADES} current={s.eyeShadowColour} onChoose={(eyeShadowColour) => setSkinDetails({ eyeShadowColour })} />
      </div>
      <RangeRow label="Lash length" value={s.lashLength} min={0.6} max={1.8} step={0.05} reset={D.lashLength} low="short" high="very long" mid format={times} onChange={(lashLength) => setSkinDetails({ lashLength })} />
      <RangeRow label="Lash curl" value={s.lashCurl} min={-1} max={1} step={0.05} reset={D.lashCurl} low="straight, drooping" high="curled up" mid format={signed} onChange={(lashCurl) => setSkinDetails({ lashCurl })} />
      <RangeRow label="Lash fullness" value={s.lashDensity} min={0} max={2} step={0.05} reset={D.lashDensity} low="sparse" high="very full" mid format={times} onChange={(lashDensity) => setSkinDetails({ lashDensity })} />
      <RangeRow label="Neat lashes" value={s.lashNeat} min={0} max={1} step={0.05} reset={D.lashNeat} low="natural" high="neat and clean" format={(v) => `${Math.round(v * 100)}%`} onChange={(lashNeat) => setSkinDetails({ lashNeat })} />
      <RangeRow label="Eyebrow fullness" value={s.browFullness} min={0} max={2} step={0.05} reset={D.browFullness} low="sparse" high="very full" format={(v) => `×${v.toFixed(2)}`} onChange={(browFullness) => setSkinDetails({ browFullness })} />
    </>
  );
}
