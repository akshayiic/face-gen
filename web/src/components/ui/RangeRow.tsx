"use client";

/**
 * A labelled range slider for the Style tab's look controls (skin details, uploaded textures): the value on the right,
 * end labels under it, double-click to go back to `reset`. The fill is painted as the panel's sliders paint theirs
 * (panel/rangeFill.ts): from the left edge, or from the middle with `mid`.
 */
import { paintRange } from "@/components/ui/panel/rangeFill";

export function RangeRow({
  label,
  value,
  min,
  max,
  step,
  reset,
  low,
  high,
  mid = false,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  reset: number;
  low: string;
  high: string;
  mid?: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block px-5 py-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body text-ink">{label}</span>
        <span className="text-meta tabular-nums text-ink-3">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        onDoubleClick={() => onChange(reset)}
        aria-label={label}
        aria-valuetext={`${format(value)}, ${label}`}
        className={`range block w-full ${mid ? "range-mid" : ""}`}
        ref={(el) => {
          if (el) paintRange(el);
        }}
      />
      <span className="mt-1 flex justify-between text-meta text-ink-3">
        <span>{low}</span>
        <span>{high}</span>
      </span>
    </label>
  );
}
