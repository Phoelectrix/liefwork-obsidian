import { test, expect } from "bun:test";
import { BindingStore } from "../src/binding-store.ts";

test("create auto-assigns rotation colors and lists bindings", () => {
  const s = new BindingStore();
  const a = s.create({ branchPath: "A", launchedVia: "integrated" });
  const b = s.create({ branchPath: "B", launchedVia: "integrated" });
  expect(a.color).toBe("#5ECFBE");
  expect(b.color).toBe("#C44848");
  expect(s.all().map((x) => x.branchPath)).toEqual(["A", "B"]);
});

test("create honors an explicit (user-picked) color", () => {
  const s = new BindingStore();
  const a = s.create({ branchPath: "A", color: "#abcdef", launchedVia: "integrated" });
  expect(a.color).toBe("#abcdef");
  // next auto pick still starts at teal (user color ignored by rotation)
  expect(s.create({ branchPath: "B", launchedVia: "integrated" }).color).toBe("#5ECFBE");
});

test("colorForBranch / colorByBranchPath reflect live bindings", () => {
  const s = new BindingStore();
  s.create({ branchPath: "A", launchedVia: "integrated" });
  expect(s.colorForBranch("A")).toBe("#5ECFBE");
  expect(s.colorForBranch("Z")).toBeNull();
  expect(s.colorByBranchPath().get("A")).toBe("#5ECFBE");
});

test("endById and endByLeaf remove bindings and free the color", () => {
  const s = new BindingStore();
  const leaf = { tag: "leaf-1" };
  const a = s.create({ branchPath: "A", leaf, launchedVia: "integrated" });
  s.create({ branchPath: "B", launchedVia: "integrated" });
  s.endByLeaf(leaf);
  expect(s.all().map((x) => x.branchPath)).toEqual(["B"]);
  // A's teal is now free → next auto pick is teal again
  expect(s.create({ branchPath: "C", launchedVia: "integrated" }).color).toBe("#5ECFBE");
  s.endById(a.id); // no-op (already gone) must not throw
});

test("subscribe fires on create and end; unsubscribe stops it", () => {
  const s = new BindingStore();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.create({ branchPath: "A", launchedVia: "integrated" });
  expect(n).toBe(1);
  off();
  s.create({ branchPath: "B", launchedVia: "integrated" });
  expect(n).toBe(1);
});

test("colorsByBranchPath keeps every color per branch, in bind order", () => {
  const s = new BindingStore();
  s.create({ branchPath: "A", launchedVia: "integrated" }); // teal
  s.create({ branchPath: "A", launchedVia: "integrated" }); // coral — same branch
  s.create({ branchPath: "B", launchedVia: "integrated" }); // holo-bloom
  const m = s.colorsByBranchPath();
  expect(m.get("A")).toEqual(["#5ECFBE", "#C44848"]);
  expect(m.get("B")).toEqual(["#FF3399"]);
});

test("bindingsForBranch returns all bindings on a branch in order", () => {
  const s = new BindingStore();
  const a1 = s.create({ branchPath: "A", leaf: { t: 1 }, launchedVia: "integrated" });
  const a2 = s.create({ branchPath: "A", leaf: { t: 2 }, launchedVia: "integrated" });
  s.create({ branchPath: "B", launchedVia: "integrated" });
  expect(s.bindingsForBranch("A").map((b) => b.id)).toEqual([a1.id, a2.id]);
  expect(s.bindingsForBranch("Z")).toEqual([]);
});
