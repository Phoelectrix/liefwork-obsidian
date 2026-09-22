import type {
  BlockId, EngineConfig, GrowthEvent, HierarchyId, HierarchyInput,
  HierarchyNode, Ring, RingSet,
} from "../types.ts";
import type { StructureOutput } from "./structure.ts";
import { magnitude, attribute } from "../math/projection.ts";
import { compoundAngle, localFrame } from "../math/chain-walk.ts";

export interface RingOutput extends StructureOutput {
  rings: RingSet[];
  events: GrowthEvent[];
}

// Derive an event log from the hierarchy when none is supplied. Only lief
// nodes produce events; BranchNode "creation" is implicit in its children's
// events. Sorted by createdAt so replay order is deterministic.
function deriveEventLog(input: HierarchyInput): GrowthEvent[] {
  const events: GrowthEvent[] = [];
  let counter = 0;
  const walk = (node: HierarchyNode): void => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    if (!hasChildren) {
      events.push({
        eventId: `ev_${counter++}`,
        liefId: node.id,
        createdAt: node.createdAt ?? new Date(0 + counter).toISOString(),
      });
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(input.root);
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return events;
}

export function ringPass(
  s: StructureOutput,
  config: EngineConfig,
  input?: HierarchyInput,
  explicitEvents?: GrowthEvent[],
): RingOutput {
  const events = explicitEvents ?? (input ? deriveEventLog(input) : []);
  const buffer = config.clearance.branchBuffer;

  const blockById = new Map(s.blocks.map((b) => [b.id, b]));
  const branchById = new Map(s.branches.map((b) => [b.id, b]));

  // Chain-local depth scaling (matches sizePass — kept here because ring must
  // run before size, but both derive from the same formula).
  const shortSideAtDepth = (d: number): number => {
    const { baseSize, childScale, phiOrder } = config.sizing;
    return baseSize * Math.pow(childScale, d * phiOrder);
  };

  // Per-BranchNode epsilon: spec §3 says `expansionEpsilonRatio × S_branchNode`,
  // where S_branchNode is the BN's own short side (set by its PARENT branch's
  // depth, since the BN is a block on the parent chain).
  const epsilonByBn = new Map<BlockId, number>();
  for (const blk of s.blocks) {
    if (blk.kind !== "branchNode") continue;
    const parentBranch = branchById.get(blk.branchId)!;
    epsilonByBn.set(
      blk.id,
      config.clearance.expansionEpsilonRatio * shortSideAtDepth(parentBranch.depth),
    );
  }

  const ringSets = new Map<BlockId, { forward: Ring[]; backward: Ring[] }>();
  for (const blk of s.blocks) {
    if (blk.kind === "branchNode") ringSets.set(blk.id, { forward: [], backward: [] });
  }

  const frontiers = new Map<BlockId, { fwd: number; bwd: number }>();
  for (const id of ringSets.keys()) frontiers.set(id, { fwd: 0, bwd: 0 });

  // Chain-local arc positions: each block sits at the cumulative sum of
  // preceding block short-sides (depth-scaled). Rings accumulate on the
  // ANCESTOR chain, not the child chain where the lief lives, so the child
  // chain's arc positions are unaffected by ring emissions here.
  const liefArcOnHomeChain = new Map<HierarchyId, number>();
  for (const br of s.branches) {
    const S = shortSideAtDepth(br.depth);
    const spacerSize = S * config.sizing.spacerRatio;
    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      if (blk.kind === "spacer") cursor += spacerSize;
      else if (blk.kind === "lief") {
        liefArcOnHomeChain.set(blk.hierarchyId, cursor + S / 2);
        cursor += S;
      } else if (blk.kind === "branchNode") {
        cursor += S;
      } else if (blk.kind === "meristem") {
        cursor += S;
      }
    }
  }

  const branchNodeArcOnParent = new Map<BlockId, number>();
  for (const br of s.branches) {
    const S = shortSideAtDepth(br.depth);
    const spacerSize = S * config.sizing.spacerRatio;
    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      if (blk.kind === "spacer") cursor += spacerSize;
      else if (blk.kind === "lief") cursor += S;
      else if (blk.kind === "branchNode") {
        branchNodeArcOnParent.set(blk.id, cursor + S / 2);
        cursor += S;
      } else if (blk.kind === "meristem") cursor += S;
    }
  }

  for (const ev of events) {
    const homeBranchId = s.liefHome.get(ev.liefId);
    if (!homeBranchId) continue;
    const ancestorBns = s.ancestorBranchNodes.get(homeBranchId) ?? [];
    const ancestorBrs = s.ancestorBranches.get(homeBranchId) ?? [];

    for (let i = 0; i < ancestorBns.length; i++) {
      const bnId = ancestorBns[i]!;
      const targetChain = ancestorBrs[i]!;

      // Departure angles from targetChain's direct child branch down to home.
      const deps: number[] = [];
      let br = branchById.get(homeBranchId)!;
      while (br.parentBranchId && br.parentBranchId !== targetChain) {
        deps.unshift(br.departureAngle);
        br = branchById.get(br.parentBranchId)!;
      }
      deps.unshift(br.departureAngle);
      const alpha = compoundAngle(deps);

      const homeBranch = branchById.get(homeBranchId)!;
      const S_lief = shortSideAtDepth(homeBranch.depth);
      const liefArc = liefArcOnHomeChain.get(ev.liefId) ?? 0;

      // frame.dx is the lief's offset from the BranchNode along the ancestor
      // axis (attribution needs offset relative to BN, not absolute on ancestor).
      const frame = localFrame(alpha, liefArc, 0);
      const m = magnitude(S_lief, alpha, frame.dy);
      const { forward, backward } = attribute(frame.dx, m, buffer);

      const f = frontiers.get(bnId)!;
      const epsilon = epsilonByBn.get(bnId)!;
      let wF = Math.max(0, forward - f.fwd);
      if (wF < epsilon) wF = epsilon;
      let wB = Math.max(0, backward - f.bwd);
      if (wB < epsilon) wB = epsilon;
      f.fwd += wF;
      f.bwd += wB;

      const rs = ringSets.get(bnId)!;
      rs.forward.push({
        eventId: ev.eventId, liefId: ev.liefId,
        width: wF, index: rs.forward.length,
      });
      rs.backward.push({
        eventId: ev.eventId, liefId: ev.liefId,
        width: wB, index: rs.backward.length,
      });
    }
  }

  const rings: RingSet[] = Array.from(ringSets.entries()).map(([blockId, sides]) => ({
    blockId, forward: sides.forward, backward: sides.backward,
  }));

  return { ...s, rings, events };
}
