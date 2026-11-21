"use client";

/**
 * Shape tab → Fine shape (local feature sliders and asymmetry) and Sculpt (brushes on the face). State in lib/sculpt.ts;
 * the brush strokes themselves are components/scene/SkinTools.tsx.
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import {
  type Brush,
  clearSculpt,
  FINE,
  onSculptChange,
  SCULPT_SERVER_SNAPSHOT,
  sculptSnapshot,
  setFine,
  setSculptTool,
  shuffleAsymmetry,
  undoSculpt,
} from "@/lib/sculpt";

const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function FineShapeControl() {
  const s = useSyncExternalStore(onSculptChange, sculptSnapshot, () => SCULPT_SERVER_SNAPSHOT);
  return (
    <>
      {FINE.map((f) => (
        <RangeRow key={f.id} label={f.name} value={s.fine.sliders[f.id] ?? 0} min={f.min} max={1} step={0.05} reset={0} low={f.low} high={f.high} mid={f.min < 0}
          format={signed} onChange={(v) => setFine({ sliders: { [f.id]: v } })} />
      ))}
      <RangeRow label="Asymmetry" value={s.fine.asymmetry} min={0} max={1} step={0.05} reset={0} low="symmetric" high="lopsided" format={pct}
        onChange={(asymmetry) => setFine({ asymmetry })} />
      <div className={s.fine.asymmetry > 0 ? "px-5 pb-2" : "pointer-events-none px-5 pb-2 opacity-40"}>
        <button type="button" className="pill-secondary h-8 px-3 text-label" onClick={shuffleAsymmetry}>
          Shuffle asymmetry
        </button>
      </div>
    </>
  );
}

const BRUSHES: { id: Brush; label: string; tip: string }[] = [
  { id: "raise", label: "Raise", tip: "Build the skin out" },
  { id: "lower", label: "Lower", tip: "Push the skin in" },
  { id: "smooth", label: "Smooth", tip: "Even out bumps" },
  { id: "grab", label: "Grab", tip: "Drag the skin with the pointer" },
  { id: "erase", label: "Erase", tip: "Take sculpting away" },
];

export function SculptControl() {
  const s = useSyncExternalStore(onSculptChange, sculptSnapshot, () => SCULPT_SERVER_SNAPSHOT);
  const t = s.tool;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-2.5">
        <button type="button" disabled={!s.ready} aria-pressed={t.on} className={`h-9 px-4 text-label ${t.on ? "pill-primary" : "pill-secondary"}`}
          onClick={() => setSculptTool({ on: !t.on })}>
          {t.on ? "Stop sculpting" : "Sculpt on the face"}
        </button>
        <button type="button" disabled={!s.canUndo} className="pill-secondary h-9 px-3 text-label" onClick={undoSculpt}>
          Undo
        </button>
        <button type="button" disabled={!s.sculpted} className="pill-secondary h-9 px-3 text-label" onClick={clearSculpt}>
          Clear
        </button>
      </div>
      <p className="px-5 pt-2 text-meta text-ink-3">
        {t.on ? "Drag on the face to sculpt. The camera holds still until you stop (Esc)." : "Shape any part of the face by hand: brush it in or out, smooth it, or grab and pull it."}
      </p>
      <div className={t.on ? "" : "pointer-events-none opacity-40"} aria-disabled={!t.on || undefined}>
        <div className="flex flex-wrap gap-2 px-5 pt-2" role="radiogroup" aria-label="Brush">
          {BRUSHES.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={t.brush === b.id} data-tip={b.tip}
              className={`h-8 px-3 text-label ${t.brush === b.id ? "pill-primary" : "pill-secondary"}`} onClick={() => setSculptTool({ brush: b.id })}>
              {b.label}
            </button>
          ))}
        </div>
        <RangeRow label="Brush size" value={t.radius} min={3} max={40} step={1} reset={12} low="fine" high="broad" format={(v) => `${Math.round(v)} mm`} onChange={(radius) => setSculptTool({ radius })} />
        <RangeRow label="Strength" value={t.strength} min={0.05} max={1} step={0.05} reset={0.5} low="gentle" high="strong" format={pct} onChange={(strength) => setSculptTool({ strength })} />
        <label className="flex cursor-pointer items-center gap-2 px-5 py-2 text-body text-ink">
          <input type="checkbox" checked={t.symmetry} onChange={(e) => setSculptTool({ symmetry: e.target.checked })} className="size-4 accent-current" />
          Mirror across the face
        </label>
      </div>
    </>
  );
}
