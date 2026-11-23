/**
 * How the eyelashes are worn (Style tab → Colouring → Lashes): length, curl and fullness. Plain values with no imports:
 * lib/skinDetails.ts writes them (they are part of the skin details, so the config file and the rebuild link carry
 * them) and lib/addons.ts, which owns the lash strands, registers `apply` and reads them when a lash style is attached.
 */
export const LASH_DEFAULTS = { length: 1, curl: 0, density: 1 };
export const lashLook = { ...LASH_DEFAULTS, apply: null as null | (() => void) };
