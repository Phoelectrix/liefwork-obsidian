import { test, expect } from "bun:test";
import { resolveAgentTints } from "../src/agent-tint.ts";

// Minimal Plant-shaped stub: only the fields resolveAgentTints reads.
const plant = {
  blocks: [
    { id: "m1", kind: "meristem", hierarchyId: "Projects/Alpha", branchId: "br1" },
    { id: "l1", kind: "lief", hierarchyId: "Projects/Alpha/note.md", branchId: "br1" },
    { id: "m2", kind: "meristem", hierarchyId: "Projects/Beta", branchId: "br2" },
  ],
} as unknown as import("../../src/types.ts").Plant;

test("maps a branch path to its meristem block id and branch id (single color)", () => {
  const { meristemColorsByBlockId, stemColorsByBranchId } = resolveAgentTints(
    plant,
    new Map([["Projects/Alpha", ["#5ECFBE"]]]),
  );
  expect(meristemColorsByBlockId.get("m1")).toEqual(["#5ECFBE"]);
  expect(stemColorsByBranchId.get("br1")).toEqual(["#5ECFBE"]);
  // does not tint lief labels or other branches
  expect(meristemColorsByBlockId.has("l1")).toBe(false);
  expect(stemColorsByBranchId.has("br2")).toBe(false);
});

test("carries the full color list when a branch has several agents", () => {
  const { meristemColorsByBlockId, stemColorsByBranchId } = resolveAgentTints(
    plant,
    new Map([["Projects/Alpha", ["#5ECFBE", "#C44848"]]]),
  );
  expect(meristemColorsByBlockId.get("m1")).toEqual(["#5ECFBE", "#C44848"]);
  expect(stemColorsByBranchId.get("br1")).toEqual(["#5ECFBE", "#C44848"]);
});

test("skips unknown and empty branch paths", () => {
  expect(resolveAgentTints(plant, new Map([["Nope", ["#fff"]]])).meristemColorsByBlockId.size).toBe(0);
  expect(resolveAgentTints(plant, new Map([["Projects/Alpha", []]])).meristemColorsByBlockId.size).toBe(0);
});

test("tints the root meristem when its path ('') is bound", () => {
  const rootPlant = {
    blocks: [
      { id: "root1", kind: "meristem", hierarchyId: "", branchId: "br0" },
    ],
  } as unknown as import("../../src/types.ts").Plant;
  const { meristemColorsByBlockId, stemColorsByBranchId } = resolveAgentTints(
    rootPlant,
    new Map([["", ["#5ECFBE"]]]),
  );
  expect(meristemColorsByBlockId.get("root1")).toEqual(["#5ECFBE"]);
  expect(stemColorsByBranchId.get("br0")).toEqual(["#5ECFBE"]);
});
