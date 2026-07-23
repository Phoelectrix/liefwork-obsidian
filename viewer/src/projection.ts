// Projection geometry helpers for the Projected skin.
//
// Two kinds of identity block project differently:
//   - Liefs sit offset to one side of their branch; perpendicular-outward is
//     the natural projection direction. sideFlip keeps the two sides of a
//     chain alternating naturally.
//   - Meristems sit on the chain axis at the tip; along-tangent forward is
//     the natural direction. No side flip.
//
// Angles are in radians, world frame. tangent = engine-provided block.tangent.

export interface LiefGeom {
  tangent: number;
  side: "left" | "right";
}

export function liefSunAzimuth(block: LiefGeom, liefRelativeAngle: number): number {
  // Mirror across the branch tangent: a relative angle of π/2 puts the ray
  // perpendicular-outward on both sides, and any deviation from π/2 tilts
  // both sides toward the SAME end of the branch (toward tip if θ < π/2,
  // toward base if θ > π/2). On the right we measure CCW from tangent; on
  // the left we measure CW (negate) — that's the mirror image about the
  // branch axis.
  if (block.side === "left") return block.tangent - liefRelativeAngle;
  return block.tangent + liefRelativeAngle;
}

/** Half-angle (as a sin threshold) around the horizontal within which a
 *  projected label centres vertically instead of tucking to a corner (~20°). */
const VERTICAL_ANCHOR_DEADZONE = Math.sin(Math.PI / 9);

/**
 * Which vertical edge of a projected label its light-ray should land on, so the
 * label body sits in open space away from the branch — the angle-driven
 * replacement for the old side-based guess.
 *
 * The ray-tip sits at (cos sunAz, sin sunAz)·rayLen in SVG's y-DOWN frame, so a
 * ray pointing DOWN (sin > 0) puts the label below its source → anchor at the
 * box TOP edge (label hangs downward). Pointing UP (sin < 0) → "bottom". A
 * near-horizontal ray (|sin| < deadzone) centres vertically. Mirrors the
 * horizontal anchor's use of cos(sunAz): the corner nearest the branch, for any
 * branch angle and either side.
 */
export function projectionVerticalAnchor(
  sunAz: number,
  deadzone = VERTICAL_ANCHOR_DEADZONE,
): "top" | "middle" | "bottom" {
  const sin = Math.sin(sunAz);
  if (Math.abs(sin) < deadzone) return "middle";
  return sin > 0 ? "top" : "bottom";
}

export interface MeristemGeom {
  tangent: number;
}

export function meristemSunAzimuth(
  block: MeristemGeom,
  meristemRelativeAngle: number,
): number {
  return block.tangent + meristemRelativeAngle;
}

export function resolveMeristemSide(departureAngle: number): "left" | "right" {
  return departureAngle < 0 ? "left" : "right";
}

// Per-lief angular offset so a branch's lief chain fans across `fanRange`.
// Rear (idx 0) tilts back toward the base, tip (idx count-1) tilts forward
// toward the meristem; middle sits at 0.
//
// θ_rel = π/2 is perpendicular-outward. Tilting back toward base means
// θ_rel > π/2 (positive offset); tilting forward toward tip means θ_rel < π/2
// (negative offset). `liefSunAzimuth` mirrors the static angle across the
// branch on the left side, so the SAME signed offset on both sides produces
// a mirror-symmetric fan visually — no side-aware negation needed here.
// count <= 1 returns 0 (nothing to fan).
export function fanOffsetForLief(
  idx: number,
  count: number,
  fanRange: number,
  // `side` is kept in the signature for backwards compatibility with call
  // sites that already pass it; the value is no longer needed because
  // `liefSunAzimuth` handles the mirror.
  _side?: "left" | "right",
): number {
  void _side;
  if (count <= 1) return 0;
  const t = idx / (count - 1);
  const s = 1 - 2 * t;
  const offset = (s * fanRange) / 2;
  if (offset === 0) return 0;     // normalise -0 → 0 for clean equality checks
  return offset;
}

export interface Vec2 { x: number; y: number; }

export function rayEndpoint(
  origin: Vec2,
  sunAzimuth: number,
  shortSide: number,
  distance: number,
): Vec2 {
  const len = shortSide * distance;
  return {
    x: origin.x + Math.cos(sunAzimuth) * len,
    y: origin.y + Math.sin(sunAzimuth) * len,
  };
}

import type { Block, Branch, Plant } from "../../src/types.ts";

/** Pre-built lookups for `branchPathForWithMaps`. Build ONCE per plant and
 *  reuse across many calls — the alternative (calling `branchPathFor` per
 *  block) rebuilds these maps on every call, which is O(N²) over an
 *  N-block plant and dominates `renderAll` cost on large fixtures. */
export interface BranchPathMaps {
  branchById: Map<string, Branch>;
  meristemNameByBranchId: Map<string, string>;
}

export function buildBranchPathMaps(plant: Plant): BranchPathMaps {
  const branchById = new Map(plant.branches.map((b) => [b.id, b]));
  const meristemNameByBranchId = new Map<string, string>();
  for (const b of plant.blocks) {
    if (b.kind === "meristem" && "name" in b) {
      meristemNameByBranchId.set(b.branchId, b.name);
    }
  }
  return { branchById, meristemNameByBranchId };
}

/** Slash-joined chain of branch names from the stem down to `block`'s branch,
 *  given pre-built lookup maps (see `buildBranchPathMaps`). Use this in any
 *  loop that calls per-block — `O(depth)` per call vs `O(N)` for the
 *  convenience wrapper `branchPathFor`. */
export function branchPathForWithMaps(
  block: Block,
  maps: BranchPathMaps,
): string {
  const branch = maps.branchById.get(block.branchId);
  if (!branch) return "";
  const names: string[] = [];
  let current = branch;
  while (current.parentBranchId !== null) {
    const name = maps.meristemNameByBranchId.get(current.id);
    if (name !== undefined) names.unshift(name);
    const parent = maps.branchById.get(current.parentBranchId);
    if (!parent) break;
    current = parent;
  }
  return names.join("/");
}

/** One-off convenience: rebuilds the lookup maps internally. O(N) per call.
 *  Acceptable for tests and one-shot lookups; for per-block use in a loop,
 *  call `buildBranchPathMaps` once and `branchPathForWithMaps` per block. */
export function branchPathFor(block: Block, plant: Plant): string {
  return branchPathForWithMaps(block, buildBranchPathMaps(plant));
}

export function resolveProjectionConfig<T extends object>(
  branchPath: string,
  base: T,
  overrides: Record<string, Partial<T>>,
): T {
  const ancestors: string[] = [""];
  if (branchPath !== "") {
    const parts = branchPath.split("/");
    let acc = "";
    for (const p of parts) {
      acc = acc === "" ? p : `${acc}/${p}`;
      ancestors.push(acc);
    }
  }
  let merged: T = { ...base };
  for (const key of ancestors) {
    const ov = overrides[key];
    if (ov) merged = { ...merged, ...ov };
  }
  return merged;
}
