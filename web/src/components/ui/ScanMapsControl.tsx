"use client";

/**
 * Style tab → Colouring → Scanned skin maps: a scan's normal, roughness and cavity maps in this head's UV layout, each
 * with its strength (lib/scanMaps.ts). The scan's colour map goes in the skin texture as a painted map (UV).
 */
import { useSyncExternalStore } from "react";

import { RangeRow } from "@/components/ui/RangeRow";
import { UploadRow } from "@/components/ui/TextureControls";
import { onScanMapsChange, removeScanMap, SCAN_DEFAULT_AMOUNT, SCAN_SERVER_SNAPSHOT, SCAN_SLOTS, scanMapsSnapshot, setScanAmount, uploadScanMap } from "@/lib/scanMaps";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ScanMapsControl() {
  const s = useSyncExternalStore(onScanMapsChange, scanMapsSnapshot, () => SCAN_SERVER_SNAPSHOT);
  return (
    <>
      <div className="px-5 pt-2.5">
        <span className="text-body text-ink">Scanned skin maps</span>
        <p className="pt-1 text-meta text-ink-3">
          From a face scan, transferred to this head&apos;s layout (pipeline/tools/bake_scan_to_head.py). Put the scan&apos;s colour map in the skin texture as a painted map.
        </p>
      </div>
      {SCAN_SLOTS.map((slot) => {
        const snap = s[slot.id];
        return (
          <div key={slot.id}>
            <UploadRow title={slot.title} hint={slot.hint} snap={snap} onFile={(f) => uploadScanMap(slot.id, f)} onRemove={() => removeScanMap(slot.id)} />
            {snap.on && (
              <RangeRow label={`${slot.title} strength`} value={snap.amount} min={0} max={2} step={0.05} reset={SCAN_DEFAULT_AMOUNT} low="none" high="double" format={pct}
                onChange={(v) => setScanAmount(slot.id, v)} />
            )}
          </div>
        );
      })}
    </>
  );
}
