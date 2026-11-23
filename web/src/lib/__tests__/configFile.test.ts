/**
 * The config file (lib/export/configFile.ts): Markdown out and back in, embedded texture images, a plain
 * character.json, what importing writes into sessionStorage, and files that aren't ours.
 */
import { describe, expect, it } from "vitest";

import { CHARACTER_FORMAT, type CharacterFile } from "@/lib/export/characterCode";
import { CONFIG_FORMAT, configFromMarkdown, configStorage, configToMarkdown, type ConfigFile } from "@/lib/export/configFile";
import { SCULPT_KEY, STORAGE_KEYS, TEXTURE_KEYS, VIEW_KEYS } from "@/lib/storageKeys";

const character: CharacterFile = {
  format: CHARACTER_FORMAT,
  version: 1,
  sliders: 2,
  shape: { sem_age: -0.4, sem_cheekbones: 0.3 },
  emotion: "happy",
  intensity: 0.6,
  pose: { headYaw: 10, headPitch: 0, headRoll: 0, gazeYaw: 0, gazePitch: 0 },
  hair: { style: "haircs-v0-00081", colour: "black" },
  addons: { eyebrows: "full", eyelashes: "volume", facialHair: "none", glasses: "none" },
  skin: "warm-golden",
  eyes: "brown",
  clothes: { style: "vneck", colour: "#2b2b2e", inner: "#f2f0ec", fabric: "cotton", fit: 0, shoulders: 0, build: 0, neckline: 0 },
  skinDetails: { blush: 0.15, freckles: 0, moles: 2, moleSize: 0.3, moleSeed: 5, pores: 1, underEye: 1, variation: 1, veins: 0.4, wrinkles: 0.5, sun: 0.3 },
  marks: [{ type: "scar", at: [40, 268, 100], normal: [0.55, 0, 0.83], angle: -35, length: 30, width: 2.2, healed: 0.85, seed: 11 }],
  fineShape: { sliders: { nasolabial: 0.8 }, asymmetry: 0.2, asymSeed: 4 },
};
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const config: ConfigFile = {
  format: CONFIG_FORMAT,
  version: 1,
  savedAt: "2026-11-20T16:40:00.000Z",
  character,
  textures: { skin: { name: "pores | close-up.jpg", settings: { mode: "uv", amount: 0.8, scale: 60, keepTone: true }, image: IMG } },
  finish: { on: true, focus: 0.5, bloom: 0.5, grain: 0.5, vignette: 0.5, grade: 0.5 },
};

describe("config file", () => {
  it("round-trips through Markdown, images and all", () => {
    const md = configToMarkdown(config, { sem_age: "Age" });
    expect(md).toContain("# Face to Voice character config");
    expect(md).toContain("| Age | -0.40 |"); // the slider's name, not its target id
    expect(md).toContain("pores \\| close-up.jpg"); // a pipe in a file name can't break the table
    expect(md).toContain("![ftv:skin-texture](data:image/jpeg;base64,");
    expect(md.match(/data:image\/jpeg/g)).toHaveLength(1); // the image once, not again inside the JSON
    expect(configFromMarkdown(md)).toEqual(config);
    expect(md).toContain("| 1. scar | 30 mm, 85 % healed |");
    expect(md).toContain("| nasolabial | +0.80 |");
  });

  it("carries the sculpt in its own block, and a config without one clears the tab's", () => {
    const sculpt = "s1:AAABAAIA";
    const md = configToMarkdown({ ...config, sculpt });
    expect(md).toContain("```ftv-sculpt\ns1:AAABAAIA\n```");
    expect(md).toContain('"sculpt": "embedded below"');
    const back = configFromMarkdown(md)!;
    expect(back.sculpt).toBe(sculpt);
    expect(configStorage(back).set[SCULPT_KEY]).toBe(sculpt);
    expect(configStorage(config).remove).toContain(SCULPT_KEY);
  });

  it("reads a file saved without images, and a CRLF copy", () => {
    const withoutImage: ConfigFile = { ...config, textures: { skin: { ...config.textures!.skin!, image: undefined } } };
    const md = configToMarkdown(withoutImage).replace(/\n/g, "\r\n");
    expect(md).toContain("(image not included)");
    const back = configFromMarkdown(md)!;
    expect(back.textures?.skin?.image).toBeUndefined();
    expect(back.character).toEqual(character);
  });

  it("imports a plain character.json, leaving textures and camera alone", () => {
    const back = configFromMarkdown(JSON.stringify(character))!;
    expect(back.character).toEqual(character);
    expect(back.textures).toBeUndefined();
    expect(back.finish).toBeUndefined();
    const { set, remove } = configStorage(back);
    expect(remove).toEqual([SCULPT_KEY]); // another character's sculpt never stays on this face
    expect(Object.keys(set)).not.toContain(TEXTURE_KEYS.skin);
    expect(Object.keys(set)).not.toContain(VIEW_KEYS.finish);
  });

  it("writes the entries a reload reads", () => {
    const { set, remove } = configStorage(config);
    expect(JSON.parse(set[STORAGE_KEYS.hair])).toEqual(character.hair);
    expect(set[STORAGE_KEYS.skin]).toBe("warm-golden");
    expect(JSON.parse(set[TEXTURE_KEYS.skin])).toEqual({ name: "pores | close-up.jpg", url: IMG });
    expect(JSON.parse(set[`${TEXTURE_KEYS.skin}:settings`]).mode).toBe("uv");
    expect(JSON.parse(set[VIEW_KEYS.finish]).focus).toBe(0.5);
    expect(JSON.parse(set[STORAGE_KEYS.marks])).toEqual(character.marks);
    expect(JSON.parse(set[STORAGE_KEYS.fineShape])).toEqual(character.fineShape);
    // the file had no hair texture or scanned maps: the tab's are cleared, and so is any sculpt
    expect(remove).toEqual([
      TEXTURE_KEYS.hair, `${TEXTURE_KEYS.hair}:settings`,
      TEXTURE_KEYS.skinMicro, `${TEXTURE_KEYS.skinMicro}:settings`,
      TEXTURE_KEYS.skinNormal, `${TEXTURE_KEYS.skinNormal}:settings`,
      TEXTURE_KEYS.skinRough, `${TEXTURE_KEYS.skinRough}:settings`,
      TEXTURE_KEYS.skinCavity, `${TEXTURE_KEYS.skinCavity}:settings`,
      SCULPT_KEY,
    ]);
    // saved without its image: the settings load, the tab keeps its own image
    const kept = configStorage({ ...config, textures: { skin: { ...config.textures!.skin!, image: undefined } } });
    expect(kept.set).not.toHaveProperty(TEXTURE_KEYS.skin);
    expect(kept.set).toHaveProperty(`${TEXTURE_KEYS.skin}:settings`);
  });

  it("refuses files that aren't a config", () => {
    expect(configFromMarkdown("# Notes\n\nNothing here.")).toBeNull();
    expect(configFromMarkdown("```json\n{ \"format\": \"something-else\" }\n```")).toBeNull();
    expect(configFromMarkdown("```json\n{ not json\n```")).toBeNull();
    const newer = configToMarkdown(config).replace('"version": 1,\n  "savedAt"', '"version": 99,\n  "savedAt"');
    expect(configFromMarkdown(newer)).toBeNull();
    // an embedded "image" that isn't one is dropped
    const bad = configToMarkdown(config).replace(/!\[ftv:skin-texture\]\([^)]*\)/, "![ftv:skin-texture](data:text/html;base64,PGI+)");
    expect(configFromMarkdown(bad)!.textures?.skin?.image).toBeUndefined();
  });
});
