import { describe, test, expect } from "bun:test";
import { nodeRefFor, nodeRefByHierarchyId } from "../src/mount-plant.ts";
import type { Block, Plant } from "../../src/types.ts";

const asBlock = (o: object): Block => o as unknown as Block;

describe("nodeRefFor", () => {
  test("lief → NodeRef with hierarchyId/kind/name/branchId", () => {
    const b = asBlock({ kind: "lief", id: "L1", branchId: "B1", hierarchyId: "Topic/a.md", name: "a" });
    expect(nodeRefFor(b)).toEqual({ hierarchyId: "Topic/a.md", kind: "lief", name: "a", branchId: "B1" });
  });
  test("meristem → NodeRef", () => {
    const b = asBlock({ kind: "meristem", id: "M1", branchId: "B1", hierarchyId: "Topic", name: "Topic" });
    expect(nodeRefFor(b)).toEqual({ hierarchyId: "Topic", kind: "meristem", name: "Topic", branchId: "B1" });
  });
  test("structural blocks → null", () => {
    expect(nodeRefFor(asBlock({ kind: "branchNode", id: "BN", branchId: "B1" }))).toBeNull();
    expect(nodeRefFor(asBlock({ kind: "spacer", id: "S", branchId: "B1" }))).toBeNull();
  });
  test("lief missing hierarchyId or name → null", () => {
    expect(nodeRefFor(asBlock({ kind: "lief", id: "L", branchId: "B1", name: "x" }))).toBeNull();
    expect(nodeRefFor(asBlock({ kind: "lief", id: "L", branchId: "B1", hierarchyId: "p" }))).toBeNull();
  });
});

describe("nodeRefByHierarchyId", () => {
  const plant = {
    blocks: [
      asBlock({ kind: "meristem", id: "M1", branchId: "B0", hierarchyId: "Topic", name: "Topic" }),
      asBlock({ kind: "lief", id: "L1", branchId: "B0", hierarchyId: "Topic/a.md", name: "a" }),
    ],
  } as unknown as Plant;

  test("finds a block by its hierarchyId → NodeRef (for re-selecting a just-grown lief)", () => {
    expect(nodeRefByHierarchyId(plant, "Topic/a.md")).toEqual({
      hierarchyId: "Topic/a.md",
      kind: "lief",
      name: "a",
      branchId: "B0",
    });
  });
  test("returns null when no block matches", () => {
    expect(nodeRefByHierarchyId(plant, "Topic/missing.md")).toBeNull();
  });
});
