import { test, expect } from "bun:test";
import { resolveSeedBadges } from "../src/seed-badge.ts";

// Minimal Plant-shaped stub: only the fields resolveSeedBadges reads.
const plant = {
  blocks: [
    { id: "m1", kind: "meristem", hierarchyId: "Projects/Alpha", branchId: "br1" },
    { id: "l1", kind: "lief", hierarchyId: "Projects/Alpha/note.md", branchId: "br1" },
    { id: "m2", kind: "meristem", hierarchyId: "Projects/Beta", branchId: "br2" },
  ],
} as unknown as import("../../src/types.ts").Plant;

test("maps a badged branch path to its meristem block id", () => {
  const blockIds = resolveSeedBadges(plant, new Set(["Projects/Alpha"]));
  expect(blockIds.has("m1")).toBe(true);
  expect(blockIds.has("m2")).toBe(false);
  // never badges a lief, even one under the badged path
  expect(blockIds.has("l1")).toBe(false);
});

test("carries every badged branch when several are seeded roots", () => {
  const blockIds = resolveSeedBadges(plant, new Set(["Projects/Alpha", "Projects/Beta"]));
  expect(blockIds).toEqual(new Set(["m1", "m2"]));
});

test("skips unknown paths and an empty set", () => {
  expect(resolveSeedBadges(plant, new Set(["Nope"])).size).toBe(0);
  expect(resolveSeedBadges(plant, new Set()).size).toBe(0);
});

test("badges the root meristem when its path ('') is in the set", () => {
  const rootPlant = {
    blocks: [{ id: "root1", kind: "meristem", hierarchyId: "", branchId: "br0" }],
  } as unknown as import("../../src/types.ts").Plant;
  const blockIds = resolveSeedBadges(rootPlant, new Set([""]));
  expect(blockIds.has("root1")).toBe(true);
});
