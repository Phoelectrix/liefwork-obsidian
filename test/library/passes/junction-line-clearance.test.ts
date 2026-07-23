import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { growthBlockPass } from "../../../src/library/passes/growth-block.ts";
import { placePass } from "../../../src/library/passes/place.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { Branch, EngineConfig, HierarchyInput, HierarchyNode, Vec2 } from "../../../src/library/types.ts";

// The shipped plugin layout tuning (values transcribed from
// viewer/src/liefwork-defaults.ts — engine tests must not import the viewer).
// The bug reproduces at the plugin's uniform 68.76° departures; the library
// default config masks it on this shape.
function pluginConfig(): EngineConfig {
  const cfg = structuredClone(defaultEngineConfig) as EngineConfig;
  cfg.sizing = { ...cfg.sizing, baseSize: 40, childScale: 0.62, phiOrder: 1, spacerRatio: 2, liefTaper: 0 };
  cfg.angles = {
    ...cfg.angles, angleMode: "phi-sequence", firstBranchAngle: 68.76, angleDecay: 1,
    alternateBranches: true, alternateLiefs: true, nonAlternatingDepth: 0,
    rootOrientationAngle: 90, curlBack: false,
  };
  cfg.curve = { ...cfg.curve, curveType: "straight" };
  cfg.sort = { ...cfg.sort, default: "newest-first", liefsLast: false };
  return cfg;
}

// Synthetic "site shape" distilled from the live LiefWork.Com coral (the
// Contact × root-stem collision, 13 July 2026): trunk → limb (departs
// +68.76°) → bough (departs −68.76°, running parallel to the trunk) → fan
// (departs −68.76° again, heading back ACROSS the trunk), with siblings
// padding the bough so the fan sits far out along it. At ≥9 fan stubs the
// fan's tip protrudes past the trunk unless the junction-line term holds
// it clear. createdAt stamps are explicit so newest-first sort is stable.
let t = 0;
const stamp = (): string => new Date(Date.UTC(2026, 0, 1, 0, ++t)).toISOString();
const lief = (id: string): HierarchyNode => ({ id, name: id, children: [], createdAt: stamp() });
const branch = (id: string, children: HierarchyNode[]): HierarchyNode =>
  ({ id, name: id, children, createdAt: stamp() });

function siteShape(fanStubs: number): HierarchyInput {
  t = 0;
  const privacy = branch("privacy", [lief("p1"), lief("p2")]);
  const b1 = branch("b1", [lief("b1a"), lief("b1b"), lief("b1c")]);
  const b2 = branch("b2", [lief("b2a"), lief("b2b"), lief("b2c")]);
  const b3 = branch("b3", [lief("b3a"), lief("b3b"), lief("b3c")]);
  const fan = branch("fan", Array.from({ length: fanStubs }, (_, i) => branch(`stub${i}`, [lief(`s${i}a`)])));
  const bough = branch("bough", [b1, b2, b3, fan]);
  const limb = branch("limb", [privacy, bough]);
  const trunkTail = Array.from({ length: 10 }, (_, i) => lief(`t${i}`));
  return { root: { id: "root", name: "root", children: [limb, ...trunkTail] } };
}

function runFullPipeline(input: HierarchyInput, cfg: EngineConfig) {
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

// Every crossing between two branches' chain polylines, excluding legitimate
// parent↔child adjacency. Same harness as deep-nesting-crossing.test.ts
// (test files in this repo are self-contained by precedent).
function findCrossings(plant: ReturnType<typeof placePass>): Array<{ a: string; b: string }> {
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
  const out: Array<{ a: string; b: string }> = [];
  const B = plant.branches;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const A = B[i]!, C = B[j]!;
    if (isAncestorPair(A, C) && Math.abs(A.depth - C.depth) <= 1) continue; // parent↔child meet legitimately
    const pa = polyline(A), pb = polyline(C);
    let hit = false;
    for (let s = 0; s < pa.length - 1 && !hit; s++)
      for (let u = 0; u < pb.length - 1 && !hit; u++)
        if (segmentsCross(pa[s]!, pa[s + 1]!, pb[u]!, pb[u + 1]!)) hit = true;
    if (hit) out.push({ a: A.id, b: C.id });
  }
  return out;
}

// A near-perpendicular great-grandchild must stay clear of its
// great-grandparent's chain AT EVERY SIZE — the junction-line guarantee.
// Pre-fix, the fan crosses the trunk from 9 stubs up (the backward demand
// grows with the fan but at the tangent slope only, dropping |dy|·cotθ).
describe("junction-line: near-perpendicular fold-back stays clear as it grows", () => {
  for (const stubs of [3, 6, 9, 12, 18]) {
    test(`site-shape with ${stubs} fan stubs is crossing-free (plugin config)`, () => {
      expect(findCrossings(runFullPipeline(siteShape(stubs), pluginConfig()))).toEqual([]);
    });
  }
});
