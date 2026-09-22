import { test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput, HierarchyNode } from "../../src/library/types.ts";
import { injectAffordanceLiefs, isFurlableNode } from "../../scripts/lib/inject-affordance-liefs.ts";
import { UNFURL_EXPAND_STENCIL, UNFURL_FURL_STENCIL } from "../../viewer/src/unfurl-affordance.ts";

const CFG = { expandLabel: "click to expand", furlLabel: "− furl" };

// A lief-only branch (children present, but none of them are themselves
// branches) must now be furlable too — every branch collapses to a stub,
// including one whose only children are liefs. A leaf (no children at all)
// stays non-furlable, and the pre-existing has-a-grandchild case stays true.
test("isFurlableNode: ANY children make a node furlable (lief-only branches too); a leaf (no children) is not", () => {
  const leaf: HierarchyNode = { id: "leaf", name: "leaf", order: 0 };
  const liefOnlyBranch: HierarchyNode = {
    id: "liefOnly", name: "liefOnly", order: 0,
    children: [{ id: "n1", name: "n1", order: 0 }, { id: "n2", name: "n2", order: 1 }],
  };
  const hasGrandchild: HierarchyNode = {
    id: "hasGrandchild", name: "hasGrandchild", order: 0,
    children: [{ id: "child", name: "child", order: 0,
      children: [{ id: "grandchild", name: "grandchild", order: 0 }] }],
  };
  expect(isFurlableNode(leaf)).toBe(false);
  expect(isFurlableNode(liefOnlyBranch)).toBe(true);
  expect(isFurlableNode(hasGrandchild)).toBe(true);
});
// furlable = has ANY children (a sub-branch or a lief).
// root(furlable: has child area) → area(furlable: has child topic)
//   → topic(furlable: has child 'note', a lief) → note(lief, NOT furlable: no children)
// root → leafArea(furlable: has child 'ln', a lief) → ln(lief, NOT furlable: no children)
const h: HierarchyInput = { root: { id: "root", name: "root", order: 0, children: [
  { id: "area", name: "area", order: 1, children: [
    { id: "topic", name: "topic", order: 1, children: [{ id: "note", name: "note", order: 1 }] },
  ] },
  { id: "leafArea", name: "leafArea", order: 2, children: [{ id: "ln", name: "ln", order: 1 }] },
] } };

const affKids = (n: any) => (n.children ?? []).filter((c: any) =>
  c.stencilId === UNFURL_EXPAND_STENCIL || c.stencilId === UNFURL_FURL_STENCIL);

test("isFurlableNode is true for any node with children, including lief-only branches", () => {
  expect(isFurlableNode(h.root)).toBe(true);
  expect(isFurlableNode(h.root.children![0]!)).toBe(true);           // area (child: topic, a branch)
  expect(isFurlableNode(h.root.children![0]!.children![0]!)).toBe(true); // topic (child: note, a lief)
  expect(isFurlableNode(h.root.children![1]!)).toBe(true);           // leafArea (child: ln, a lief)
  // leaves (no children at all) are still NOT furlable.
  expect(isFurlableNode(h.root.children![0]!.children![0]!.children![0]!)).toBe(false); // note
  expect(isFurlableNode(h.root.children![1]!.children![0]!)).toBe(false);               // ln
});
test("injects exactly two affordance liefs on every furlable node (now including lief-only branches), none on leaves", () => {
  const out = injectAffordanceLiefs(h, CFG);
  expect(affKids(out.root).length).toBe(2);
  const area = out.root.children!.find((c) => c.id === "area")!;
  expect(affKids(area).length).toBe(2);
  const topic = area.children!.find((c) => c.id === "topic")!;
  expect(affKids(topic).length).toBe(2); // lief-only branch: now furlable too
  const leafArea = out.root.children!.find((c) => c.id === "leafArea")!;
  expect(affKids(leafArea).length).toBe(2); // lief-only branch: now furlable too
  // Leaves (note, ln) never get affordances — they have no children to collapse.
  const note = topic.children!.find((c: any) => c.id === "note")!;
  expect(affKids(note).length).toBe(0);
  const ln = leafArea.children!.find((c: any) => c.id === "ln")!;
  expect(affKids(ln).length).toBe(0);
});
test("injection is pure — the input hierarchy is not mutated", () => {
  injectAffordanceLiefs(h, CFG);
  expect(affKids(h.root).length).toBe(0);
});
test("the engine bakes injected affordances as PLACED LiefBlocks carrying the marker", () => {
  const out = injectAffordanceLiefs(h, CFG);
  const plant = build(out, undefined, defaultEngineConfig);
  const aff = plant.blocks.filter((b) => b.kind === "lief"
    && ((b as any).stencilId === UNFURL_EXPAND_STENCIL || (b as any).stencilId === UNFURL_FURL_STENCIL));
  expect(aff.length).toBe(8); // 2 per furlable node × {root, area, topic, leafArea}
  expect(aff.every((b) => Number.isFinite((b as any).position.x)
    && Number.isFinite((b as any).position.y))).toBe(true);
  // Expand affordance is a real lief on its owner branch, hit-testable like any lief.
  expect(aff.every((b) => typeof (b as any).branchId === "string")).toBe(true);
});
