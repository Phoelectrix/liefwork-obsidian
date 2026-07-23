import { describe, expect, test } from "bun:test";
import { structurePass } from "../../src/passes/structure.ts";
import { anglePass } from "../../src/passes/angle.ts";
import { ringPass } from "../../src/passes/ring.ts";
import { defaultEngineConfig } from "../../src/defaults.ts";
import { tiny } from "../fixtures/tiny.ts";
import { shakespeareMini } from "../fixtures/shakespeare-mini.ts";

describe("ringPass (tiny)", () => {
  const s = structurePass(tiny, defaultEngineConfig);
  anglePass(s, defaultEngineConfig);
  const r = ringPass(s, defaultEngineConfig, tiny);

  test("emits a RingSet for every BranchNode", () => {
    const bnCount = s.blocks.filter((b) => b.kind === "branchNode").length;
    expect(r.rings).toHaveLength(bnCount);
  });

  test("each RingSet's count equals descendant lief-event count", () => {
    // Spec §ring: exactly 2 rings per event per ANCESTRAL BranchNode. For a
    // given BN, the count on each side equals the number of lief events in
    // its subtree — never the global event count.
    for (const rs of r.rings) {
      const bn = s.blocks.find((b) => b.id === rs.blockId) as
        { kind: "branchNode"; childBranchId: string };
      // Descendant lief count = number of entries in liefHome whose branch
      // is the BN's child branch or any branch reachable beneath it.
      const descendantBranchIds = new Set<string>();
      const collect = (branchId: string): void => {
        descendantBranchIds.add(branchId);
        for (const blk of s.blocks) {
          if (blk.kind === "branchNode" && blk.branchId === branchId) {
            collect(blk.childBranchId);
          }
        }
      };
      collect(bn.childBranchId);
      const descendantLiefCount = [...s.liefHome.values()]
        .filter((bid) => descendantBranchIds.has(bid)).length;
      expect(rs.forward.length).toBe(descendantLiefCount);
      expect(rs.backward.length).toBe(descendantLiefCount);
    }
  });

  test("all ring widths ≥ that BranchNode's own epsilon floor", () => {
    const { baseSize, childScale, phiOrder } = defaultEngineConfig.sizing;
    const ratio = defaultEngineConfig.clearance.expansionEpsilonRatio;
    for (const rs of r.rings) {
      const bn = s.blocks.find((b) => b.id === rs.blockId)!;
      const parentBranch = s.branches.find((b) => b.id === bn.branchId)!;
      const S_bn = baseSize * Math.pow(childScale, parentBranch.depth * phiOrder);
      const eps = ratio * S_bn;
      for (const ring of rs.forward) expect(ring.width).toBeGreaterThanOrEqual(eps);
      for (const ring of rs.backward) expect(ring.width).toBeGreaterThanOrEqual(eps);
    }
  });

  test("rings are archaeologically ordered (innermost = oldest)", () => {
    for (const rs of r.rings) {
      for (let i = 0; i < rs.forward.length; i++) {
        expect(rs.forward[i]!.index).toBe(i);
      }
    }
  });
});

describe("ringPass (shakespeare-mini)", () => {
  // Deeper hierarchy so we get non-root BranchNodes where descendant-count
  // differs across BNs. Proves the per-BN-count rule isn't a tiny-tree
  // coincidence.
  const s = structurePass(shakespeareMini, defaultEngineConfig);
  anglePass(s, defaultEngineConfig);
  const r = ringPass(s, defaultEngineConfig, shakespeareMini);

  test("each RingSet's count equals descendant lief-event count", () => {
    for (const rs of r.rings) {
      const bn = s.blocks.find((b) => b.id === rs.blockId) as
        { kind: "branchNode"; childBranchId: string };
      const descendantBranchIds = new Set<string>();
      const collect = (branchId: string): void => {
        descendantBranchIds.add(branchId);
        for (const blk of s.blocks) {
          if (blk.kind === "branchNode" && blk.branchId === branchId) {
            collect(blk.childBranchId);
          }
        }
      };
      collect(bn.childBranchId);
      const descendantLiefCount = [...s.liefHome.values()]
        .filter((bid) => descendantBranchIds.has(bid)).length;
      expect(rs.forward.length).toBe(descendantLiefCount);
      expect(rs.backward.length).toBe(descendantLiefCount);
    }
  });

  test("RingSets are NOT all the same size (different subtree depths)", () => {
    const sizes = new Set(r.rings.map((rs) => rs.forward.length));
    expect(sizes.size).toBeGreaterThan(1);
  });
});
