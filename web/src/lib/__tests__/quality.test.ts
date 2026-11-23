import { describe, expect, it, vi } from "vitest";

/** A WebGL context that only answers the renderer query (no debug-renderer extension). */
const gl = (renderer: string) => ({ RENDERER: 0x1f01, getExtension: () => null, getParameter: () => renderer }) as unknown as WebGLRenderingContext;

// quality.ts is a module-level store that probes once: each case gets a fresh copy.
const fresh = () => {
  vi.resetModules();
  return import("../quality");
};

describe("quality tiers", () => {
  it("starts a desktop with a real GPU at high, a software renderer at low", async () => {
    expect((await fresh()).probeTier(gl("ANGLE (Apple, Apple M2, OpenGL 4.1)"))).toBe("high");
    expect((await fresh()).probeTier(gl("Google SwiftShader"))).toBe("low");
    expect((await fresh()).probeTier(gl("Mali-G52 MC2"))).toBe("low");
  });

  it("probes once, then steps down one tier at a time and stops at low", async () => {
    const q = await fresh();
    const seen: string[] = [];
    q.onTier((t) => seen.push(t));
    expect(q.probeTier(gl("ANGLE (Apple, Apple M2, OpenGL 4.1)"))).toBe("high");
    expect(q.probeTier(gl("Google SwiftShader"))).toBe("high");
    expect(q.dropTier()).toBe(true);
    expect(q.dropTier()).toBe(true);
    expect(q.dropTier()).toBe(false);
    expect(seen).toEqual(["high", "medium", "low"]);
    expect(q.tierSettings()).toBe(q.TIERS.low);
  });

  describe("the visitor's pick", () => {
    const store = new Map<string, string>();
    const browser = (search = "") =>
      vi.stubGlobal("window", {
        location: { search },
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
        matchMedia: () => ({ matches: false }),
      });
    const GPU = "ANGLE (Apple, Apple M2, OpenGL 4.1)";

    it("is kept on the device and beats the probe next time; Auto goes back to what the device chose", async () => {
      store.clear();
      browser();
      const first = await fresh();
      first.setQualityChoice("medium");
      expect(store.get("ftv-quality")).toBe("medium");
      const next = await fresh(); // the next visit
      expect(next.probeTier(gl(GPU))).toBe("medium");
      expect(next.quality).toMatchObject({ tier: "medium", auto: "high", pinned: true, choice: "medium" });
      expect(next.dropTier()).toBe(false); // a pinned tier never drops
      next.setQualityChoice("auto");
      expect(next.quality).toMatchObject({ tier: "high", pinned: false, choice: "auto" });
      expect(store.has("ftv-quality")).toBe(false);
      expect(next.dropTier()).toBe(true); // Auto steps down again when the frame rate sags
      vi.unstubAllGlobals();
    });

    it("lets the address win over a kept pick, and ignores nonsense", async () => {
      store.clear();
      store.set("ftv-quality", "medium");
      browser("?quality=low");
      expect((await fresh()).probeTier(gl(GPU))).toBe("low");
      browser("");
      store.set("ftv-quality", "ultra");
      expect((await fresh()).probeTier(gl(GPU))).toBe("high"); // not a tier: the device's own
      vi.unstubAllGlobals();
    });

    it("tells whoever is showing the pick when it changes", async () => {
      store.clear();
      browser();
      const q = await fresh();
      let n = 0;
      q.onQualityChoice(() => n++);
      q.setQualityChoice("low");
      q.setQualityChoice("auto");
      expect(n).toBe(2);
      vi.unstubAllGlobals();
    });
  });
});
