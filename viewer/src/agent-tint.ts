import { type Plant } from "../../src/types.ts";

/** Resolve per-branch agent colors (keyed by branch folder path) to the draw-time
 *  lookups the skeleton renderer needs: meristem label (by block id) + stem (by
 *  branch id). Each branch carries the LIST of its agent colors (≥2 when several
 *  terminals run on one branch — the renderer combines them). Only the branch's
 *  own meristem + stem are tinted. */
export function resolveAgentTints(
  plant: Plant,
  colorsByPath: Map<string, string[]>,
): { meristemColorsByBlockId: Map<string, string[]>; stemColorsByBranchId: Map<string, string[]> } {
  const meristemColorsByBlockId = new Map<string, string[]>();
  const stemColorsByBranchId = new Map<string, string[]>();
  if (colorsByPath.size === 0) return { meristemColorsByBlockId, stemColorsByBranchId };
  for (const block of plant.blocks) {
    if (block.kind !== "meristem") continue;
    const hid = (block as { hierarchyId?: string }).hierarchyId ?? "";
    const colors = colorsByPath.get(hid);
    if (!colors || colors.length === 0) continue;
    meristemColorsByBlockId.set(block.id, colors);
    stemColorsByBranchId.set(block.branchId, colors);
  }
  return { meristemColorsByBlockId, stemColorsByBranchId };
}
