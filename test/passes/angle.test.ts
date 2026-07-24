import { describe, expect, test } from "bun:test";
import { structurePass } from "../../src/passes/structure.ts";
import { anglePass } from "../../src/passes/angle.ts";
import { defaultEngineConfig } from "../../src/defaults.ts";
import { tiny } from "../fixtures/tiny.ts";
import { shakespeareMini } from "../fixtures/shakespeare-mini.ts";

describe("anglePass (tiny, phi-sequence)", () => {
  const s = structurePass(tiny, defaultEngineConfig);
  const a = anglePass(s, defaultEngineConfig);

  test("the root branch is the stem: departureAngle 0", () => {
    const rootId = s.stemBranchId;
    const root = a.branches.find((b) => b.id === rootId)!;
    expect(root.departureAngle).toBe(0);
  });

  test("stem's first child departs at ±firstBranchAngle", () => {
    const rootId = s.stemBranchId;
    const firstLevel = a.branches.filter((b) => b.parentBranchId === rootId);
    // tiny fixture has at least one promoted child at the root level
    expect(firstLevel.length).toBeGreaterThanOrEqual(1);
    const expected = (defaultEngineConfig.angles.firstBranchAngle * Math.PI) / 180;
    expect(Math.abs(firstLevel[0]!.departureAngle)).toBeCloseTo(expected, 9);
  });
});

describe("anglePass (shakespeare-mini, phi-sequence)", () => {
  const s = structurePass(shakespeareMini, defaultEngineConfig);
  const a = anglePass(s, defaultEngineConfig);
  const rootId = s.stemBranchId;

  test("first-level child branches alternate sign under alternateBranches=true", () => {
    const firstLevel = a.branches.filter((b) => b.parentBranchId === rootId);
    expect(firstLevel.length).toBeGreaterThanOrEqual(2);
    const signs = firstLevel.map((b) => Math.sign(b.departureAngle));
    expect(signs[0]).not.toBe(signs[1]);
  });

  test("first-level children: per-side decay is symmetric", () => {
    // Pair i on each side shares |magnitude|: the paired left/right children
    // at side-local index 0 both take firstBranchAngle; pair at side-local 1
    // both take firstBranchAngle × decay; etc.
    const firstLevel = a.branches.filter((b) => b.parentBranchId === rootId);
    const first = defaultEngineConfig.angles.firstBranchAngle;
    const decay = defaultEngineConfig.angles.angleDecay;
    // Split by sign into the two sides (preserving sibling order within each).
    const positives = firstLevel.filter((b) => b.departureAngle > 0);
    const negatives = firstLevel.filter((b) => b.departureAngle < 0);
    for (let k = 0; k < Math.min(positives.length, negatives.length); k++) {
      const expected = (first * Math.pow(decay, k) * Math.PI) / 180;
      expect(Math.abs(positives[k]!.departureAngle)).toBeCloseTo(expected, 9);
      expect(Math.abs(negatives[k]!.departureAngle)).toBeCloseTo(expected, 9);
    }
  });

  test("deeper branches' side-local first departure = |parent.departureAngle| × decay", () => {
    // A grandchild at side-local index 0 takes the seed itself; that seed is
    // |parent.departureAngle| × decay by construction. Walks every parent that
    // has at least one child-branch and checks the first (leftmost) child.
    const decay = defaultEngineConfig.angles.angleDecay;
    for (const parent of a.branches) {
      if (parent.parentBranchId === null) continue; // stem seed is separate
      const kids = a.branches.filter((b) => b.parentBranchId === parent.id);
      if (kids.length === 0) continue;
      // Side-local index 0 on either side shares magnitude; compare abs values.
      const firstMag = Math.abs(kids[0]!.departureAngle);
      const expected = Math.abs(parent.departureAngle) * decay;
      expect(firstMag).toBeCloseTo(expected, 9);
    }
  });
});

describe("anglePass (fixed mode)", () => {
  const cfg = {
    ...defaultEngineConfig,
    angles: { ...defaultEngineConfig.angles, angleMode: "fixed" as const, firstBranchAngle: 25 },
  };
  const s = structurePass(tiny, cfg);
  const a = anglePass(s, cfg);

  test("the root branch still has departureAngle 0", () => {
    const rootId = s.stemBranchId;
    const root = a.branches.find((b) => b.id === rootId)!;
    expect(root.departureAngle).toBe(0);
  });

  test("every non-stem branch has |departureAngle| = firstBranchAngle", () => {
    const target = (25 * Math.PI) / 180;
    for (const br of a.branches) {
      if (br.parentBranchId === null) continue;
      expect(Math.abs(br.departureAngle)).toBeCloseTo(target, 6);
    }
  });
});
