"use client";

/**
 * Face form (Style tab → Colouring): the small shapes that make a scan read as a person: the groove between the nose and
 * the lip (philtrum), the upper lip's cupid's bow, the line where the lips meet, how much shadow sits under the lower
 * lip, the collarbones and the notch between them, the shadow under the jaw, and how defined the ears are. State in
 * lib/skinDetails.ts (part of the skin details, so the config file and the rebuild link carry it); the skin shader draws
 * them from landmarks on the rest skin (lib/skinShader.ts).
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import {
  onSkinDetailsChange,
  setSkinDetails,
  SKIN_DETAILS_DEFAULTS as D,
  SKIN_DETAILS_SERVER_SNAPSHOT,
  skinDetailsSnapshot,
} from "@/lib/skinDetails";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;

export function FaceFormControl() {
  const s = useSyncExternalStore(onSkinDetailsChange, skinDetailsSnapshot, () => SKIN_DETAILS_SERVER_SNAPSHOT);
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Face form</span>
      </div>
      <RangeRow label="Philtrum (nose to lip)" value={s.philtrum} min={0} max={2} step={0.05} reset={D.philtrum} low="flat" high="deep groove" format={times} onChange={(philtrum) => setSkinDetails({ philtrum })} />
      <RangeRow label="Cupid's bow" value={s.cupidBow} min={0} max={2} step={0.05} reset={D.cupidBow} low="soft" high="defined" format={times} onChange={(cupidBow) => setSkinDetails({ cupidBow })} />
      <RangeRow label="Mouth line" value={s.mouthLine} min={0} max={2} step={0.05} reset={D.mouthLine} low="none" high="deep parting" format={times} onChange={(mouthLine) => setSkinDetails({ mouthLine })} />
      <RangeRow label="Shadow under lower lip" value={s.underLip} min={0} max={1.5} step={0.05} reset={D.underLip} low="none" high="deep" format={times} onChange={(underLip) => setSkinDetails({ underLip })} />
      <RangeRow label="Collarbones" value={s.collarbone} min={0} max={2} step={0.05} reset={D.collarbone} low="hidden" high="prominent" format={pct} onChange={(collarbone) => setSkinDetails({ collarbone })} />
      <RangeRow label="Shadow under the jaw" value={s.jawShadow} min={0} max={2} step={0.05} reset={D.jawShadow} low="none" high="deep" format={times} onChange={(jawShadow) => setSkinDetails({ jawShadow })} />
      <RangeRow label="Ear definition" value={s.earDetail} min={0} max={2} step={0.05} reset={D.earDetail} low="plain" high="detailed" format={times} onChange={(earDetail) => setSkinDetails({ earDetail })} />
    </>
  );
}
