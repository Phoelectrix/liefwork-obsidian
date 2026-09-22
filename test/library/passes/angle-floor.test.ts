import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import { shakespeareMini } from "../../fixtures/shakespeare-mini.ts";

// angles.minBranchAngle (10 Sept 2026): the plugin shipped decay 1 because a
// decaying fan collapses toward 0°. The floor lets decay tighten a fan without
// flattening any branch onto its parent — applied to the sibling sequence AND
// the depth seed (|parent| × decay), so it holds at every level.
describe("anglePass — angles.minBranchAngle", () => {
  const cfg = {
    ...defaultEngineConfig,
    angles: { ...defaultEngineConfig.angles, firstBranchAngle: 50, angleDecay: 0.3, minBranchAngle: 35 },
  };
  const a = anglePass(structurePass(shakespeareMini, cfg), cfg);
  test("no non-stem branch departs below the floor", () => {
    const nonStem = a.branches.filter((b) => b.parentBranchId !== null);
    expect(nonStem.length).toBeGreaterThan(2);
    for (const b of nonStem) {
      expect((Math.abs(b.departureAngle) * 180) / Math.PI).toBeGreaterThanOrEqual(35 - 1e-9);
    }
  });
  test("without the floor the same config collapses (the bug the floor fixes)", () => {
    const bare = { ...cfg, angles: { ...cfg.angles, minBranchAngle: 0 } };
    const b = anglePass(structurePass(shakespeareMini, bare), bare);
    const minDeg = Math.min(...b.branches.filter((x) => x.parentBranchId !== null).map((x) => (Math.abs(x.departureAngle) * 180) / Math.PI));
    expect(minDeg).toBeLessThan(35);
  });
  test("absent = 0 = today's angles byte-for-byte", () => {
    const base = anglePass(structurePass(shakespeareMini, defaultEngineConfig), defaultEngineConfig);
    const zero = { ...defaultEngineConfig, angles: { ...defaultEngineConfig.angles, minBranchAngle: 0 } };
    const withZero = anglePass(structurePass(shakespeareMini, zero), zero);
    expect(withZero.branches.map((b) => b.departureAngle)).toEqual(base.branches.map((b) => b.departureAngle));
  });
});
