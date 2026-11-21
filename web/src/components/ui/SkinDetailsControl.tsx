"use client";

/**
 * Skin details (Style tab → Colouring): blush, freckles, moles (how many, how big, shuffle where), pores, the shadow
 * under the eyes, tone variation and veins; wrinkles and expression lines; weathering (sun damage, sun spots, broken
 * capillaries, oiliness, sweat, grime). State in lib/skinDetails.ts, pushed straight into the skin shader.
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import {
  onSkinDetailsChange,
  setSkinDetails,
  shuffleMoles,
  SKIN_DETAILS_DEFAULTS as D,
  SKIN_DETAILS_SERVER_SNAPSHOT,
  skinDetailsSnapshot,
} from "@/lib/skinDetails";
import { MAX_MOLES } from "@/lib/skinShader";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;

export function SkinDetailsControl() {
  const s = useSyncExternalStore(onSkinDetailsChange, skinDetailsSnapshot, () => SKIN_DETAILS_SERVER_SNAPSHOT);
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Skin details</span>
      </div>
      <RangeRow label="Blush" value={s.blush} min={0} max={1} step={0.05} reset={D.blush} low="none" high="flushed" format={pct} onChange={(blush) => setSkinDetails({ blush })} />
      <RangeRow label="Freckles" value={s.freckles} min={0} max={1} step={0.05} reset={D.freckles} low="none" high="many" format={pct} onChange={(freckles) => setSkinDetails({ freckles })} />
      <RangeRow label="Moles" value={s.moles} min={0} max={MAX_MOLES} step={1} reset={D.moles} low="none" high={String(MAX_MOLES)} format={(v) => String(v)} onChange={(moles) => setSkinDetails({ moles })} />
      <div className={s.moles ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.moles || undefined}>
        <RangeRow label="Mole size" value={s.moleSize} min={0} max={1} step={0.05} reset={D.moleSize} low="small" high="large" format={pct} onChange={(moleSize) => setSkinDetails({ moleSize })} />
        <div className="px-5 pb-2">
          <button type="button" onClick={shuffleMoles} className="pill-secondary h-8 px-3 text-label">
            Move the moles
          </button>
        </div>
      </div>
      <RangeRow label="Pores" value={s.pores} min={0} max={2} step={0.05} reset={D.pores} low="smooth" high="deep" mid format={times} onChange={(pores) => setSkinDetails({ pores })} />
      <RangeRow label="Under the eyes" value={s.underEye} min={0} max={2} step={0.05} reset={D.underEye} low="bright" high="dark circles" mid format={times} onChange={(underEye) => setSkinDetails({ underEye })} />
      <RangeRow label="Tone variation" value={s.variation} min={0} max={2} step={0.05} reset={D.variation} low="even" high="blotchy" mid format={times} onChange={(variation) => setSkinDetails({ variation })} />
      <RangeRow label="Veins" value={s.veins} min={0} max={1} step={0.05} reset={D.veins} low="hidden" high="visible" format={pct} onChange={(veins) => setSkinDetails({ veins })} />
      <RangeRow label="Wrinkles" value={s.wrinkles} min={0} max={1.5} step={0.05} reset={D.wrinkles} low="smooth" high="deep lines" format={pct} onChange={(wrinkles) => setSkinDetails({ wrinkles })} />
      <RangeRow label="Expression lines" value={s.expression} min={0} max={2} step={0.05} reset={D.expression} low="none" high="deep creases" mid format={times} onChange={(expression) => setSkinDetails({ expression })} />
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Weathering</span>
      </div>
      <RangeRow label="Sun damage" value={s.sun} min={0} max={1} step={0.05} reset={D.sun} low="none" high="leathery" format={pct} onChange={(sun) => setSkinDetails({ sun })} />
      <RangeRow label="Sun spots" value={s.sunSpots} min={0} max={1} step={0.05} reset={D.sunSpots} low="none" high="many" format={pct} onChange={(sunSpots) => setSkinDetails({ sunSpots })} />
      <RangeRow label="Broken capillaries" value={s.capillaries} min={0} max={1} step={0.05} reset={D.capillaries} low="none" high="many" format={pct} onChange={(capillaries) => setSkinDetails({ capillaries })} />
      <RangeRow label="Oiliness" value={s.oiliness} min={0} max={2} step={0.05} reset={D.oiliness} low="matte" high="greasy" mid format={times} onChange={(oiliness) => setSkinDetails({ oiliness })} />
      <RangeRow label="Sweat" value={s.sweat} min={0} max={1} step={0.05} reset={D.sweat} low="dry" high="dripping" format={pct} onChange={(sweat) => setSkinDetails({ sweat })} />
      <RangeRow label="Grime" value={s.grime} min={0} max={1} step={0.05} reset={D.grime} low="clean" high="filthy" format={pct} onChange={(grime) => setSkinDetails({ grime })} />
    </>
  );
}
