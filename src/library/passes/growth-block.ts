import type {
  Block, BlockId, BranchId, EngineConfig, GrowthEvent, GrowthBlock, HierarchyInput,
  HierarchyNode,
} from "../types.ts";
import type { StructureOutput } from "./structure.ts";
import { extent } from "../../math/projection.ts";
import { multiSegmentLocalFrame } from "../../math/chain-walk.ts";

export interface GrowthBlockOutput extends StructureOutput {
  events: GrowthEvent[];
}

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

export function growthBlockPass(
  s: StructureOutput,
  config: EngineConfig,
  input?: HierarchyInput,
  explicitEvents?: GrowthEvent[],
): GrowthBlockOutput {
  const events =
    explicitEvents ?? (input ? deriveEventLog(input) : []);
  const buffer = config.clearance.branchBuffer;
  const epsRatio = config.clearance.expansionEpsilonRatio;

  const blockById = new Map<BlockId, Block>(s.blocks.map((b) => [b.id, b]));
  const branchById = new Map(s.branches.map((b) => [b.id, b]));

  const shortSideForDepth = (depth: number): number => {
    const { baseSize, childScale, phiOrder } = config.sizing;
    return baseSize * Math.pow(childScale, depth * phiOrder);
  };

  // For each block, compute its center arc on its home chain.
  // INITIALLY computed with all GBs at 0; UPDATED per-chain as BNs are
  // processed bottom-up. By the time an outer BN's demand is computed,
  // the arcs for all chains in its subtree reflect deeper BNs' GB
  // inflations — descendants project at their true post-inflation
  // positions, eliminating the staleness bug that under-reserved
  // outer-BN GBs by 3-5× under extreme angle settings.
  const arcOnHomeChain = new Map<BlockId, number>();
  for (const br of s.branches) {
    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      arcOnHomeChain.set(blockId, cursor + blk.shortSide / 2);
      cursor += blk.shortSide;
    }
  }

  // For each BN, its center arc on its parent chain (for intermediate
  // chain segments in the multi-segment walk). Initially computed with all
  // GBs at 0; updated per-chain alongside arcOnHomeChain as BNs are processed.
  const arcOfBnOnParentChain = new Map<BlockId, number>();
  for (const br of s.branches) {
    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      if (blk.kind === "branchNode") {
        arcOfBnOnParentChain.set(blk.id, cursor + blk.shortSide / 2);
      }
      cursor += blk.shortSide;
    }
  }

  // Build child-of map for subtree traversal (keyed by parent branch id).
  const childrenOf = new Map<string, typeof s.branches>();
  for (const b of s.branches) {
    if (b.parentBranchId === null) continue;
    const arr = childrenOf.get(b.parentBranchId) ?? [];
    arr.push(b);
    childrenOf.set(b.parentBranchId, arr);
  }

  // Pre-build BN id → {fwdGB, bwdGB} index so the main loop can hoist
  // O(allBlocks) lookup to O(1).
  const fwdGBByBn = new Map<BlockId, GrowthBlock>();
  const bwdGBByBn = new Map<BlockId, GrowthBlock>();
  for (const blk of s.blocks) {
    if (blk.kind !== "growthBlock") continue;
    if (blk.subtype === "fwd-tangent") fwdGBByBn.set(blk.ownerBlockId, blk);
    else if (blk.subtype === "bwd-tangent") bwdGBByBn.set(blk.ownerBlockId, blk);
  }

  // Collect all blocks in the descendant subtree rooted at a given branch.
  const subtreeBlocks = (rootBranchId: string): Block[] => {
    const out: Block[] = [];
    const stack: string[] = [rootBranchId];
    while (stack.length > 0) {
      const brId = stack.pop()!;
      const br = branchById.get(brId);
      if (!br) continue;
      for (const id of br.blockIds) {
        const blk = blockById.get(id);
        if (blk) out.push(blk);
      }
      const kids = childrenOf.get(brId) ?? [];
      for (const k of kids) stack.push(k.id);
    }
    return out;
  };

  // Recompute arcOnHomeChain and arcOfBnOnParentChain for every block on a
  // given chain. Called after a BN's GBs are set so that subsequent (shallower)
  // BNs see the inflated positions when computing their own demand.
  const recomputeChainArcs = (chainId: BranchId): void => {
    const br = branchById.get(chainId);
    if (!br) return;
    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      arcOnHomeChain.set(blockId, cursor + blk.shortSide / 2);
      if (blk.kind === "branchNode") {
        arcOfBnOnParentChain.set(blk.id, cursor + blk.shortSide / 2);
      }
      cursor += blk.shortSide;
    }
  };

  // Sort BranchNode blocks by depth descending — deepest first. When an outer
  // BN runs, every inner BN's GBs are already set and the arc maps reflect their
  // inflations, so the outer BN's demand calculation captures the true
  // cumulative reach of its subtree.
  const bnsByDepthDesc = s.blocks
    .filter((b): b is typeof b & { kind: "branchNode" } => b.kind === "branchNode")
    .map((bn) => {
      const parentBranch = branchById.get(bn.branchId);
      return { bn, depth: parentBranch?.depth ?? 0 };
    })
    .sort((a, b) => b.depth - a.depth)
    .map((x) => x.bn);

  // For each BN, compute fwd/bwd demand from its subtree.
  for (const targetBN of bnsByDepthDesc) {
    const childBranchId = targetBN.childBranchId;
    if (!childBranchId) continue;

    const childBranch = branchById.get(childBranchId);
    if (!childBranch) continue;

    const parentBranchOfBN = branchById.get(targetBN.branchId)!;
    const epsilon = epsRatio * shortSideForDepth(parentBranchOfBN.depth);

    // JUNCTION-LINE clearance (13 July 2026, Contact × root-stem): the
    // obstacle at this parent chain's ORIGIN is the grandparent chain it
    // departed from, running obliquely through the origin at angle -theta
    // in this frame. The plain (bwdHalf - dx) term below only guards a
    // line PERPENDICULAR to the parent chain; a descendant reaching |dy|
    // toward the grandparent's continuation needs backward room
    // ~ |dy|·cot(theta) MORE — a term that grows with the subtree's
    // length, which is exactly the growth the old demand under-tracked
    // (it responded at the tangent slope only, so growing branches crept
    // across far ancestors). NOTE this is NOT the proven-dead raw-|dy|
    // magnitude of 2026-04-26: |dy| enters only against this BN's own
    // junction line, scaled by cot(theta), and self-gates to zero for
    // descendants on the safe side — far ancestors still see footprints.
    // Near-parallel departures (|sin| ≤ 0.1) skip it: a tangent
    // translation cannot clear a near-parallel line (the demand would
    // diverge); footprint terms still apply there.
    const junctionTheta = parentBranchOfBN.departureAngle;
    const junctionSin = Math.abs(Math.sin(junctionTheta));
    const junctionActive =
      parentBranchOfBN.parentBranchId !== null && junctionSin > 0.1;
    const junctionCos = Math.cos(junctionTheta) * Math.sign(Math.sin(junctionTheta));
    // Arc already guaranteed before this BN on its parent chain (earlier
    // siblings' spans; final by now — deeper BNs and same-chain earlier
    // siblings are already processed, and later siblings' blocks sit after
    // this BN). The junction obstacle is fixed at the chain ORIGIN, so this
    // prefix already provides that much clearance — subtract it from the
    // junction demand or successive siblings stack the full origin
    // requirement each (the 13 July vault-scale +33% over-reservation).
    const junctionPrefix = Math.max(
      0,
      (arcOfBnOnParentChain.get(targetBN.id) ?? 0) - targetBN.shortSide / 2,
    );

    let fwdDemand = 0;
    let bwdDemand = 0;

    const descendants = subtreeBlocks(childBranchId);
    for (const b of descendants) {
      // CONTENT blocks only. Growth blocks are empty reservations: every
      // content block already sits at post-GB arcs (a GB's span is baked
      // into the positions of everything after it), so counting the GB
      // itself — its center position AND its often-huge footprint
      // (extent of a multi-thousand-unit shortSide) — double-counts
      // emptiness. Bottom-up processing then compounds it per generation:
      // each ancestor reserves room for its descendants' reservations
      // ("internal detail leaking to the root" — the 13 July vault coral
      // carried a ~4× phantom expansion from exactly this, with zero
      // crossings to justify it). Chains end in a content meristem, so
      // drawn tips stay covered; only the small trailing meristem-out GB
      // is uncounted, absorbed by footprint margins.
      if (b.kind === "growthBlock") continue;
      // Build path segments from targetBN's child chain down to b's home chain.
      // Walk up from b's home branch back to childBranch, building reverse-ordered chain list.
      const reverseChain: string[] = [];
      let cur: string | null = b.branchId;
      while (cur && cur !== childBranchId) {
        reverseChain.push(cur);
        const br = branchById.get(cur);
        cur = br?.parentBranchId ?? null;
      }
      reverseChain.push(childBranchId);
      const chainOrder = reverseChain.reverse(); // childBranchId → ... → b's home

      // Build segments array.
      // For each intermediate chain (not the last), arc = arc-on-chain of the NEXT chain's parent BN.
      // For the last chain (b's home), arc = b's arcOnHomeChain.
      // Each segment's departureAngle is the branch's angle relative to its parent chain's tangent.
      // The BN's local frame x-axis aligns with the PARENT chain tangent, so the child chain's
      // departureAngle is the angle of the first segment.
      const segments: Array<{ arcOnChain: number; departureAngle: number }> = [];
      for (let i = 0; i < chainOrder.length; i++) {
        const chainId = chainOrder[i]!;
        const chainBranch = branchById.get(chainId)!;
        const departure = chainBranch.departureAngle;

        let arcOnThis: number;
        if (i === chainOrder.length - 1) {
          arcOnThis = arcOnHomeChain.get(b.id) ?? 0;
        } else {
          const nextChainId = chainOrder[i + 1]!;
          const nextChain = branchById.get(nextChainId)!;
          const nextParentBnId = nextChain.parentBranchNodeId;
          if (!nextParentBnId) {
            arcOnThis = 0;
          } else {
            arcOnThis = arcOfBnOnParentChain.get(nextParentBnId) ?? 0;
          }
        }

        segments.push({ arcOnChain: arcOnThis, departureAngle: departure });
      }

      const { dx, dy } = multiSegmentLocalFrame(segments);

      let alpha = 0;
      for (const seg of segments) alpha += seg.departureAngle;

      // FORWARD demand only needs the descendant's TANGENT half-footprint: it
      // claims room ahead of this BN for the next sibling on the parent chain,
      // a purely along-chain concern. (Original spread = extent(S,α)/2.)
      const tangentHalf = extent(b.shortSide, alpha) / 2;
      // BACKWARD demand also reserves the descendant's PERPENDICULAR half-extent
      // (`extent(S, α+90°)/2`). The backward ring TRANSLATES this BN's subtree
      // along the parent chain (place-pass cursor-split); reserving the
      // perpendicular footprint here is what shifts a deeply-nested branch off a
      // FAR ancestor's chain it would otherwise fold back across (favicons ×
      // Marketing — the in-between grandparent finally has a term to grow on).
      //
      // Two deliberate choices keep this tight:
      //  • FOOTPRINT (size), not POSITION (`dy`): the 2026-04-26 attempt added
      //    |dy| and over-stretched 5–186× because a deep lief's perpendicular
      //    *position* is huge at far ancestors. Its *footprint* shrinks with
      //    depth, so far ancestors barely move (they see the lief as tiny).
      //  • BACKWARD only: adding it forward too just pushed the next sibling out
      //    (over-spacing) without aiding clearance. Real corals: every fold-back
      //    crossing clears at ~1.2–1.3× stretch (vs ~1.5× when applied both ways).
      const bwdHalf = tangentHalf + extent(b.shortSide, alpha + Math.PI / 2) / 2;
      const fwdContribution = Math.max(0, dx + tangentHalf);
      let bwdContribution = Math.max(0, bwdHalf - dx);

      // Keep b on the near side of the junction line: in this frame the
      // constraint is (arc + dx)·|sinθ| + dy·cosθ·sgn(sinθ) ≥ bwdHalf,
      // and the bwd GB width w guarantees arc ≥ w, so demand
      // w ≥ (bwdHalf − dy·cosθ·sgn)/|sinθ| − dx is sufficient (anything
      // else on the chain before the GB only adds clearance).
      // NEAR SPAN only (≤ 3 chain segments): the straight-chain (dx,dy)
      // estimate degrades into wild conservatism across many generations
      // (the 2026-04-26 raw-|dy| lesson in another guise); every observed
      // fold-back class — Contact × root, favicons × Marketing, all five
      // 13-July project-coral crossings — clears within 3 segments of its
      // clearing BN. Farther spans stay covered by the footprint terms
      // above. (Content-only is enforced for ALL terms by the growthBlock
      // skip at the top of this loop.)
      if (junctionActive && chainOrder.length <= 3) {
        const junctionNeed =
          (bwdHalf - dy * junctionCos) / junctionSin - dx - junctionPrefix;
        if (junctionNeed > bwdContribution) bwdContribution = junctionNeed;
      }

      if (fwdContribution > fwdDemand) fwdDemand = fwdContribution;
      if (bwdContribution > bwdDemand) bwdDemand = bwdContribution;
    }

    const fwdWidth = Math.max(epsilon, fwdDemand * buffer);
    const bwdWidth = Math.max(epsilon, bwdDemand * buffer);

    // Set this BN's fwd-tangent and bwd-tangent Growth Blocks via index lookup.
    const fwdGB = fwdGBByBn.get(targetBN.id);
    const bwdGB = bwdGBByBn.get(targetBN.id);
    if (fwdGB) fwdGB.shortSide = fwdWidth;
    if (bwdGB) bwdGB.shortSide = bwdWidth;

    // After GBs are set, recompute arc positions for the parent chain so that
    // shallower BNs processed next will see the inflated block positions.
    // (Child-axis GB is a constant set by sizePass; no child-chain recompute needed.)
    recomputeChainArcs(targetBN.branchId);   // parent chain: fwd/bwd-tangent GBs changed
  }

  // arcLength becomes stale after fwd/bwd shortSides change. Recompute.
  for (const br of s.branches) {
    let arc = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (blk) arc += blk.shortSide;
    }
    br.arcLength = arc;
    if (br.curve) br.curve.arcLength = arc;
  }

  return { ...s, events };
}
