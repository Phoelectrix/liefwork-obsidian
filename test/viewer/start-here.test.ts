import { describe, test, expect } from "bun:test";
import {
  START_HERE_MARKER,
  START_HERE_DISPLAY_PREFIX,
  hasStartHerePrefix,
  stripStartHerePrefix,
  displayNameForBoosted,
  extractStartHereBranches,
} from "../../viewer/src/start-here.ts";
import type { Plant, Block } from "../../src/types.ts";

describe("start-here prefix helpers", () => {
  test("hasStartHerePrefix detects the marker", () => {
    expect(hasStartHerePrefix("<=Start Here: Preface")).toBe(true);
    expect(hasStartHerePrefix("Preface")).toBe(false);
    expect(hasStartHerePrefix("")).toBe(false);
  });

  test("stripStartHerePrefix returns the clean name", () => {
    expect(stripStartHerePrefix("<=Start Here: Preface")).toBe("Preface");
    expect(stripStartHerePrefix("<=Start Here:   Lots of space")).toBe("Lots of space");
  });

  test("stripStartHerePrefix is a no-op on names without the prefix", () => {
    expect(stripStartHerePrefix("Preface")).toBe("Preface");
    expect(stripStartHerePrefix("<= Other thing")).toBe("<= Other thing");
  });

  test("displayNameForBoosted prepends the visible cue", () => {
    expect(displayNameForBoosted("Preface")).toBe("Start Here → Preface");
    expect(displayNameForBoosted("Whatever You Like")).toBe("Start Here → Whatever You Like");
  });

  test("constants are the documented values", () => {
    expect(START_HERE_MARKER).toBe("<=Start Here:");
    expect(START_HERE_DISPLAY_PREFIX).toBe("Start Here → ");
  });
});

describe("extractStartHereBranches", () => {
  function makePlant(blocks: Block[]): Plant {
    return {
      blocks,
      branches: [],
      extents: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    } as unknown as Plant;
  }

  test("mutates prefixed meristem name + returns its branch id", () => {
    const plant = makePlant([
      { id: "m1", kind: "meristem", branchId: "br1", name: "<=Start Here: Preface" } as unknown as Block,
      { id: "l1", kind: "lief", branchId: "br1", name: "Some lief" } as unknown as Block,
    ]);
    const out = extractStartHereBranches(plant);
    expect(out.has("br1")).toBe(true);
    expect(out.size).toBe(1);
    // mutation:
    expect((plant.blocks[0] as { name: string }).name).toBe("Preface");
    // lief untouched:
    expect((plant.blocks[1] as { name: string }).name).toBe("Some lief");
  });

  test("returns empty set when no meristem is tagged", () => {
    const plant = makePlant([
      { id: "m1", kind: "meristem", branchId: "br1", name: "Preface" } as unknown as Block,
    ]);
    const out = extractStartHereBranches(plant);
    expect(out.size).toBe(0);
  });

  test("skips lief blocks even if their name has the prefix", () => {
    const plant = makePlant([
      { id: "l1", kind: "lief", branchId: "br1", name: "<=Start Here: somehow" } as unknown as Block,
    ]);
    const out = extractStartHereBranches(plant);
    expect(out.size).toBe(0);
    // Lief name is NOT mutated — start-here is meristem-only.
    expect((plant.blocks[0] as { name: string }).name).toBe("<=Start Here: somehow");
  });

  test("handles multiple tagged meristems", () => {
    const plant = makePlant([
      { id: "m1", kind: "meristem", branchId: "br1", name: "<=Start Here: A" } as unknown as Block,
      { id: "m2", kind: "meristem", branchId: "br2", name: "B" } as unknown as Block,
      { id: "m3", kind: "meristem", branchId: "br3", name: "<=Start Here: C" } as unknown as Block,
    ]);
    const out = extractStartHereBranches(plant);
    expect(out.has("br1")).toBe(true);
    expect(out.has("br2")).toBe(false);
    expect(out.has("br3")).toBe(true);
  });
});
