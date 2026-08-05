import { describe, expect, test } from "bun:test";
import { sortChildren } from "../../src/library/passes/structure.ts";
import type { HierarchyNode } from "../../src/library/types.ts";

const node = (id: string, createdAt: string, order?: number): HierarchyNode =>
  order === undefined ? { id, name: id, createdAt } : { id, name: id, createdAt, order };

describe("sortChildren — explicit `order` overrides createdAt", () => {
  test("oldest-first: when nodes carry `order`, they sort by it (not createdAt)", () => {
    // createdAt-desc alone would give A, C, B; `order` should win → B, C, A.
    const kids = [
      node("A", "2026-06-03", 10),
      node("B", "2026-06-01", 30),
      node("C", "2026-06-02", 20),
    ];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids).toEqual(["B", "C", "A"]);
  });

  test("oldest-first: a MIXED branch (some lack order) falls back to createdAt entirely", () => {
    // A carries an order but B doesn't → the whole branch sorts by createdAt
    // (order only governs once every sibling has it — a clean total order).
    const kids = [node("A", "2026-06-01", 99), node("B", "2026-06-02")];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids).toEqual(["B", "A"]); // createdAt desc — A's order is ignored
  });

  test("oldest-first: with NO order, falls back to createdAt (behaviour unchanged)", () => {
    const kids = [
      node("A", "2026-06-03"),
      node("B", "2026-06-01"),
      node("C", "2026-06-02"),
    ];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids).toEqual(["A", "C", "B"]); // createdAt descending (newest first in array)
  });
});

describe("sortChildren — duplicate orders never collide (mechanical tiebreak)", () => {
  // The renderer places siblings by sorted index, so two nodes that compare
  // equal would land on the same spot and overlap. Placement must be mechanical:
  // a deterministic, distinct order regardless of what (possibly colliding)
  // `order` values an agent wrote.
  test("oldest-first: equal `order` falls back to createdAt — distinct + deterministic", () => {
    const kids = [
      node("X", "2026-06-01", 10),
      node("Y", "2026-06-03", 10),
      node("Z", "2026-06-02", 10), // all collide at order 10
    ];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids).toEqual(["Y", "Z", "X"]); // createdAt descending — never the same slot
    expect(new Set(ids).size).toBe(3);
  });

  test("oldest-first: equal `order` AND equal createdAt fall back to name", () => {
    const kids = [node("alpha", "2026-06-01", 10), node("beta", "2026-06-01", 10)];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids).toEqual(["beta", "alpha"]); // name = guaranteed-unique final disambiguator
    expect(new Set(ids).size).toBe(2);
  });
});

describe("sortChildren — sortPin: \"base\" pins a child at the branch base", () => {
  const pinned = (id: string, createdAt: string): HierarchyNode => ({
    id, name: id, createdAt, sortPin: "base",
  });

  test("newest-first: the pinned child sorts to index 0 even though its date is mid-branch", () => {
    const kids = [
      node("A", "2026-06-01"),
      pinned("NOTE", "2026-06-02"),
      node("C", "2026-06-03"),
    ];
    const ids = sortChildren(kids, "newest-first", false).map((n) => n.id);
    expect(ids[0]).toBe("NOTE");
    expect(ids).toEqual(["NOTE", "A", "C"]);
  });

  test("oldest-first: the pin is still at the base (index 0), not flipped to the tip", () => {
    const kids = [
      node("A", "2026-06-01"),
      pinned("NOTE", "2026-06-02"),
      node("C", "2026-06-03"),
    ];
    const ids = sortChildren(kids, "oldest-first", false).map((n) => n.id);
    expect(ids[0]).toBe("NOTE");
  });

  test("the pin wins over `order` (which alone would place NOTE by its value)", () => {
    const kids = [
      { id: "A", name: "A", createdAt: "2026-06-01", order: 10 },
      { id: "NOTE", name: "NOTE", createdAt: "2026-06-02", order: 20, sortPin: "base" as const },
      { id: "C", name: "C", createdAt: "2026-06-03", order: 30 },
    ];
    const ids = sortChildren(kids, "newest-first", false).map((n) => n.id);
    expect(ids[0]).toBe("NOTE");
  });

  test("the pin wins over liefsLast (a pinned lief still sits at the base)", () => {
    const kids = [
      { id: "BR", name: "BR", createdAt: "2026-06-03", children: [{ id: "x", name: "x" }] },
      pinned("NOTE", "2026-06-01"),
    ];
    const ids = sortChildren(kids, "newest-first", true).map((n) => n.id);
    expect(ids[0]).toBe("NOTE");
  });
});
