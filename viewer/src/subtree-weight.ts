/** Structural input — both Plant types (src/types.ts and src/library/types.ts)
 *  satisfy it, so the helper serves mount-plant and Studio alike. */
export interface WeightablePlant {
  blocks: ReadonlyArray<{ kind: string; branchId: string }>;
  branches: ReadonlyArray<{ id: string; parentBranchId: string | null }>;
}

/**
 * Per-branch subtree weight, log-normalised to [0, 1] — the SAME definition
 * the cascade pass uses for stem width and title boost (cascade-pass.ts
 * `subtreeNormFor`, minus its start-here sibling lift): descendant count =
 * liefs + meristems in the branch and everything beneath it;
 * norm = log10(count + 1) / log10(max + 1). The root is 1.
 *
 * Pure and plant-level, so plant-time consumers (the projection map — the
 * weight-proportional meristem ray) can read weight without the cascade's
 * per-frame machinery.
 */
export function subtreeNormByBranch(plant: WeightablePlant): Map<string, number> {
  const own = new Map<string, number>();
  for (const b of plant.blocks) {
    if (b.kind !== "lief" && b.kind !== "meristem") continue;
    own.set(b.branchId, (own.get(b.branchId) ?? 0) + 1);
  }
  const children = new Map<string, string[]>();
  for (const br of plant.branches) {
    if (br.parentBranchId == null) continue;
    const list = children.get(br.parentBranchId) ?? [];
    list.push(br.id);
    children.set(br.parentBranchId, list);
  }
  const count = new Map<string, number>();
  const countFor = (id: string): number => {
    const cached = count.get(id);
    if (cached !== undefined) return cached;
    let c = own.get(id) ?? 0;
    for (const cid of children.get(id) ?? []) c += countFor(cid);
    count.set(id, c);
    return c;
  };
  let max = 0;
  for (const br of plant.branches) max = Math.max(max, countFor(br.id));
  const logMax = Math.log10(max + 1);
  const norm = new Map<string, number>();
  for (const br of plant.branches) {
    norm.set(br.id, logMax > 0 ? Math.log10(countFor(br.id) + 1) / logMax : 0);
  }
  return norm;
}
