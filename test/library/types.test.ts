import { describe, expect, test } from "bun:test";
import {
  LIBRARY_ENGINE_VERSION,
  defaultEngineConfig,
  validateHierarchy,
} from "../../src/library/index.ts";
import type { Block, GrowthBlock, Plant, EngineConfig } from "../../src/library/types.ts";

describe("library type foundation", () => {
  test("exports LIBRARY_ENGINE_VERSION", () => {
    expect(typeof LIBRARY_ENGINE_VERSION).toBe("string");
    expect(LIBRARY_ENGINE_VERSION.length).toBeGreaterThan(0);
  });

  test("defaultEngineConfig has Library clearance shape", () => {
    expect(defaultEngineConfig.clearance.branchBuffer).toBe(1.0);
    expect(defaultEngineConfig.clearance.expansionEpsilonRatio).toBe(0.02);
    expect(defaultEngineConfig.clearance.childAxisGrowthBlockFactor).toBeGreaterThan(0);
    expect(defaultEngineConfig.clearance.meristemInFactor).toBeGreaterThan(0);
    expect(defaultEngineConfig.clearance.meristemOutFactor).toBeGreaterThan(0);
    // None of the original-engine clearance knobs:
    expect((defaultEngineConfig.clearance as Record<string, unknown>).branchNodeLeadIn).toBeUndefined();
    expect((defaultEngineConfig.clearance as Record<string, unknown>).meristemLeadInSpacers).toBeUndefined();
    expect((defaultEngineConfig.clearance as Record<string, unknown>).meristemTrailingSpacers).toBeUndefined();
    expect((defaultEngineConfig.clearance as Record<string, unknown>).leadInMargin).toBeUndefined();
    expect((defaultEngineConfig.clearance as Record<string, unknown>).minBranchLeadInSpacers).toBeUndefined();
  });

  test("re-exports validateHierarchy from src/validation.ts", () => {
    const result = validateHierarchy({ root: { id: "x", name: "x" } });
    expect(result.errors).toHaveLength(0);
  });

  test("Block union includes GrowthBlock", () => {
    const gb: GrowthBlock = {
      id: "blk_0",
      branchId: "br_0",
      index: 0,
      shortSide: 0,
      arcPosition: 0,
      position: { x: 0, y: 0 },
      tangent: 0,
      rotation: 0,
      kind: "growthBlock",
      subtype: "fwd-tangent",
      ownerBlockId: "blk_owner",
    };
    const b: Block = gb;
    expect(b.kind).toBe("growthBlock");
  });

  test("Plant shape excludes rings", () => {
    // Compile-time assertion: rings is not a property on Library Plant.
    type HasRings = "rings" extends keyof Plant ? true : false;
    const _check: HasRings = false;
    expect(_check).toBe(false);
  });

  test("EngineConfig.clearance has Library shape, not original", () => {
    type HasChildAxis = "childAxisGrowthBlockFactor" extends keyof EngineConfig["clearance"] ? true : false;
    const _check: HasChildAxis = true;
    expect(_check).toBe(true);
  });
});
