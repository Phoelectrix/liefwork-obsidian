// The coral's right-click menu: the pure prune rule (unit-tested below the
// fold in test/coral-menu.test.ts) plus the thin live wiring that applies it to
// an Obsidian Menu. Type-only Obsidian import, so the rule stays unit-testable.

import type { Menu } from "obsidian";

/** What the prune rule needs to know about one contributed menu entry. */
export interface ContributedEntry {
  isSeparator: boolean;
  title: string;
}

/** A terminal command that isn't ours. The coral menu carries exactly ONE
 *  terminal command — Liefwork's "Open agent terminal here", which we add
 *  ourselves — so any terminal command arriving through the `file-menu` event
 *  is a foreign one (in practice the community Terminal plugin's three
 *  profiles). They stay available in the file explorer, where the menu isn't
 *  competing with the coral's own commands. Title-matched: no plugin declares
 *  its identity on a menu item, so the visible word is the only signal there
 *  is. A localised Obsidian degrades to the old behaviour (the items stay),
 *  never to a broken menu. */
function isForeignTerminalCommand(title: string): boolean {
  return /terminal/i.test(title);
}

/** The entries to keep out of the region a menu trigger appended, in order:
 *  foreign terminal commands dropped, then the separators that lost their
 *  purpose (leading — the coral already closes its own items with one —
 *  trailing, and runs of them). Survivors are returned as the SAME objects
 *  passed in, so a caller can splice them straight back into a live menu. */
export function keepContributedEntries<T>(
  region: readonly T[],
  describe: (entry: T) => ContributedEntry,
): T[] {
  const kept: T[] = [];
  let lastKeptWasSeparator = true; // "true" at the head → a leading separator drops
  for (const entry of region) {
    const { isSeparator, title } = describe(entry);
    if (isSeparator) {
      if (lastKeptWasSeparator) continue;
      lastKeptWasSeparator = true;
      kept.push(entry);
      continue;
    }
    if (isForeignTerminalCommand(title)) continue;
    lastKeptWasSeparator = false;
    kept.push(entry);
  }
  // Trailing separator: nothing of ours follows it.
  if (kept.length > 0 && lastKeptWasSeparator) kept.pop();
  return kept;
}

// ── Live wiring (thin; founder-verified in the vault) ─────────────────────

/** A Menu's own item list — not in the public API, so read defensively. */
// Private API: `Menu.items` is the only handle on what a `file-menu` trigger appended (contributors are anonymous — no item carries the plugin that added it). Fully optional-typed: any Obsidian refactor makes the prune a no-op — the menu simply keeps the foreign terminal commands it shows today — never a crash.
interface MenuInternals {
  items?: unknown[];
}
interface MenuItemInternals {
  titleEl?: { textContent?: string | null } | null;
}

const itemsOf = (menu: Menu): unknown[] | null => {
  const items = (menu as unknown as MenuInternals).items;
  return Array.isArray(items) ? items : null;
};

/** How many entries a menu holds right now — snapshot this before firing a
 *  trigger to know where the contributed region starts. */
export function menuEntryCount(menu: Menu): number {
  return itemsOf(menu)?.length ?? 0;
}

/** Apply {@link keepContributedEntries} to everything a trigger appended from
 *  `fromIndex` on. A separator has no `titleEl`; that is how we tell the two
 *  entry kinds apart without the public API naming either. */
export function pruneContributedEntries(menu: Menu, fromIndex: number): void {
  const items = itemsOf(menu);
  if (!items || fromIndex >= items.length) return;
  const region = items.slice(fromIndex);
  const kept = keepContributedEntries(region, (entry) => {
    const titleEl = (entry as MenuItemInternals | null)?.titleEl;
    return { isSeparator: !titleEl, title: titleEl?.textContent ?? "" };
  });
  if (kept.length !== region.length) items.splice(fromIndex, region.length, ...kept);
}
