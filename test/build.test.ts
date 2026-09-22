import { describe, expect, test } from "bun:test";
import { build } from "../src/index.ts";
import { defaultEngineConfig } from "../src/defaults.ts";
import { tiny } from "./fixtures/tiny.ts";
import { shakespeareMini } from "./fixtures/shakespeare-mini.ts";

describe("build (tiny)", () => {
  const plant = build(tiny, undefined, defaultEngineConfig);

  test("schemaVersion is '1.0.0'", () => expect(plant.schemaVersion).toBe("1.0.0"));
  test("has an anchor and a stem", () => {
    expect(plant.anchor).toBeDefined();
    expect(plant.stemBranchId).toBeDefined();
  });
  test("stem's tip meristem is the Root Meristem (carries input.root identity)", () => {
    const stem = plant.branches.find((b) => b.id === plant.stemBranchId)!;
    const tip = stem.blockIds
      .map((id) => plant.blocks.find((b) => b.id === id)!)
      .find((b) => b.kind === "meristem")!;
    expect(tip.kind).toBe("meristem");
    expect((tip as { hierarchyId: string }).hierarchyId).toBe("root");
  });
  test("branches and blocks are non-empty", () => {
    expect(plant.branches.length).toBeGreaterThan(0);
    expect(plant.blocks.length).toBeGreaterThan(0);
  });
  test("metadata.counts matches arrays", () => {
    expect(plant.metadata.counts.blocks).toBe(plant.blocks.length);
    expect(plant.metadata.counts.branches).toBe(plant.branches.length);
    expect(plant.metadata.counts.events).toBe(plant.events.length);
  });
  test("round-trips through JSON", () => {
    const roundTrip = JSON.parse(JSON.stringify(plant));
    expect(roundTrip.id).toBe(plant.id);
  });
});

describe("build (shakespeare-mini)", () => {
  const plant = build(shakespeareMini, undefined, defaultEngineConfig);

  test("stem carries 3 top-level branchNodes", () => {
    const stem = plant.branches.find((b) => b.id === plant.stemBranchId)!;
    const branchNodes = stem.blockIds
      .map((id) => plant.blocks.find((b) => b.id === id)!)
      .filter((b) => b.kind === "branchNode");
    expect(branchNodes).toHaveLength(3);
  });
  test("every BranchNode has a RingSet", () => {
    const bnIds = plant.blocks.filter((b) => b.kind === "branchNode").map((b) => b.id);
    for (const id of bnIds) {
      expect(plant.rings.some((rs) => rs.blockId === id)).toBe(true);
    }
  });
});

