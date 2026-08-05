/**
 * Pure frontmatter/ordering helpers — parse `created`/`order`, derive the next
 * order, build a new lief's content. Obsidian-free (the vault reads/writes live
 * in vault-adapter.ts / plant-view.ts), so it's unit-tested. Mirrors lief-writer.ts.
 */

/** Gap between appended orders, so a later midpoint insert has room. */
export const ORDER_STEP = 10;

/** The frontmatter `created` if it's a usable date string, else the fs fallback
 *  (the file's ctime, ISO). */
export function resolveCreated(fmCreated: unknown, fallbackISO: string): string {
  if (
    typeof fmCreated === "string" &&
    fmCreated.trim() !== "" &&
    !Number.isNaN(Date.parse(fmCreated))
  ) {
    return fmCreated;
  }
  return fallbackISO;
}

/** The frontmatter `order` if it's a finite number, else undefined. */
export function resolveOrder(fmOrder: unknown): number | undefined {
  return typeof fmOrder === "number" && Number.isFinite(fmOrder) ? fmOrder : undefined;
}

/** Merge loose-lief orders and sub-branch folder-note orders into a single
 *  list for `nextOrder`. This pure helper is extracted so it can be unit-tested
 *  without the Obsidian API; `siblingOrders()` in plant-view.ts feeds it. */
export function collectBranchOrders(looseOrders: number[], subBranchOrders: number[]): number[] {
  return [...looseOrders, ...subBranchOrders];
}

/** The next per-branch order — after the current max with a gap, or the first
 *  step when the branch is empty. */
export function nextOrder(existing: number[]): number {
  if (existing.length === 0) return ORDER_STEP;
  return existing.reduce((m, o) => (o > m ? o : m), existing[0]) + ORDER_STEP;
}

/** A new lief note's content: `created` + `order` frontmatter, then the body. */
export function liefNoteContent(text: string, created: string, order: number): string {
  const fm = `---\ncreated: ${created}\norder: ${order}\n---\n\n`;
  return text ? `${fm}${text}\n` : fm;
}

/** A fresh order that re-inserts a restored item at its original position among
 *  the parent's CURRENT children: just after the closest survivor with order ≤
 *  originalOrder, midpoint to the next; tip-append when newest; below-first when
 *  it precedes all. */
export function restoreOrder(originalOrder: number, survivingSiblingOrders: number[]): number {
  const sorted = [...survivingSiblingOrders].sort((a, b) => a - b);
  const prev = sorted.filter((o) => o <= originalOrder).pop();
  const next = sorted.find((o) => o > originalOrder);
  if (prev == null) return next != null ? Math.min(originalOrder, next - 1) : ORDER_STEP;
  if (next == null) return prev + ORDER_STEP;
  return next - prev > 1 ? Math.floor((prev + next) / 2) : prev + ORDER_STEP;
}
