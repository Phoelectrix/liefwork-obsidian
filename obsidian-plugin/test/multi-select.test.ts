import { test, expect } from "bun:test";
import {
  toggleSelection,
  surviveRefresh,
  isInSelection,
  isAncestorPath,
  bulkDeleteTitle,
  type SelectionItem,
} from "../src/multi-select.ts";

const lief = (id: string): SelectionItem => ({ hierarchyId: id, kind: "lief" });
const branch = (id: string): SelectionItem => ({ hierarchyId: id, kind: "meristem" });
const ids = (sel: readonly SelectionItem[]): string[] => sel.map((s) => s.hierarchyId);

test("toggleSelection: empty + click → set of one (either kind)", () => {
  expect(ids(toggleSelection([], lief("A/n.md")))).toEqual(["A/n.md"]);
  expect(ids(toggleSelection([], branch("A")))).toEqual(["A"]);
});

test("toggleSelection: matching kind adds; re-click removes (both kinds)", () => {
  const two = toggleSelection([lief("A/n.md")], lief("A/m.md"));
  expect(ids(two)).toEqual(["A/n.md", "A/m.md"]);
  expect(ids(toggleSelection(two, lief("A/n.md")))).toEqual(["A/m.md"]);
  const bTwo = toggleSelection([branch("A")], branch("B"));
  expect(ids(bTwo)).toEqual(["A", "B"]);
  expect(ids(toggleSelection(bTwo, branch("A")))).toEqual(["B"]);
});

test("toggleSelection: the other kind CANCELS the prior set (homogeneous rule)", () => {
  expect(ids(toggleSelection([lief("A/n.md"), lief("A/m.md")], branch("B")))).toEqual(["B"]);
  expect(ids(toggleSelection([branch("A"), branch("B")], lief("C/x.md")))).toEqual(["C/x.md"]);
});

test("toggleSelection: a descendant of a selected branch is a NO-OP (already covered)", () => {
  const current = [branch("A"), branch("C")];
  expect(toggleSelection(current, branch("A/sub"))).toBe(current);
  expect(toggleSelection(current, branch("A/sub/deeper"))).toBe(current);
});

test("toggleSelection: an ancestor ABSORBS the members it covers", () => {
  const next = toggleSelection([branch("A/x"), branch("A/y"), branch("C")], branch("A"));
  expect(ids(next)).toEqual(["C", "A"]);
});

test("toggleSelection: the root branch '/' absorbs everything", () => {
  expect(ids(toggleSelection([branch("A"), branch("B/c")], branch("/")))).toEqual(["/"]);
});

test("toggleSelection: toggle-off wins over the descendant rule (a member removes itself)", () => {
  // "A/sub" is a descendant of nothing selected here — but IS a member: remove it.
  expect(ids(toggleSelection([branch("A/sub"), branch("B")], branch("A/sub")))).toEqual(["B"]);
});

test("isAncestorPath: strict prefix by path segment; '/' is everyone's ancestor; never self", () => {
  expect(isAncestorPath("A", "A/sub")).toBe(true);
  expect(isAncestorPath("A", "AB/sub")).toBe(false); // segment boundary, not string prefix
  expect(isAncestorPath("/", "A")).toBe(true);
  expect(isAncestorPath("A", "A")).toBe(false);
});

test("surviveRefresh: keeps only members whose path still resolves", () => {
  const sel = [lief("A/n.md"), lief("A/gone.md")];
  expect(ids(surviveRefresh(sel, new Set(["A/n.md", "A/other.md"])))).toEqual(["A/n.md"]);
});

test("isInSelection: membership by hierarchyId", () => {
  expect(isInSelection([lief("A/n.md")], "A/n.md")).toBe(true);
  expect(isInSelection([lief("A/n.md")], "A/m.md")).toBe(false);
});

test("bulkDeleteTitle: notes vs branches", () => {
  expect(bulkDeleteTitle("lief", 3)).toBe("Delete 3 notes");
  expect(bulkDeleteTitle("meristem", 2)).toBe("Delete 2 branches");
});
