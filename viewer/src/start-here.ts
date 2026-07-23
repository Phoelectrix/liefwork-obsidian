/**
 * start-here.ts — "Start Here" meristem prefix.
 *
 * Authors can prefix a meristem heading in their MD with `<=Start Here:`
 * (e.g. `## <=Start Here: Preface`). At viewer load time:
 *
 *  1. The FULL prefix is stripped from `block.name` → "Preface". Side
 *     panel, nodeMetadata lookups, branchPath, projection-config
 *     overrides all see the clean canonical name. "Start Here" never
 *     leaks into prose, citations, or breadcrumbs.
 *  2. The branch carrying that meristem is recorded so:
 *      - The cascade-pass lifts its subtreeNorm to match the LARGEST
 *        SIBLING branch (peer equality, not root equality).
 *      - The renderer prepends "Start Here →" to the VISIBLE label only
 *        (bud-path letter cutouts + projection-label). The cue is in the
 *        plant; nowhere else.
 *
 * Use case: a hand-curated plant like Holographia where the author wants
 * a specific entry-point meristem to be as visually prominent as the
 * largest sibling bough (here Quantum Wholeness, ~87 descendants), even
 * though its actual subtree is small (Preface has 5 bullets).
 */

import type { Plant } from "../../src/types.ts";

/** Full MD marker, used for detection. */
export const START_HERE_MARKER = "<=Start Here:";

/** Visible cue prepended to the meristem label at render time (only on
 *  boosted meristems). Distinct from the MD marker so the trigger can be
 *  edited independently from the user-visible text. */
export const START_HERE_DISPLAY_PREFIX = "Start Here → ";

export function hasStartHerePrefix(name: string): boolean {
  return name.startsWith(START_HERE_MARKER);
}

/** Strip the FULL `<=Start Here:` marker — block.name becomes the clean
 *  canonical name. Use `displayNameForBoosted` to get the rendering form. */
export function stripStartHerePrefix(name: string): string {
  if (!hasStartHerePrefix(name)) return name;
  return name.slice(START_HERE_MARKER.length).trimStart();
}

/** The visible label form for a boosted meristem — prepends the cue. */
export function displayNameForBoosted(cleanName: string): string {
  return START_HERE_DISPLAY_PREFIX + cleanName;
}

/**
 * Walk the plant once, strip the full marker from any meristem block
 * names in place, and return the set of branch IDs whose meristem carried
 * the marker. MUST be called before render and before the cascade reads
 * block.name (i.e. right after `hydrateFrozenPlant`).
 *
 * Mutates: `block.name` on each prefixed meristem (full marker → clean).
 *
 * Returns: a Set of branch IDs that should receive the start-here boost.
 * Pass into `cascade-pass.startHereBranchIds` so subtreeNormFor lifts
 * them, AND into `renderPlant` (via RenderOptions.boostedBranchIds) so
 * the renderer prepends the visible cue.
 */
export function extractStartHereBranches(plant: Plant): Set<string> {
  const out = new Set<string>();
  for (const block of plant.blocks) {
    if (block.kind !== "meristem") continue;
    if (!("name" in block)) continue;
    if (!hasStartHerePrefix(block.name)) continue;
    out.add(block.branchId);
    block.name = stripStartHerePrefix(block.name);
  }
  return out;
}
