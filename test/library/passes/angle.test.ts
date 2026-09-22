import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
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

describe("anglePass: assigns departure angles", () => {
  test("stem branch has departureAngle 0", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const stem = s.branches.find((b) => b.id === s.stemBranchId)!;
    expect(stem.departureAngle).toBe(0);
  });

  test("non-stem branch gets non-zero departureAngle", () => {
    const s = structurePass(tiny, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const child = s.branches.find((b) => b.parentBranchId === s.stemBranchId)!;
    expect(child.departureAngle).not.toBe(0);
  });

  test("fixed angle mode: every child takes ±firstBranchAngle", () => {
    const cfg = {
      ...defaultEngineConfig,
      angles: { ...defaultEngineConfig.angles, angleMode: "fixed" as const, firstBranchAngle: 45 },
    };
    const wide: HierarchyInput = {
      root: {
        id: "root", name: "root",
        children: [
          { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
          { id: "b", name: "b", children: [{ id: "b1", name: "b1" }] },
          { id: "c", name: "c", children: [{ id: "c1", name: "c1" }] },
        ],
      },
    };
    const s = structurePass(wide, cfg);
    anglePass(s, cfg);
    const childs = s.branches.filter((b) => b.parentBranchId === s.stemBranchId);
    for (const c of childs) {
      expect(Math.abs((c.departureAngle * 180) / Math.PI)).toBeCloseTo(45, 4);
    }
  });
});

describe("anglePass: curlBack flag (spiral mode)", () => {
  // A single-branch chain: r → l1 → l2 → l3 (→ l4 leaf). Branches at depth 1,2,3.
  const chainHier: HierarchyInput = {
    root: { id: "r", name: "r", children: [
      { id: "l1", name: "l1", children: [
        { id: "l2", name: "l2", children: [
          { id: "l3", name: "l3", children: [{ id: "l4", name: "l4" }] },
        ] },
      ] },
    ] },
  };

  const chainDegs = (cfg: typeof defaultEngineConfig): number[] => {
    const s = structurePass(chainHier, cfg);
    anglePass(s, cfg);
    return s.branches
      .filter((b) => b.depth >= 1)
      .sort((a, b) => a.depth - b.depth)
      .map((b) => (b.departureAngle * 180) / Math.PI);
  };

  const fixed = {
    ...defaultEngineConfig,
    angles: { ...defaultEngineConfig.angles, angleMode: "fixed" as const, firstBranchAngle: 30 },
  };

  test("curlBack:false → constant same-side departures (spiral)", () => {
    const cfg = { ...fixed, angles: { ...fixed.angles, curlBack: false } };
    const degs = chainDegs(cfg);
    expect(degs.length).toBeGreaterThanOrEqual(3);
    for (const d of degs) expect(d).toBeCloseTo(30, 4); // all +30°, never flipped
  });

  test("curlBack:true (default) → alternating sides (curl-back preserved)", () => {
    const degs = chainDegs(fixed); // curlBack defaults to true
    expect(degs[0]).toBeGreaterThan(0);
    expect(degs[1]).toBeLessThan(0);
    expect(degs[2]).toBeGreaterThan(0);
  });
});

describe("anglePass: mirrorCurl flag (side-mirrored spiral)", () => {
  // Two boughs, each a 3-deep single chain → depth 1,2,3 on both sides.
  const twoBough: HierarchyInput = {
    root: { id: "r", name: "r", children: [
      { id: "a", name: "a", children: [
        { id: "a1", name: "a1", children: [
          { id: "a2", name: "a2", children: [{ id: "a3", name: "a3" }] },
        ] },
      ] },
      { id: "b", name: "b", children: [
        { id: "b1", name: "b1", children: [
          { id: "b2", name: "b2", children: [{ id: "b3", name: "b3" }] },
        ] },
      ] },
    ] },
  };

  const fixed = {
    ...defaultEngineConfig,
    angles: { ...defaultEngineConfig.angles, angleMode: "fixed" as const, firstBranchAngle: 30 },
  };

  // The depth-1 ancestor (the bough) a branch descends from.
  const boughSign = (b: { departureAngle: number; depth: number; parentBranchId: string | null }, byId: Map<string, any>): number => {
    let c: any = b;
    while (c.depth > 1) c = byId.get(c.parentBranchId);
    return Math.sign(c.departureAngle);
  };

  test("curlBack:false + mirrorCurl + curlOutward:true → each lineage spirals consistently, mirrored across the stem", () => {
    const cfg = { ...fixed, angles: { ...fixed.angles, curlBack: false, mirrorCurl: true, curlOutward: true } };
    const s = structurePass(twoBough, cfg);
    anglePass(s, cfg);
    const byId = new Map(s.branches.map((x) => [x.id, x]));
    const deep = s.branches.filter((x) => x.depth >= 2);
    expect(deep.length).toBeGreaterThanOrEqual(4);
    // every deep branch curls the SAME way as its bough → consistent per-side coil
    for (const x of deep) expect(Math.sign(x.departureAngle)).toBe(boughSign(x, byId));
    // …and the two boughs sit on opposite sides → the coils mirror
    const boughs = s.branches.filter((x) => x.depth === 1).sort((p, q) => p.departureAngle - q.departureAngle);
    expect(Math.sign(boughs[0]!.departureAngle)).toBe(-Math.sign(boughs[boughs.length - 1]!.departureAngle));
  });

  test("curlOutward toggle negates the deep (descendant) departures", () => {
    const mk = (outward: boolean) => {
      const cfg = { ...fixed, angles: { ...fixed.angles, curlBack: false, mirrorCurl: true, curlOutward: outward } };
      const s = structurePass(twoBough, cfg);
      anglePass(s, cfg);
      return new Map(s.branches.filter((x) => x.depth >= 2).map((x) => [x.id, x.departureAngle]));
    };
    const out = mk(true), inw = mk(false);
    expect(out.size).toBeGreaterThanOrEqual(4);
    for (const [id, deg] of out) expect(inw.get(id)!).toBeCloseTo(-deg, 6);
  });

  test("mirrorCurl:false (default) → legacy global handedness (all descendants same side)", () => {
    const cfg = { ...fixed, angles: { ...fixed.angles, curlBack: false } }; // mirrorCurl undefined → false
    const s = structurePass(twoBough, cfg);
    anglePass(s, cfg);
    const deep = s.branches.filter((x) => x.depth >= 2).map((x) => (x.departureAngle * 180) / Math.PI);
    for (const d of deep) expect(d).toBeCloseTo(30, 4); // all +30°, ignores side
  });
});
