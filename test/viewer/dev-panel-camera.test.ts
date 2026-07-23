import { describe, expect, test } from "bun:test";
import { knobsToStylingFragment } from "../../viewer/src/dev-panel.ts";
import { defaultStylingConfig } from "../../viewer/src/styling.ts";
import type { DevKnobs } from "../../viewer/src/mount-plant.ts";

// Task 9: camera-framing sliders in the `?dev` panel. The load-bearing contract
// here is the "Copy JSON" PASTE SHAPE — knobsToStylingFragment's output must
// drop into site.json's `houseStyle` unchanged, so `camera` must come out as a
// NESTED block (matching StylingConfig.camera), not flattened alongside the
// other keys — same convention as the existing `projection` block.

const knobs: DevKnobs = {
  titleSize: 0.4,
  basalMag: 2,
  optimalSize: 120,
  liefOptimalSize: 60,
  subtreeBoost: 0.3,
  subtreeBoostShape: 1,
  attentionPropagationDecay: 0.5,
  meristemPeakSize: 200,
  liefPeakSize: 100,
  // LOD ladder + crowding cap — added 21 July when the panel moved in-plugin.
  meristemDotsAbovePx: 4,
  meristemFullAbovePx: 20,
  meristemCullMinPx: 1,
  liefDotsAbovePx: 3,
  liefFullAbovePx: 14,
  liefCullMinPx: 1,
  liefMaxLift: 2.2,
  meristemDistance: 2,
  rootMeristemDistance: 2,
  fitPadding: 0.2,
  branchFramePad: 1.8,
  branchFitPad: 1.4,
};

describe("knobsToStylingFragment — camera", () => {
  test("emits a nested camera block with all three tuned values", () => {
    const frag = knobsToStylingFragment(knobs) as { camera: Record<string, unknown> };
    expect(frag.camera).toEqual({
      fitPadding: 0.2,
      branchFramePad: 1.8,
      branchFitPad: 1.4,
    });
  });

  test("the camera block's key set matches defaultStylingConfig.camera's key set", () => {
    const frag = knobsToStylingFragment(knobs) as { camera: Record<string, unknown> };
    expect(Object.keys(frag.camera).sort()).toEqual(
      Object.keys(defaultStylingConfig.camera).sort(),
    );
  });

  test("camera is nested, not flattened into the top-level fragment", () => {
    const frag = knobsToStylingFragment(knobs);
    expect(frag).not.toHaveProperty("fitPadding");
    expect(frag).not.toHaveProperty("branchFramePad");
    expect(frag).not.toHaveProperty("branchFitPad");
  });
});
