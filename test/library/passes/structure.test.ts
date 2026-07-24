import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { HierarchyInput } from "../../../src/library/types.ts";

const tinyAllLeafs: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a" },
      { id: "b", name: "b" },
    ],
  },
};

const tinyOneBN: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      {
        id: "a", name: "a",
        children: [{ id: "a1", name: "a1" }],
      },
      { id: "b", name: "b" },
    ],
  },
};

const pureBNTrie: HierarchyInput = {
  // root → c1 → c2 → leaf (one chain, two BNs deep)
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

describe("structurePass: chain emission", () => {
  test("stem with two leaf children: [Spacer, Lief, Spacer, Lief, meristem-in-GB, Meristem, meristem-out-GB]", () => {
    const out = structurePass(tinyAllLeafs, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const blockKindsAndSubs = stem.blockIds.map((id) => {
      const b = out.blocks.find((bb) => bb.id === id)!;
      return b.kind === "growthBlock" ? `gb:${b.subtype}` : b.kind;
    });
    expect(blockKindsAndSubs).toEqual([
      "spacer", "lief",
      "spacer", "lief",
      "gb:meristem-in", "meristem", "gb:meristem-out",
    ]);
  });

  test("stem with mixed Lief+BN: between them is just a Spacer (Lief's prefix); BN gets bwd/fwd-tangent GBs", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const seq = stem.blockIds.map((id) => {
      const b = out.blocks.find((bb) => bb.id === id)!;
      return b.kind === "growthBlock" ? `gb:${b.subtype}` : b.kind;
    });
    // Children are sorted newest-first, but neither child has createdAt, so order is input order: a (BN), b (Lief).
    expect(seq).toEqual([
      "gb:bwd-tangent", "branchNode", "gb:fwd-tangent",
      "spacer", "lief",
      "gb:meristem-in", "meristem", "gb:meristem-out",
    ]);
  });

  test("non-stem chain begins with child-axis-GB", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const firstBlk = out.blocks.find((bb) => bb.id === childBranch.blockIds[0])!;
    expect(firstBlk.kind).toBe("growthBlock");
    expect((firstBlk as { subtype: string }).subtype).toBe("child-axis");
  });

  test("pure-BN chain (depth-2 trie): no spacers between BNs; child-axis-GB at chain start", () => {
    const out = structurePass(pureBNTrie, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const seq = stem.blockIds.map((id) => {
      const b = out.blocks.find((bb) => bb.id === id)!;
      return b.kind === "growthBlock" ? `gb:${b.subtype}` : b.kind;
    });
    // c1 is a BN (has children).
    expect(seq).toEqual([
      "gb:bwd-tangent", "branchNode", "gb:fwd-tangent",
      "gb:meristem-in", "meristem", "gb:meristem-out",
    ]);
    const c1Branch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const c1Seq = c1Branch.blockIds.map((id) => {
      const b = out.blocks.find((bb) => bb.id === id)!;
      return b.kind === "growthBlock" ? `gb:${b.subtype}` : b.kind;
    });
    // c2 is a BN; c1 chain has [child-axis, bwd, c2-BN, fwd, meristem-in, meristem, meristem-out]
    expect(c1Seq).toEqual([
      "gb:child-axis",
      "gb:bwd-tangent", "branchNode", "gb:fwd-tangent",
      "gb:meristem-in", "meristem", "gb:meristem-out",
    ]);
  });

  test("ownerBlockId on fwd-tangent and bwd-tangent points to the BN", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const stemBlocks = stem.blockIds.map((id) => out.blocks.find((bb) => bb.id === id)!);
    const bn = stemBlocks.find((b) => b.kind === "branchNode")!;
    const bwd = stemBlocks.find((b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "bwd-tangent")!;
    const fwd = stemBlocks.find((b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "fwd-tangent")!;
    expect((bwd as { ownerBlockId: string }).ownerBlockId).toBe(bn.id);
    expect((fwd as { ownerBlockId: string }).ownerBlockId).toBe(bn.id);
  });

  test("ownerBlockId on child-axis-GB points to the parent BN", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const bn = stem.blockIds
      .map((id) => out.blocks.find((bb) => bb.id === id)!)
      .find((b) => b.kind === "branchNode")!;
    const childBranch = out.branches.find((b) => b.parentBranchId === out.stemBranchId)!;
    const childAxis = out.blocks.find((bb) => bb.id === childBranch.blockIds[0])!;
    expect((childAxis as { ownerBlockId: string }).ownerBlockId).toBe(bn.id);
  });

  test("ownerBlockId on meristem-in / meristem-out points to the meristem", () => {
    const out = structurePass(tinyAllLeafs, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const stemBlocks = stem.blockIds.map((id) => out.blocks.find((bb) => bb.id === id)!);
    const m = stemBlocks.find((b) => b.kind === "meristem")!;
    const mIn = stemBlocks.find((b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "meristem-in")!;
    const mOut = stemBlocks.find((b) => b.kind === "growthBlock" && (b as { subtype: string }).subtype === "meristem-out")!;
    expect((mIn as { ownerBlockId: string }).ownerBlockId).toBe(m.id);
    expect((mOut as { ownerBlockId: string }).ownerBlockId).toBe(m.id);
  });

  test("all GrowthBlocks have shortSide 0 at structure-pass time", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    const gbs = out.blocks.filter((b) => b.kind === "growthBlock");
    expect(gbs.length).toBeGreaterThan(0);
    for (const gb of gbs) {
      expect(gb.shortSide).toBe(0);
    }
  });

  test("liefHome map populated for every leaf node", () => {
    const out = structurePass(tinyOneBN, defaultEngineConfig);
    expect(out.liefHome.has("a1")).toBe(true);
    expect(out.liefHome.has("b")).toBe(true);
    // 'a' is a BN, not a leaf — not in liefHome
    expect(out.liefHome.has("a")).toBe(false);
  });

  test("ancestorBranchNodes and ancestorBranches populated for non-stem branches", () => {
    const out = structurePass(pureBNTrie, defaultEngineConfig);
    const stemId = out.stemBranchId;
    const c1 = out.branches.find((b) => b.parentBranchId === stemId)!;
    const c2 = out.branches.find((b) => b.parentBranchId === c1.id)!;
    expect(out.ancestorBranches.get(c1.id)).toEqual([stemId]);
    expect(out.ancestorBranches.get(c2.id)).toEqual([stemId, c1.id]);
    expect(out.ancestorBranchNodes.get(c1.id)?.length).toBe(1);
    expect(out.ancestorBranchNodes.get(c2.id)?.length).toBe(2);
  });
});
