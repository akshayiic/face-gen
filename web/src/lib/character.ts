/**
 * Random character and Reset, the two buttons over the head (components/ui/Toolbar.tsx).
 *
 * Random character: a whole new person in one click. A random face (lib/morphs/random.ts) plus a random
 * age, skin and eye colour, hair and hair colour, brows, lashes, maybe a beard, maybe glasses, and an
 * emotion. Pose is left alone. Every piece goes through the same setters the panel uses, so the panel,
 * the saved choices and the voice's look all follow.
 *
 * The change (`transition` below): the new hair and add-ons are built, hidden, while nothing moves yet (usually done
 * already: their files were downloaded ahead). Then everything starts on the same frame: the face morphs into the new
 * one, the emotion blends in, the skin, eye and hair colours blend on the live head (the new pieces were built in the
 * old hair colour and blend with the rest), and the old hair and add-ons cross-fade to the new ones (CHARACTER.styleAt
 * moves that later; lib/pieceFade.ts: the head is rendered with the old pieces and with the new ones, both live and
 * opaque, and the two frames are mixed), so there is never a second face and no see-through hair.
 * The simpler options don't hold up: a screenshot cross-fade over the morph shows a double image, a
 * dip to the backdrop hides the morph, and fading the pieces themselves dissolves or turns patchy.
 *
 * Rolled ahead (`prepareNext`): the next character's style is picked and its files download in idle time a few seconds
 * after the page loads, as soon as a change's own pieces are on (during its morph), and when the pointer reaches the
 * button, so the click finds them waiting. Only the face, age and expression are rolled at click time; age's effect on
 * the hair (grey, bald) is applied then, with the same odds.
 *
 * Tweak the odds and timings in CHARACTER. A profile ("Random Indian woman", lib/characterProfiles.ts) swaps the odds for
 * its own: colouring, hair, brows, lashes, a woman's Age range and a feminine-presenting lean on the face.
 */
import { precompile } from "@/lib/sceneRig";
import { type CharacterProfile, INDIAN_WOMAN, womanLean } from "@/lib/characterProfiles";
import {
  ADDON_CATEGORIES,
  ADDON_DEFAULTS,
  addonState,
  addonStyleById,
  addonStyles,
  setAddonStyle,
  setFacialHairColour,
  type AddonCategory,
  type AddonStyle,
  type FacialHairColour,
} from "@/lib/addons";
import { NATURAL_HAIR } from "@/lib/swatches";
import { emotionDefs, MODELS_BASE, sliders, visibleSliders, type Weights } from "@/lib/data";
import { AGE } from "@/lib/age";
import { NEUTRAL, setEmotion, setIntensity } from "@/lib/emotion";
import { EYE_COLOURS, EYE_DEFAULT, setEyeColour, type EyeColourId } from "@/lib/eyes";
import { canTie, HAIR_COLOURS, HAIR_DEFAULTS, HAIR_STYLES, hairFileUrl, hairState, hairStyleById, setHairColour, setHairStyle, setHairWear, type HairColourId, type HairStyle } from "@/lib/hair";
import { preload, whenRevealed } from "@/lib/headLoad";
import { finishPieceFade, openPieceFade, pieceFade, runPieceFade } from "@/lib/pieceFade";
import { askLimiter } from "@/lib/morphs/capsClient";
import { clearRandomFace, randomFace, randomFaceAsync, teethOf } from "@/lib/morphs/random";
import { MOTION } from "@/lib/motion";
import { morphs } from "@/lib/morphs/store";
import { centrePose } from "@/lib/pose";
import { resetFineShape } from "@/lib/sculpt";
import { setSkinTone, SKIN_DEFAULT, SKIN_TONES, type SkinToneId } from "@/lib/skin";
import { setSkinDetails, type SkinDetails } from "@/lib/skinDetails";
import { whenIdle } from "@/lib/whenIdle";

/** Tweak freely. Chances are 0..1; weights are relative. */
export const CHARACTER = {
  duration: MOTION.morph, // seconds for the face to morph into the new one (colours, expression and pose change as long)
  holdFor: 5, // seconds the morph may wait for the new hair and add-ons, so everything changes together (maxDownload and maxAttach end it sooner)
  aheadAfterLoad: 4, // seconds after the head appears before the first character's files download ahead
  styleAt: 0, // seconds after the morph starts when the hair and add-ons cross-fade: 0 = with the morph, 0.9 = after it
  styleFade: MOTION.crossfade, // seconds for the old hair and add-ons to fade out and the new ones in
  maxDownload: 3, // seconds to wait for new hair / add-on files before changing anyway (they then pop in late)
  maxAttach: 1, // seconds to wait for them to be built and attached (and again for their shaders) before fading anyway
  age: [-0.7, 0.9] as const, // the Age slider's random range (−1 young … +1 old)
  bald: 0.08, // chance of no hair …
  baldWhenOld: 0.25, // … once Age is past `old` (at least `bald`)
  old: 0.5, // Age from which grey and white hair become likely
  greyWhenOld: 0.6, // chance of grey or white hair past `old`
  facialHair: 0.25,
  glasses: 0.25,
  /** Hair colours when not grey: "natural" shows the style's own painted colour. */
  hairColours: {
    natural: 3, black: 2, "dark-brown": 2, brown: 2, auburn: 1, blonde: 1, platinum: 0.4, ginger: 0.6,
    // dyed: about one random character in fifteen
    "pastel-pink": 0.15, "hot-pink": 0.1, "cherry-red": 0.15, purple: 0.1, lavender: 0.1, "electric-blue": 0.1, teal: 0.1, green: 0.05,
  } as Record<string, number>,
  /** Emotions: neutral and happy come up most, the rest now and then. Unlisted emotions weigh 1. */
  emotions: { [NEUTRAL]: 3, happy: 3 } as Record<string, number>,
  intensity: [0.35, 0.9] as const,
  /**
   * Distinctiveness of the face (lib/morphs/random.ts): chance of each band; a band rolls uniformly in [from, to].
   * 1 = a typical face; above 1 a few Feature sliders head toward their wide ends. The panel's slider shows the roll.
   */
  distinctiveness: [
    { chance: 0.7, from: 1, to: 1 },
    { chance: 0.2, from: 1.5, to: 2 },
    { chance: 0.1, from: 2, to: 2.25 },
  ],
  /** From this skin tone on (lightest first in SKIN_TONES), eyes are brown most of the time. */
  darkSkinFrom: "bronze" as string,
  brownEyes: 0.9,
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const chance = (p: number) => Math.random() < p;
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** A Distinctiveness from CHARACTER.distinctiveness (bands by chance, uniform inside a band, two decimals). */
function rollDistinctiveness(): number {
  const bands = CHARACTER.distinctiveness;
  let r = Math.random() * bands.reduce((sum, b) => sum + b.chance, 0);
  const band = bands.find((b) => (r -= b.chance) < 0) ?? bands[0];
  return Math.round(rand(band.from, band.to) * 100) / 100;
}

/** Weighted pick from { id: weight }. */
function pickWeighted(weights: Record<string, number>): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of entries) if ((r -= w) < 0) return id;
  return entries[entries.length - 1][0];
}

/** Any style of an add-on category except "none". */
const anyStyle = (category: AddonCategory) => pick(addonStyles(category)).id;

/** Everything worn or coloured: what `transition` blends and swaps in. */
type Style = {
  skin: SkinToneId;
  eyes: EyeColourId;
  hair: HairStyle;
  hairColour: HairColourId;
  addons: Record<AddonCategory, AddonStyle>;
  facialHairColour: FacialHairColour;
};

/**
 * A random character's style before its age is known: skin, eyes, hair, a non-grey hair colour, brows, lashes, maybe a
 * beard and glasses. randomCharacter makes it grey or bald by age.
 */
function rollStyle(profile: CharacterProfile = "any"): Style {
  if (profile === "indian-woman") return rollIndianWomanStyle();
  // Colouring: eye colour leans on skin tone.
  const tone = Math.floor(Math.random() * SKIN_TONES.length);
  const browns = EYE_COLOURS.filter((c) => c.id.includes("brown"));
  const eyes = (tone >= SKIN_TONES.findIndex((t) => t.id === CHARACTER.darkSkinFrom) && chance(CHARACTER.brownEyes) ? pick(browns) : pick(EYE_COLOURS)).id;
  const colour = pickWeighted(CHARACTER.hairColours);
  // Brows and lashes always; beard and glasses by chance. The beard wears the hair colour.
  return {
    skin: SKIN_TONES[tone].id,
    eyes,
    hair: chance(CHARACTER.bald) ? "none" : pick(HAIR_STYLES).id,
    hairColour: (HAIR_COLOURS.find((c) => c.id === colour) ?? NATURAL_HAIR).id,
    addons: {
      eyebrows: anyStyle("eyebrows"),
      eyelashes: anyStyle("eyelashes"),
      facialHair: chance(CHARACTER.facialHair) ? anyStyle("facialHair") : "none",
      glasses: chance(CHARACTER.glasses) ? anyStyle("glasses") : "none",
    },
    facialHairColour: "hair",
  };
}

/**
 * A woman or girl from India (lib/characterProfiles.ts): the colouring and styling, before her age is known. No beard,
 * never bald; the hair is mostly long, shoulder length or tied back, black or dark brown.
 */
function rollIndianWomanStyle(): Style {
  const P = INDIAN_WOMAN;
  const group = pickWeighted(P.hairGroups);
  const wavy = chance(P.curly);
  const styles = HAIR_STYLES.filter((s) => s.group === group && !!s.curly === wavy);
  const pool = styles.length ? styles : HAIR_STYLES.filter((s) => s.group === group);
  const hairColour = pickWeighted(P.hairColours);
  return {
    skin: pickWeighted(P.skin) as SkinToneId,
    eyes: pickWeighted(P.eyes) as EyeColourId,
    hair: (pool.length ? pick(pool) : pick(HAIR_STYLES)).id,
    hairColour: (HAIR_COLOURS.find((c) => c.id === hairColour) ?? NATURAL_HAIR).id,
    addons: {
      eyebrows: pickWeighted(P.eyebrows),
      eyelashes: pickWeighted(P.eyelashes),
      facialHair: "none",
      glasses: chance(P.glasses) ? anyStyle("glasses") : "none",
    },
    facialHairColour: "hair",
  };
}

/** Lip colour for a woman of this Age (lib/skinDetails.ts): none on a girl, a soft shade and maybe a liner on an adult. */
function rollLips(age: number): Partial<SkinDetails> {
  const P = INDIAN_WOMAN;
  const bare = { lipColour: "", lipLiner: 0, lipLinerColour: "", lipGloss: 1 };
  if (age < P.girlBelow || !chance(P.lipstick)) return bare;
  const liner = chance(P.lipLiner[0]);
  return {
    lipColour: pick(P.lipShades),
    lipOpacity: Math.round(rand(0.5, 0.9) * 20) / 20,
    lipLiner: liner ? Math.round(rand(0.1, P.lipLiner[1]) * 20) / 20 : 0,
    lipLinerColour: "", // automatic: a darker shade of the lipstick
    lipGloss: Math.round(rand(0.6, 1.4) * 20) / 20,
  };
}

/** The add-ons `style` puts on that aren't on the head already. */
const newAddons = (style: Style) =>
  ADDON_CATEGORIES.flatMap((c) => (style.addons[c] === "none" || style.addons[c] === addonState[c] ? [] : (addonStyleById(c, style.addons[c]) ?? [])));

/** The files `style` needs that aren't on the head already (production hair: Vercel Blob). */
function filesFor(style: Style): string[] {
  const hair = style.hair === "none" || style.hair === hairState.style ? undefined : hairStyleById(style.hair);
  return [...(hair ? [hairFileUrl(hair)] : []), ...newAddons(style).map((def) => MODELS_BASE + def.file)];
}

/** Small files the add-on loaders fetch for themselves (a lash line's lid fix, a beard's stubble mask). */
const sideFilesFor = (style: Style) =>
  newAddons(style).flatMap((def) => [def.strands?.lidFix?.file, def.stubbleMask].filter((f) => f !== undefined).map((f) => MODELS_BASE + f));

/** The next Random character's style, rolled ahead (prepareNext). */
let next: Style | undefined;

/** The visitor's browser asks for less data: nothing downloads ahead. */
const saveData = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

/**
 * Roll the next Random character's style now and download its files at low priority, so the click finds them waiting.
 * Called once a change's pieces are on and when the pointer or keyboard focus reaches the button. Does
 * nothing if one is already waiting; with Save-Data on, the style is rolled but nothing downloads early.
 */
export function prepareNext(): void {
  if (next || building) return; // never while a change downloads and builds its own pieces: they would compete
  next = rollStyle();
  if (saveData()) return;
  for (const url of filesFor(next)) void preload(url, "low");
  // into the HTTP cache (the asset URLs are immutable), where those loaders' own fetches find them
  for (const url of sideFilesFor(next)) void fetch(url, { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {});
}


/**
 * The first character, rolled ahead a little after the page has loaded (Toolbar mounts it), so even
 * the first tap finds its files.
 */
export function prepareFirst(): void {
  void whenRevealed(20_000)
    .then(() => wait(CHARACTER.aheadAfterLoad))
    .then(() => whenIdle(prepareNext, 2000, 200));
}

// One transition at a time: a newer click supersedes an older one that is still downloading.
let run = 0;

/** The last transition, fully landed: the morph finished and the pieces faded (see characterSettled). */
let settled: Promise<void> = Promise.resolve();
/** A Random character / Reset is still downloading or building its pieces. */
let building = false;

/**
 * Resolves once the last Random character / Reset has fully landed: the face morph has finished and the hair
 * and add-ons have cross-faded. The voice screenshot waits for it (VoicePanel): mid-change, the two-render fade
 * isn't in a single render, and the face would be half-morphed. Waits again if a newer change starts meanwhile.
 */
export async function characterSettled(): Promise<void> {
  for (let current = settled; ; current = settled) {
    await current;
    if (current === settled) return;
  }
}

type Change = { landed: Promise<void>; morphed: Promise<void> };

/** Start a transition and remember when it has fully landed. A failed change has landed too (what made it on stays). */
function track(change: Change): Promise<void> {
  const landed = change.landed.catch((err: unknown) => console.warn("[character] change failed:", err));
  settled = Promise.all([landed, change.morphed]).then(() => {});
  return landed;
}

/**
 * Build the new hair and add-ons hidden; once `faceReady` has resolved and the pieces are ready (or
 * CHARACTER.holdFor has passed), run `motion` (the face morph, emotion, pose), blend the colours
 * and cross-fade the pieces, together. `landed` resolves when that fade has finished (the Toolbar
 * keeps its buttons disabled until then), `morphed` when the morph has.
 */
function transition(style: Style, motion: () => void, faceReady: Promise<unknown> = Promise.resolve()): Change {
  const id = ++run;
  let started = () => {};
  const morphed = new Promise<void>((resolve) => (started = resolve)).then(() => wait(CHARACTER.duration));
  // 1. The colours, started with the morph (3.): on the hair, brows, lashes and beard shown then, new ones included.
  const colours = () => {
    setSkinTone(style.skin, CHARACTER.duration);
    setEyeColour(style.eyes, CHARACTER.duration);
    setHairColour(style.hairColour, CHARACTER.duration);
    if (addonState.facialHairColour !== style.facialHairColour) setFacialHairColour(style.facialHairColour, CHARACTER.duration);
  };
  // 2. The new pieces: downloaded (usually already, prepareNext), then put on hidden in a cross-fade batch. Re-applying
  //    an unchanged piece would re-tint it at once and cut its colour blend short, so those are left alone.
  let opened = false;
  building = true;
  const ready = (async () => {
    const urls = filesFor(style);
    if (urls.length) await within(Promise.all(urls.map((url) => preload(url))), CHARACTER.maxDownload);
    if (id !== run) return;
    openPieceFade();
    opened = true;
    const attached = [
      style.hair !== hairState.style && setHairStyle(style.hair, true),
      ...ADDON_CATEGORIES.map((c) => style.addons[c] !== addonState[c] && setAddonStyle(c, style.addons[c], true)),
    ];
    await within(Promise.all(attached), CHARACTER.maxAttach);
    await within(precompile(pieceFade.arriving), CHARACTER.maxAttach); // their shaders, off the main thread, before the first frame
  })();
  void ready
    .catch(() => {})
    .then(() => {
      if (id !== run) return; // a newer change is building its own
      building = false;
      whenIdle(() => !building && prepareNext(), 2000, 200); // the next character's files, during this one's morph
    });
  const landed = (async () => {
    try {
      // 3. The morph, the colours and (styleAt 0) the pieces' cross-fade together, once the face is worked out and the
      //    pieces are on (or the hold is up: then they fade in late).
      await Promise.all([within(ready.catch(() => {}), CHARACTER.holdFor), faceReady]);
      if (id === run) {
        motion();
        colours();
      }
      started();
      await ready;
      if (CHARACTER.styleAt > 0) await wait(CHARACTER.styleAt); // (a 0 s timer would start the fade a frame late)
      if (!opened) return;
      if (id !== run) return finishPieceFade();
      await runPieceFade(CHARACTER.styleFade);
    } catch (err) {
      if (id === run) finishPieceFade(); // never leave the batch open: later swaps would wait for a fade that never runs
      throw err;
    } finally {
      started();
    }
  })();
  return { landed, morphed };
}

const wait = (seconds: number) => new Promise<void>((r) => setTimeout(r, seconds * 1000));

const within = (work: Promise<unknown>, seconds: number) => Promise.race([work, wait(seconds)]);

/**
 * A new character in one click. `profile` "indian-woman" draws a woman or girl from India instead (lib/characterProfiles.ts):
 * the colouring, hair and styling, a youthful-to-mature Age and a feminine-presenting lean on the face.
 */
export function randomCharacter(profile: CharacterProfile = "any"): Promise<void> {
  const woman = profile === "indian-woman";
  // The face first, so a seeded Math.random (the stress test) gives the same faces whether or not a
  // style was rolled ahead.
  const age = woman ? rand(...INDIAN_WOMAN.age) : rand(...CHARACTER.age);
  const old = age >= CHARACTER.old;
  const distinctiveness = woman ? Math.min(1.5, rollDistinctiveness()) : rollDistinctiveness(); // typical faces, a few striking ones
  // drawn now, fitted to the limiter off the main thread (a distinctive face is seconds of checks on a phone)
  const defs = visibleSliders();
  const hold: Weights = { ...teethOf(defs, morphs.base), [AGE.target]: age }; // the teeth stay as they are
  if (woman) Object.assign(hold, womanLean(Object.fromEntries(defs.map((d) => [d.target, d])))); // a feminine-presenting lean
  let face: Weights | null = null;
  const faceReady = randomFaceAsync(defs, askLimiter, distinctiveness, hold)
    .catch(() => randomFace(defs, distinctiveness, hold)) // the worker went wrong: fitted here
    .then((f) => void (face = f));
  // Expression.
  const odds = woman ? INDIAN_WOMAN.emotions : CHARACTER.emotions;
  const weights = Object.fromEntries([NEUTRAL, ...emotionDefs.map((e) => e.id)].map((id) => [id, odds[id] ?? (woman ? INDIAN_WOMAN.otherEmotions : 1)]));
  const emotion = pickWeighted(weights);
  const [loI, hiI] = woman ? INDIAN_WOMAN.intensity : CHARACTER.intensity;
  const intensity = Math.round(rand(loI, hiI) * 100) / 100;

  // The style rolled ahead (or now), then by age: balder and greyer (same odds as rolling with the age known). A profile
  // rolls its own style (the one rolled ahead stays for the next plain Random character).
  const style = woman ? rollStyle(profile) : (next ?? rollStyle());
  if (!woman) next = undefined;
  if (!woman && old && style.hair !== "none" && chance((CHARACTER.baldWhenOld - CHARACTER.bald) / (1 - CHARACTER.bald))) style.hair = "none";
  if (old && chance(woman ? 0.45 : CHARACTER.greyWhenOld)) style.hairColour = pick(["grey", "white"]);
  // Hair worn down, or sometimes a low ponytail; lip colour on an adult, none on a girl.
  const tied = woman && canTie(style.hair) && chance(INDIAN_WOMAN.tieWhenTiable);
  const lips = woman ? rollLips(age) : undefined;

  return track(transition(style, () => {
    if (woman) {
      setHairWear({ tie: tied ? "low" : "down", framing: true, volume: 0, frizz: 0.12 });
      setSkinDetails(lips ?? {});
    }
    // Face and age: one tween, so the shape and the skin's ageing move together.
    // (the Age is fitted with the face: an age set afterwards could break a face that only fits at rest)
    if (face) morphs.tweenTo(face, CHARACTER.duration); // (null: Reset or another random face took over meanwhile)
    setEmotion(emotion, CHARACTER.duration); // the expression on the face's clock, not the emotion buttons' quicker blend
    setIntensity(intensity, "code", CHARACTER.duration);
  }, faceReady));
}

/**
 * Reset: a first visit, i.e. a blank head. The face (every slider, Age, fine-tune, the fine shape and any sculpting:
 * lib/sculpt.ts, undoable there) at rest, default skin and eyes,
 * no hair, brows, lashes, beard or glasses (HAIR_DEFAULTS / ADDON_DEFAULTS), no emotion at the default intensity,
 * and a centred pose. "Look at cursor" is a device preference and stays. Same two steps as Random character.
 */
export function resetCharacter(): Promise<void> {
  const { facialHairColour, ...addons } = ADDON_DEFAULTS;
  const style: Style = { skin: SKIN_DEFAULT, eyes: EYE_DEFAULT, hair: HAIR_DEFAULTS.style, hairColour: HAIR_DEFAULTS.colour, addons, facialHairColour };
  return track(transition(style, () => {
    morphs.reset(CHARACTER.duration);
    resetFineShape();
    clearRandomFace();
    setEmotion(NEUTRAL, CHARACTER.duration);
    setIntensity(sliders.emotions.intensity.default, "code", CHARACTER.duration);
    centrePose(CHARACTER.duration);
  }));
}
