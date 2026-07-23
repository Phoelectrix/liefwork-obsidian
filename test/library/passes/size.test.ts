import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import { PHI } from "../../../src/constants.ts";
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

describe("sizePass: shortSides and arcLength", () => {
  test("liefs sized at S × phi^(taper × index) (default taper = 0 → flat)", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const stem = sized.branches.find((b) => b.id === sized.stemBranchId)!;
    const lief = sized.blocks.find((b) => b.kind === "lief" && b.branchId === stem.id)!;
    // Stem depth = 0 → S = baseSize × childScale^0 = 40
    // Default liefTaper = 0 → phi^0 = 1
    expect(lief.shortSide).toBeCloseTo(stem.shortSide, 6);
  });

  test("BN sized at S (chain depth)", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const stem = sized.branches.find((b) => b.id === sized.stemBranchId)!;
    const bn = sized.blocks.find((b) => b.kind === "branchNode" && b.branchId === stem.id)!;
    expect(bn.shortSide).toBe(stem.shortSide);
  });

  test("meristem sized at S(depth - 1) — bigger than chain's liefs", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const stem = sized.branches.find((b) => b.id === sized.stemBranchId)!;
    const stemMeristem = sized.blocks.find(
      (b) => b.kind === "meristem" && b.branchId === stem.id,
    )!;
    // Stem depth = 0; meristem sized at depth = -1: S × childScale^(-phiOrder) = 40 × phi^1 = 40 × phi
    expect(stemMeristem.shortSide).toBeCloseTo(stem.shortSide * PHI, 4);
  });

  test("spacer sized at S × spacerRatio", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const stem = sized.branches.find((b) => b.id === sized.stemBranchId)!;
    const spacer = sized.blocks.find((b) => b.kind === "spacer" && b.branchId === stem.id)!;
    expect(spacer.shortSide).toBeCloseTo(
      stem.shortSide * defaultEngineConfig.sizing.spacerRatio,
      6,
    );
  });

  test("child-axis Growth Block sized at S × childAxisGrowthBlockFactor", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const childBranch = sized.branches.find((b) => b.parentBranchId === sized.stemBranchId)!;
    const childAxis = sized.blocks.find(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "child-axis",
    )!;
    expect(childAxis.shortSide).toBeCloseTo(
      childBranch.shortSide * defaultEngineConfig.clearance.childAxisGrowthBlockFactor,
      6,
    );
  });

  test("meristem-in / meristem-out Growth Blocks sized at S × factor", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const stem = sized.branches.find((b) => b.id === sized.stemBranchId)!;
    const mIn = sized.blocks.find(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "meristem-in" && b.branchId === stem.id,
    )!;
    const mOut = sized.blocks.find(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "meristem-out" && b.branchId === stem.id,
    )!;
    expect(mIn.shortSide).toBeCloseTo(
      stem.shortSide * defaultEngineConfig.clearance.meristemInFactor,
      6,
    );
    expect(mOut.shortSide).toBeCloseTo(
      stem.shortSide * defaultEngineConfig.clearance.meristemOutFactor,
      6,
    );
  });

  test("fwd-tangent / bwd-tangent Growth Blocks remain shortSide 0 after sizePass", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const fwd = sized.blocks.filter(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "fwd-tangent",
    );
    const bwd = sized.blocks.filter(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "bwd-tangent",
    );
    expect(fwd.length).toBeGreaterThan(0);
    expect(bwd.length).toBeGreaterThan(0);
    for (const b of [...fwd, ...bwd]) {
      expect(b.shortSide).toBe(0);
    }
  });

  test("arcLength = sum of all block shortSides on each chain", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    const blockById = new Map(sized.blocks.map((b) => [b.id, b]));
    for (const br of sized.branches) {
      const sum = br.blockIds.reduce(
        (acc, id) => acc + (blockById.get(id)?.shortSide ?? 0),
        0,
      );
      expect(br.arcLength).toBeCloseTo(sum, 6);
    }
  });
});
