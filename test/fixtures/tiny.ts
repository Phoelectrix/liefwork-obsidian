import type { HierarchyInput } from "../../src/types.ts";

/**
 * 3-node tree: root → [A, B]. A has one child (A1). B is terminal.
 * Use for exercising the smallest non-trivial case: one BranchNode, one
 * lief sibling to it, one lief on the child branch.
 */
export const tiny: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    createdAt: "2026-04-20T10:00:00Z",
    children: [
      {
        id: "A",
        name: "A",
        createdAt: "2026-04-20T10:00:01Z",
        children: [
          { id: "A1", name: "A1", createdAt: "2026-04-20T10:00:02Z" },
        ],
      },
      { id: "B", name: "B", createdAt: "2026-04-20T10:00:03Z" },
    ],
  },
};
