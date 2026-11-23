"use client";

/**
 * Hair style and colour (Style tab, Hair): length filters (Short … Tied back, Curly, All), a wrapping grid of round
 * thumbnails of the styles in the chosen filter (hair/index.json, "None" first) and the colour swatches ("Natural"
 * first, a swatch like the others: its chip is the chosen style's own colour). Until a filter is picked,
 * the one holding the chosen style shows (Short when there is none), so the selection is always in view.
 * The state lives in lib/hair.ts (applied straight to the mesh); this component just mirrors it
 * through useSyncExternalStore, which also carries the subtle loading state.
 * Below the styles, how it's worn (lib/hairShape.ts): down, half up, a low or high ponytail or a bun (styles shoulder
 * length or longer), face-framing strands left loose; and volume, flyaways and shine for any style.
 */
import { useState, useSyncExternalStore } from "react";

import { RadioGroup } from "@/components/ui/RadioGroup";
import { RangeRow } from "@/components/ui/RangeRow";
import { NoneMark, thumbClass, thumbImg } from "@/components/ui/thumb";
import { MODELS_BASE, type HairGroup } from "@/lib/data";
import {
  canTie,
  HAIR_COLOURS,
  HAIR_SERVER_SNAPSHOT,
  HAIR_STYLES,
  HAIR_WEAR_DEFAULTS,
  hairChipHex,
  hairSnapshot,
  hairStyleById,
  type HairTie,
  onHairChange,
  setHairColour,
  setHairStyle,
  setHairWear,
  type HairStyle,
} from "@/lib/hair";

const TIES: { id: HairTie; label: string }[] = [
  { id: "down", label: "Down" },
  { id: "half", label: "Half up" },
  { id: "low", label: "Low ponytail" },
  { id: "high", label: "High ponytail" },
  { id: "bun", label: "Bun" },
];
const pct = (v: number) => `${Math.round(v * 100)}%`;

type Filter = HairGroup | "curly" | "all";
const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "bob", label: "Bob" },
  { id: "shoulder", label: "Shoulder" },
  { id: "long", label: "Long" },
  { id: "tied", label: "Tied back" },
  { id: "curly", label: "Curly" },
  { id: "all", label: "All" },
];
const inFilter = (f: Filter, s: (typeof HAIR_STYLES)[number]) => f === "all" || (f === "curly" ? !!s.curly : (s.group ?? "short") === f);

export function HairControl() {
  const [picked, setPicked] = useState<Filter | null>(null);
  // The server (and the hydrating client) render the defaults; the saved choice comes in with
  // the first client snapshot, the same state the head reads when it mounts.
  const state = useSyncExternalStore(onHairChange, hairSnapshot, () => HAIR_SERVER_SNAPSHOT);
  const { loading, failed, filesMissing } = state;

  const chosen = state.style === "none" ? undefined : hairStyleById(state.style);
  const current = state.style === "none" ? "None" : (chosen?.label ?? "");
  const filter: Filter = picked ?? chosen?.group ?? "short";
  const shown = HAIR_STYLES.filter((s) => inFilter(filter, s));
  const thumb = (style: HairStyle, selected: boolean) => thumbClass(selected, selected && loading && style !== "none");

  return (
    <div className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-ink">Hair</span>
        <span className="text-label text-ink-3" aria-live="polite">
          {loading ? "Loading…" : failed ? "Couldn't load. Try again" : current}
        </span>
      </div>
      {/* Development only (lib/hair.ts checkHairFiles): a fresh clone has no strand files. */}
      {process.env.NODE_ENV !== "production" && filesMissing && (
        <p className="mt-1 text-meta text-ink-3">
          Hair files aren&apos;t installed: run <code>pnpm fetch-hair</code> in web/.
        </p>
      )}
      {/* Length filters: they wrap like every option row (no sideways scrolling). */}
      <RadioGroup label="Hair length" className="mt-2 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setPicked(f.id)}
            className="pill-secondary pill-choice h-8 px-3 text-label"
          >
            {f.label}
          </button>
        ))}
      </RadioGroup>
      {/* The filter's styles at once: the thumbnails wrap onto as many rows as they need (no sideways scrolling).
          The padding leaves room for the selection ring. */}
      {/* a new filter fades its styles in (keyed: the grid is remade); not on first show, the tab fades it in */}
      <RadioGroup key={filter} label="Hair style" chooseOnArrow={false} className={`${picked ? "enter " : ""}mt-2 flex flex-wrap gap-2 py-0.5`}>
        <button
          type="button"
          role="radio"
          aria-checked={state.style === "none"}
          aria-label="None"
          data-tip="None"
          onClick={() => setHairStyle("none")}
          className={`${thumb("none", state.style === "none")} bg-card`}
        >
          <NoneMark />
        </button>
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={state.style === s.id}
            aria-label={s.label}
            data-tip={s.label}
            onClick={() => setHairStyle(s.id)}
            className={`${thumb(s.id, state.style === s.id)} bg-surface`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static 128 px webp, no optimisation wanted */}
            <img src={MODELS_BASE + s.thumb} alt="" width={44} height={44} loading="lazy" draggable={false} {...thumbImg} className="size-full rounded-full object-contain p-0.5" />
          </button>
        ))}
      </RadioGroup>
      {state.style !== "none" && (
        <div className="-mx-5 mt-3">
          <div className="px-5">
            <span className="text-body text-ink">Wear it</span>
            <RadioGroup label="How the hair is worn" className="mt-2 flex flex-wrap gap-2">
              {TIES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={state.tie === t.id} disabled={t.id !== "down" && !canTie(state.style)}
                  onClick={() => setHairWear({ tie: t.id })} className="pill-secondary pill-choice h-8 px-3 text-label">
                  {t.label}
                </button>
              ))}
            </RadioGroup>
            {!canTie(state.style) && <p className="mt-1.5 text-meta text-ink-3">Tying back needs hair to the chin or longer.</p>}
            {state.tie !== "down" && canTie(state.style) && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-body text-ink">
                <input type="checkbox" checked={state.framing} onChange={(e) => setHairWear({ framing: e.target.checked })} className="size-4 accent-current" />
                Leave face-framing strands loose
              </label>
            )}
          </div>
          <RangeRow label="Volume" value={state.volume} min={-1} max={1} step={0.05} reset={0} low="flat" high="full" mid format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`} onChange={(volume) => setHairWear({ volume })} />
          <RangeRow label="Flyaways" value={state.frizz} min={0} max={1} step={0.05} reset={HAIR_WEAR_DEFAULTS.frizz} low="sleek" high="frizzy" format={pct} onChange={(frizz) => setHairWear({ frizz })} />
          <RangeRow label="Density" value={state.density} min={0} max={2} step={0.05} reset={HAIR_WEAR_DEFAULTS.density} low="thin, see-through" high="very dense" mid format={(v) => `×${v.toFixed(2)}`} onChange={(density) => setHairWear({ density })} />
          <RangeRow label="Strand thickness" value={state.thickness} min={0.5} max={1.8} step={0.05} reset={HAIR_WEAR_DEFAULTS.thickness} low="fine, silky" high="coarse" mid format={(v) => `×${v.toFixed(2)}`} onChange={(thickness) => setHairWear({ thickness })} />
          <RangeRow label="Shine" value={state.shine} min={0} max={2} step={0.05} reset={HAIR_WEAR_DEFAULTS.shine} low="matte" high="glossy" mid format={(v) => `×${v.toFixed(2)}`} onChange={(shine) => setHairWear({ shine })} />
        </div>
      )}
      {/* Stays usable with no hair: the eyebrows, lashes and beard wear this colour too. */}
      <RadioGroup label="Hair colour" className="mt-3 flex flex-wrap items-center gap-2 py-0.5">
        {HAIR_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={state.colour === c.id}
            aria-label={c.label}
            data-tip={c.label}
            onClick={() => setHairColour(c.id)}
            style={{ backgroundColor: hairChipHex(c.id, state.style) }}
            className={`grid size-6 place-items-center rounded-full choice relative shadow-hairline transition-shadow ${state.colour === c.id ? "" : "hover:shadow-control-hover"}`}
          />
        ))}
      </RadioGroup>
    </div>
  );
}
