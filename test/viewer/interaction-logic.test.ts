import { describe, expect, test } from "bun:test";
import {
  exceedsDragThreshold,
  resolveIdentityBlock,
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
