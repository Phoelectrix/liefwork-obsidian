import type { Block } from "../types.ts";

/** FNV-1a hash, 32-bit. Stable across runs and platforms. */
export function hashBlockId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Returns a () => number generator producing [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/** Bake per-block disappearance tags onto Liefs and Meristems. Mutates blocks
 *  in place. Idempotent (running twice produces identical tags). Other block
 *  kinds (BranchNode, Spacer, GrowthBlock) are skipped.
 *
 *  @param importanceByHierarchyId  Optional map from hierarchyId → importance
 *  in [0, 1]. When present and the block has a matching hierarchyId, the
 *  importance is copied through to tag.importance.
 */
export function tagPass(
  blocks: Block[],
  importanceByHierarchyId: Record<string, number> | undefined,
): void {
  for (const b of blocks) {
    if (b.kind !== "lief" && b.kind !== "meristem") continue;
    const random = mulberry32(hashBlockId(b.id))();
    const importance = importanceByHierarchyId?.[b.hierarchyId];
    (b as { tag: { random: number; importance?: number } }).tag = importance !== undefined
      ? { random, importance }
      : { random };
  }
}
