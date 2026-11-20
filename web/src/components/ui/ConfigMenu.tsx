"use client";

/**
 * "Config" in the toolbar: save the whole setup (character, uploaded textures, camera finish) as a Markdown file, or
 * load one back (lib/export/config.ts). The export code loads on first use.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Status } from "@/components/ui/Status";

const TIP = "Save the setup as a .md file, or load one";

export function ConfigMenu({ held = false }: { held?: boolean }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState(true);
  const [error, setError] = useState("");
  const [said, setSaid] = useState({ message: "", count: 0 });
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const say = (message: string) => setSaid((s) => ({ message, count: s.count + 1 }));

  // close on a click outside or Escape
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const save = async () => {
    setError("");
    try {
      const { downloadConfig } = await import("@/lib/export/config");
      say(`Downloaded ${downloadConfig(images)}.`);
      setOpen(false);
    } catch (e) {
      console.error("[config save]", e);
      setError("Couldn't save the config. Please try again.");
    }
  };

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    say("Loading the config…");
    const { importConfig } = await import("@/lib/export/config");
    const problem = await importConfig(f); // reloads the page when it works
    setError(problem);
    say(problem);
    if (file.current) file.current.value = "";
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="pill-secondary h-9"
        disabled={held}
        aria-expanded={open}
        aria-controls={`${ids}-menu`}
        data-tip={TIP}
        aria-label={`Config: ${TIP.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
      >
        Config
      </button>
      {open && (
        <div id={`${ids}-menu`} className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl bg-card p-3 text-body text-ink shadow-float">
          <button type="button" className="pill-secondary h-8 w-full px-3 text-label" onClick={() => void save()}>
            Save config (.md)
          </button>
          <label className="flex cursor-pointer items-center gap-2 py-2 text-meta text-ink-2">
            <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} className="size-4 accent-current" />
            Include uploaded textures
          </label>
          <button type="button" className="pill-secondary h-8 w-full px-3 text-label" onClick={() => file.current?.click()}>
            Import config…
          </button>
          <p className="pt-2 text-meta text-ink-3">Importing replaces the current character, textures and camera settings.</p>
          {error && (
            <p role="alert" className="pt-1 text-meta text-danger">
              {error}
            </p>
          )}
          <input ref={file} type="file" accept=".md,.markdown,.json,text/markdown,application/json" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
        </div>
      )}
      <Status message={said.message} count={said.count} />
    </div>
  );
}
