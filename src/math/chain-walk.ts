/**
 * Sum of departure angles along a chain from an ancestor's direct child
 * branch down to a descendant's home branch. Unitless (whatever unit the
 * inputs are in; typically radians).
 */
export function compoundAngle(departureAnglesAlongChain: number[]): number {
  let sum = 0;
  for (const a of departureAnglesAlongChain) sum += a;
  return sum;
}

/**
 * Lief's (dx, dy) position in the ancestor BranchNode's local frame.
 *
 * Straight-chain approximation:
 *   dx = branchNodeArcOnAncestor + liefArcOnChildChain · cos(α)
 *   dy =                          liefArcOnChildChain · sin(α)
 *
 * Curved-chain correction (for bough curves) is applied in the Place pass;
 * projection uses chain arc-length, not world arc (spec's chain-local rule).
 */
export function localFrame(
  α: number,
  liefArcOnChildChain: number,
  branchNodeArcOnAncestor: number,
): { dx: number; dy: number } {
  return {
    dx: branchNodeArcOnAncestor + liefArcOnChildChain * Math.cos(α),
    dy: liefArcOnChildChain * Math.sin(α),
  };
}

/**
 * Position of a descendant in an ancestor BN's local frame, walking through
 * every intermediate chain segment. `segments` is ordered from the ancestor
 * BN's direct child chain (segment 0) down to the descendant's home chain
 * (last segment).
 *
 *   dx = sum over segments i of: arcOnChain_i × cos(α_partial_i)
 *   dy = sum over segments i of: arcOnChain_i × sin(α_partial_i)
 *
 * where α_partial_i is the cumulative compound angle through segments 1..i
 * (each segment's departure angle is relative to the previous chain's tangent).
 *
 * Replaces the original engine's `localFrame(α, liefArc, 0)` call site, which
 * silently dropped intermediate-chain arcs by hardcoding the BN-arc-on-ancestor
 * argument to zero.
 */
export function multiSegmentLocalFrame(
  segments: Array<{ arcOnChain: number; departureAngle: number }>,
): { dx: number; dy: number } {
  let cumulativeAngle = 0;
  let dx = 0;
  let dy = 0;
  for (const seg of segments) {
    cumulativeAngle += seg.departureAngle;
    dx += seg.arcOnChain * Math.cos(cumulativeAngle);
    dy += seg.arcOnChain * Math.sin(cumulativeAngle);
  }
  return { dx, dy };
}
