"use client";

/**
 * Style tab → Scars and marks: pick a kind, click on the face to place it, then size, turn and heal each one
 * (lib/marks.ts; components/scene/SkinTools.tsx does the click).
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { clearMarks, MARK_TYPES, MARKS_SERVER_SNAPSHOT, marksSnapshot, onMarksChange, removeMark, startPlacing, updateMark } from "@/lib/marks";
import { MAX_MARKS } from "@/lib/skinShader";

const mm = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} mm`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const label = (id: string) => MARK_TYPES.find((t) => t.id === id)?.label ?? id;

export function MarksControl() {
  const s = useSyncExternalStore(onMarksChange, marksSnapshot, () => MARKS_SERVER_SNAPSHOT);
  const full = s.marks.length >= MAX_MARKS;
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Add</span>
        <div className="flex flex-wrap gap-2 pt-2">
          {MARK_TYPES.map((t) => (
            <button key={t.id} type="button" disabled={full} aria-pressed={s.placing === t.id}
              className={`h-8 px-3 text-label ${s.placing === t.id ? "pill-primary" : "pill-secondary"}`}
              onClick={() => startPlacing(s.placing === t.id ? null : t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="pt-2 text-meta text-ink-3" role="status">
          {s.placing ? `Click on the face to place the ${label(s.placing).toLowerCase()} (Esc to cancel).` : full ? `${MAX_MARKS} marks is the most.` : "Pick one, then click where it goes on the face."}
        </p>
      </div>
      {s.marks.map((m, i) => (
        <div key={i} className="mt-2 border-t border-ink/10 pt-1">
          <div className="flex items-center justify-between px-5 pt-1.5">
            <span className="text-body text-ink">{label(m.type)} {s.marks.filter((x, j) => x.type === m.type && j <= i).length}</span>
            <button type="button" className="pill-secondary h-7 px-3 text-label" onClick={() => removeMark(i)}>
              Remove
            </button>
          </div>
          <RangeRow label={m.type === "pockmarks" || m.type === "burn" || m.type === "bruise" ? "Size" : "Length"} value={m.length} min={4} max={80} step={1} reset={MARK_TYPES.find((t) => t.id === m.type)!.length} low="small" high="large" format={mm} onChange={(length) => updateMark(i, { length })} />
          {m.type !== "bruise" && m.type !== "burn" && (
            <RangeRow label={m.type === "pockmarks" ? "Pit size" : "Width"} value={m.width} min={0.3} max={6} step={0.1} reset={MARK_TYPES.find((t) => t.id === m.type)!.width} low="fine" high="wide" format={mm} onChange={(width) => updateMark(i, { width })} />
          )}
          <RangeRow label="Angle" value={m.angle} min={-90} max={90} step={1} reset={0} low="tilted down" high="tilted up" format={(v) => `${Math.round(v)}°`} onChange={(angle) => updateMark(i, { angle })} />
          <RangeRow label="Healed" value={m.healed} min={0} max={1} step={0.05} reset={MARK_TYPES.find((t) => t.id === m.type)!.healed} low="fresh" high="old" format={pct} onChange={(healed) => updateMark(i, { healed })} />
        </div>
      ))}
      {s.marks.length > 0 && (
        <div className="px-5 py-2">
          <button type="button" className="pill-secondary h-8 px-3 text-label" onClick={clearMarks}>
            Remove all
          </button>
        </div>
      )}
    </>
  );
}
