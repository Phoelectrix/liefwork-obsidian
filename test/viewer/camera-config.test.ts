import { describe, expect, test } from "bun:test";
import { mergeStylingConfig, type StylingConfig } from "../../viewer/src/styling.ts";
import { liefworkStylingDefaults } from "../../viewer/src/liefwork-defaults.ts";
import { defaultStylingConfig } from "../../viewer/src/styling.ts";

// Camera framing (Task 8): previously-hardcoded constants — fit padding,
// meristem-click pad, branch-frame pad, and (5 Aug) the pull-back limit —
// become house-style-tuneable via StylingConfig.camera. The single most important property here is that the
// DEFAULTS preserve today's behaviour exactly, in both the public-viewer
// defaults (styling.ts) and the separate Studio/plugin defaults
// (liefwork-defaults.ts) — so the Obsidian plugin's framing cannot drift.

describe("mergeStylingConfig — camera", () => {
  test("defaults to the today-preserving values when camera is omitted entirely", () => {
    expect(mergeStylingConfig({}).camera).toEqual({
      fitPadding: 0.12,
      branchFramePad: 1.5,
      branchFitPad: 1.2,
      zoomOutMax: 2,
      pinchZoomGain: 7,
    });
  });

  test("a partial camera object keeps the other defaults (nested merge)", () => {
    const partial = { camera: { fitPadding: 0.05 } } as unknown as Partial<StylingConfig>;
    const merged = mergeStylingConfig(partial).camera;
    expect(merged.fitPadding).toBe(0.05);
    expect(merged.branchFramePad).toBe(1.5);
    expect(merged.branchFitPad).toBe(1.2);
    expect(merged.zoomOutMax).toBe(2);
    expect(merged.pinchZoomGain).toBe(7);
  });
});

describe("liefwork-defaults — camera matches the public-viewer default", () => {
  test("the plugin's camera block equals defaultStylingConfig's camera block", () => {
    expect(liefworkStylingDefaults.camera).toEqual(defaultStylingConfig.camera);
  });
});
