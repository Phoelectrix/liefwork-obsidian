import type { HierarchyNode } from "../../src/types.ts";

/**
 * The HUD's "Next item" reading walk over the coral, as a flat list of node ids
 * (vault paths). Pre-order: at each branch the **meristem first** (the node
 * itself), then its children **oldest → newest**, recursing into any child
 * branch (its meristem, then its liefs) before the parent continues. Stepping
 * one index forward = the next item; descending into a sub-branch and returning
 * to the parent both fall out of the flattened pre-order automatically.
 */
export function traversalOrder(root: HierarchyNode): string[] {
  const out: string[] = [];
  const walk = (n: HierarchyNode): void => {
    out.push(n.id);
    if (n.children && n.children.length > 0) {
      for (const c of sortChildren(n.children)) walk(c);
    }
  };
  walk(root);
  return out;
}

/**
 * Sort siblings by the engine's structure-pass rule (oldest → newest / base →
 * tip), so the walk matches what the coral renders. Mirrors
 * `src/library/passes/structure.ts` (`sortChildren`, ~lines 63-74): by `order`
 * ascending iff EVERY child carries a finite order (a half-migrated branch keeps
 * its createdAt ordering until all children have `order`, then flips), else by
 * createdAt (localeCompare, missing → ""), with `name` as the final tiebreaker.
 */
function sortChildren(children: HierarchyNode[]): HierarchyNode[] {
  const useOrder = children.length > 0 && children.every((c) => c.order != null);
  return [...children].sort((a, b) => {
    if (useOrder) {
      const d = (a.order ?? 0) - (b.order ?? 0);
      if (d !== 0) return d;
    }
    const c = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    if (c !== 0) return c;
    return a.name.localeCompare(b.name);
  });
}

/** Candidate ids for one cursor step, nearest first. The caller tries them in
 *  order and takes the first that still resolves in the current plant (ids can
 *  vanish between rebuilds), which is why this returns a LIST and not an id.
 *  Clamps at both ends — the cursor never wraps. With no current selection a
 *  forward step starts at the base of the walk and a backward step at the tip. */
export function stepTraversal(
  ids: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string[] {
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return dir === 1 ? [...ids] : [...ids].reverse();
  const rest = dir === 1 ? ids.slice(i + 1) : ids.slice(0, i).reverse();
  return [...rest];
}
