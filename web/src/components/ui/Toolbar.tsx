"use client";

/**
 * Bottom-left over the head: Random character (a new face, style and expression at once, lib/character.ts)
 * and Reset (a blank head: face at rest, no hair, brows, lashes, beard or glasses, neutral, centred).
 * Both morph the face with the colours blending and cross-fade the hair and add-ons on the live head
 * (lib/character.ts); the buttons wait until the new pieces are on. Meanwhile both stay solid (the change is
 * working, not unavailable): the clicked one shows the spinner, and neither takes a second click (BusyPill).
 * Then a screen reader hears the new face in words. The first character's hair and add-ons download a few
 * seconds after the page loads (prepareFirst), and pointing at or focusing Random character starts them too.
 * Random face alone lives in the Shape tab. Export .glb and Config (save or load the setup as a .md file) sit beside them.
 */
import { useEffect, useId, useState } from "react";

import { ConfigMenu } from "@/components/ui/ConfigMenu";
import { ModelExportButton } from "@/components/ui/ModelExportButton";
import { BusyPill } from "@/components/ui/Spinner";
import { Status } from "@/components/ui/Status";
import { characterSettled, prepareFirst, prepareNext, randomCharacter, resetCharacter } from "@/lib/character";
import { describeFace } from "@/lib/describeFace";

type Action = "random" | "indian" | "reset";

const TIPS = {
  random: "A new face, style and expression",
  indian: "A new woman or girl from India: warm skin tones, dark hair and eyes, a feminine-presenting face, any age from youthful to mature",
  reset: "Back to a blank head",
};

export function Toolbar() {
  const ids = useId();
  const [busy, setBusy] = useState<Action | null>(null);
  // What a screen reader hears once the new face is on: the look in words (the head's own text alternative).
  const [said, setSaid] = useState({ message: "", count: 0 });
  useEffect(prepareFirst, []);
  const run = (action: Action, change: () => Promise<void>) => {
    setBusy(action);
    change().finally(() => {
      setBusy(null);
      // described once the morph has landed too (the pieces can be on before the face stops moving)
      void characterSettled().then(() => setSaid((s) => ({ message: `${action === "reset" ? "Reset" : "New character"}. ${describeFace()}`, count: s.count + 1 })));
    });
  };
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
      <BusyPill className="pill-secondary h-9" busy={busy === "random"} held={!!busy} onClick={() => run("random", randomCharacter)} onPointerEnter={prepareNext} onFocus={prepareNext} data-tip={TIPS.random} aria-describedby={`${ids}-random`}>
        Random character
      </BusyPill>
      <BusyPill className="pill-secondary h-9" busy={busy === "indian"} held={!!busy} onClick={() => run("indian", () => randomCharacter("indian-woman"))} data-tip={TIPS.indian} aria-describedby={`${ids}-indian`}>
        Random Indian woman
      </BusyPill>
      <BusyPill className="pill-secondary h-9" busy={busy === "reset"} held={!!busy} onClick={() => run("reset", resetCharacter)} data-tip={TIPS.reset} aria-describedby={`${ids}-reset`}>
        Reset
      </BusyPill>
      <ModelExportButton held={!!busy} />
      <ConfigMenu held={!!busy} />
      {/* the hints for screen readers (the tooltip, TooltipLayer, is visual only) */}
      <span id={`${ids}-random`} className="sr-only">
        {TIPS.random}
      </span>
      <span id={`${ids}-indian`} className="sr-only">
        {TIPS.indian}
      </span>
      <span id={`${ids}-reset`} className="sr-only">
        {TIPS.reset}
      </span>
      <Status message={said.message} count={said.count} />
    </div>
  );
}
