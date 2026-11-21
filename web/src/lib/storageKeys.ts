/**
 * The sessionStorage keys the look is kept under: across reloads, while a new tab opens on the blank head. The rebuild
 * link (lib/export/characterCode.ts) writes the same entries, so each name is written once, here. No imports: the
 * link is read before anything else restores.
 */
export const STORAGE_KEYS = {
  face: "ftv-face", pose: "ftv-pose", hair: "ftv-hair", addons: "ftv-addons", skin: "ftv-skin", eyes: "ftv-eyes", clothes: "ftv-clothes",
  skinDetails: "ftv-skin-details", marks: "ftv-marks", fineShape: "ftv-fine-shape",
} as const;

/**
 * Sculpting (lib/sculpt.ts): an offset for every skin vertex, far too big for a rebuild link; this tab and the config
 * file only.
 */
export const SCULPT_KEY = "ftv-sculpt";

/**
 * Uploaded textures (lib/surfaceTextures.ts): this tab only, never in a rebuild link (an image is far too big for one).
 */
export const TEXTURE_KEYS = {
  skin: "ftv-skin-texture", hair: "ftv-hair-texture",
  // scanned maps in the head's UV layout (normal, roughness, cavity)
  skinNormal: "ftv-skin-normal", skinRough: "ftv-skin-rough", skinCavity: "ftv-skin-cavity",
} as const;

/** The camera finish (lib/finishSettings.ts): how the view is drawn, not part of the character or its link. */
export const VIEW_KEYS = { finish: "ftv-finish" } as const;
