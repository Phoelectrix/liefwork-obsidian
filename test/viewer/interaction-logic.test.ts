import { describe, expect, test } from "bun:test";
import {
  exceedsDragThreshold,
  resolveIdentityBlock,
  shouldFrameOnPanelOpen,
  shouldReframeOnPanelClose,
  shouldSuppressClick,
} from "../../viewer/src/interaction-logic.ts";
import { build, defaultEngineConfig } from "../../src/index.ts";
import { tiny } from "../fixtures/tiny.ts";
import type { Plant, LiefBlock, MeristemBlock } from "../../src/types.ts";

describe("exceedsDragThreshold", () => {
  test("no movement is below threshold", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 }, 4)).toBe(false);
  });

  test("movement above threshold returns true", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toBe(true);
  });

  test("movement below threshold returns false", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 0 }, 4)).toBe(false);
  });

  test("uses Euclidean distance (diagonal)", () => {
    // 3-4-5 triangle: distance 5 exceeds threshold 4
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(true);
  });

  test("exactly at threshold counts as drag", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 }, 4)).toBe(true);
  });
});

describe("shouldSuppressClick", () => {
  test("a drag at the pan threshold suppresses the trailing click", () => {
    // Mirrors exceedsDragThreshold's >= semantics: the state machine enters
    // "panning" AT the threshold, so the concluding click must be suppressed.
    expect(shouldSuppressClick(4, 4)).toBe(true);
  });

  test("a drag beyond the threshold suppresses the trailing click", () => {
    expect(shouldSuppressClick(300, 4)).toBe(true);
  });

  test("a sub-threshold tap keeps its click", () => {
    expect(shouldSuppressClick(3.9, 4)).toBe(false);
    expect(shouldSuppressClick(0, 4)).toBe(false);
  });

  test("a pinch gesture (distance forced to Infinity) always suppresses", () => {
    expect(shouldSuppressClick(Number.POSITIVE_INFINITY, 4)).toBe(true);
  });
});

describe("resolveIdentityBlock", () => {
  const plant: Plant = build(tiny, undefined, defaultEngineConfig);

  test("a lief resolves to itself", () => {
    const lief = plant.blocks.find((b) => b.kind === "lief") as LiefBlock;
    expect(resolveIdentityBlock(lief, plant)).toBe(lief);
  });

  test("a meristem resolves to itself", () => {
    const meristem = plant.blocks.find(
      (b) => b.kind === "meristem",
    ) as MeristemBlock;
    expect(resolveIdentityBlock(meristem, plant)).toBe(meristem);
  });

  test("a spacer resolves to its branch's tip meristem", () => {
    const spacer = plant.blocks.find((b) => b.kind === "spacer")!;
    const resolved = resolveIdentityBlock(spacer, plant);
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe("meristem");
    expect(resolved!.branchId).toBe(spacer.branchId);
  });

  test("a branchNode resolves to its (parent) branch's tip meristem", () => {
    const bn = plant.blocks.find((b) => b.kind === "branchNode")!;
    const resolved = resolveIdentityBlock(bn, plant);
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe("meristem");
    expect(resolved!.branchId).toBe(bn.branchId);
  });
});

describe("shouldFrameOnPanelOpen (mobile split view)", () => {
  const base = {
    unfurlEnabled: true,
    isPortraitViewport: true,
    branchId: "b1" as string | undefined,
    userCameraOwned: false,
  };

  test("frames on a fresh camera (entry experience)", () => {
    expect(shouldFrameOnPanelOpen(base)).toBe(true);
  });

  test("never frames once the reader has pinched/panned to their own view", () => {
    expect(shouldFrameOnPanelOpen({ ...base, userCameraOwned: true })).toBe(false);
  });

  test("never frames on desktop (inset model, click never moves the view)", () => {
    expect(shouldFrameOnPanelOpen({ ...base, isPortraitViewport: false })).toBe(false);
  });

  test("never frames without a branch to frame", () => {
    expect(shouldFrameOnPanelOpen({ ...base, branchId: undefined })).toBe(false);
  });

  test("never frames outside the unfurl site", () => {
    expect(shouldFrameOnPanelOpen({ ...base, unfurlEnabled: false })).toBe(false);
  });
});

describe("shouldReframeOnPanelClose (mobile split view)", () => {
  test("reframes an untouched camera so the coral isn't left cropped in the top half", () => {
    expect(shouldReframeOnPanelClose({ isPortraitViewport: true, userCameraOwned: false })).toBe(true);
  });

  test("preserves a hand-placed camera — the grown stage only reveals more", () => {
    expect(shouldReframeOnPanelClose({ isPortraitViewport: true, userCameraOwned: true })).toBe(false);
  });

  test("desktop close uses the inset model, never this reframe", () => {
    expect(shouldReframeOnPanelClose({ isPortraitViewport: false, userCameraOwned: false })).toBe(false);
  });
});
