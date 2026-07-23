import { PHI } from "../constants.ts";

/**
 * Axial footprint of a lief with short side S at compound angle α (radians)
 * relative to an ancestor BranchNode's axis.
 *
 *   extent(α) = S · |cos α| + S·φ · |sin α|
 *
 * Bounded in [S, S·√(1+φ²)]; maximum at α = arctan(φ) (the golden-rectangle
 * diagonal). No division, no singularities. Periodic in α with period π.
 */
export function extent(S: number, α: number): number {
  let c = Math.abs(Math.cos(α));
  let s = Math.abs(Math.sin(α));
  // Float hygiene: clamp and zero near-epsilons (spec §5).
  if (c < 1e-10) c = 0;
  if (s < 1e-10) s = 0;
  return S * c + S * PHI * s;
}

/**
 * Total parent-tangent ring reservation a lief at BN-local (dx, dy)
 * claims at an ancestor BranchNode. Combines the lief's tangent extent
 * (via extent(S, α)) with its perpendicular position magnitude, so deep
 * perpendicular reach contributes to ring growth in addition to tangent
 * reach. Sign of dy doesn't matter — only its magnitude.
 *
 *   magnitude(S, α, dy) = extent(S, α) + |dy|
 *
 * Properties:
 *   - magnitude(S, α, 0) === extent(S, α)              (tame topologies unaffected)
 *   - monotone non-decreasing in |dy|                  (more perpendicular reach → more reservation)
 *   - branchBuffer (in attribute()) scales the whole result linearly
 *
 * Candidate α from the 2026-04-26 ring-perpendicular fix design. If the
 * verification matrix shows α visibly over-stretches Shakespeare or kotsanas,
 * fall back to Candidate δ: sqrt(extent² + dy²). γ (multiplicative) was
 * discarded — blows up at extreme nesting.
 */
export function magnitude(S: number, α: number, dy: number): number {
  return extent(S, α) + Math.abs(dy);
}

/**
 * Split the extent into forward and backward contributions, offset by the
 * lief's axial position (dx) in the ancestor's local frame, and scaled by
 * the stylistic branchBuffer multiplier. Either side may be zero.
 */
export function attribute(
  dx: number,
  extentValue: number,
  branchBuffer: number,
): { forward: number; backward: number } {
  const spread = (extentValue * branchBuffer) / 2;
  return {
    forward: Math.max(0, dx + spread),
    backward: Math.max(0, spread - dx),
  };
}
