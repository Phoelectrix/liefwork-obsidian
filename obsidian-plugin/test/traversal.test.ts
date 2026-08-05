import { test, expect, describe } from "bun:test";
import { traversalOrder, stepTraversal } from "../src/traversal.ts";
import type { HierarchyNode } from "../../src/types.ts";

// createdAt strings — chronological is what orders siblings (oldest → newest)
const T = (n: number) => `2026-06-0${n}T00:00:00.000Z`;

test("traversalOrder: a lone lief is just itself", () => {
  expect(traversalOrder({ id: "a.md", name: "a" })).toEqual(["a.md"]);
});

test("traversalOrder: branch → meristem first, then liefs oldest→newest", () => {
  const root: HierarchyNode = {
    id: "Topic",
    name: "Topic",
    createdAt: T(1),
    children: [
      { id: "Topic/new.md", name: "new", createdAt: T(5) },
      { id: "Topic/old.md", name: "old", createdAt: T(2) },
    ],
  };
  expect(traversalOrder(root)).toEqual(["Topic", "Topic/old.md", "Topic/new.md"]);
});

test("traversalOrder: a child branch encountered mid-walk is recursed (meristem then its liefs) before the parent continues", () => {
  const root: HierarchyNode = {
    id: "P",
    name: "P",
    createdAt: T(1),
    children: [
      { id: "P/a.md", name: "a", createdAt: T(2) }, // oldest lief
      {
        id: "P/Sub",
        name: "Sub",
        createdAt: T(4), // a child branch, encountered between a and b
        children: [
          { id: "P/Sub/s2.md", name: "s2", createdAt: T(7) },
          { id: "P/Sub/s1.md", name: "s1", createdAt: T(5) },
        ],
      },
      { id: "P/b.md", name: "b", createdAt: T(9) }, // newest lief
    ],
  };
  expect(traversalOrder(root)).toEqual([
    "P",
    "P/a.md",
    "P/Sub",
    "P/Sub/s1.md",
    "P/Sub/s2.md",
    "P/b.md",
  ]);
});

test("traversalOrder: undated nodes sort oldest (toward the base)", () => {
  const root: HierarchyNode = {
    id: "R",
    name: "R",
    children: [
      { id: "R/dated.md", name: "dated", createdAt: T(3) },
      { id: "R/undated.md", name: "undated" },
    ],
  };
  expect(traversalOrder(root)).toEqual(["R", "R/undated.md", "R/dated.md"]);
});

// ── parity with the engine's structure pass (src/library/passes/structure.ts) ──
// The walk must sort siblings by the SAME rule the coral renders with: by `order`
// ascending iff every child carries a finite order, else by createdAt, ties by name.

test("traversalOrder: all children ordered → by `order` even when it contradicts createdAt (case a)", () => {
  const root: HierarchyNode = {
    id: "A",
    name: "A",
    createdAt: T(1),
    children: [
      { id: "A/x.md", name: "x", createdAt: T(1), order: 20 }, // oldest, but higher order
      { id: "A/y.md", name: "y", createdAt: T(5), order: 10 }, // newest, but lower order
    ],
  };
  // order wins: 10 before 20, i.e. y before x, contradicting createdAt.
  expect(traversalOrder(root)).toEqual(["A", "A/y.md", "A/x.md"]);
});

test("traversalOrder: one child unordered → whole branch falls back to createdAt (case b)", () => {
  const root: HierarchyNode = {
    id: "B",
    name: "B",
    createdAt: T(1),
    children: [
      { id: "B/x.md", name: "x", createdAt: T(5), order: 10 }, // has order, but newer
      { id: "B/y.md", name: "y", createdAt: T(2) },            // no order
    ],
  };
  // not every child has order → sort by createdAt: y (T2) before x (T5).
  expect(traversalOrder(root)).toEqual(["B", "B/y.md", "B/x.md"]);
});

test("traversalOrder: missing createdAt sorts first, ties broken by name (case c)", () => {
  const root: HierarchyNode = {
    id: "C",
    name: "C",
    createdAt: T(1),
    children: [
      { id: "C/dated.md", name: "dated", createdAt: T(3) },
      { id: "C/b.md", name: "b" }, // no createdAt → "" sorts first
      { id: "C/a.md", name: "a" }, // no createdAt → "" sorts first; tie broken by name
    ],
  };
  // "" < T(3); undated tie a before b by name; then the dated node.
  expect(traversalOrder(root)).toEqual(["C", "C/a.md", "C/b.md", "C/dated.md"]);
});

describe("stepTraversal", () => {
  const ids = ["a", "b", "c", "d"];

  test("forward yields the following ids, nearest first", () => {
    expect(stepTraversal(ids, "b", 1)).toEqual(["c", "d"]);
  });

  test("backward yields the preceding ids, nearest first", () => {
    expect(stepTraversal(ids, "c", -1)).toEqual(["b", "a"]);
  });

  test("clamps at the ends — no wrap-around", () => {
    expect(stepTraversal(ids, "d", 1)).toEqual([]);
    expect(stepTraversal(ids, "a", -1)).toEqual([]);
  });

  test("no selection: forward starts at the first id, backward at the last", () => {
    expect(stepTraversal(ids, null, 1)).toEqual(["a", "b", "c", "d"]);
    expect(stepTraversal(ids, null, -1)).toEqual(["d", "c", "b", "a"]);
  });

  test("an unknown current id behaves like no selection", () => {
    expect(stepTraversal(ids, "zzz", 1)).toEqual(["a", "b", "c", "d"]);
  });

  test("an empty walk yields nothing", () => {
    expect(stepTraversal([], null, 1)).toEqual([]);
  });
});
