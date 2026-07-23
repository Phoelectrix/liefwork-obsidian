import { describe, expect, test } from "bun:test";
import { build, defaultEngineConfig } from "../../../src/library/index.ts";
import type { HierarchyInput } from "../../../src/library/types.ts";

// root
//   a (depth-1 branch, 2 children)
//     a1 (branch — has its own child a1x)
//     a2 (branch — has its own child a2x)
//   b (branch — has its own child b1, which is itself a branch via b1x)
const hier: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      {
        id: "a", name: "a",
        children: [
          { id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }] },
          { id: "a2", name: "a2", children: [{ id: "a2x", name: "a2x" }] },
        ],
      },
      {
        id: "b", name: "b",
        children: [{ id: "b1", name: "b1", children: [{ id: "b1x", name: "b1x" }] }],
      },
    ],
  },
};

const stripBuiltAt = (plant: any): any => {
  const { builtAt: _ignored, ...rest } = plant.metadata;
  return { ...plant, metadata: rest };
};

describe("foldFactor: default-off byte-identical", () => {
  test("no foldFactor anywhere → two builds of the same hierarchy/config are byte-identical", () => {
    const p1 = build(hier, undefined, defaultEngineConfig);
    const p2 = build(hier, undefined, defaultEngineConfig);
    expect(stripBuiltAt(p1)).toEqual(stripBuiltAt(p2));
    expect(p1.id).toBe(p2.id);
  });

  test("no foldFactor key is introduced into the config", () => {
    const p = build(hier, undefined, defaultEngineConfig);
    expect(JSON.stringify(defaultEngineConfig)).not.toContain("foldFactor");
    expect(JSON.stringify(p.config)).not.toContain("foldFactor");
  });
});

describe("foldFactor: root override folds direct children flat", () => {
  test("baseline: root's direct children have non-zero departureAngle (observable fan)", () => {
    const p = build(hier, undefined, defaultEngineConfig);
    const rootChildren = p.branches.filter((br) => br.parentBranchId === p.stemBranchId);
    expect(rootChildren.length).toBe(2);
    for (const c of rootChildren) expect(c.departureAngle).not.toBe(0);
  });

  test("overrides.root.foldFactor = 0 → every direct child of root departs at angle 0", () => {
    const cfg = {
      ...defaultEngineConfig,
      overrides: { root: { foldFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const rootChildren = p.branches.filter((br) => br.parentBranchId === p.stemBranchId);
    expect(rootChildren.length).toBe(2);
    // toBeCloseTo (not toBe): -0 vs 0 both mean "folded flat" mathematically,
    // but Object.is (used by toBe) distinguishes signed zero.
    for (const c of rootChildren) expect(c.departureAngle).toBeCloseTo(0, 10);
  });
});

describe("foldFactor: non-root (depth ≥ 1) override folds its own direct children flat", () => {
  test("baseline: branch a's direct children (a1, a2) have non-zero departureAngle", () => {
    const p = build(hier, undefined, defaultEngineConfig);
    // Identify branch "a" via its meristem hierarchyId.
    const aBranch = p.branches.find((br) =>
      p.blocks.some((bl) => bl.branchId === br.id && bl.kind === "meristem" && bl.hierarchyId === "a"),
    )!;
    expect(aBranch).toBeDefined();
    const aChildren = p.branches.filter((br) => br.parentBranchId === aBranch.id);
    expect(aChildren.length).toBe(2);
    for (const c of aChildren) expect(c.departureAngle).not.toBe(0);
  });

  test("overrides.a.foldFactor = 0 → every direct child of a departs at angle 0 (per-depth application)", () => {
    const cfg = {
      ...defaultEngineConfig,
      overrides: { a: { foldFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const aBranch = p.branches.find((br) =>
      p.blocks.some((bl) => bl.branchId === br.id && bl.kind === "meristem" && bl.hierarchyId === "a"),
    )!;
    expect(aBranch).toBeDefined();
    const aChildren = p.branches.filter((br) => br.parentBranchId === aBranch.id);
    expect(aChildren.length).toBe(2);
    for (const c of aChildren) expect(c.departureAngle).toBeCloseTo(0, 10);

    // And root's OWN direct children are unaffected (fold is scoped to N's own children only).
    const rootChildren = p.branches.filter((br) => br.parentBranchId === p.stemBranchId);
    for (const c of rootChildren) expect(c.departureAngle).not.toBe(0);
  });
});
