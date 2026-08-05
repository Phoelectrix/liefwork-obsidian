import type { Bounds, EngineConfig, Vec2 } from "../types.ts";
import type { RingOutput } from "./ring.ts";
import { sampleCurve } from "../curves/sample.ts";

export interface PlaceOutput extends RingOutput { bounds: Bounds; }

export function placePass(r: RingOutput, _cfg: EngineConfig): PlaceOutput {
  const minBounds: Vec2 = { x: Infinity, y: Infinity };
  const maxBounds: Vec2 = { x: -Infinity, y: -Infinity };
  const track = (p: Vec2): void => {
    if (p.x < minBounds.x) minBounds.x = p.x;
    if (p.y < minBounds.y) minBounds.y = p.y;
    if (p.x > maxBounds.x) maxBounds.x = p.x;
    if (p.y > maxBounds.y) maxBounds.y = p.y;
  };

  const blockById = new Map(r.blocks.map((b) => [b.id, b]));
  const ringByBlockId = new Map(r.rings.map((x) => [x.blockId, x]));

  // Walk top-down: parent branches must be placed before children reach
  // their parent BranchNode block for its world position and tangent.
  const byDepthAsc = [...r.branches].sort((a, b) => a.depth - b.depth);

  for (const br of byDepthAsc) {
    let origin: Vec2;
    let originAngle: number;
    if (br.parentBranchId === null) {
      origin = r.anchor.position;
      originAngle = r.anchor.orientationAngle + br.departureAngle;
    } else {
      const bn = blockById.get(br.parentBranchNodeId!)!;
      origin = bn.position;
      originAngle = bn.tangent + br.departureAngle;
    }
    br.curve.originAngle = originAngle;

    const minB: Vec2 = { x: Infinity, y: Infinity };
    const maxB: Vec2 = { x: -Infinity, y: -Infinity };
    const trackBranch = (p: Vec2, halfExtent: number): void => {
      if (p.x - halfExtent < minB.x) minB.x = p.x - halfExtent;
      if (p.y - halfExtent < minB.y) minB.y = p.y - halfExtent;
      if (p.x + halfExtent > maxB.x) maxB.x = p.x + halfExtent;
      if (p.y + halfExtent > maxB.y) maxB.y = p.y + halfExtent;
    };

    let cursor = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId)!;
      // (a): backward ring widths advance the cursor BEFORE placing the BN's
      // center, so the BN itself slides forward by `backward`. The BN's
      // entire subtree rides along via the parent tangent direction,
      // translating by (backward·tx, backward·ty) in world coords.
      const rs = blk.kind === "branchNode"
        ? ringByBlockId.get(blk.id)
        : undefined;
      if (rs) {
        cursor += rs.backward.reduce((a, rg) => a + rg.width, 0);
      }
      const centerArc = cursor + blk.shortSide / 2;
      const t = br.arcLength > 0 ? centerArc / br.arcLength : 0;
      const { point, tangent } = sampleCurve(br.curve, t);
      // sampleCurve returns curve-local coords already rotated by originAngle;
      // translating by origin moves them into world.
      const worldPoint: Vec2 = { x: origin.x + point.x, y: origin.y + point.y };
      blk.position = worldPoint;
      blk.arcPosition = centerArc;
      blk.tangent = tangent;
      blk.rotation = tangent;
      track(worldPoint);
      trackBranch(worldPoint, blk.shortSide);
      cursor += blk.shortSide;
      // Forward ring widths advance the cursor AFTER the BN, pushing the
      // next sibling on the parent chain forward.
      if (rs) {
        cursor += rs.forward.reduce((a, rg) => a + rg.width, 0);
      }
    }

    br.bounds = {
      min: Number.isFinite(minB.x) ? minB : { x: origin.x, y: origin.y },
      max: Number.isFinite(maxB.x) ? maxB : { x: origin.x, y: origin.y },
    };
    // Capture the LOCAL box (this branch's own blocks only) as a deep copy
    // BEFORE the depth-descending union pass below overwrites br.bounds with
    // the subtree AABB. Copy (not alias) so the union can't mutate localBounds.
    br.localBounds = {
      min: { x: br.bounds.min.x, y: br.bounds.min.y },
      max: { x: br.bounds.max.x, y: br.bounds.max.y },
    };
  }

  // Propagate descendants' bounds up: each branch's AABB must contain all of
  // its children's AABBs so the recursive cull can drop entire subtrees in one
  // intersect test. Walk deepest-first so each parent reads already-expanded
  // child bounds.
  const childrenOf = new Map<string | null, typeof r.branches[number][]>();
  for (const b of r.branches) {
    const arr = childrenOf.get(b.parentBranchId) ?? [];
    arr.push(b);
    childrenOf.set(b.parentBranchId, arr);
  }
  const byDepthDesc = [...r.branches].sort((a, b) => b.depth - a.depth);
  for (const br of byDepthDesc) {
    const kids = childrenOf.get(br.id);
    if (!kids) continue;
    for (const k of kids) {
      if (k.bounds.min.x < br.bounds.min.x) br.bounds.min.x = k.bounds.min.x;
      if (k.bounds.min.y < br.bounds.min.y) br.bounds.min.y = k.bounds.min.y;
      if (k.bounds.max.x > br.bounds.max.x) br.bounds.max.x = k.bounds.max.x;
      if (k.bounds.max.y > br.bounds.max.y) br.bounds.max.y = k.bounds.max.y;
    }
  }

  const bounds: Bounds = {
    min: Number.isFinite(minBounds.x) ? minBounds : { x: 0, y: 0 },
    max: Number.isFinite(maxBounds.x) ? maxBounds : { x: 0, y: 0 },
  };

  return { ...r, bounds };
}
