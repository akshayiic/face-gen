"use client";

/**
 * Style tab → Camera: the light (studio, hard sun, side light) and the photo finish over the view (skin translucency,
 * clarity, depth of field, bloom, grade, vignette, grain). State in lib/finishSettings.ts, drawn by lib/finish.ts and
 * components/scene/Lighting.tsx. Low-quality devices draw without the finish (lib/quality.ts), which says so.
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { FINISH_DEFAULTS as D, FINISH_SERVER_SNAPSHOT, finishSnapshot, type LightPreset, onFinishChange, setFinish } from "@/lib/finishSettings";
import { onTier, quality } from "@/lib/quality";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const subscribeTier = (fn: () => void) => onTier(fn);
const LIGHTS: { id: LightPreset; label: string; tip: string }[] = [
  { id: "studio", label: "Studio", tip: "Soft studio light" },
  { id: "sun", label: "Hard sun", tip: "A hard light from above: deep shade under the brows, every pore and line shows" },
  { id: "side", label: "Side light", tip: "A low light from one side: half the face in shadow" },
];

export function FinishControl() {
  const s = useSyncExternalStore(onFinishChange, finishSnapshot, () => FINISH_SERVER_SNAPSHOT);
  const low = useSyncExternalStore(subscribeTier, () => quality.tier === "low", () => false);
  return (
    <>
      <div className="px-5 pt-2.5" role="radiogroup" aria-label="Light">
        <span className="text-body text-ink">Light</span>
        <div className="flex flex-wrap gap-2 pt-2">
          {LIGHTS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={s.light === l.id} data-tip={l.tip}
              className={`h-8 px-3 text-label ${s.light === l.id ? "pill-primary" : "pill-secondary"}`} onClick={() => setFinish({ light: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 px-5 py-2.5 text-body text-ink">
        <input type="checkbox" checked={s.on} onChange={(e) => setFinish({ on: e.target.checked })} className="size-4 accent-current" />
        Photo finish
        <span className="text-meta text-ink-3">{low ? "(off on this device: low quality)" : "(lens, grade and grain)"}</span>
      </label>
      <div className={s.on && !low ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.on || low || undefined}>
        <RangeRow label="Skin translucency" value={s.skin} min={0} max={1} step={0.05} reset={D.skin} low="none" high="glowing" format={pct} onChange={(skin) => setFinish({ skin })} />
        <RangeRow label="Clarity" value={s.clarity} min={0} max={1} step={0.05} reset={D.clarity} low="soft" high="gritty" format={pct} onChange={(clarity) => setFinish({ clarity })} />
        <RangeRow label="Depth of field" value={s.focus} min={0} max={1} step={0.05} reset={D.focus} low="all sharp" high="f/2" format={(v) => (v > 0 ? `f/${(2 / v).toFixed(1)}` : "off")} onChange={(focus) => setFinish({ focus })} />
        <RangeRow label="Bloom" value={s.bloom} min={0} max={1} step={0.05} reset={D.bloom} low="none" high="glow" format={pct} onChange={(bloom) => setFinish({ bloom })} />
        <RangeRow label="Colour grade" value={s.grade} min={0} max={1} step={0.05} reset={D.grade} low="neutral" high="filmic" format={pct} onChange={(grade) => setFinish({ grade })} />
        <RangeRow label="Vignette" value={s.vignette} min={0} max={1} step={0.05} reset={D.vignette} low="none" high="dark corners" format={pct} onChange={(vignette) => setFinish({ vignette })} />
        <RangeRow label="Film grain" value={s.grain} min={0} max={1} step={0.05} reset={D.grain} low="clean" high="grainy" format={pct} onChange={(grain) => setFinish({ grain })} />
      </div>
    </>
  );
}
