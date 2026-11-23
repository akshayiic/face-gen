"use client";

/**
 * Lip makeup (Style tab → Colouring): lipstick shade and how much of it, a lip liner (strength and colour; automatic is
 * a darker shade of the lipstick or of the lips' own colour) and the finish, matte to high gloss. State in
 * lib/skinDetails.ts (it is part of the skin details, so the config file and the rebuild link carry it); the skin
 * shader draws it on the lips' region (lib/skinShader.ts).
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { type Swatch, SwatchRow } from "@/components/ui/SwatchRow";
import {
  onSkinDetailsChange,
  setSkinDetails,
  SKIN_DETAILS_DEFAULTS as D,
  SKIN_DETAILS_SERVER_SNAPSHOT,
  skinDetailsSnapshot,
} from "@/lib/skinDetails";

/** Lipstick shades; "" (none) leaves the lips as the skin tone makes them. */
export const LIP_SHADES: readonly Swatch<string>[] = [
  { id: "", label: "None (natural)", hex: "#d9a79a" },
  { id: "#e8a598", label: "Nude peach", hex: "#e8a598" },
  { id: "#d68a86", label: "Dusty rose", hex: "#d68a86" },
  { id: "#c96f7c", label: "Soft pink", hex: "#c96f7c" },
  { id: "#e0607a", label: "Bright pink", hex: "#e0607a" },
  { id: "#c8475f", label: "Berry", hex: "#c8475f" },
  { id: "#c23b3b", label: "Classic red", hex: "#c23b3b" },
  { id: "#a41f2e", label: "Deep red", hex: "#a41f2e" },
  { id: "#8c2a3c", label: "Wine", hex: "#8c2a3c" },
  { id: "#6e2a3a", label: "Plum", hex: "#6e2a3a" },
  { id: "#b6573a", label: "Terracotta", hex: "#b6573a" },
  { id: "#8a5a4a", label: "Mocha", hex: "#8a5a4a" },
  { id: "#e87a4a", label: "Coral", hex: "#e87a4a" },
  { id: "#5a2d52", label: "Dark violet", hex: "#5a2d52" },
];

/** Liner colours; "" is automatic. */
export const LINER_SHADES: readonly Swatch<string>[] = [
  { id: "", label: "Automatic (darker lipstick)", hex: "#7a4a44" },
  { id: "#5e2f2f", label: "Brown", hex: "#5e2f2f" },
  { id: "#7a2a3a", label: "Berry", hex: "#7a2a3a" },
  { id: "#8a1f2a", label: "Red", hex: "#8a1f2a" },
  { id: "#a8606a", label: "Rose", hex: "#a8606a" },
  { id: "#3a2230", label: "Plum", hex: "#3a2230" },
  { id: "#1c1517", label: "Black", hex: "#1c1517" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;

export function LipMakeupControl() {
  const s = useSyncExternalStore(onSkinDetailsChange, skinDetailsSnapshot, () => SKIN_DETAILS_SERVER_SNAPSHOT);
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Lips</span>
      </div>
      <SwatchRow title="Lipstick" groupLabel="Lipstick shade" swatches={LIP_SHADES} current={s.lipColour} onChoose={(lipColour) => setSkinDetails({ lipColour })} />
      <div className={s.lipColour ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.lipColour || undefined}>
        <RangeRow label="Lipstick strength" value={s.lipOpacity} min={0} max={1} step={0.05} reset={D.lipOpacity} low="sheer" high="opaque" format={pct} onChange={(lipOpacity) => setSkinDetails({ lipOpacity })} />
      </div>
      <RangeRow label="Lip liner" value={s.lipLiner} min={0} max={1} step={0.05} reset={D.lipLiner} low="none" high="bold outline" format={pct} onChange={(lipLiner) => setSkinDetails({ lipLiner })} />
      <div className={s.lipLiner ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.lipLiner || undefined}>
        <SwatchRow title="Liner colour" groupLabel="Lip liner colour" swatches={LINER_SHADES} current={s.lipLinerColour} onChoose={(lipLinerColour) => setSkinDetails({ lipLinerColour })} />
      </div>
      <RangeRow label="Lip lines" value={s.lipLines} min={0} max={1.5} step={0.05} reset={D.lipLines} low="smooth" high="deeply lined" format={(v) => pct(v / 1.5)} onChange={(lipLines) => setSkinDetails({ lipLines })} />
      <RangeRow label="Lip finish" value={s.lipGloss} min={0} max={2} step={0.05} reset={D.lipGloss} low="matte" high="high gloss" mid format={times} onChange={(lipGloss) => setSkinDetails({ lipGloss })} />
    </>
  );
}
