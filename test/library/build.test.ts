import { describe, expect, test } from "bun:test";
import { build, defaultEngineConfig, LIBRARY_ENGINE_VERSION } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tiny: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
      { id: "b", name: "b" },
    ],
  },
};

describe("build (Library)", () => {
  test("tiny fixture builds without error", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    expect(plant).toBeDefined();
    expect(plant.id).toMatch(/^plant_/);
  });

  test("Plant has no rings field", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    expect((plant as unknown as Record<string, unknown>).rings).toBeUndefined();
  });

  test("Plant.metadata.engineVersion = LIBRARY_ENGINE_VERSION", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    expect(plant.metadata.engineVersion).toBe(LIBRARY_ENGINE_VERSION);
  });

  test("Plant.events derived from leaves", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    expect(plant.events.length).toBe(2);
  });

  test("Plant.bounds finite + non-degenerate", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    expect(Number.isFinite(plant.bounds.min.x)).toBe(true);
    expect(Number.isFinite(plant.bounds.max.x)).toBe(true);
    expect(plant.bounds.max.x).toBeGreaterThan(plant.bounds.min.x);
    expect(plant.bounds.max.y).toBeGreaterThan(plant.bounds.min.y);
  });

  test("Plant.blocks contains GrowthBlocks (5 subtypes present)", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    const subtypes = new Set(
      plant.blocks
        .filter((b) => b.kind === "growthBlock")
        .map((b) => (b as { subtype: string }).subtype),
    );
    expect(subtypes.has("fwd-tangent")).toBe(true);
    expect(subtypes.has("bwd-tangent")).toBe(true);
    expect(subtypes.has("child-axis")).toBe(true);
    expect(subtypes.has("meristem-in")).toBe(true);
    expect(subtypes.has("meristem-out")).toBe(true);
  });

  test("determinism: same input + config yields same id and same block count", () => {
    const p1 = build(tiny, undefined, defaultEngineConfig);
    const p2 = build(tiny, undefined, defaultEngineConfig);
    expect(p1.id).toBe(p2.id);
    expect(p1.blocks.length).toBe(p2.blocks.length);
    expect(p1.branches.length).toBe(p2.branches.length);
  });

  test("validation error throws", () => {
    const bad: HierarchyInput = {
      root: { id: "x", name: "y", children: [{ id: "x", name: "duplicate" }] },
    };
    expect(() => build(bad, undefined, defaultEngineConfig)).toThrow(/validation failed/i);
  });
});

describe("build (Library) — isBranch / empty branches", () => {
  const withEmptyBranches: HierarchyInput = {
    root: {
      id: "root", name: "root",
      children: [
        { id: "empty", name: "empty", isBranch: true },              // empty branch at root level
        {
          id: "parent", name: "parent",
          children: [{ id: "nested-empty", name: "nested-empty", isBranch: true }], // nested empty branch
        },
        { id: "leaf", name: "leaf" },                                // ordinary lief (no flag, no children)
      ],
    },
  };

  test("an isBranch node with no children becomes a branch (meristem present), not a lief", () => {
    const plant = build(withEmptyBranches, undefined, defaultEngineConfig);
    const meristems = plant.blocks.filter((b) => b.kind === "meristem") as Array<{ hierarchyId: string }>;
    const liefs = plant.blocks.filter((b) => b.kind === "lief") as Array<{ hierarchyId: string }>;
    // "empty" and "nested-empty" render as branches → their identity is on a meristem, never a lief.
    expect(meristems.map((m) => m.hierarchyId)).toContain("empty");
    expect(meristems.map((m) => m.hierarchyId)).toContain("nested-empty");
    expect(liefs.map((l) => l.hierarchyId)).not.toContain("empty");
  });

  test("a node WITHOUT the flag and without children stays a lief (producer back-compat)", () => {
    const plant = build(withEmptyBranches, undefined, defaultEngineConfig);
    const liefs = plant.blocks.filter((b) => b.kind === "lief") as Array<{ hierarchyId: string }>;
    const meristems = plant.blocks.filter((b) => b.kind === "meristem") as Array<{ hierarchyId: string }>;
    expect(liefs.map((l) => l.hierarchyId)).toContain("leaf");
    expect(meristems.map((m) => m.hierarchyId)).not.toContain("leaf");
  });

  test("empty-branch geometry is finite and non-degenerate (no NaN)", () => {
    const plant = build(withEmptyBranches, undefined, defaultEngineConfig);
    expect(Number.isFinite(plant.bounds.min.x)).toBe(true);
    expect(Number.isFinite(plant.bounds.max.y)).toBe(true);
    expect(plant.bounds.max.x).toBeGreaterThan(plant.bounds.min.x);
    expect(plant.bounds.max.y).toBeGreaterThan(plant.bounds.min.y);
    for (const b of plant.blocks) {
      expect(Number.isFinite(b.position.x)).toBe(true);
      expect(Number.isFinite(b.position.y)).toBe(true);
    }
  });
});

describe("build (Library) — nonMd lief flag (colour-by-file-type)", () => {
  const mixed: HierarchyInput = {
    root: {
      id: "root", name: "root",
      children: [
        { id: "note.md", name: "note" },                      // a note (no flag)
        { id: "pic.png", name: "pic.png", nonMd: true },      // a non-md file lief
      ],
    },
  };

  test("a nonMd HierarchyNode lief produces a LiefBlock carrying nonMd:true", () => {
    const plant = build(mixed, undefined, defaultEngineConfig);
    const liefs = plant.blocks.filter((b) => b.kind === "lief") as Array<{ hierarchyId: string; nonMd?: boolean }>;
    const pic = liefs.find((l) => l.hierarchyId === "pic.png")!;
    const note = liefs.find((l) => l.hierarchyId === "note.md")!;
    expect(pic.nonMd).toBe(true);
    expect(note.nonMd).toBeUndefined();
  });
});
