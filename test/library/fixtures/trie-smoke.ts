import type { HierarchyInput, HierarchyNode } from "../../../src/library/types.ts";

/**
 * 5-deep trie: every level has 3 BN children; only the deepest level has Liefs.
 * Models the Istorima Professions trie shape in miniature: many branches, very
 * few liefs, deep depth. Tests that the all-blocks-contribute demand fix
 * gives upper BNs non-trivial reservations even though no events propagate
 * leaf demand to them directly.
 */
function buildBranching(depth: number, prefix: string): HierarchyNode[] {
  if (depth === 0) {
    return [{ id: `${prefix}-leaf`, name: `leaf-${prefix}` }];
  }
  const childrenA: HierarchyNode[] = buildBranching(depth - 1, `${prefix}a`);
  const childrenB: HierarchyNode[] = buildBranching(depth - 1, `${prefix}b`);
  const childrenC: HierarchyNode[] = buildBranching(depth - 1, `${prefix}c`);
  return [
    { id: `${prefix}-a`, name: `${prefix}-a`, children: childrenA },
    { id: `${prefix}-b`, name: `${prefix}-b`, children: childrenB },
    { id: `${prefix}-c`, name: `${prefix}-c`, children: childrenC },
  ];
}

export const trieSmoke: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: buildBranching(4, "L0"),
  },
};
