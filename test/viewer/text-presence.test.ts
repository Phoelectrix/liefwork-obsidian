import { test, expect, describe } from "bun:test";
import { mergeStylingConfig, defaultStylingConfig } from "../../viewer/src/styling.ts";
import { knobsToStylingFragment } from "../../viewer/src/dev-panel.ts";
import type { DevKnobs } from "../../viewer/src/mount-plant.ts";

// Text presence (10 Sept 2026): dark-on-white small text gets eaten by the
// bright surround — anti-aliasing thins every edge that halation used to fatten
// on the Void. Two palette-carried levers buy the weight back: full label
// opacity (lightOpacity 1 — a 0.95 alpha lightens dark text into grey) and a
// same-colour hairline stroke under the glyphs (labelStrokePx). Both default
// to the pre-0.2.0 draw so Meridian is untouched.

describe("labelStrokePx", () => {
  test("defaults to 0 (no stroke) and merges a partial", () => {
    expect(defaultStylingConfig.labelStrokePx).toBe(0);
    expect(mergeStylingConfig({}).labelStrokePx).toBe(0);
    expect(mergeStylingConfig({ labelStrokePx: 0.6 }).labelStrokePx).toBe(0.6);
  });
});

describe("dev-panel text-presence knobs", () => {
  const knobs: DevKnobs = {
    titleSize: 0.4, basalMag: 2, optimalSize: 120, liefOptimalSize: 60,
    subtreeBoost: 0.3, subtreeBoostShape: 1, attentionPropagationDecay: 0.5,
    meristemPeakSize: 200, liefPeakSize: 100,
    meristemDotsAbovePx: 4, meristemFullAbovePx: 20, meristemCullMinPx: 1,
    liefDotsAbovePx: 3, liefFullAbovePx: 14, liefCullMinPx: 1, liefMaxLift: 2.2,
    meristemDistance: 2, rootMeristemDistance: 2,
    meristemDistanceWeightGain: 0, meristemLiftEm: 0,
    labelWeight: 600, dotGlyphRadiusEm: 0.24, labelStrokePx: 0.5, lightOpacity: 1,
    fitPadding: 0.2, branchFramePad: 1.8, branchFitPad: 1.4, zoomOutMax: 3, pinchZoomGain: 2.5,
  };
  test("copy JSON carries the four text-presence values in StylingConfig shape", () => {
    const frag = knobsToStylingFragment(knobs) as Record<string, unknown> & { projection: Record<string, unknown> };
    // labelWeight is a CSS font-weight STRING in StylingConfig; the slider is numeric.
    expect(frag.labelWeight).toBe("600");
    expect(frag.dotGlyphRadiusEm).toBe(0.24);
    expect(frag.labelStrokePx).toBe(0.5);
    expect(frag.projection.lightOpacity).toBe(1);
  });
});
