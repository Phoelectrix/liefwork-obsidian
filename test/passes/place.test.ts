import { describe, expect, test } from "bun:test";
import { structurePass } from "../../src/passes/structure.ts";
import { anglePass } from "../../src/passes/angle.ts";
import { ringPass } from "../../src/passes/ring.ts";
import { sizePass } from "../../src/passes/size.ts";
import { placePass } from "../../src/passes/place.ts";
import { defaultEngineConfig } from "../../src/defaults.ts";
import { tiny } from "../fixtures/tiny.ts";

describe("placePass", () => {
  const s = structurePass(tiny, defaultEngineConfig);
  anglePass(s, defaultEngineConfig);
  const r = ringPass(s, defaultEngineConfig, tiny);
  sizePass(r, defaultEngineConfig);
  const p = placePass(r, defaultEngineConfig);

  test("every block has a finite world position", () => {
    for (const blk of p.blocks) {
      expect(Number.isFinite(blk.position.x)).toBe(true);
      expect(Number.isFinite(blk.position.y)).toBe(true);
    }
  });

  test("bounds contain every block center", () => {
    for (const blk of p.blocks) {
      expect(blk.position.x).toBeGreaterThanOrEqual(p.bounds.min.x - 0.01);
      expect(blk.position.x).toBeLessThanOrEqual(p.bounds.max.x + 0.01);
      expect(blk.position.y).toBeGreaterThanOrEqual(p.bounds.min.y - 0.01);
      expect(blk.position.y).toBeLessThanOrEqual(p.bounds.max.y + 0.01);
    }
  });

  test("arcPosition is monotonic along each branch chain", () => {
    for (const br of p.branches) {
      let prev = -Infinity;
      for (const bid of br.blockIds) {
        const blk = p.blocks.find((b) => b.id === bid)!;
        expect(blk.arcPosition).toBeGreaterThanOrEqual(prev);
        prev = blk.arcPosition;
      }
    }
  });
});

describe("placePass — (a) backward-ring cursor split", () => {
  // Build the full pipeline once; reuse across tests.
  const cfg = defaultEngineConfig;
  const s = structurePass(tiny, cfg);
  anglePass(s, cfg);
  const r = ringPass(s, cfg, tiny);
  sizePass(r, cfg);
  const p = placePass(r, cfg);

  // Helper: depth-scaled short side, mirroring the formula in ring.ts/size.ts.
  const sAtDepth = (d: number): number =>
    cfg.sizing.baseSize * Math.pow(cfg.sizing.childScale, d * cfg.sizing.phiOrder);

  test("(a)-1: every BN's arcPosition reflects backward shift before placement", () => {
    // Walk each branch chain reproducing the post-(a) cursor rule and
    // assert each block's arcPosition matches.
    for (const br of p.branches) {
      let cursor = 0;
      for (const bid of br.blockIds) {
        const blk = p.blocks.find((b) => b.id === bid)!;
        if (blk.kind === "branchNode") {
          const rs = p.rings.find((x) => x.blockId === bid);
          if (rs) cursor += rs.backward.reduce((a, rg) => a + rg.width, 0);
        }
        const expectedArc = cursor + blk.shortSide / 2;
        expect(blk.arcPosition).toBeCloseTo(expectedArc, 6);
        cursor += blk.shortSide;
        if (blk.kind === "branchNode") {
          const rs = p.rings.find((x) => x.blockId === bid);
          if (rs) cursor += rs.forward.reduce((a, rg) => a + rg.width, 0);
        }
      }
    }
  });

  test("(a)-2: child branch origin reflects post-(a) BN world position", () => {
    for (const br of p.branches) {
      if (br.parentBranchNodeId === null) continue;
      const bn = p.blocks.find((b) => b.id === br.parentBranchNodeId);
      expect(bn).toBeDefined();
      expect(Number.isFinite(bn!.position.x)).toBe(true);
      expect(Number.isFinite(bn!.position.y)).toBe(true);
    }
  });

  test("(a)-3: next-sibling invariance — total advance after BN unchanged", () => {
    // The sum (backward + forward) at each BN must still equal the cursor
    // gap between BN's center+S/2 and the next block's center-next.shortSide/2.
    for (const br of p.branches) {
      for (let i = 0; i < br.blockIds.length - 1; i++) {
        const blk = p.blocks.find((b) => b.id === br.blockIds[i])!;
        const next = p.blocks.find((b) => b.id === br.blockIds[i + 1])!;
        if (blk.kind !== "branchNode") continue;
        const rs = p.rings.find((x) => x.blockId === blk.id)!;
        const fwdTotal = rs.forward.reduce((a, rg) => a + rg.width, 0);
        const expectedNextArc =
          blk.arcPosition + blk.shortSide / 2 + fwdTotal + next.shortSide / 2;
        expect(next.arcPosition).toBeCloseTo(expectedNextArc, 6);
      }
    }
  });

  test("(a)-4: every BN's backward total ≥ epsilon floor (sanity check)", () => {
    const expansionEpsilonRatio = cfg.clearance.expansionEpsilonRatio;
    for (const rs of p.rings) {
      const bn = p.blocks.find((b) => b.id === rs.blockId)!;
      const parentBranch = p.branches.find((b) => b.id === bn.branchId)!;
      const epsilon = expansionEpsilonRatio * sAtDepth(parentBranch.depth);
      const bwdTotal = rs.backward.reduce((a, rg) => a + rg.width, 0);
      for (const ring of rs.backward) {
        expect(ring.width).toBeGreaterThanOrEqual(epsilon - 1e-9);
      }
      if (rs.backward.length > 0) {
        expect(bwdTotal).toBeGreaterThanOrEqual(epsilon - 1e-9);
      }
    }
  });
});

describe("branch bounds (per-branch + descendants)", () => {
  const cfg = defaultEngineConfig;
  const s = structurePass(tiny, cfg);
  anglePass(s, cfg);
  const r = ringPass(s, cfg, tiny);
  sizePass(r, cfg);
  const p = placePass(r, cfg);

  test("each branch's bounds contain its block centers", () => {
    for (const br of p.branches) {
      const blocks = p.blocks.filter((b) => br.blockIds.includes(b.id));
      for (const blk of blocks) {
        expect(blk.position.x).toBeGreaterThanOrEqual(br.bounds.min.x);
        expect(blk.position.x).toBeLessThanOrEqual(br.bounds.max.x);
        expect(blk.position.y).toBeGreaterThanOrEqual(br.bounds.min.y);
        expect(blk.position.y).toBeLessThanOrEqual(br.bounds.max.y);
      }
    }
  });

  test("parent branch bounds contain child branch bounds", () => {
    for (const br of p.branches) {
      if (br.parentBranchId === null) continue;
      const parent = p.branches.find((b) => b.id === br.parentBranchId)!;
      expect(parent.bounds.min.x).toBeLessThanOrEqual(br.bounds.min.x);
      expect(parent.bounds.min.y).toBeLessThanOrEqual(br.bounds.min.y);
      expect(parent.bounds.max.x).toBeGreaterThanOrEqual(br.bounds.max.x);
      expect(parent.bounds.max.y).toBeGreaterThanOrEqual(br.bounds.max.y);
    }
  });

  test("localBounds excludes descendants while bounds includes them", () => {
    // Every branch's localBounds (its own blocks' extent) must be contained
    // within its subtree-union bounds.
    for (const br of p.branches) {
      expect(br.localBounds).toBeDefined();
      expect(br.localBounds!.min.x).toBeGreaterThanOrEqual(br.bounds.min.x);
      expect(br.localBounds!.min.y).toBeGreaterThanOrEqual(br.bounds.min.y);
      expect(br.localBounds!.max.x).toBeLessThanOrEqual(br.bounds.max.x);
      expect(br.localBounds!.max.y).toBeLessThanOrEqual(br.bounds.max.y);
    }

    // At least one branch WITH children must have a localBounds strictly
    // smaller than its subtree bounds: the descendants push the union outward,
    // so the local box does not equal the subtree box.
    const parentsWithChildren = p.branches.filter((br) =>
      p.branches.some((c) => c.parentBranchId === br.id),
    );
    expect(parentsWithChildren.length).toBeGreaterThan(0);
    const anyStrictlySmaller = parentsWithChildren.some((br) => {
      const lb = br.localBounds!;
      return (
        lb.min.x > br.bounds.min.x ||
        lb.min.y > br.bounds.min.y ||
        lb.max.x < br.bounds.max.x ||
        lb.max.y < br.bounds.max.y
      );
    });
    expect(anyStrictlySmaller).toBe(true);
  });

  test("localBounds is a distinct copy, not an alias of the local box", () => {
    // The union pass must not have mutated localBounds; for a leaf branch
    // (no children) localBounds and bounds are value-equal but not the same ref.
    const leaf = p.branches.find(
      (br) => !p.branches.some((c) => c.parentBranchId === br.id),
    )!;
    expect(leaf.localBounds).toBeDefined();
    expect(leaf.localBounds).not.toBe(leaf.bounds);
    expect(leaf.localBounds).toEqual(leaf.bounds);
  });
});
