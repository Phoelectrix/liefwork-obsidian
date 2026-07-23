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

// Find the branch whose tip meristem corresponds to a given hierarchy node id.
const branchFor = (p: any, hierarchyId: string) =>
  p.branches.find((br: any) =>
    p.blocks.some(
      (bl: any) => bl.branchId === br.id && bl.kind === "meristem" && bl.hierarchyId === hierarchyId,
    ),
  );

const meristemBlockOf = (p: any, branchId: string) =>
  p.blocks.find((bl: any) => bl.branchId === branchId && bl.kind === "meristem");

const nonMeristemBlocksOf = (p: any, branchId: string) =>
  p.blocks.filter((bl: any) => bl.branchId === branchId && bl.kind !== "meristem");

// The FIRST lief block in a branch (in the branch's own blockIds order) — the
// one-lief "floor": size.ts never scales it by growthFactor, so a branch can
// never shrink below meristem + this block, however few or many liefs it has.
const firstLiefOf = (p: any, branch: any) => {
  const liefs = p.blocks.filter((bl: any) => bl.branchId === branch.id && bl.kind === "lief");
  liefs.sort(
    (x: any, y: any) => branch.blockIds.indexOf(x.id) - branch.blockIds.indexOf(y.id),
  );
  return liefs[0];
};

describe("growthFactor: default-off byte-identical", () => {
  test("no growthFactor anywhere → two builds of the same hierarchy/config are byte-identical", () => {
    const p1 = build(hier, undefined, defaultEngineConfig);
    const p2 = build(hier, undefined, defaultEngineConfig);
    expect(stripBuiltAt(p1)).toEqual(stripBuiltAt(p2));
    expect(p1.id).toBe(p2.id);
  });

  test("no growthFactor key is introduced into the config", () => {
    const p = build(hier, undefined, defaultEngineConfig);
    expect(JSON.stringify(defaultEngineConfig)).not.toContain("growthFactor");
    expect(JSON.stringify(p.config)).not.toContain("growthFactor");
  });
});

// a1 is a "leaf" branch (its only child a1x has no children of its own, so
// a1x lives as a lief block inside a1 rather than spawning its own child
// branch/branchNode). That keeps a1's growthBlock set free of any
// grandchild-tip reservations, so the arcLength ≈ meristem-size collapse is
// exact rather than approximate (see "a", used below for the cascade test,
// where the parent branch's fwd/bwd-tangent growthBlocks legitimately stay
// non-zero — they reserve room for its child branches' own full-size
// meristem tips, which is correct: meristems never shrink, at any depth).
describe("growthFactor: overrides.a1.growthFactor = 0 shrinks a1's arc to meristem + one-lief floor", () => {
  test("baseline: a1's arcLength is well above a1's meristem shortSide (non-meristem blocks contribute)", () => {
    const p = build(hier, undefined, defaultEngineConfig);
    const a1Branch = branchFor(p, "a1");
    expect(a1Branch).toBeDefined();
    const a1Meristem = meristemBlockOf(p, a1Branch.id);
    expect(a1Branch.arcLength).toBeGreaterThan(a1Meristem.shortSide * 1.5);
  });

  test("overrides.a1.growthFactor = 0 → a1's arcLength shrinks to ≈ meristem + first-lief shortSide (the one-lief stub floor); meristem itself unchanged vs baseline", () => {
    const baseline = build(hier, undefined, defaultEngineConfig);
    const baseA1Branch = branchFor(baseline, "a1");
    const baseA1Meristem = meristemBlockOf(baseline, baseA1Branch.id);
    const baseFirstLief = firstLiefOf(baseline, baseA1Branch);
    expect(baseFirstLief).toBeDefined();

    const cfg = {
      ...defaultEngineConfig,
      overrides: { a1: { growthFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const a1Branch = branchFor(p, "a1");
    const a1Meristem = meristemBlockOf(p, a1Branch.id);
    const firstLief = firstLiefOf(p, a1Branch);

    // Meristem size is unaffected by growthFactor.
    expect(a1Meristem.shortSide).toBeCloseTo(baseA1Meristem.shortSide, 10);

    // The FIRST lief is the floor: its shortSide is UNCHANGED between g=0 and
    // g=1 — it never scales.
    expect(firstLief.shortSide).toBeCloseTo(baseFirstLief.shortSide, 10);

    // Every OTHER non-meristem block (spacer / child-axis / meristem-in /
    // meristem-out — and any lief with index ≥ 1, though a1 only has one
    // lief) has shrunk to (~)zero.
    for (const blk of nonMeristemBlocksOf(p, a1Branch.id)) {
      if (blk.id === firstLief.id) continue;
      expect(blk.shortSide).toBeCloseTo(0, 10);
    }

    // arcLength ≈ meristem + the first lief's (unscaled) shortSide —
    // everything else contributes 0.
    expect(a1Branch.arcLength).toBeCloseTo(a1Meristem.shortSide + baseFirstLief.shortSide, 6);
  });

  test("the floor is per-branch, not per-lief-count: a branch with 1 lief and a branch with 3 liefs shrink to ~the same arc at growthFactor = 0", () => {
    const multiHier: HierarchyInput = {
      root: {
        id: "root", name: "root",
        children: [
          { id: "one", name: "one", children: [{ id: "one1", name: "one1" }] },
          {
            id: "three", name: "three",
            children: [
              { id: "three1", name: "three1" },
              { id: "three2", name: "three2" },
              { id: "three3", name: "three3" },
            ],
          },
        ],
      },
    };
    const cfg = {
      ...defaultEngineConfig,
      overrides: { one: { growthFactor: 0 }, three: { growthFactor: 0 } },
    };
    const p = build(multiHier, undefined, cfg);
    const oneBranch = branchFor(p, "one");
    const threeBranch = branchFor(p, "three");
    expect(oneBranch).toBeDefined();
    expect(threeBranch).toBeDefined();

    // Sanity: "three" really does have 3 liefs, "one" really has 1.
    expect(p.blocks.filter((b: any) => b.branchId === oneBranch.id && b.kind === "lief").length).toBe(1);
    expect(p.blocks.filter((b: any) => b.branchId === threeBranch.id && b.kind === "lief").length).toBe(3);

    // Both are the same depth (both direct children of root) so their
    // meristem + first-lief floor sizes match, and both collapse to ~the
    // same arcLength at g=0 regardless of how many liefs they hold.
    expect(threeBranch.arcLength).toBeCloseTo(oneBranch.arcLength, 6);

    // Liefs with index ≥ 1 (the 2nd and 3rd of "three") DO scale: they
    // shrink to ~0 at g=0, and are full-size again at g=1 (baseline).
    const baseline = build(multiHier, undefined, defaultEngineConfig);
    const baseThreeBranch = branchFor(baseline, "three");
    const threeLiefs = p.blocks
      .filter((b: any) => b.branchId === threeBranch.id && b.kind === "lief")
      .sort((x: any, y: any) => threeBranch.blockIds.indexOf(x.id) - threeBranch.blockIds.indexOf(y.id));
    const baseThreeLiefs = baseline.blocks
      .filter((b: any) => b.branchId === baseThreeBranch.id && b.kind === "lief")
      .sort((x: any, y: any) => baseThreeBranch.blockIds.indexOf(x.id) - baseThreeBranch.blockIds.indexOf(y.id));
    for (let i = 1; i < threeLiefs.length; i++) {
      expect(threeLiefs[i]!.shortSide).toBeCloseTo(0, 10); // g=0 → ~0
      expect(baseThreeLiefs[i]!.shortSide).toBeGreaterThan(0.01); // g=1 → full
    }
    // The first lief (index 0) is untouched by g either way — the floor.
    expect(threeLiefs[0]!.shortSide).toBeCloseTo(baseThreeLiefs[0]!.shortSide, 10);
  });
});

describe("growthFactor: place.ts stays finite and collapses non-meristem blocks toward the branch origin", () => {
  test("at growthFactor = 0, all positions are finite (no NaN)", () => {
    const cfg = {
      ...defaultEngineConfig,
      overrides: { a1: { growthFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    for (const blk of p.blocks as any[]) {
      expect(Number.isFinite(blk.position.x)).toBe(true);
      expect(Number.isFinite(blk.position.y)).toBe(true);
    }
    expect(Number.isFinite(p.bounds.min.x)).toBe(true);
    expect(Number.isFinite(p.bounds.max.x)).toBe(true);
  });

  test("at growthFactor = 0, a1's non-meristem blocks collapse near the branch's origin (base of the arc), except the floored first lief", () => {
    const cfg = {
      ...defaultEngineConfig,
      overrides: { a1: { growthFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const a1Branch = branchFor(p, "a1");

    // The branch's own origin: parent branchNode's position (a1's parent is a).
    const parentBN = (p.blocks as any[]).find((b) => b.id === a1Branch.parentBranchNodeId);
    expect(parentBN).toBeDefined();
    const origin = parentBN.position;

    const dist = (pt: any) => Math.hypot(pt.x - origin.x, pt.y - origin.y);
    const firstLief = firstLiefOf(p, a1Branch);
    expect(firstLief).toBeDefined();

    // Every non-meristem block sits within the (now tiny) arc, i.e. no
    // farther from the origin than the arc's own total length — which has
    // shrunk to ~meristem + the one-lief floor's size (not just the
    // meristem stub alone, now that the first lief no longer scales to 0).
    for (const blk of nonMeristemBlocksOf(p, a1Branch.id)) {
      expect(dist(blk.position)).toBeLessThanOrEqual(a1Branch.arcLength * 1.0001);
    }
    // Blocks ordered strictly BEFORE the first lief (spacer/child-axis —
    // still zero-width, since only the first LIEF is floored, not the
    // spacer/growth-blocks around it) land essentially exactly on the
    // origin (t = 0, zero-width arc before them).
    const firstLiefIndex = a1Branch.blockIds.indexOf(firstLief.id);
    const beforeFirstLief = nonMeristemBlocksOf(p, a1Branch.id).filter(
      (blk: any) => a1Branch.blockIds.indexOf(blk.id) < firstLiefIndex,
    );
    expect(beforeFirstLief.length).toBeGreaterThan(0);
    for (const blk of beforeFirstLief) {
      expect(dist(blk.position)).toBeLessThan(1e-6);
    }

    // The first lief itself is the floor: it keeps its full shortSide, so
    // unlike the blocks before it, it does NOT collapse onto the origin —
    // it sits at a real, nonzero offset (while still bounded within the
    // tiny arc, per the assertion above).
    expect(dist(firstLief.position)).toBeGreaterThan(1);

    // Sanity: the baseline (growthFactor absent) has these blocks spread well
    // away from the origin, confirming the collapse is a real effect.
    const baseline = build(hier, undefined, defaultEngineConfig);
    const baseA1Branch = branchFor(baseline, "a1");
    const baseParentBN = (baseline.blocks as any[]).find(
      (b) => b.id === baseA1Branch.parentBranchNodeId,
    );
    const baseOrigin = baseParentBN.position;
    const baseDist = (pt: any) => Math.hypot(pt.x - baseOrigin.x, pt.y - baseOrigin.y);
    const spread = nonMeristemBlocksOf(baseline, baseA1Branch.id).some(
      (blk: any) => baseDist(blk.position) > 1,
    );
    expect(spread).toBe(true);
  });
});

describe("growthFactor: cascades to child branches, leaves siblings unaffected", () => {
  test("overrides.a.growthFactor = 0 also shrinks child branch a1's non-meristem sizes", () => {
    const baseline = build(hier, undefined, defaultEngineConfig);
    const baseA1 = branchFor(baseline, "a1");
    const baseA1NonMeristem = nonMeristemBlocksOf(baseline, baseA1.id);
    expect(baseA1NonMeristem.some((b: any) => b.shortSide > 0)).toBe(true);

    const cfg = {
      ...defaultEngineConfig,
      overrides: { a: { growthFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const a1Branch = branchFor(p, "a1");
    expect(a1Branch).toBeDefined();
    const firstLief = firstLiefOf(p, a1Branch);
    const baseFirstLief = firstLiefOf(baseline, baseA1);
    for (const blk of nonMeristemBlocksOf(p, a1Branch.id)) {
      if (blk.id === firstLief.id) continue; // the cascaded floor — see below
      expect(blk.shortSide).toBeCloseTo(0, 10);
    }
    // The cascade still respects the floor: a1's first lief keeps its full
    // (unscaled) size even though the collapse cascaded down from parent "a".
    expect(firstLief.shortSide).toBeCloseTo(baseFirstLief.shortSide, 10);
    // a1's own meristem stays full-size (unscaled).
    const a1Meristem = meristemBlockOf(p, a1Branch.id);
    const baseA1Meristem = meristemBlockOf(baseline, baseA1.id);
    expect(a1Meristem.shortSide).toBeCloseTo(baseA1Meristem.shortSide, 10);
  });

  test("overrides.a.growthFactor = 0 leaves sibling branch b's sizes unaffected", () => {
    const baseline = build(hier, undefined, defaultEngineConfig);
    const baseB = branchFor(baseline, "b");

    const cfg = {
      ...defaultEngineConfig,
      overrides: { a: { growthFactor: 0 } },
    };
    const p = build(hier, undefined, cfg);
    const bBranch = branchFor(p, "b");
    expect(bBranch).toBeDefined();
    expect(bBranch.arcLength).toBeCloseTo(baseB.arcLength, 10);
    for (const blk of nonMeristemBlocksOf(p, bBranch.id)) {
      const baseBlk = nonMeristemBlocksOf(baseline, baseB.id).find(
        (bb: any) => bb.id === blk.id,
      );
      expect(baseBlk).toBeDefined();
      expect(blk.shortSide).toBeCloseTo(baseBlk.shortSide, 10);
    }
  });
});
