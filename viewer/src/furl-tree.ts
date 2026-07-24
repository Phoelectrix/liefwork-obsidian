// Pure furl-tree helpers — the "brain" of the render gate (Task 5) and click
// routing (Task 7) for the default-off "unfurling" progressive-disclosure
// capability. No DOM, no canvas: operates only over `Plant` + the affordance
// markers from unfurl-affordance.ts, so it's exhaustively unit-testable and
// safe for both mount code and future non-DOM contexts to share.
import type { Plant, Block } from "../../src/types.ts";
import { isAffordanceBlock, isExpandAffordance, isFurlAffordance } from "./unfurl-affordance.ts";

export interface FurlState {
  enabled: boolean;
  furled: ReadonlySet<string>;
}

/** Build the parentBranchId -> direct child branch ids adjacency map, same
 *  idiom as src/library/passes/place.ts's `childrenOf` construction. */
function buildChildrenOf(plant: Plant): Map<string | null, string[]> {
  const childrenOf = new Map<string | null, string[]>();
  for (const b of plant.branches) {
    const arr = childrenOf.get(b.parentBranchId) ?? [];
    arr.push(b.id);
    childrenOf.set(b.parentBranchId, arr);
  }
  return childrenOf;
}

/** Branches with a direct child branch — the only branches that can be furled. */
export function furlableBranchIds(plant: Plant): Set<string> {
  const childrenOf = buildChildrenOf(plant);
  const result = new Set<string>();
  for (const b of plant.branches) {
    const kids = childrenOf.get(b.id);
    if (kids && kids.length > 0) result.add(b.id);
  }
  return result;
}

/** Furlable branches with depth >= initialDepth (landing seed). */
export function seedFurledByDepth(plant: Plant, initialDepth: number): Set<string> {
  const furlable = furlableBranchIds(plant);
  const byId = new Map(plant.branches.map((b) => [b.id, b] as const));
  const result = new Set<string>();
  for (const id of furlable) {
    const branch = byId.get(id);
    if (branch && branch.depth >= initialDepth) result.add(id);
  }
  return result;
}

/** Direct child branch ids of a branch (one level). */
export function directChildBranchIds(plant: Plant, branchId: string): string[] {
  const childrenOf = buildChildrenOf(plant);
  return [...(childrenOf.get(branchId) ?? [])];
}

/** Strict descendants of any furled branch (a fully-hidden branch → stem culled). */
export function hiddenBranchIds(plant: Plant, furled: ReadonlySet<string>): Set<string> {
  const childrenOf = buildChildrenOf(plant);
  const result = new Set<string>();

  const collectDescendants = (branchId: string): void => {
    for (const childId of childrenOf.get(branchId) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        collectDescendants(childId);
      }
    }
  };

  for (const branchId of furled) collectDescendants(branchId);
  return result;
}

/** Per-BLOCK cull set for bodies/rays/labels + cascade. A block is HIDDEN when:
 *  - !enabled  → every affordance block (they exist only in the site bundle);
 *  - its branch is a strict descendant of a furled branch;
 *  - its branch is furled AND it is neither the meristem nor the expand-affordance
 *    (i.e. the furled branch's own content liefs + its furl-affordance);
 *  - its branch is NOT furled AND it is the expand-affordance (shown only furled). */
export function hiddenBlockIds(plant: Plant, state: FurlState): Set<string> {
  const hiddenBranches = hiddenBranchIds(plant, state.furled);
  const result = new Set<string>();

  for (const block of plant.blocks) {
    if (!state.enabled) {
      if (isAffordanceBlock(block)) result.add(block.id);
      continue;
    }

    if (hiddenBranches.has(block.branchId)) {
      result.add(block.id);
      continue;
    }

    const branchFurled = state.furled.has(block.branchId);
    if (branchFurled) {
      if (block.kind !== "meristem" && !isExpandAffordance(block)) {
        result.add(block.id);
      }
    } else if (isExpandAffordance(block)) {
      result.add(block.id);
    }
  }

  return result;
}

/** Pure furl transitions the mount handle delegates to. */
export function unfurlOneLevel(
  plant: Plant,
  furled: ReadonlySet<string>,
  branchId: string,
): Set<string> {
  const next = new Set(furled);
  next.delete(branchId);
  for (const childId of directChildBranchIds(plant, branchId)) {
    next.add(childId);
  }
  return next;
}

export function furlBranch(furled: ReadonlySet<string>, branchId: string): Set<string> {
  const next = new Set(furled);
  next.add(branchId);
  return next;
}

export type ClickIntent = "expand-only" | "expand-and-open" | "furl" | "normal" | "none";

/** Decide what a click on `block` means, given furl state. Marker + kind drive it:
 *  expand-affordance → "expand-only"; furl-affordance → "furl";
 *  meristem of a furled branch → "expand-and-open"; else "normal". */
export function clickIntentFor(block: Block, state: FurlState): ClickIntent {
  if (!state.enabled) return "normal";
  if (isFurlAffordance(block)) return "furl";
  if (isExpandAffordance(block)) return "expand-only";
  if (block.kind === "meristem" && state.furled.has(block.branchId)) return "expand-and-open";
  return "normal";
}
