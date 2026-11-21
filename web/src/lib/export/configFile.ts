/**
 * The whole setup as one Markdown file (Save config / Import config): the character (the same data as a rebuild link:
 * scars and marks and the fine shape included), the sculpt (lib/sculpt.ts: too big for a link, so in its own block at
 * the end), the uploaded textures with their settings (skin, hair, and the scanned normal, roughness and cavity maps),
 * and the camera finish and light.
 *
 * People read the tables; the app reads the JSON block back, and the texture images embedded at the end as data-URL
 * images (they show in any Markdown viewer). Importing writes the file into the sessionStorage entries a reload reads
 * and reloads, so every value goes through the app's usual checks (unknown ids ignored, numbers clamped). A plain
 * character.json, or a JSON block of one, imports too (the textures and camera then stay as they are).
 *
 * Pure: no app state (lib/export/config.ts reads the live setup and does the download and the import).
 */
import { SCULPT_KEY, TEXTURE_KEYS, VIEW_KEYS } from "@/lib/storageKeys";

import { CHARACTER_FORMAT, checkCharacter, storageEntries, type CharacterFile } from "./characterCode";

export const CONFIG_FORMAT = "face-to-voice/config";
export const CONFIG_VERSION = 1;

export type TextureSlot = keyof typeof TEXTURE_KEYS;
export const TEXTURE_SLOTS = Object.keys(TEXTURE_KEYS) as TextureSlot[];

export type TextureEntry = {
  /** The uploaded file's name. */
  name: string;
  /** As lib/surfaceTextures.ts keeps them (checked again on restore). */
  settings: Record<string, unknown>;
  /** The image as a data URL; missing when the file was saved without images (the tab's own image then stays). */
  image?: string;
};

export interface ConfigFile {
  format: typeof CONFIG_FORMAT;
  version: number;
  savedAt: string;
  character: CharacterFile;
  /** Per slot; a slot that is missing had no texture. Undefined: the file says nothing about textures (keep the tab's). */
  textures?: Partial<Record<TextureSlot, TextureEntry>>;
  /** lib/finishSettings.ts; undefined: keep the tab's. */
  finish?: Record<string, unknown>;
  /** lib/sculpt.ts encodeSculpt ("s1:…"); undefined: none (an imported character never keeps another face's sculpt). */
  sculpt?: string;
}

/** Biggest file we'll read, and biggest embedded image (a 1024 px JPEG is ~0.2–0.5 MB as a data URL). */
export const MAX_CONFIG_CHARS = 30_000_000;
const MAX_IMAGE_CHARS = 12_000_000;
const IMAGE_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const IMAGE_LINE = /!\[ftv:(\w+)-texture\]\((data:image\/[^)\s]+)\)/g;
const JSON_BLOCK = /```json[^\n]*\r?\n([\s\S]*?)\r?\n```/g;
const SCULPT_BLOCK = /```ftv-sculpt\r?\n(s1:[A-Za-z0-9+/=]+)\r?\n```/;
const MAX_SCULPT_CHARS = 4_000_000;

const SLOT_LABEL: Record<TextureSlot, string> = {
  skin: "Skin texture", hair: "Hair texture", skinNormal: "Skin normal map", skinRough: "Skin roughness map", skinCavity: "Skin cavity map",
};

// --- writing ---------------------------------------------------------------------------------------------------------

const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const table = (head: [string, string], rows: [string, unknown][]) =>
  [`| ${head[0]} | ${head[1]} |`, "|---|---|", ...rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`)].join("\n");
const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)} %` : "—");
const num = (v: unknown, places = 2) => (typeof v === "number" ? (v > 0 ? "+" : "") + v.toFixed(places) : "—");
const deg = (v: unknown) => (typeof v === "number" ? `${Math.round(v)}°` : "—");
const words = (id: unknown) => (typeof id === "string" && id ? id.replace(/[-_]/g, " ") : "—");

function textureSummary(slot: TextureSlot, e: TextureEntry): string {
  const s = e.settings;
  if (slot !== "skin") return `strength ${pct(s.amount)}`;
  const mode = s.mode === "uv" ? "painted map (UV)" : `skin photo, tiled every ${typeof s.scale === "number" ? Math.round(s.scale) : "?"} mm`;
  return `${mode}, strength ${pct(s.amount)}${s.keepTone === false ? ", its own colours" : ", keeps the skin tone"}`;
}

/**
 * The Markdown file. `labels`: slider names by morph target (the Shape table shows them; ids otherwise). Images go in
 * only when the entries carry them.
 */
export function configToMarkdown(c: ConfigFile, labels: Record<string, string> = {}): string {
  const ch = c.character;
  const a = ch.addons ?? {};
  const out: string[] = [];
  out.push("# Face to Voice character config", "");
  out.push(`Saved ${c.savedAt.replace("T", " ").slice(0, 16)} UTC. To load it, open Face to Voice and choose **Config → Import config**.`, "");

  out.push("## Look", "");
  out.push(
    table(["", ""], [
      ["Skin tone", words(ch.skin)],
      ["Eye colour", words(ch.eyes)],
      ["Hair", ch.hair.style === "none" ? "none" : `${ch.hair.style}, ${words(ch.hair.colour)}`],
      ["Eyebrows", words(a.eyebrows)],
      ["Eyelashes", words(a.eyelashes)],
      ["Facial hair", a.facialHair && a.facialHair !== "none" ? `${words(a.facialHair)}${a.facialHairColour ? `, ${words(a.facialHairColour)}` : ""}` : "none"],
      ["Glasses", words(a.glasses)],
      ["Expression", `${words(ch.emotion)}, ${pct(ch.intensity)}`],
      ["Head", `turn ${deg(ch.pose.headYaw)}, tilt ${deg(ch.pose.headPitch)}, roll ${deg(ch.pose.headRoll)}`],
      ["Gaze", `${deg(ch.pose.gazeYaw)} across, ${deg(ch.pose.gazePitch)} up`],
    ]),
    "",
  );

  const clothes = (ch.clothes ?? {}) as Record<string, unknown>;
  out.push("## Clothes", "");
  if (!clothes.style || clothes.style === "none") out.push("None.", "");
  else
    out.push(
      table(["", ""], [
        ["Style", words(clothes.style)],
        ["Colour", clothes.colour],
        ["Inner layer", clothes.inner],
        ["Fabric", words(clothes.fabric)],
        ["Fit", num(clothes.fit)],
        ["Shoulders", num(clothes.shoulders)],
        ["Build", num(clothes.build)],
        ["Neckline", num(clothes.neckline)],
      ]),
      "",
    );

  out.push("## Shape", "");
  const shape = Object.entries(ch.shape).sort(([x], [y]) => (labels[x] ?? x).localeCompare(labels[y] ?? y));
  out.push(shape.length ? table(["Slider", "Value"], shape.map(([t, v]) => [labels[t] ?? t, num(v)])) : "Every slider at rest.", "");

  const d = (ch.skinDetails ?? {}) as Record<string, unknown>;
  out.push("## Skin details", "");
  out.push(
    table(["", ""], [
      ["Blush", pct(d.blush)],
      ["Freckles", pct(d.freckles)],
      ["Moles", typeof d.moles === "number" ? `${d.moles} (size ${pct(d.moleSize)}, placement ${d.moleSeed ?? 1})` : "—"],
      ["Pores", typeof d.pores === "number" ? `×${d.pores.toFixed(2)}` : "—"],
      ["Under the eyes", typeof d.underEye === "number" ? `×${d.underEye.toFixed(2)}` : "—"],
      ["Tone variation", typeof d.variation === "number" ? `×${d.variation.toFixed(2)}` : "—"],
      ["Veins", pct(d.veins)],
      ["Wrinkles", pct(d.wrinkles)],
      ["Expression lines", typeof d.expression === "number" ? `×${d.expression.toFixed(2)}` : "—"],
      ["Sun damage", pct(d.sun)],
      ["Sun spots", pct(d.sunSpots)],
      ["Broken capillaries", pct(d.capillaries)],
      ["Oiliness", typeof d.oiliness === "number" ? `×${d.oiliness.toFixed(2)}` : "—"],
      ["Sweat", pct(d.sweat)],
      ["Grime", pct(d.grime)],
    ]),
    "",
  );

  const marks = Array.isArray(ch.marks) ? (ch.marks as Record<string, unknown>[]) : [];
  out.push("## Scars and marks", "");
  out.push(
    marks.length
      ? table(["Mark", "Size, healed"], marks.map((m, i) => [`${i + 1}. ${words(m.type)}`, `${typeof m.length === "number" ? Math.round(m.length) : "?"} mm, ${pct(m.healed)} healed`]))
      : "None.",
    "",
  );

  const fine = (ch.fineShape ?? {}) as { sliders?: Record<string, number>; asymmetry?: number };
  const fineRows: [string, unknown][] = Object.entries(fine.sliders ?? {}).map(([k, v]) => [words(k.replace(/([A-Z])/g, " $1").toLowerCase()), num(v)]);
  if (typeof fine.asymmetry === "number" && fine.asymmetry > 0) fineRows.push(["asymmetry", pct(fine.asymmetry)]);
  fineRows.push(["sculpted by hand", c.sculpt ? "yes (in the sculpt block at the end)" : "no"]);
  out.push("## Fine shape and sculpt", "");
  out.push(table(["", ""], fineRows), "");

  out.push("## Textures", "");
  if (!c.textures) out.push("Not saved in this file.", "");
  else
    out.push(
      table(
        ["Slot", "Texture"],
        TEXTURE_SLOTS.map((slot) => {
          const e = c.textures?.[slot];
          return [SLOT_LABEL[slot], e ? `${e.name}: ${textureSummary(slot, e)}${e.image ? "" : " (image not included)"}` : "none"];
        }),
      ),
      "",
    );

  if (c.finish) {
    const f = c.finish;
    out.push("## Camera", "");
    out.push(
      table(["", ""], [
        ["Light", words(f.light ?? "studio")],
        ["Photo finish", f.on === false ? "off" : "on"],
        ["Skin translucency", pct(f.skin)],
        ["Clarity", pct(f.clarity)],
        ["Depth of field", typeof f.focus === "number" && f.focus > 0 ? `f/${(2 / f.focus).toFixed(1)}` : "off"],
        ["Bloom", pct(f.bloom)],
        ["Colour grade", pct(f.grade)],
        ["Vignette", pct(f.vignette)],
        ["Film grain", pct(f.grain)],
      ]),
      "",
    );
  }

  // the data: images are referenced, not repeated (they follow as Markdown images)
  const data: ConfigFile = {
    ...c,
    textures: c.textures
      ? Object.fromEntries(Object.entries(c.textures).map(([slot, e]) => [slot, { name: e.name, settings: e.settings, image: e.image ? "embedded below" : "not included" }]))
      : undefined,
    sculpt: c.sculpt ? "embedded below" : undefined,
  };
  out.push("## Settings data", "");
  out.push("The app reads this block when you import the file (the tables above are for reading). Values it doesn't know are ignored and numbers are kept in range.", "");
  out.push("```json", JSON.stringify(data, null, 2), "```", "");

  const images = TEXTURE_SLOTS.filter((slot) => c.textures?.[slot]?.image);
  if (images.length) {
    out.push("## Texture images", "");
    for (const slot of images) out.push(`${SLOT_LABEL[slot]} (${cell(c.textures![slot]!.name)}):`, "", `![ftv:${slot}-texture](${c.textures![slot]!.image})`, "");
  }
  if (c.sculpt) {
    out.push("## Sculpt", "");
    out.push("Hand sculpting: an offset for every skin vertex (the app reads it; not meant for reading).", "");
    out.push("```ftv-sculpt", c.sculpt, "```", "");
  }
  return out.join("\n");
}

// --- reading ---------------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validImage = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_IMAGE_CHARS && IMAGE_URL.test(v);

/** The config in a Markdown file (or a JSON file: a config or a plain character.json), or null if there is none. */
export function configFromMarkdown(text: string): ConfigFile | null {
  if (typeof text !== "string" || text.length > MAX_CONFIG_CHARS) return null;
  const images = new Map<string, string>();
  for (const m of text.matchAll(IMAGE_LINE)) if (validImage(m[2])) images.set(m[1], m[2]);
  const candidates: unknown[] = [];
  for (const m of text.matchAll(JSON_BLOCK)) {
    try {
      candidates.push(JSON.parse(m[1]));
    } catch {
      /* not JSON: try the next block */
    }
  }
  if (!candidates.length) {
    try {
      candidates.push(JSON.parse(text)); // a bare JSON file
    } catch {
      return null;
    }
  }
  const sm = text.length ? SCULPT_BLOCK.exec(text) : null;
  const sculpt = sm && sm[1].length <= MAX_SCULPT_CHARS ? sm[1] : undefined;
  for (const raw of candidates) {
    const c = readConfig(raw, images, sculpt);
    if (c) return c;
  }
  return null;
}

function readConfig(raw: unknown, images: Map<string, string>, sculpt?: string): ConfigFile | null {
  if (!isObject(raw)) return null;
  if (raw.format === CHARACTER_FORMAT) {
    const character = checkCharacter(raw);
    return character && { format: CONFIG_FORMAT, version: CONFIG_VERSION, savedAt: "", character };
  }
  if (raw.format !== CONFIG_FORMAT || typeof raw.version !== "number" || raw.version > CONFIG_VERSION) return null;
  const character = checkCharacter(raw.character);
  if (!character) return null;
  const out: ConfigFile = { format: CONFIG_FORMAT, version: CONFIG_VERSION, savedAt: typeof raw.savedAt === "string" ? raw.savedAt.slice(0, 40) : "", character };
  if (isObject(raw.textures)) {
    out.textures = {};
    for (const slot of TEXTURE_SLOTS) {
      const e = raw.textures[slot];
      if (!isObject(e)) continue;
      const image = images.get(slot) ?? (validImage(e.image) ? e.image : undefined);
      out.textures[slot] = { name: typeof e.name === "string" ? e.name.slice(0, 120) : "texture", settings: isObject(e.settings) ? e.settings : {}, ...(image ? { image } : {}) };
    }
  }
  if (isObject(raw.finish)) out.finish = raw.finish;
  if (sculpt) out.sculpt = sculpt;
  return out;
}

/**
 * What importing writes into sessionStorage (then a reload restores it): the character's entries, each texture slot
 * (a slot the file has no texture for is cleared; one saved without its image keeps the tab's image), the camera.
 */
export function configStorage(c: ConfigFile): { set: Record<string, string>; remove: string[] } {
  const set: Record<string, string> = { ...storageEntries(c.character) };
  const remove: string[] = [];
  if (c.textures)
    for (const slot of TEXTURE_SLOTS) {
      const key = TEXTURE_KEYS[slot];
      const e = c.textures[slot];
      if (!e) {
        remove.push(key, `${key}:settings`);
        continue;
      }
      set[`${key}:settings`] = JSON.stringify(e.settings);
      if (e.image) set[key] = JSON.stringify({ name: e.name, url: e.image });
    }
  if (c.finish) set[VIEW_KEYS.finish] = JSON.stringify(c.finish);
  if (c.sculpt) set[SCULPT_KEY] = c.sculpt;
  else remove.push(SCULPT_KEY);
  return { set, remove };
}
