/** Pure state machine for the coral's cmd/ctrl-click multi-selection.
 *
 *  Invariants (spec 2026-07-20, founder decisions):
 *  - A selection is HOMOGENEOUS — all liefs (notes) or all branches
 *    (meristems/folders), never mixed. Folders ARE branches, so a mixed set
 *    has no crisp meaning: a branch already contains its notes. An additive
 *    click of the other kind cancels the prior set and starts fresh.
 *  - A branch set holds INDEPENDENT SUBTREES only — no member is an ancestor
 *    of another. Adding a covered descendant is a no-op (the parent's
 *    highlight already says "all of this"); adding an ancestor absorbs the
 *    members it covers. Bulk move/delete therefore always acts on independent
 *    subtrees — the stale-child-path ambiguity of nested moves can never be
 *    constructed.
 *
 *  Pure + Obsidian-free so the whole rule set unit-tests without a workspace;
 *  `NodeRef` (viewer/src/mount-plant.ts) is structurally a SelectionItem. */

export interface SelectionItem {
  hierarchyId: string;
  kind: "lief" | "meristem";
}

/** Is `a` a STRICT ancestor path of `b`? Meristem hierarchyIds are vault
 *  folder paths; the coral root is "/" (ancestor of everything else). Segment
 *  boundary, not string prefix — "A" is not an ancestor of "AB/x". */
export function isAncestorPath(a: string, b: string): boolean {
  if (a === b) return false;
  if (a === "/") return true;
  return b.startsWith(`${a}/`);
}

export function isInSelection(sel: readonly SelectionItem[], hierarchyId: string): boolean {
  return sel.some((s) => s.hierarchyId === hierarchyId);
}

/** One additive (cmd/ctrl) click: the next selection. Never mutates `current`;
 *  returns `current` ITSELF on a no-op so callers can cheaply detect it. */
export function toggleSelection<T extends SelectionItem>(
  current: readonly T[],
  clicked: T,
): readonly T[] {
  // Toggle-off first: re-clicking a member always removes it, whatever else holds.
  if (isInSelection(current, clicked.hierarchyId)) {
    return current.filter((s) => s.hierarchyId !== clicked.hierarchyId);
  }
  // Homogeneous sets: the OTHER kind cancels and starts a fresh set.
  if (current.length > 0 && current[0].kind !== clicked.kind) return [clicked];
  if (clicked.kind === "meristem") {
    // Covered descendant → no-op (never a lone glowing child among covered siblings).
    if (current.some((s) => isAncestorPath(s.hierarchyId, clicked.hierarchyId))) return current;
    // Ancestor → absorb the members it covers (their highlights clear).
    const kept = current.filter((s) => !isAncestorPath(clicked.hierarchyId, s.hierarchyId));
    return [...kept, clicked];
  }
  return [...current, clicked];
}

/** After a vault-change rebuild: keep only members whose path still resolves
 *  in the new plant (deleted/moved members simply leave the set). */
export function surviveRefresh<T extends SelectionItem>(
  current: readonly T[],
  livePaths: ReadonlySet<string>,
): readonly T[] {
  return current.filter((s) => livePaths.has(s.hierarchyId));
}

/** Bulk-delete menu title — a selection is homogeneous by construction. */
export function bulkDeleteTitle(kind: "lief" | "meristem", n: number): string {
  return kind === "meristem" ? `Delete ${n} branches` : `Delete ${n} notes`;
}

/** The bulk menu's build-time target list: each selected member resolved via
 *  the host's `resolve` (Obsidian file/folder lookup), dropping members that
 *  don't resolve (e.g. a member deleted/moved out from under a menu that sat
 *  open) — the exact list `showMultiNodeMenu` counts for its title and hands
 *  to the files-menu trigger. Order-preserving; a fully-unresolvable selection
 *  yields an empty list (caller's cue to skip building the menu). */
export function resolveBulkTargets<T extends SelectionItem, R>(
  selection: readonly T[],
  resolve: (item: T) => R | null,
): R[] {
  return selection.map(resolve).filter((r): r is R => r !== null);
}
