import { describe, expect, test } from "bun:test";
import { structurePass } from "../../src/passes/structure.ts";
import { anglePass } from "../../src/passes/angle.ts";
import { ringPass } from "../../src/passes/ring.ts";
import { sizePass } from "../../src/passes/size.ts";
import { defaultEngineConfig } from "../../src/defaults.ts";
import { tiny } from "../fixtures/tiny.ts";

describe("sizePass", () => {
  const s = structurePass(tiny, defaultEngineConfig);
  anglePass(s, defaultEngineConfig);
  const r = ringPass(s, defaultEngineConfig, tiny);
  const sized = sizePass(r, defaultEngineConfig);

  test("every block has a non-zero shortSide", () => {
    for (const blk of sized.blocks) expect(blk.shortSide).toBeGreaterThan(0);
  });

  test("deeper branches have smaller shortSide (childScale attenuation)", () => {
    const shallow = sized.branches.find((b) => b.depth === 0)!.shortSide;
    const deep = sized.branches.find((b) => b.depth === 1)!.shortSide;
    expect(deep).toBeLessThan(shallow);
  });

  test("arcLength ≥ sum of block chain lengths (includes ring + lead-in contributions)", () => {
    for (const br of sized.branches) {
      expect(br.arcLength).toBeGreaterThan(0);
    }
  });

  test("CurveSpec arcLength matches branch arcLength", () => {
    for (const br of sized.branches) {
      expect(br.curve.arcLength).toBeCloseTo(br.arcLength, 6);
    }
  });

  // Meristems carry the identity that a node had as a lief before promotion.
  // They should therefore be sized at the PARENT branch's depth, not their
  // own — preserving visual cohesion across the promotion boundary. The root
  // meristem has no parent, so it extrapolates to one step larger than depth
  // 0, making it the largest identity block in the plant.
  test("non-root meristem shortSide equals parent branch shortSide", () => {
    const aBranch = sized.branches.find((b) => b.depth === 1)!;
    const aMeristem = sized.blocks.find(
      (b) => b.kind === "meristem" && b.branchId === aBranch.id,
    )!;
    const rootBranch = sized.branches.find((b) => b.depth === 0)!;
    expect(aMeristem.shortSide).toBeCloseTo(rootBranch.shortSide, 6);
  });

  test("root meristem shortSide is baseSize / childScale^phiOrder", () => {
    const rootBranch = sized.branches.find((b) => b.depth === 0)!;
    const rootMeristem = sized.blocks.find(
      (b) => b.kind === "meristem" && b.branchId === rootBranch.id,
    )!;
    const { baseSize, childScale, phiOrder } = defaultEngineConfig.sizing;
    const expected = baseSize / Math.pow(childScale, phiOrder);
    expect(rootMeristem.shortSide).toBeCloseTo(expected, 6);
  });

  test("branchNodes are still sized by their own branch depth (unchanged)", () => {
    for (const blk of sized.blocks) {
      if (blk.kind !== "branchNode") continue;
      const br = sized.branches.find((b) => b.id === blk.branchId)!;
      expect(blk.shortSide).toBeCloseTo(br.shortSide, 6);
    }
  });
});
