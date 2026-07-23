import type { HierarchyInput, HierarchyNode } from "../../src/types.ts";
import root from "./tutorial.json" with { type: "json" };

export const tutorial: HierarchyInput = { root: root as unknown as HierarchyNode };
