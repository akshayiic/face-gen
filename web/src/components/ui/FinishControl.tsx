"use client";

/**
 * Style tab → Camera: the quality (Auto, High, Medium, Low: lib/quality.ts, kept on this device), the light (studio,
 * hard sun, side light) and the photo finish over the view (skin translucency,
 * clarity, depth of field, bloom, grade, vignette, grain). State in lib/finishSettings.ts, drawn by lib/finish.ts and
 * components/scene/Lighting.tsx. Low-quality devices draw without the finish (lib/quality.ts), which says so.
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { type Backdrop, BACKDROPS, FINISH_DEFAULTS as D, FINISH_SERVER_SNAPSHOT, finishSnapshot, type LightPreset, onFinishChange, setFinish } from "@/lib/finishSettings";
import { onQualityChoice, onTier, type QualityChoice, quality, setQualityChoice } from "@/lib/quality";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const BACKDROP_LABELS: Record<Backdrop, string> = { page: "None", grey: "Studio grey", dark: "Dark", white: "White" };
const subscribeTier = (fn: () => void) => onTier(fn);
/** The pick and the tier it gives, as one string (a stable snapshot for useSyncExternalStore). */
const subscribeQuality = (fn: () => void) => {
  const a = onTier(fn), b = onQualityChoice(fn);
  return () => {
    a();
    b();
  };
};
const qualitySnapshot = () => `${quality.choice}:${quality.tier}:${quality.auto}`;
const QUALITY: { id: QualityChoice; label: string; tip: string }[] = [
  { id: "auto", label: "Auto", tip: "Picked for this device; it lowers itself if the frame rate drops" },
  { id: "high", label: "High", tip: "Sharpest shadows and depth of field. Needs a good graphics card" },
  { id: "medium", label: "Medium", tip: "Fine skin texture, shadows and photo finish, lighter on the graphics card" },
  { id: "low", label: "Low", tip: "No fine skin texture, shadows or photo finish: for slow devices" },
];
const NAMES = { high: "High", medium: "Medium", low: "Low" } as const;
const LIGHTS: { id: LightPreset; label: string; tip: string }[] = [
  { id: "studio", label: "Studio", tip: "Soft studio light" },
  { id: "sun", label: "Hard sun", tip: "A hard light from above: deep shade under the brows, every pore and line shows" },
  { id: "side", label: "Side light", tip: "A low light from one side: half the face in shadow" },
];

export function FinishControl() {
  const s = useSyncExternalStore(onFinishChange, finishSnapshot, () => FINISH_SERVER_SNAPSHOT);
  const low = useSyncExternalStore(subscribeTier, () => quality.tier === "low", () => false);
  const [choice, tier, auto] = useSyncExternalStore(subscribeQuality, qualitySnapshot, () => "auto:high:high").split(":") as [QualityChoice, keyof typeof NAMES, keyof typeof NAMES];
  return (
    <>
      <div className="px-5 pt-2.5" role="radiogroup" aria-label="Quality">
        <span className="text-body text-ink">Quality</span>
        <span className="pl-2 text-meta text-ink-3">{choice === "auto" ? `(Auto: ${NAMES[tier]} now)` : `(${NAMES[tier]}, kept on this device)`}</span>
        <div className="flex flex-wrap gap-2 pt-2">
          {QUALITY.map((q) => (
            <button key={q.id} type="button" role="radio" aria-checked={choice === q.id} data-tip={q.tip}
              className={`h-8 px-3 text-label ${choice === q.id ? "pill-primary" : "pill-secondary"}`} onClick={() => setQualityChoice(q.id)}>
              {q.label}
            </button>
          ))}
        </div>
        <p className="pt-1.5 text-meta text-ink-3">
          {low ? "Low turns off the fine skin texture, shadows and photo finish. " : ""}
          {choice === "auto" ? `This device starts at ${NAMES[auto]}, and Auto steps down if the frame rate drops.` : "Held at this quality, whatever the frame rate."}
        </p>
      </div>
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
      <div className="px-5 pt-3" role="radiogroup" aria-label="Backdrop">
        <span className="text-body text-ink">Backdrop</span>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={s.backdrop === b}
              className={`inline-flex h-8 items-center gap-2 px-3 text-label ${s.backdrop === b ? "pill-primary" : "pill-secondary"}`} onClick={() => setFinish({ backdrop: b })}>
              <span aria-hidden className="size-3 rounded-full shadow-hairline" style={{ backgroundColor: BACKDROPS[b] }} />
              {BACKDROP_LABELS[b]}
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
