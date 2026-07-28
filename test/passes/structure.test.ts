import { describe, expect, test } from "bun:test";
import { structurePass } from "../../src/passes/structure.ts";
import { defaultEngineConfig } from "../../src/defaults.ts";
import { tiny } from "../fixtures/tiny.ts";

describe("structurePass (tiny tree)", () => {
  const out = structurePass(tiny, defaultEngineConfig);

  test("produces an anchor and a stem branch id", () => {
    expect(out.anchor).toBeDefined();
    expect(out.stemBranchId).toBeDefined();
  });

  test("stem branch has parentBranchId === null", () => {
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    expect(stem.parentBranchId).toBeNull();
  });

  test("stem's tip meristem carries input.root identity (Root Meristem)", () => {
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const tip = stem.blockIds
      .map((id) => out.blocks.find((b) => b.id === id)!)
      .find((b) => b.kind === "meristem")!;
    expect(tip.kind).toBe("meristem");
    expect((tip as { hierarchyId: string }).hierarchyId).toBe("root");
    expect((tip as { name: string }).name).toBe("root");
  });

  test("top-level children (A as BN, B as lief) are blocks on the stem", () => {
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const blocks = stem.blockIds.map((bid) => out.blocks.find((b) => b.id === bid)!);
    // B is a terminal lief — its identity is on the lief block.
    const liefs = blocks.filter((b) => b.kind === "lief") as Array<{ hierarchyId: string }>;
    expect(liefs.map((l) => l.hierarchyId)).toContain("B");
    // A is promoted — a BranchNode appears on the stem (anonymous).
    const bns = blocks.filter((b) => b.kind === "branchNode");
    expect(bns).toHaveLength(1);
  });

  test("each branch has exactly one meristem block", () => {
    for (const branch of out.branches) {
      const meristems = branch.blockIds
        .map((id) => out.blocks.find((b) => b.id === id)!)
        .filter((b) => b.kind === "meristem");
      expect(meristems).toHaveLength(1);
    }
  });

  test("promotion: A's identity is on the child branch's tip meristem, not the BranchNode", () => {
    // Find the anonymous BranchNode on the stem.
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const bn = stem.blockIds
      .map((bid) => out.blocks.find((b) => b.id === bid)!)
      .find((b) => b.kind === "branchNode") as
      { kind: "branchNode"; childBranchId: string };
    expect(bn).toBeDefined();
    // BranchNode must NOT carry identity fields.
    expect((bn as Record<string, unknown>).hierarchyId).toBeUndefined();
    expect((bn as Record<string, unknown>).name).toBeUndefined();
    // Child branch's tip meristem carries A's identity.
    const childBranch = out.branches.find((br) => br.id === bn.childBranchId)!;
    const tip = childBranch.blockIds
      .map((id) => out.blocks.find((b) => b.id === id)!)
      .find((b) => b.kind === "meristem")!;
    expect(tip.kind).toBe("meristem");
    expect((tip as { hierarchyId: string }).hierarchyId).toBe("A");
    expect((tip as { name: string }).name).toBe("A");
  });

  test("A's child branch contains lief A1", () => {
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const bn = stem.blockIds
      .map((bid) => out.blocks.find((b) => b.id === bid)!)
      .find((b) => b.kind === "branchNode") as
      { kind: "branchNode"; childBranchId: string };
    const childBranch = out.branches.find((br) => br.id === bn.childBranchId)!;
    const hasA1 = childBranch.blockIds
      .map((bid) => out.blocks.find((b) => b.id === bid)!)
      .some((b) => b.kind === "lief" && (b as { hierarchyId: string }).hierarchyId === "A1");
    expect(hasA1).toBe(true);
  });

  test("lief B stays a lief on the stem", () => {
    const b = out.blocks.find(
      (blk) => blk.kind === "lief" &&
        (blk as { hierarchyId: string }).hierarchyId === "B",
    )!;
    expect(b.kind).toBe("lief");
  });

  test("every branch has a cached effective config", () => {
    for (const branch of out.branches) {
      expect(out.effectiveConfig.get(branch.id)).toBeDefined();
    }
  });
});

describe("sort order semantics", () => {
  // 3 liefs on the stem, explicit createdAt so ordering is deterministic.
  const threeLiefs = {
    root: {
      id: "root",
      name: "root",
      createdAt: "2026-04-20T00:00:00Z",
      children: [
        { id: "old",    name: "old",    createdAt: "2026-04-20T00:00:01Z" },
        { id: "middle", name: "middle", createdAt: "2026-04-20T00:00:02Z" },
        { id: "new",    name: "new",    createdAt: "2026-04-20T00:00:03Z" },
      ],
    },
  };

  test("newest-first places newest adjacent to the meristem", () => {
    const out = structurePass(threeLiefs, defaultEngineConfig);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const content = stem.blockIds
      .map((bid) => out.blocks.find((b) => b.id === bid)!)
      .filter((b) => b.kind === "lief") as Array<{ hierarchyId: string }>;
    // chain order is base → meristem, so content[last] is closest to the tip.
    expect(content[0]!.hierarchyId).toBe("old");
    expect(content[content.length - 1]!.hierarchyId).toBe("new");
  });

  test("oldest-first places oldest adjacent to the meristem", () => {
    const cfg = { ...defaultEngineConfig, sort: { default: "oldest-first" as const, liefsLast: false } };
    const out = structurePass(threeLiefs, cfg);
    const stem = out.branches.find((b) => b.id === out.stemBranchId)!;
    const content = stem.blockIds
      .map((bid) => out.blocks.find((b) => b.id === bid)!)
      .filter((b) => b.kind === "lief") as Array<{ hierarchyId: string }>;
    expect(content[0]!.hierarchyId).toBe("new");
    expect(content[content.length - 1]!.hierarchyId).toBe("old");
  });
});
