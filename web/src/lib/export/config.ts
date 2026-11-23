/**
 * Save config / Import config (the toolbar's Config menu): the live setup to a Markdown file and back
 * (lib/export/configFile.ts has the format). Importing writes the file into the tab's sessionStorage and reloads, the
 * way a rebuild link opens, so the character, textures and camera all come back through the app's own restore checks.
 */
import { sliders } from "@/lib/data";
import { finishSettings } from "@/lib/finishSettings";
import { SCAN_SLOTS, scanMapDataUrl, scanMapsSnapshot } from "@/lib/scanMaps";
import { currentSculpt } from "@/lib/sculpt";
import { microDataUrl, microSettings, microSnapshot } from "@/lib/skinMicro";
import { hairTextureSnapshot, skinTextureSnapshot, textureDataUrl } from "@/lib/surfaceTextures";

import { currentCharacter } from "./character";
import { type ConfigFile, CONFIG_FORMAT, CONFIG_VERSION, configFromMarkdown, configStorage, configToMarkdown, MAX_CONFIG_CHARS, type TextureEntry } from "./configFile";

/** The setup now; `images`: put the uploaded textures in (bigger file, but it restores them anywhere). */
export function currentConfig(images: boolean): ConfigFile {
  const textures: ConfigFile["textures"] = {};
  const skin = skinTextureSnapshot();
  if (skin.on) {
    const { mode, amount, scale, keepTone } = skin;
    textures.skin = withImage({ name: skin.name, settings: { mode, amount, scale, keepTone } }, images && textureDataUrl("skin"));
  }
  const hair = hairTextureSnapshot();
  if (hair.on) textures.hair = withImage({ name: hair.name, settings: { amount: hair.amount } }, images && textureDataUrl("hair"));
  const scans = scanMapsSnapshot();
  for (const { id } of SCAN_SLOTS) {
    const s = scans[id];
    if (s.on) textures[id] = withImage({ name: s.name, settings: { amount: s.amount } }, images && scanMapDataUrl(id));
  }
  if (microSnapshot().source === "upload") textures.skinMicro = withImage({ name: microSnapshot().name, settings: { ...microSettings() } }, images && microDataUrl());
  const sculpt = currentSculpt();
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    savedAt: new Date().toISOString(),
    character: currentCharacter(),
    textures,
    finish: { ...finishSettings },
    ...(sculpt ? { sculpt } : {}),
  };
}

const withImage = (e: TextureEntry, image: string | null | false): TextureEntry => (image ? { ...e, image } : e);

/** Slider names by morph target, for the Shape table. */
const labels = () => Object.fromEntries(sliders.sliders.map((s) => [s.target, s.name]));

/** Download the setup as a .md file; returns its name. */
export function downloadConfig(images: boolean): string {
  const md = configToMarkdown(currentConfig(images), labels());
  const filename = `character-config-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/**
 * Load a config (.md, or a .json config or character.json): writes it into this tab and reloads. Resolves with what
 * went wrong (the page stays as it was), or never when it reloads.
 */
export async function importConfig(file: File): Promise<string> {
  if (file.size > MAX_CONFIG_CHARS) return "That file is too big to be a character config.";
  let text: string;
  try {
    text = await file.text();
  } catch {
    return "That file couldn't be read.";
  }
  const config = configFromMarkdown(text);
  if (!config) return "That file has no Face to Voice config in it (the settings block is missing or not valid).";
  const { set, remove } = configStorage(config);
  const skipped: string[] = [];
  try {
    for (const key of remove) sessionStorage.removeItem(key);
    for (const [key, value] of Object.entries(set)) {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        skipped.push(key); // a texture image too big for this tab's storage: the rest still loads
      }
    }
  } catch {
    return "This browser isn't keeping data for the page (private mode?), so the config can't be loaded.";
  }
  if (skipped.length && !confirm("A texture in this config is too big for this tab's storage and will be left out. Load the rest?")) return "Import cancelled.";
  location.reload();
  return new Promise(() => {}); // the page is going away
}
