import { describe, expect, test } from "bun:test";
import { build, defaultEngineConfig } from "../../../src/library/index.ts";
import { trieSmoke } from "./trie-smoke.ts";

describe("trie-smoke fixture", () => {
  test("builds without error", () => {
    const plant = build(trieSmoke, undefined, defaultEngineConfig);
    expect(plant).toBeDefined();
  });

  test("has many more branches than events (trie shape)", () => {
    const plant = build(trieSmoke, undefined, defaultEngineConfig);
    expect(plant.branches.length).toBeGreaterThan(plant.events.length);
  });

  test("upper BNs (closer to root) get non-trivial fwd/bwd demand from descendants — the trie fix", () => {
    const plant = build(trieSmoke, undefined, defaultEngineConfig);
    const stem = plant.branches.find((b) => b.id === plant.stemBranchId)!;
    const epsilon = defaultEngineConfig.clearance.expansionEpsilonRatio * stem.shortSide;

    // Find any BN on the stem chain.
    const stemBNs = plant.blocks.filter(
      (b) => b.kind === "branchNode" && b.branchId === stem.id,
    );
    expect(stemBNs.length).toBeGreaterThan(0);

    for (const bn of stemBNs) {
      const fwd = plant.blocks.find(
        (b) =>
          b.kind === "growthBlock" &&
          (b as { subtype: string }).subtype === "fwd-tangent" &&
          (b as { ownerBlockId: string }).ownerBlockId === bn.id,
      )!;
      const bwd = plant.blocks.find(
        (b) =>
          b.kind === "growthBlock" &&
          (b as { subtype: string }).subtype === "bwd-tangent" &&
          (b as { ownerBlockId: string }).ownerBlockId === bn.id,
      )!;
      // The forward growth block of a stem-level BN should reserve substantial
      // space (way above ε) because its subtree has 4 layers of further BNs.
      expect(fwd.shortSide + bwd.shortSide).toBeGreaterThan(epsilon * 10);
    }
  });

  test("Plant.bounds non-degenerate", () => {
    const plant = build(trieSmoke, undefined, defaultEngineConfig);
    expect(plant.bounds.max.x - plant.bounds.min.x).toBeGreaterThan(0);
    expect(plant.bounds.max.y - plant.bounds.min.y).toBeGreaterThan(0);
  });
});
