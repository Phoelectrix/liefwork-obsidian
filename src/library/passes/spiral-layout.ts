import type { EngineConfig } from "../types.ts";
import type { StructureOutput } from "./structure.ts";

/** Re-lay-out every archive branch as an inward spiral: swap its curve to a
 *  spiral CurveSpec, lean it downward (bottommost), taper node sizes toward the
 *  centre, force one-sided labels, and label the meristem "Archive". Runs right
 *  after sizePass so the tapered sizes feed growth-block clearance + placement.
 *  Pure w.r.t. non-archive branches (left untouched). */
export function spiralLayoutPass(s: StructureOutput, _config: EngineConfig): StructureOutput {
  const blockById = new Map(s.blocks.map((b) => [b.id, b]));
  for (const br of s.branches) {
    if (!br.isArchive) continue;

    // Lean the coil downward off its parent (bottommost). Tunable.
    br.departureAngle = Math.PI * 0.8;

    // Swap to a spiral curve. startRadius scales with the branch's arcLength so
    // the coil is proportionate; handedness curls toward the interior (toward
    // the stem side opposite the branch's departure — tuned live).
    br.curve = {
      type: "spiral",
      arcLength: br.arcLength,
      originAngle: br.curve.originAngle, // placePass overwrites this from the parent
      spiral: {
        turns: 2.5,
        startRadius: Math.max(br.arcLength * 0.5, br.shortSide * 4),
        shrink: 1.6,
        handedness: 1,
      },
    };

    // Taper node sizes toward the meristem and force one-sided labels + the name.
    const blocks = br.blockIds.map((id) => blockById.get(id)!).filter(Boolean);
    const n = blocks.length;
    for (let i = 0; i < n; i++) {
      const blk = blocks[i]!;
      const t = n > 1 ? i / (n - 1) : 0;
      const taper = 1 - 0.6 * t; // 1.0 at base → 0.4 at tip (tunable)
      blk.shortSide = blk.shortSide * taper;
      if (blk.kind === "lief") (blk as { side: "left" | "right" }).side = "left";
      if (blk.kind === "meristem") (blk as { name: string }).name = "Archive";
    }
  }
  return s;
}
