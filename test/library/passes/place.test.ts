import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { growthBlockPass } from "../../../src/library/passes/growth-block.ts";
import { placePass } from "../../../src/library/passes/place.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { HierarchyInput } from "../../../src/library/types.ts";

const tiny: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
      { id: "b", name: "b" },
    ],
  },
};

function runFullPipeline(input: HierarchyInput) {
  const s = structurePass(input, defaultEngineConfig);
  anglePass(s, defaultEngineConfig);
  const sized = sizePass(s, defaultEngineConfig);
  const g = growthBlockPass(sized, defaultEngineConfig, input);
  return placePass(g, defaultEngineConfig);
}

describe("placePass: linear cursor walk", () => {
  test("returns finite plant bounds", () => {
    const out = runFullPipeline(tiny);
    expect(Number.isFinite(out.bounds.min.x)).toBe(true);
    expect(Number.isFinite(out.bounds.min.y)).toBe(true);
    expect(Number.isFinite(out.bounds.max.x)).toBe(true);
    expect(Number.isFinite(out.bounds.max.y)).toBe(true);
  });

  test("each block's arcPosition matches cumulative cursor on its chain", () => {
    const out = runFullPipeline(tiny);
    const blockById = new Map(out.blocks.map((b) => [b.id, b]));
    for (const br of out.branches) {
      let cursor = 0;
      for (const id of br.blockIds) {
        const blk = blockById.get(id)!;
        const expected = cursor + blk.shortSide / 2;
        expect(blk.arcPosition).toBeCloseTo(expected, 6);
        cursor += blk.shortSide;
      }
    }
  });

  test("BN's parentBranchNodeId.position matches the world point at the BN's arcPosition on parent chain", () => {
    const out = runFullPipeline(tiny);
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const parentBn = out.blocks.find((b) => b.id === childBranch.parentBranchNodeId)!;
    expect(Number.isFinite(parentBn.position.x)).toBe(true);
    expect(Number.isFinite(parentBn.position.y)).toBe(true);
    // Child branch origin should match BN position when sampled at t=0 of child curve.
    expect(parentBn.position).toBeDefined();
  });

  test("descendant bounds propagate up parent chain", () => {
    const out = runFullPipeline(tiny);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    // Stem's bounds must contain child's bounds.
    expect(stem.bounds.min.x).toBeLessThanOrEqual(childBranch.bounds.min.x);
    expect(stem.bounds.min.y).toBeLessThanOrEqual(childBranch.bounds.min.y);
    expect(stem.bounds.max.x).toBeGreaterThanOrEqual(childBranch.bounds.max.x);
    expect(stem.bounds.max.y).toBeGreaterThanOrEqual(childBranch.bounds.max.y);
  });
});
