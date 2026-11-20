/**
 * The hair's shadow volume (lib/hairShadow.ts): density lands where the strands are, the box has an empty rim (reads
 * outside it are "no hair"), long hair grows the cell instead of the grid, and the shader chunks patch three's light
 * loop (a three upgrade that changes it shows up here, not as hair without shadows).
 */
import { MeshPhysicalMaterial, ShaderChunk } from "three";
import { describe, expect, it } from "vitest";

import { buildHairVolume, DIR_SHADOW, hairLitChunk } from "@/lib/hairShadow";

/** n straight strands of p points from (x0, y, z) along +x for len mm (positions in metres, as the strand files). */
function strands(n: number, p: number, len: number, at: [number, number, number] = [0, 300, 0], spread = 0) {
  const positions = new Float32Array(n * p * 3);
  for (let s = 0; s < n; s++)
    for (let k = 0; k < p; k++) {
      const i = (s * p + k) * 3;
      positions[i] = (at[0] + (len * k) / (p - 1)) / 1000;
      positions[i + 1] = (at[1] + spread * (s / Math.max(1, n - 1) - 0.5)) / 1000;
      positions[i + 2] = at[2] / 1000;
    }
  return { positions, n, p, width: 0.5 };
}

const cellOf = (v: NonNullable<ReturnType<typeof buildHairVolume>>, mm: [number, number, number]) => {
  const [nx, ny] = v.dims;
  const [x, y, z] = mm.map((c, a) => Math.floor((c - v.min[a]) / v.voxel));
  return v.data[x + nx * (y + ny * z)];
};

describe("hair shadow volume", () => {
  it("is null without strands", () => {
    expect(buildHairVolume([])).toBeNull();
  });

  it("puts the density on the strands and none away from them", () => {
    const v = buildHairVolume([strands(200, 16, 60)])!;
    expect(v.sigmaMax).toBeGreaterThan(0);
    expect(cellOf(v, [30, 300, 0])).toBeGreaterThan(200); // in the middle of the bundle
    expect(cellOf(v, [30, 300 + 20, 0])).toBe(0); // 2 cm off it
    expect(cellOf(v, [30, 300, 13])).toBe(0); // inside the box, past the blur's 2 cells
  });

  it("leaves the outermost cells empty, so reads clamped outside the box see no hair", () => {
    const v = buildHairVolume([strands(50, 8, 40, [0, 300, 0], 10)])!;
    const [nx, ny, nz] = v.dims;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (x > 0 && y > 0 && z > 0 && x < nx - 1 && y < ny - 1 && z < nz - 1) continue;
          expect(v.data[x + nx * (y + ny * z)]).toBe(0);
        }
  });

  it("grows the cell for long hair instead of the grid", () => {
    const v = buildHairVolume([strands(20, 32, 900)], 4, 96)!;
    expect(Math.max(...v.dims)).toBeLessThanOrEqual(96);
    expect(v.voxel).toBeGreaterThan(4);
  });

  it("counts more hair as more density", () => {
    const thin = buildHairVolume([strands(20, 16, 60)])!;
    const thick = buildHairVolume([strands(200, 16, 60)])!;
    expect(thick.sigmaMax).toBeGreaterThan(thin.sigmaMax * 5);
  });
});

describe("hair shadow shader chunks", () => {
  it("patch three's light loop", () => {
    expect(ShaderChunk.lights_fragment_begin).toContain(DIR_SHADOW);
    const c = hairLitChunk("vRest", "SKIN_SHADOW_LINE");
    expect(c).toContain("hairTransmit( hsHead");
    expect(c).toContain("SKIN_SHADOW_LINE");
    expect(c).not.toContain(DIR_SHADOW);
    expect(c.startsWith("vec3 hsHead = vRest;")).toBe(true);
  });

  it("goes into the skin's shader with its two lobes and the per-channel diffuse", async () => {
    const { installSkinShader } = await import("@/lib/skinShader");
    const m = new MeshPhysicalMaterial();
    installSkinShader(m);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <begin_vertex>\n#include <uv_vertex>",
      fragmentShader: [
        "#include <color_fragment>",
        "#include <roughnessmap_fragment>",
        "#include <lights_physical_fragment>",
        "#include <normal_fragment_maps>",
        "#include <lights_physical_pars_fragment>",
        "#include <lights_fragment_begin>",
        "#include <aomap_fragment>",
        "#include <alphamap_fragment>",
      ].join("\n"),
    };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain("skinLobe.roughness");
    expect(shader.fragmentShader).toContain("uSssNormal");
    expect(shader.fragmentShader).toContain("pow( vec3( skinSh ), uShadowTint )");
    expect(shader.fragmentShader).toContain("hairAmbient(hsHead");
    expect(shader.uniforms).toHaveProperty("uHairVol");
  });
});
