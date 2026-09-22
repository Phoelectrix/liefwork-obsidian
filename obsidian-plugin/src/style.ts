import type { EngineConfig } from "../../src/library/index.ts";

/** The coral's branching style (22 Sept 2026). "default" = the shipped uniform
 *  fan — every sibling departs at 60°, the LOCKED geometry, byte-for-byte.
 *  "organic" = a wider first angle with capped decay: siblings and depths
 *  tighten toward the floor, so a dense fan reads as a plant, not a comb.
 *  Two options, not sliders: the numbers are the founder's, tuned on the dev
 *  panel; the panel's engine group still overrides either for a session. */
export type CoralStyle = "default" | "organic";

/** Persisted value → style. Anything unrecognised (including absent — every
 *  existing data.json) is default, so nothing moves for existing users. */
export function resolveStyle(raw: unknown): CoralStyle {
  return raw === "organic" ? "organic" : "default";
}

/** The organic delta over the shipped `angles` block. 85° seeds the root fan;
 *  0.95 decays both the same-side sibling sequence and each depth's seed (the
 *  third level seeds near 60°, the shipped uniform angle — the two styles are
 *  one family); 45° floors both so no branch can lean onto its parent. */
export const ORGANIC_ANGLES: Pick<EngineConfig["angles"], "firstBranchAngle" | "angleDecay"> & { minBranchAngle: number } = {
  firstBranchAngle: 85,
  angleDecay: 0.95,
  minBranchAngle: 45,
};
