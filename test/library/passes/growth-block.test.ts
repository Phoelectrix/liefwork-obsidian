import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { growthBlockPass } from "../../../src/library/passes/growth-block.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { EngineConfig, HierarchyInput } from "../../../src/library/types.ts";

const tiny: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
      { id: "b", name: "b" },
    ],
  },
};

const trie3: HierarchyInput = {
  // Pure-BN trie: root → c1 → c2 → leaf. Depth-3 chain, 1 leaf.
  root: {
    id: "root", name: "root",
    children: [{
      id: "c1", name: "c1",
      children: [{
        id: "c2", name: "c2",
        children: [{ id: "leaf", name: "leaf" }],
      }],
    }],
  },
};

function runUpToGrowthBlock(input: HierarchyInput, cfg: EngineConfig = defaultEngineConfig) {
  const s = structurePass(input, cfg);
  anglePass(s, cfg);
  const sized = sizePass(s, cfg);
  return growthBlockPass(sized, cfg, input);
}

describe("growthBlockPass: tangent demand", () => {
  test("epsilon floor enforced when subtree has no descendants", () => {
    // BN's subtree should never produce zero-width fwd/bwd blocks.
    const out = runUpToGrowthBlock(tiny);
    const fwds = out.blocks.filter(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "fwd-tangent",
    );
    const bwds = out.blocks.filter(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "bwd-tangent",
    );
    expect(fwds.length).toBeGreaterThan(0);
    expect(bwds.length).toBeGreaterThan(0);
    for (const b of [...fwds, ...bwds]) {
      expect(b.shortSide).toBeGreaterThan(0);
    }
  });

  test("a BN with descendant lief gets non-trivial fwd/bwd demand", () => {
    const out = runUpToGrowthBlock(tiny);
    // The stem's BN (the one for 'a' which has child 'a1') should reserve
    // tangent space for 'a1' on its child chain.
    const stemBN = out.blocks.find((b) => b.kind === "branchNode")!;
    const fwd = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "fwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN.id,
    )!;
    // Far above ε: descendant a1 sits at non-trivial dx in stem-BN's frame.
    expect(fwd.shortSide).toBeGreaterThan(out.branches[0]!.shortSide);
  });

  test("trie3 — pure-BN chain produces non-trivial demand at top BN (the trie fix)", () => {
    // No leaf events at upper BNs; demand must come from descendant BNs and meristems.
    const out = runUpToGrowthBlock(trie3);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const epsilon =
      defaultEngineConfig.clearance.expansionEpsilonRatio * stem.shortSide;
    const stemBN = out.blocks.find((b) => b.kind === "branchNode" && b.branchId === stem.id)!;
    const fwd = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "fwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN.id,
    )!;
    // The whole chain c1 → c2 → leaf carries arc through descendants. Demand should far exceed epsilon.
    expect(fwd.shortSide).toBeGreaterThan(epsilon * 5);
  });

  test("branchBuffer linearly scales BN reservations (post-aggregation)", () => {
    const cfg1 = defaultEngineConfig;
    const cfg2 = {
      ...cfg1,
      clearance: { ...cfg1.clearance, branchBuffer: 2.0 },
    };
    const out1 = runUpToGrowthBlock(tiny, cfg1);
    const out2 = runUpToGrowthBlock(tiny, cfg2);

    const stemBN1 = out1.blocks.find((b) => b.kind === "branchNode")!;
    const stemBN2 = out2.blocks.find((b) => b.kind === "branchNode")!;
    const fwd1 = out1.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "fwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN1.id,
    )!;
    const fwd2 = out2.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "fwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN2.id,
    )!;
    // Doubling branchBuffer doubles fwd demand (away from the epsilon floor).
    expect(fwd2.shortSide / fwd1.shortSide).toBeCloseTo(2.0, 2);
  });

  test("forward backward asymmetric for forward-leaning subtree (fwd > bwd)", () => {
    // Two-leaf tiny: stem-BN's only-leaf descendant a1 lies forward of the BN.
    // The spread formula reserves the descendant's full footprint (tangent +
    // perpendicular extent), so the bwd contribution is small but not epsilon —
    // the perpendicular half-extent adds symmetrically to both sides. Real
    // expectation: bwd stays meaningfully smaller than fwd because the subtree
    // is one-sided (forward), but the perpendicular term narrows the gap.
    const out = runUpToGrowthBlock(tiny);
    const stemBN = out.blocks.find((b) => b.kind === "branchNode")!;
    const fwd = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "fwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN.id,
    )!;
    const bwd = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "bwd-tangent" &&
        (b as { ownerBlockId: string }).ownerBlockId === stemBN.id,
    )!;
    expect(fwd.shortSide).toBeGreaterThan(bwd.shortSide);
    // bwd stays clearly smaller than fwd (forward-leaning) — but the symmetric
    // perpendicular footprint term narrows the old 3x gap to roughly 2x.
    expect(bwd.shortSide).toBeLessThan(fwd.shortSide / 1.5);
  });

  test("child-axis Growth Block equals the config baseline (constant; demand calc removed)", () => {
    const out = runUpToGrowthBlock(tiny);
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const childAxis = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "child-axis" &&
        b.branchId === childBranch.id,
    )!;
    const baseline = childBranch.shortSide * defaultEngineConfig.clearance.childAxisGrowthBlockFactor;
    expect(childAxis.shortSide).toBeCloseTo(baseline, 6);
  });

  test("child-axis Growth Block stays at constant baseline regardless of angle settings", () => {
    // Stage 2 demand removed — child-axis is now purely structural (constant
    // baseline from sizePass). Even at extreme angle settings, the width
    // shouldn't deviate from baseline.
    const cfg = {
      ...defaultEngineConfig,
      angles: {
        ...defaultEngineConfig.angles,
        angleMode: "fixed" as const,
        firstBranchAngle: 62,
        angleDecay: 1.0,
      },
    };
    const out = runUpToGrowthBlock(trie3, cfg);
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const childAxis = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "child-axis" &&
        b.branchId === childBranch.id,
    )!;
    const baseline = childBranch.shortSide * cfg.clearance.childAxisGrowthBlockFactor;
    expect(childAxis.shortSide).toBeCloseTo(baseline, 6);
  });

  test("branchBuffer does not affect child-axis Growth Block (only fwd/bwd-tangent)", () => {
    const baseCfg = {
      ...defaultEngineConfig,
      angles: {
        ...defaultEngineConfig.angles,
        angleMode: "fixed" as const,
        firstBranchAngle: 62,
        angleDecay: 1.0,
      },
    };
    const cfg1 = { ...baseCfg, clearance: { ...baseCfg.clearance, branchBuffer: 1.0 } };
    const cfg3 = { ...baseCfg, clearance: { ...baseCfg.clearance, branchBuffer: 3.0 } };
    const out1 = runUpToGrowthBlock(trie3, cfg1);
    const out3 = runUpToGrowthBlock(trie3, cfg3);
    const ca1 = out1.blocks.find(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "child-axis",
    )!;
    const ca3 = out3.blocks.find(
      (b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "child-axis",
    )!;
    // Constant baseline — independent of branchBuffer.
    expect(ca3.shortSide).toBeCloseTo(ca1.shortSide, 6);
  });

  test("meristem-in / meristem-out unchanged by growthBlockPass", () => {
    const out = runUpToGrowthBlock(tiny);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const mIn = out.blocks.find(
      (b) =>
        b.kind === "growthBlock" &&
        (b as { subtype: string }).subtype === "meristem-in" &&
        b.branchId === stem.id,
    )!;
    expect(mIn.shortSide).toBeCloseTo(
      stem.shortSide * defaultEngineConfig.clearance.meristemInFactor,
      6,
    );
  });

  test("events derived from leaf nodes (compatibility field)", () => {
    const out = runUpToGrowthBlock(tiny);
    const liefIds = new Set(["a1", "b"]);
    expect(out.events).toBeDefined();
    expect(out.events.length).toBe(2);
    for (const ev of out.events) {
      expect(liefIds.has(ev.liefId)).toBe(true);
    }
  });
});
