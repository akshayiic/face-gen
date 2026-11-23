"use client";

/**
 * Clothes (Style tab): the garment, its colour (swatches or any colour), the top under a blazer, the fabric, and the
 * fit and body sliders. State in lib/clothes.ts (applied straight to the meshes), mirrored with useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";

import { RadioGroup } from "@/components/ui/RadioGroup";
import {
  CLOTHES_COLOURS,
  CLOTHES_SERVER_SNAPSHOT,
  CLOTHES_STYLES,
  clothesSnapshot,
  EARRINGS,
  FABRICS,
  onClothesChange,
  setClothes,
  type ClothesState,
} from "@/lib/clothes";

export function ClothesControl() {
  const s = useSyncExternalStore(onClothesChange, clothesSnapshot, () => CLOTHES_SERVER_SNAPSHOT);
  const off = s.style === "none";
  const hasInner = CLOTHES_STYLES.find((x) => x.id === s.style)?.inner ?? false;
  const hasNeckline = s.style === "vneck" || s.style === "scoop" || s.style === "shirt" || s.style === "blazer";
  return (
    <>
      <div className="px-5 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-ink">Style</span>
          <span className="text-label text-ink-3">{CLOTHES_STYLES.find((x) => x.id === s.style)?.label}</span>
        </div>
        <RadioGroup label="Clothes style" className="mt-2 flex flex-wrap gap-2 py-0.5">
          {CLOTHES_STYLES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={s.style === x.id} onClick={() => setClothes({ style: x.id })} className="pill-secondary pill-choice h-8 px-3 text-label">
              {x.label}
            </button>
          ))}
        </RadioGroup>
      </div>
      <div className={off ? "pointer-events-none opacity-40 transition-opacity" : "transition-opacity"} aria-disabled={off || undefined}>
        <ColourRow title={hasInner ? "Jacket colour" : "Colour"} value={s.colour} onChoose={(colour) => setClothes({ colour })} />
        {hasInner && <ColourRow title="Top underneath" value={s.inner} onChoose={(inner) => setClothes({ inner })} />}
        <div className="px-5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-ink">Fabric</span>
            <span className="text-label text-ink-3">{FABRICS.find((f) => f.id === s.fabric)?.label}</span>
          </div>
          <RadioGroup label="Fabric" className="mt-2 flex flex-wrap gap-2 py-0.5">
            {FABRICS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={s.fabric === f.id} onClick={() => setClothes({ fabric: f.id })} className="pill-secondary pill-choice h-8 px-3 text-label">
                {f.label}
              </button>
            ))}
          </RadioGroup>
        </div>
        {hasNeckline && <Range label="Neckline" low="shallow" high="deep" k="neckline" s={s} />}
        {s.style === "blazer" && <Range label="Collar" low="flat" high="tall, folded over" k="collar" s={s} />}
        <Range label="Fit" low="snug" high="loose" k="fit" s={s} />
        <Range label="Shoulders" low="narrow" high="broad" k="shoulders" s={s} />
        <Range label="Build" low="slim" high="broad chest" k="build" s={s} />
      </div>
      <div className="px-5 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-ink">Earrings</span>
          <span className="text-label text-ink-3">{EARRINGS.find((e) => e.id === s.earrings)?.label}</span>
        </div>
        <RadioGroup label="Earrings" className="mt-2 flex flex-wrap gap-2 py-0.5">
          {EARRINGS.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={s.earrings === e.id} onClick={() => setClothes({ earrings: e.id })} className="pill-secondary pill-choice h-8 px-3 text-label">
              {e.label}
            </button>
          ))}
        </RadioGroup>
      </div>
    </>
  );
}

/** Preset swatches, then a chip that opens the browser's colour picker for any colour. */
function ColourRow({ title, value, onChoose }: { title: string; value: string; onChoose: (hex: string) => void }) {
  const preset = CLOTHES_COLOURS.find((c) => c.hex === value);
  return (
    <div className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-ink">{title}</span>
        <span className="text-label text-ink-3">{preset?.label ?? value}</span>
      </div>
      <RadioGroup label={title} className="mt-2 flex flex-wrap items-center gap-2 py-0.5">
        {CLOTHES_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.hex}
            aria-label={c.label}
            data-tip={c.label}
            onClick={() => onChoose(c.hex)}
            style={{ backgroundColor: c.hex }}
            className={`size-6 rounded-full choice relative shadow-hairline transition-shadow ${value === c.hex ? "" : "hover:shadow-control-hover"}`}
          />
        ))}
        <label
          data-tip="Any colour"
          className={`relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full shadow-hairline ${preset ? "" : "ring-2 ring-ink"}`}
          style={{ background: preset ? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" : value }}
        >
          <span className="sr-only">Any colour</span>
          <input type="color" value={value} onChange={(e) => onChoose(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
      </RadioGroup>
    </div>
  );
}

function Range({ label, low, high, k, s }: { label: string; low: string; high: string; k: "fit" | "shoulders" | "build" | "neckline" | "collar"; s: ClothesState }) {
  return (
    <label className="block px-5 py-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body text-ink">{label}</span>
        <span className="text-meta tabular-nums text-ink-3">{(s[k] > 0 ? "+" : "") + s[k].toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={s[k]}
        onChange={(e) => setClothes({ [k]: e.target.valueAsNumber })}
        onDoubleClick={() => setClothes({ [k]: 0 })}
        aria-label={label}
        className="range range-mid block w-full"
        ref={(el) => {
          if (el) paint(el);
        }}
      />
      <span className="mt-1 flex justify-between text-meta text-ink-3">
        <span>{low}</span>
        <span>{high}</span>
      </span>
    </label>
  );
}

/** The track's fill from the middle, as the app's sliders draw it (rangeFill.ts). */
function paint(el: HTMLInputElement) {
  void import("@/components/ui/panel/rangeFill").then((m) => m.paintRange(el));
}
