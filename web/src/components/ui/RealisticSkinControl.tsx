"use client";

/**
 * Style tab → Colouring → Realistic skin: a preset (Smooth, Natural, Realistic, Hyper-real) that sets the group of
 * settings that make skin read as skin (lib/skinRealism.ts), the fine skin texture's strength, and, if you have one,
 * your own tileable micro normal map for it (lib/skinMicro.ts): read in the browser, kept in this tab and the config
 * file, never uploaded. Medium and high quality only (the fine texture is a second layer of detail normals).
 */
import { useSyncExternalStore } from "react";

import { RadioGroup } from "@/components/ui/RadioGroup";
import { RangeRow } from "@/components/ui/RangeRow";
import { UploadRow } from "@/components/ui/TextureControls";
import { onTier, quality } from "@/lib/quality";
import { detectRealism, REALISM_PRESETS } from "@/lib/skinRealism";
import { onSkinDetailsChange, setSkinDetails, SKIN_DETAILS_DEFAULTS as D, SKIN_DETAILS_SERVER_SNAPSHOT, skinDetailsSnapshot } from "@/lib/skinDetails";
import { MICRO_SERVER_SNAPSHOT, microSnapshot, onMicroChange, removeMicro, setMicroInvert, setMicroTile, uploadMicro } from "@/lib/skinMicro";

const times = (v: number) => `×${v.toFixed(2)}`;
const subscribeTier = (fn: () => void) => onTier(fn);

export function RealisticSkinControl() {
  const s = useSyncExternalStore(onSkinDetailsChange, skinDetailsSnapshot, () => SKIN_DETAILS_SERVER_SNAPSHOT);
  const micro = useSyncExternalStore(onMicroChange, microSnapshot, () => MICRO_SERVER_SNAPSHOT);
  const low = useSyncExternalStore(subscribeTier, () => quality.tier === "low", () => false);
  const chosen = detectRealism(s);
  const own = micro.source === "upload";
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Realistic skin</span>
        <span className="pl-2 text-meta text-ink-3">{low ? "(off at Low quality: raise it under Camera → Quality)" : chosen ? "" : "(custom)"}</span>
        <RadioGroup label="Realistic skin" className="mt-2 flex flex-wrap gap-2 py-0.5">
          {REALISM_PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id} data-tip={p.tip} disabled={low && p.id !== "off"}
              onClick={() => setSkinDetails(p.patch)} className="pill-secondary pill-choice h-8 px-3 text-label">
              {p.label}
            </button>
          ))}
        </RadioGroup>
      </div>
      <div className={low ? "pointer-events-none opacity-40" : ""} aria-disabled={low || undefined}>
        <RangeRow label="Fine skin texture" value={s.microDetail} min={0} max={2} step={0.05} reset={D.microDetail} low="smooth" high="every pore" format={times} onChange={(microDetail) => setSkinDetails({ microDetail })} />
        <UploadRow
          title="Your micro normal map"
          hint="Optional: a tileable skin micro normal map (PNG, any size; it is scaled to 1024 px). It replaces the built-in fine texture."
          snap={{ ...micro, on: own, tileMm: micro.tileMm, invert: micro.invert }}
          onFile={uploadMicro}
          onRemove={removeMicro}
        />
        {own && (
          <>
            <RangeRow label="Tile size" value={micro.tileMm} min={2} max={40} step={0.5} reset={14} low="fine grain" high="coarse" format={(v) => `${v.toFixed(1)} mm`} onChange={setMicroTile} />
            <label className="flex cursor-pointer items-center gap-2 px-5 py-2 text-body text-ink">
              <input type="checkbox" checked={micro.invert} onChange={(e) => setMicroInvert(e.target.checked)} className="size-4 accent-current" />
              Invert the relief
              <span className="text-meta text-ink-3">(if the pores read as bumps)</span>
            </label>
          </>
        )}
      </div>
    </>
  );
}
