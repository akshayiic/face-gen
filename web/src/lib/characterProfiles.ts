/**
 * Random Indian woman: what the Random character button draws when it is asked for a woman or girl from India
 * (lib/character.ts randomCharacter("indian-woman")).
 *
 * India is one of the most varied places on earth: skin from light wheatish to deep brown, faces of every shape across
 * its regions and communities. There is no single "Indian face", so this does NOT bend the face toward an ethnic
 * template (no per-slider "Indian" nose, eyes or jaw): the face comes from the model's own spread, as for any random
 * character, with only a modest feminine-presenting lean on the sliders that differ between women and men on average
 * (jaw, chin, neck, brow ridge, eye size, lips, cheekbones). What the profile sets is the broadly documented colouring
 * and the way it is styled:
 *   - skin tones across the whole warm light-to-deep range, most in the middle (the lightest and the very darkest rarer),
 *   - dark brown or black hair most of the time (grey with age), mostly long, shoulder length or tied back,
 *   - dark brown eyes most of the time,
 *   - brows and lashes that suit it, no beard, glasses now and then, and a little lip colour on adults.
 * Girls (young Age) get none of the makeup. The model is built from adult head scans, so "girl" is a youthful face, not a
 * child's. Nothing is read from a photo or a person, and nothing sent anywhere. Tweak the odds in INDIAN_WOMAN.
 */
import type { Weights } from "@/lib/data";

export type CharacterProfile = "any" | "indian-woman";

export const INDIAN_WOMAN = {
  /** Age slider (−1 young … +1 old): from a youthful girl to a mature woman. */
  age: [-0.9, 0.6] as const,
  /** Under this Age the character is a girl: no lipstick, no liner. */
  girlBelow: -0.35,
  /** Skin tones (lib/swatches.ts ids) by weight: most in the middle of the warm range. */
  skin: {
    fair: 0.4, light: 1.2, "warm-golden": 2.5, beige: 3, olive: 2.2, tan: 3, honey: 2.4, bronze: 2, caramel: 1.6, brown: 1.4, chestnut: 0.8, "deep-brown": 0.5,
  } as Record<string, number>,
  eyes: { "dark-brown": 8, brown: 2.5, "light-brown": 0.8, hazel: 0.1 } as Record<string, number>,
  /** Hair colour (lib/swatches.ts ids); grey and white come with Age (lib/character.ts). */
  hairColours: { black: 6, "dark-brown": 4, brown: 0.8, natural: 0.4 } as Record<string, number>,
  /** Hair length groups (lib/data.ts HairGroup) by weight, and how often a style may be wavy or curly. */
  hairGroups: { long: 4, shoulder: 3, tied: 2.5, bob: 1.8, short: 0.6 } as Record<string, number>,
  curly: 0.25, // chance of choosing among the wavy and curly styles
  tieWhenTiable: 0.25, // chance that a long or shoulder-length style is worn tied back (a low ponytail)
  eyebrows: { natural: 3, soft: 2, straight: 2, feathered: 2, arched: 2, full: 2, low: 0.6, thin: 0.5, pencil: 0.5 } as Record<string, number>,
  eyelashes: { natural: 3, long: 3, curled: 2, full: 2, thick: 1, straight: 1, short: 0.5, downturned: 0.4, "very-long": 0.5 } as Record<string, number>,
  glasses: 0.12,
  /** Mostly a neutral or friendly face; every other emotion shares `otherEmotions` each. */
  emotions: { neutral: 4, happy: 4 } as Record<string, number>,
  otherEmotions: 0.1,
  intensity: [0.3, 0.75] as const,
  /** Chance of lip colour on an adult, its shades (lib/skinDetails.ts), the liner's chance and strength. */
  lipstick: 0.5,
  lipShades: ["#e8a598", "#d68a86", "#c96f7c", "#c8475f", "#a41f2e", "#8c2a3c", "#b6573a", "#8a5a4a", "#e87a4a"],
  lipLiner: [0.35, 0.25] as const, // chance, and the most strength (it rolls up to this)
  /**
   * The feminine-presenting lean: centre and spread (slider units, a few percent of each slider's range) of the
   * Feature sliders held for a woman. Held values go through the limiter like the rest of the face.
   */
  lean: {
    sem_jaw_width: [-0.35, 0.3],
    sem_chin_width: [-0.35, 0.3],
    sem_jowls: [-0.4, 0.3],
    sem_neck_thickness: [-0.5, 0.35],
    sem_neck_length: [0.2, 0.3],
    sem_brow_ridge: [-0.4, 0.35],
    sem_eye_size: [0.25, 0.3],
    sem_lip_fullness: [0.2, 0.35],
    sem_cheekbones: [0.15, 0.3],
    sem_head_size: [-0.2, 0.2],
  } as Record<string, [number, number]>,
} as const;

/** A roughly normal draw (sum of three uniforms) in −1 … 1, so the spread is a soft bell, not a flat band. */
const bell = (rand: () => number) => (rand() + rand() + rand()) / 1.5 - 1;

/** The held Feature slider values of a woman's face: centre ± spread × a bell, clamped to each slider's own range. */
export function womanLean(ranges: Record<string, { min: number; max: number }>, rand: () => number = Math.random): Weights {
  const out: Weights = {};
  for (const [target, [centre, spread]] of Object.entries(INDIAN_WOMAN.lean)) {
    const r = ranges[target];
    if (!r) continue; // a slider this build doesn't have
    out[target] = Math.max(r.min, Math.min(r.max, centre + spread * bell(rand)));
  }
  return out;
}
