import type { Bounds } from "../../src/types.ts";

/** Expand a bounds about its centre by `factor` (1.2 = +20% margin around it).
 *  Used to frame a branch "wider than a tight fit" on single-click. */
export function expandBounds(b: Bounds, factor: number): Bounds {
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const hw = ((b.max.x - b.min.x) / 2) * factor;
  const hh = ((b.max.y - b.min.y) / 2) * factor;
  return { min: { x: cx - hw, y: cy - hh }, max: { x: cx + hw, y: cy + hh } };
}
