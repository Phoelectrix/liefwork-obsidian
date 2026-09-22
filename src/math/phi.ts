import { INV_PHI } from "../constants.ts";

/**
 * Assign departure angles to n siblings using per-side geometric decay.
 *
 * - With `alternate = true`, siblings alternate sides by index (0 left, 1 right,
 *   2 left, …). Each side runs its own independent decay sequence seeded by
 *   `firstAngleDegrees`, so the plant is symmetrical by construction: a pair of
 *   siblings at equivalent side-local positions share magnitude.
 * - With `alternate = false`, every sibling is on the positive side and the
 *   sequence decays by absolute index.
 * - `flipFirst` negates every angle in the output, so the first sibling lands
 *   on the opposite side. Callers use this to steer first-children away from
 *   their grandparent chain (avoids the curl-back that otherwise arises when
 *   every "first child" is always positive).
 * - `minAngle` (degrees, default 0 = off) floors every magnitude, so a decaying
 *   fan tightens toward the floor instead of collapsing onto the parent stem.
 *   Never raises a magnitude above the seed.
 *
 * Fixed-angle assignment is handled by the caller (the angle pass); this
 * helper is phi-sequence-only.
 */
export function siblingAngles(
  n: number,
  firstAngleDegrees: number,
  alternate: boolean,
  decay: number = INV_PHI,
  flipFirst: boolean = false,
  minAngle: number = 0,
): number[] {
  if (n <= 0) return [];
  const out: number[] = new Array<number>(n);
  const floor = Math.min(minAngle, firstAngleDegrees);
  const mag = (k: number): number => Math.max(firstAngleDegrees * Math.pow(decay, k), floor);
  if (alternate) {
    let leftIdx = 0;
    let rightIdx = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) {
        out[i] = mag(leftIdx);
        leftIdx++;
      } else {
        out[i] = -mag(rightIdx);
        rightIdx++;
      }
    }
  } else {
    for (let i = 0; i < n; i++) out[i] = mag(i);
  }
  if (flipFirst) for (let i = 0; i < n; i++) out[i] = -out[i]!;
  return out;
}
