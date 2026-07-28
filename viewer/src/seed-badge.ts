import { type Plant } from "../../src/types.ts";

/** Resolve seeded-coral-root folder paths to the draw-time lookup the skeleton
 *  renderer needs: the SET of meristem block ids to badge. Mirrors
 *  `resolveAgentTints` (agent-tint.ts) — same path→block-id resolution, just a
 *  membership set instead of a colour map (the badge reuses the label's own
 *  colour; there's nothing else to carry). Only a folder's own meristem is
 *  badged — sub-corals (a meristem whose path isn't in `paths`) never match. */
export function resolveSeedBadges(plant: Plant, paths: ReadonlySet<string>): Set<string> {
  const blockIds = new Set<string>();
  if (paths.size === 0) return blockIds;
  for (const block of plant.blocks) {
    if (block.kind !== "meristem") continue;
    const hid = (block as { hierarchyId?: string }).hierarchyId ?? "";
    if (paths.has(hid)) blockIds.add(block.id);
  }
  return blockIds;
}
