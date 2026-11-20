"use client";

/**
 * "Export .glb": the character as a 3D model with a mouth rig (lib/export/model.ts with `rig`, lib/export/rig.ts):
 * the face as shown, plus morph targets for the 15 Oculus visemes, jawOpen and the two blinks, ready to lip-sync in
 * three.js, Unity or Blender. Built in the browser; the export code loads only on the first click.
 */
import { useState } from "react";

import { BusyPill } from "@/components/ui/Spinner";
import { Status } from "@/components/ui/Status";

const TIP = "Download the 3D model (.glb) with mouth shapes for lip sync";

export function ModelExportButton({ held = false }: { held?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState({ message: "", count: 0 });

  const download = async () => {
    setBusy(true);
    setSaid((s) => ({ message: "Building the 3D model…", count: s.count + 1 }));
    try {
      const { buildModel } = await import("@/lib/export/model");
      const bytes = await buildModel({ rig: true });
      const blob = new Blob([bytes as BlobPart], { type: "model/gltf-binary" });
      const filename = `character-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.glb`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSaid((s) => ({ message: `Downloaded ${filename}.`, count: s.count + 1 }));
    } catch (e) {
      console.error("[export glb]", e);
      setSaid((s) => ({ message: "Couldn't build the 3D model. Please try again.", count: s.count + 1 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BusyPill className="pill-secondary h-9" busy={busy} held={held} onClick={download} data-tip={TIP} aria-label={TIP}>
        Export .glb
      </BusyPill>
      <Status message={said.message} count={said.count} />
    </>
  );
}
