import { expect, test } from "bun:test";
import { furlableNodeIds, hierarchyForFurlState, seedFurledNodeIds } from "../src/hierarchy-furl.ts";
import { injectAffordanceLiefs } from "../../scripts/lib/inject-affordance-liefs.ts";
import { UNFURL_EXPAND_STENCIL, UNFURL_FURL_STENCIL } from "../src/unfurl-affordance.ts";

const full = injectAffordanceLiefs({ root: { id: "root", name: "R", children: [
  { id: "A", name: "A", children: [ { id: "A1", name: "A1" }, { id: "A2", name: "A2" } ] },
] } }, { expandLabel: "click to expand", furlLabel: "− furl" });

test("furled node collapses to meristem + expand affordance", () => {
  const out = hierarchyForFurlState(full, new Set(["root"]));
  const kids = out.root.children!;
  // only the expand affordance survives on a furled node
  expect(kids.every((c) => (c.children?.length ?? 0) === 0)).toBe(true);
  expect(kids.some((c) => c.stencilId === UNFURL_EXPAND_STENCIL)).toBe(true);
  expect(kids.some((c) => c.stencilId === UNFURL_FURL_STENCIL)).toBe(false);
  expect(kids.some((c) => c.id === "A")).toBe(false);
});

test("unfurled node keeps real children and the furl affordance, but drops the expand affordance", () => {
  const out = hierarchyForFurlState(full, new Set());
  const kids = out.root.children!;
  expect(kids.some((c) => c.id === "A")).toBe(true);
  expect(kids.some((c) => c.stencilId === UNFURL_FURL_STENCIL)).toBe(true);
  expect(kids.some((c) => c.stencilId === UNFURL_EXPAND_STENCIL)).toBe(false);
});

// Depth-graded fixture: root(0) -> B(1) -> C(2) -> F(3) -> G(4). Every node
// with ANY children is furlable (lief-only branches collapse too), so
// furlable node ids are exactly { root, B, C, F } at depths { 0, 1, 2, 3 }
// respectively — only the innermost leaf G (no children at all) is not.
const deep = injectAffordanceLiefs({ root: { id: "root", name: "R", children: [
  { id: "B", name: "B", children: [
    { id: "C", name: "C", children: [
      { id: "D", name: "D" },
      { id: "F", name: "F", children: [ { id: "G", name: "G" } ] },
    ] },
  ] },
] } }, { expandLabel: "click to expand", furlLabel: "− furl" });

test("seedFurledNodeIds returns furlable ids at or below initialDepth", () => {
  expect(seedFurledNodeIds(deep, 0)).toEqual(new Set(["root", "B", "C", "F"]));
  expect(seedFurledNodeIds(deep, 1)).toEqual(new Set(["B", "C", "F"]));
  expect(seedFurledNodeIds(deep, 2)).toEqual(new Set(["C", "F"]));
  expect(seedFurledNodeIds(deep, 3)).toEqual(new Set(["F"]));
  expect(seedFurledNodeIds(deep, 4)).toEqual(new Set());
});

test("furlableNodeIds returns exactly the furlable node ids for the deep fixture", () => {
  expect(furlableNodeIds(deep)).toEqual(new Set(["root", "B", "C", "F"]));
});

test("nested recursion: furling a non-root deep node (C) collapses only that node, and its un-furled ancestors (root, B) still carry their real children beyond one hop", () => {
  const out = hierarchyForFurlState(deep, new Set(["C"]));

  // root is un-furled: still carries its real child B (not reduced to an
  // affordance-only stub) — recursion continues past the root.
  const bNode = out.root.children!.find((c) => c.id === "B");
  expect(bNode).toBeDefined();

  // B is also un-furled (two hops from the furled node C): still carries its
  // real child C — confirms recursion reaches beyond a single hop.
  const cNode = bNode!.children!.find((c) => c.id === "C");
  expect(cNode).toBeDefined();

  // C is furled: collapses to only its expand affordance, dropping its real
  // children (D, F) and the furl affordance.
  expect(cNode!.children!.length).toBe(1);
  expect(cNode!.children![0]!.stencilId).toBe(UNFURL_EXPAND_STENCIL);
  expect(cNode!.children!.some((c) => c.id === "D")).toBe(false);
  expect(cNode!.children!.some((c) => c.id === "F")).toBe(false);
  expect(cNode!.children!.some((c) => c.stencilId === UNFURL_FURL_STENCIL)).toBe(false);
});
