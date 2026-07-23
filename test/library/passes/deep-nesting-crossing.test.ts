import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { growthBlockPass } from "../../../src/library/passes/growth-block.ts";
import { placePass } from "../../../src/library/passes/place.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { Branch, EngineConfig, HierarchyInput, HierarchyNode, Vec2 } from "../../../src/library/types.ts";

// A pure binary tree of the given depth: every internal node has two
// sub-branches, no leaf-liefs. The smallest shape that reproduces the
// deep-nesting "descendant curls back across an ancestor's chain" crossing
// (Session Log line 91 / the sum-mode-rings residual). Default config.
function binaryTree(depth: number): HierarchyInput {
  let counter = 0;
  function node(d: number): HierarchyNode {
    const id = `n${counter++}`;
    const children: HierarchyNode[] = [];
    if (d < depth) { children.push(node(d + 1)); children.push(node(d + 1)); }
    return { id, name: id, children };
  }
  return { root: { id: "root", name: "root", children: [node(1)] } };
}

function runFullPipeline(input: HierarchyInput, cfg: EngineConfig = defaultEngineConfig) {
  const s = structurePass(input, cfg);
  anglePass(s, cfg);
  const sized = sizePass(s, cfg);
  const g = growthBlockPass(sized, cfg, input);
  return placePass(g, cfg);
}

// Segment-intersection (proper crossing, not just touching endpoints).
function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

interface Crossing { a: string; b: string; depthA: number; depthB: number; }

// Every crossing between two branches' chain polylines, excluding legitimate
// parent↔child adjacency (a child necessarily meets its parent at the branch
// node). Each polyline includes the lead-in from its parent attachment point.
function findCrossings(plant: ReturnType<typeof placePass>): Crossing[] {
  const blockById = new Map(plant.blocks.map((b) => [b.id, b]));
  const branchById = new Map(plant.branches.map((b) => [b.id, b]));
  const polyline = (br: Branch): Vec2[] => {
    const pts: Vec2[] = [];
    const origin = br.parentBranchNodeId ? blockById.get(br.parentBranchNodeId)!.position : plant.anchor.position;
    pts.push(origin);
    for (const id of br.blockIds) { const b = blockById.get(id); if (b) pts.push(b.position); }
    return pts;
  };
  const isAncestorPair = (a: Branch, b: Branch): boolean => {
    for (let p: Branch | undefined = a; p; p = p.parentBranchId ? branchById.get(p.parentBranchId) : undefined) if (p.id === b.id) return true;
    for (let p: Branch | undefined = b; p; p = p.parentBranchId ? branchById.get(p.parentBranchId) : undefined) if (p.id === a.id) return true;
    return false;
  };
  const meristemName = (br: Branch): string => {
    for (const id of br.blockIds) { const b = blockById.get(id); if (b && b.kind === "meristem") return (b as { name?: string }).name ?? br.id; }
    return br.id;
  };
  const out: Crossing[] = [];
  const B = plant.branches;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const A = B[i]!, C = B[j]!;
    if (isAncestorPair(A, C) && Math.abs(A.depth - C.depth) <= 1) continue; // parent↔child meet legitimately
    const pa = polyline(A), pb = polyline(C);
    let hit = false;
    for (let s = 0; s < pa.length - 1 && !hit; s++) for (let t = 0; t < pb.length - 1 && !hit; t++) if (segmentsCross(pa[s]!, pa[s + 1]!, pb[t]!, pb[t + 1]!)) hit = true;
    if (hit) out.push({ a: meristemName(A), b: meristemName(C), depthA: A.depth, depthB: C.depth });
  }
  return out;
}

// Deep-nesting fold-back crossings: a deeply-nested branch folds back across a
// FAR ancestor's chain (e.g. a grandchild × its grandparent). The growth-block
// demand reserves each descendant's FULL 2D footprint (tangent + perpendicular
// extent), so the in-between ancestors grow enough to keep the subtree off the
// ancestor chain. This is the geometric guarantee behind the "no overlaps"
// claim — it holds at depth and regardless of `curlBack` (curlBack OFF is the
// plant's aesthetic default + keeps the reservation tighter, but is no longer
// what prevents the crossing).
describe("deep-nesting: footprint reservation clears fold-back crossings", () => {
  for (const depth of [5, 6, 7]) {
    test(`a depth-${depth} binary fan is crossing-free (default config)`, () => {
      expect(findCrossings(runFullPipeline(binaryTree(depth)))).toEqual([]);
    });
  }
});
