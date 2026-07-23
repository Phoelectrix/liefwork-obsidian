import { test, expect } from "bun:test";
import { surviveRefresh, resolveBulkTargets, bulkDeleteTitle, type SelectionItem } from "../src/multi-select.ts";

// ── Thin wiring tests for the plant-view seams around multi-select.ts's pure
//    rules. No Obsidian stub: the two things plant-view actually threads
//    through (surviveRefresh at rebuild time, the bulk-menu's target
//    resolution + title at menu-build time) are pure enough to exercise
//    directly against fixtures shaped like plant-view's real call sites. ──

/** A NodeRef-shaped fixture (mount-plant.ts's real selection-item shape:
 *  hierarchyId + kind + the extra name/branchId fields plant-view actually
 *  carries in `this.multiSelection: NodeRef[]`) — proving surviveRefresh
 *  works against the RICHER shape plant-view calls it with, not just the
 *  minimal SelectionItem the pure-rule tests in multi-select.test.ts use. */
interface FakeNodeRef extends SelectionItem {
  name: string;
  branchId: string;
}
const nodeRef = (hierarchyId: string, kind: "lief" | "meristem"): FakeNodeRef => ({
  hierarchyId,
  kind,
  name: hierarchyId.split("/").pop()!,
  branchId: `b-${hierarchyId}`,
});

test("surviveRefresh: NodeRef fixture — survivors keep input order, dead ids drop", () => {
  const before = [nodeRef("A/one.md", "lief"), nodeRef("A/gone.md", "lief"), nodeRef("A/two.md", "lief")];
  const livePaths = new Set(["A/two.md", "A/one.md"]); // set order must NOT dictate result order
  const after = surviveRefresh(before, livePaths);
  // Input order preserved (one, two) — NOT the Set's insertion order (two, one) —
  // and the dead "A/gone.md" member is dropped, exactly the re-application
  // plant-view's refresh() does after rebuilding `livePaths` from the fresh plant.
  expect(after.map((n) => n.hierarchyId)).toEqual(["A/one.md", "A/two.md"]);
  expect(after.every((n) => "branchId" in n && "name" in n)).toBe(true);
});

test("surviveRefresh: NodeRef fixture — every member dead → empty (no stale selection lingers)", () => {
  const before = [nodeRef("A/gone.md", "lief"), nodeRef("A/also-gone.md", "lief")];
  expect(surviveRefresh(before, new Set(["B/still-here.md"]))).toEqual([]);
});

// ── Bulk-menu decision logic: mirrors showMultiNodeMenu's own build (plant-view.ts
//    resolves each selected member via resolveNodeFile, drops what doesn't resolve,
//    and titles the menu off the SAME resolved list — see multi-select.ts's
//    resolveBulkTargets doc comment). ──

test("resolveBulkTargets: a resolver returning null for one member → action list is resolved targets only", () => {
  const selection = [nodeRef("A/n.md", "lief"), nodeRef("A/vanished.md", "lief"), nodeRef("A/m.md", "lief")];
  // Stub resolver: "vanished" member no longer resolves to a file (deleted/moved
  // out from under an open menu) — every other member resolves to a fake handle.
  const resolve = (n: FakeNodeRef): { path: string } | null =>
    n.hierarchyId === "A/vanished.md" ? null : { path: n.hierarchyId };
  const targets = resolveBulkTargets(selection, resolve);
  expect(targets).toEqual([{ path: "A/n.md" }, { path: "A/m.md" }]);

  // The menu title is built from that SAME resolved list — showMultiNodeMenu
  // never titles off the raw pre-resolution selection, so a member that
  // silently failed to resolve doesn't inflate the count shown to the user.
  expect(bulkDeleteTitle(selection[0]!.kind, targets.length)).toBe("Delete 2 notes");
});

test("resolveBulkTargets: a homogeneous branch selection that fully resolves → title reflects the whole selection", () => {
  const selection = [nodeRef("A", "meristem"), nodeRef("B", "meristem")];
  const resolve = (n: FakeNodeRef): { path: string } => ({ path: n.hierarchyId });
  const targets = resolveBulkTargets(selection, resolve);
  expect(targets.length).toBe(selection.length);
  expect(bulkDeleteTitle(selection[0]!.kind, targets.length)).toBe("Delete 2 branches");
});

test("resolveBulkTargets: order-preserving, and an empty result signals 'nothing left to act on'", () => {
  const selection = [nodeRef("A/n.md", "lief"), nodeRef("A/m.md", "lief")];
  expect(resolveBulkTargets(selection, () => null)).toEqual([]);
});
