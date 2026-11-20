"use client";

/**
 * Uploaded textures (Style tab): a skin texture over the head and a hair texture along the strands. The image stays in
 * the browser (lib/surfaceTextures.ts). Skin: a photo of skin tiled over the head, or a map painted in the head's UV
 * layout ("Download skin map" gives the current skin in that layout to paint on). Hair: strands top to bottom.
 */
import { useId, useState, useSyncExternalStore } from "react";

import { RadioGroup } from "@/components/ui/RadioGroup";
import { RangeRow } from "@/components/ui/RangeRow";
import {
  HAIR_TEXTURE_DEFAULTS,
  HAIR_TEXTURE_SERVER_SNAPSHOT,
  hairTextureSnapshot,
  onTextureChange,
  removeHairTexture,
  removeSkinTexture,
  setHairTextureSettings,
  setSkinTextureSettings,
  SKIN_TEXTURE_DEFAULTS,
  SKIN_TEXTURE_SERVER_SNAPSHOT,
  skinTextureSnapshot,
  type TextureSnapshot,
  uploadHairTexture,
  uploadSkinTexture,
} from "@/lib/surfaceTextures";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SkinTextureControl() {
  const s = useSyncExternalStore(onTextureChange, skinTextureSnapshot, () => SKIN_TEXTURE_SERVER_SNAPSHOT);
  const [saving, setSaving] = useState(false);
  const downloadMap = async () => {
    setSaving(true);
    try {
      const { bakeSkinMap } = await import("@/lib/export/model");
      const canvas = await bakeSkinMap();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) save(blob, "skin-map.png");
    } catch (err) {
      console.error("[skin map]", err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <UploadRow
        title="Skin texture"
        hint={s.mode === "tile" ? "A close photo of skin (pores, tone changes); it repeats over the head." : "A map painted in this head's layout: download the skin map, paint on it, upload it."}
        snap={s}
        onFile={uploadSkinTexture}
        onRemove={removeSkinTexture}
      />
      <div className="px-5 py-2">
        <RadioGroup label="How the skin texture is laid" className="flex flex-wrap gap-2 py-0.5">
          {(
            [
              ["tile", "Skin photo (tiled)"],
              ["uv", "Painted map (UV)"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={s.mode === id} onClick={() => setSkinTextureSettings({ mode: id })} className="pill-secondary pill-choice h-8 px-3 text-label">
              {label}
            </button>
          ))}
        </RadioGroup>
      </div>
      <div className={s.on ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.on || undefined}>
        <RangeRow label="Texture strength" value={s.amount} min={0} max={1} step={0.05} reset={SKIN_TEXTURE_DEFAULTS.amount} low="faint" high="full" format={pct} onChange={(amount) => setSkinTextureSettings({ amount })} />
        {s.mode === "tile" && (
          <RangeRow label="Texture scale" value={s.scale} min={15} max={250} step={5} reset={SKIN_TEXTURE_DEFAULTS.scale} low="fine" high="broad" format={(v) => `${Math.round(v)} mm`} onChange={(scale) => setSkinTextureSettings({ scale })} />
        )}
        <label className="flex cursor-pointer items-center gap-2 px-5 py-2 text-body text-ink">
          <input type="checkbox" checked={s.keepTone} onChange={(e) => setSkinTextureSettings({ keepTone: e.target.checked })} className="size-4 accent-current" />
          Keep my skin tone
          <span className="text-meta text-ink-3">(use only the texture&apos;s detail)</span>
        </label>
      </div>
      <div className="px-5 pb-2.5 pt-1">
        <button type="button" onClick={() => void downloadMap()} disabled={saving} className="pill-secondary h-8 px-3 text-label">
          {saving ? "Baking…" : "Download skin map (UV)"}
        </button>
      </div>
    </>
  );
}

export function HairTextureControl() {
  const s = useSyncExternalStore(onTextureChange, hairTextureSnapshot, () => HAIR_TEXTURE_SERVER_SNAPSHOT);
  return (
    <>
      <UploadRow
        title="Hair texture"
        hint="A photo of hair with the strands running top to bottom (roots at the top). Each strand takes its colours from it."
        snap={s}
        onFile={uploadHairTexture}
        onRemove={removeHairTexture}
      />
      <div className={s.on ? "transition-opacity" : "pointer-events-none opacity-40 transition-opacity"} aria-disabled={!s.on || undefined}>
        <RangeRow label="Hair texture strength" value={s.amount} min={0} max={1} step={0.05} reset={HAIR_TEXTURE_DEFAULTS.amount} low="colour only" high="texture only" format={pct} onChange={(amount) => setHairTextureSettings({ amount })} />
      </div>
    </>
  );
}

function UploadRow<S>({ title, hint, snap, onFile, onRemove }: { title: string; hint: string; snap: TextureSnapshot<S>; onFile: (f: File) => Promise<void>; onRemove: () => void }) {
  const id = useId();
  return (
    <div className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-ink">{title}</span>
        <span className="max-w-[55%] truncate text-label text-ink-3" title={snap.name}>
          {snap.busy ? "Reading…" : snap.on ? snap.name : "None"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {snap.preview && <span aria-hidden className="size-10 shrink-0 rounded-md bg-cover bg-center shadow-hairline" style={{ backgroundImage: `url(${snap.preview})` }} />}
        <label htmlFor={id} className="pill-secondary inline-flex h-8 cursor-pointer items-center px-3 text-label">
          {snap.on ? "Replace image" : "Upload image"}
        </label>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // the same file again still fires
            if (file) void onFile(file);
          }}
        />
        {snap.on && (
          <button type="button" onClick={onRemove} className="pill-secondary h-8 px-3 text-label">
            Remove
          </button>
        )}
      </div>
      <p className="mt-1.5 text-meta text-ink-3">{hint}</p>
      {snap.error && (
        <p role="alert" className="mt-1 text-meta text-ink">
          {snap.error}
        </p>
      )}
    </div>
  );
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
