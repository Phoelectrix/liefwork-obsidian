import { describe, test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { projectedSubtreeBounds } from "../src/skeleton-canvas.ts";
import { buildProjectionConfigMap } from "../src/mount-plant.ts";
import { defaultStylingConfig } from "../src/styling.ts";

// root -> a -> a1 -> a1x (a becomes its own branch with a child branch a1)
const nested: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }, { id: "a1y", name: "a1y" }] }] },
      { id: "b", name: "b" },
    ],
  },
};

function nodeAABB(plant: any, blockIds: Set<string>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of plant.blocks) {
    if (!blockIds.has(b.id)) continue;
    minX = Math.min(minX, b.position.x); minY = Math.min(minY, b.position.y);
    maxX = Math.max(maxX, b.position.x); maxY = Math.max(maxY, b.position.y);
  }
  return { minX, minY, maxX, maxY };
}

describe("projectedSubtreeBounds — label-inclusive framing bounds", () => {
  test("includes label-ray endpoints, so it is strictly larger than the node AABB", () => {
    const plant = build(nested, undefined, defaultEngineConfig) as any;
    const proj = buildProjectionConfigMap(plant, defaultStylingConfig);
    const ids = new Set<string>(
      plant.blocks.filter((b: any) => b.kind === "lief" || b.kind === "meristem").map((b: any) => b.id),
    );

    const bounds = projectedSubtreeBounds(plant, defaultStylingConfig, proj, ids)!;
    expect(bounds).not.toBeNull();

    const node = nodeAABB(plant, ids);
    // The rays push labels outward, so the projected bounds must enclose the raw
    // node AABB and extend past it on at least one side.
    expect(bounds.min.x).toBeLessThanOrEqual(node.minX);
    expect(bounds.min.y).toBeLessThanOrEqual(node.minY);
    expect(bounds.max.x).toBeGreaterThanOrEqual(node.maxX);
    expect(bounds.max.y).toBeGreaterThanOrEqual(node.maxY);
    const projArea = (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y);
    const nodeArea = (node.maxX - node.minX) * (node.maxY - node.minY);
    expect(projArea).toBeGreaterThan(nodeArea);
  });

  test("returns null for an empty id set", () => {
    const plant = build(nested, undefined, defaultEngineConfig) as any;
    const proj = buildProjectionConfigMap(plant, defaultStylingConfig);
    expect(projectedSubtreeBounds(plant, defaultStylingConfig, proj, new Set())).toBeNull();
  });

  test("scoping to one branch's subtree excludes other branches' labels", () => {
    const plant = build(nested, undefined, defaultEngineConfig) as any;
    const proj = buildProjectionConfigMap(plant, defaultStylingConfig);
    const all = new Set<string>(
      plant.blocks.filter((b: any) => b.kind === "lief" || b.kind === "meristem").map((b: any) => b.id),
    );
    // Subtree of branch "a": the meristem named "a" and its descendants.
    const aMeristem = plant.blocks.find((b: any) => b.kind === "meristem" && b.name === "a");
    const aBranchIds = new Set<string>([aMeristem.branchId]);
    let grew = true;
    while (grew) { grew = false;
      for (const br of plant.branches) {
        if (!aBranchIds.has(br.id) && br.parentBranchId !== null && aBranchIds.has(br.parentBranchId)) { aBranchIds.add(br.id); grew = true; }
      }
    }
    const aIds = new Set<string>(plant.blocks.filter((b: any) => (b.kind === "lief" || b.kind === "meristem") && aBranchIds.has(b.branchId)).map((b: any) => b.id));

    const subBounds = projectedSubtreeBounds(plant, defaultStylingConfig, proj, aIds)!;
    const allBounds = projectedSubtreeBounds(plant, defaultStylingConfig, proj, all)!;
    const subArea = (subBounds.max.x - subBounds.min.x) * (subBounds.max.y - subBounds.min.y);
    const allArea = (allBounds.max.x - allBounds.min.x) * (allBounds.max.y - allBounds.min.y);
    // A proper subtree is smaller than the whole plant's label bounds.
    expect(aIds.size).toBeGreaterThan(0);
    expect(aIds.size).toBeLessThan(all.size);
    expect(subArea).toBeLessThan(allArea);
  });
});
