/** Pure interaction policy for the plant view — no Obsidian imports so it unit
 *  tests in isolation. The view resolves its placement + toggle, then asks these
 *  helpers what to do. Design: see the "Click model + coral placement" note.
 */

export type PlantPlacement = "sidebar" | "main" | "popout";

/** Default HUD ("Preview") visibility for a placement.
 *
 *  Sidebar → OFF: the coral replaces the file explorer, so a clicked note opens
 *  in the main editor area right beside it — the inline HUD is redundant (and its
 *  accidental opens were the reported annoyance). Main-area tab or pop-out window
 *  → ON: the coral is the only surface, so the inline preview/edit HUD earns its
 *  place. A user "Preview" toggle overrides this (see effectiveHudEnabled). */
export function hudDefaultForPlacement(placement: PlantPlacement): boolean {
  return placement !== "sidebar";
}

/** The HUD's effective on/off state: an explicit user toggle wins; otherwise the
 *  placement default. `override` is null when the user hasn't toggled. */
export function effectiveHudEnabled(
  placement: PlantPlacement,
  override: boolean | null,
): boolean {
  return override ?? hudDefaultForPlacement(placement);
}

/** What a placement change must do to the HUD, given the user's override.
 *
 *  A coral can change placement WITHOUT being rebuilt — dragging its tab from
 *  the sidebar into the main area moves the leaf inside one window, so neither
 *  `ensureShell` (the shell already exists) nor `rerender` (nothing asked for
 *  one) runs, and those are the only two places the HUD chrome is derived. The
 *  Preview control then kept the label it was born with while `hudEnabled()`
 *  had flipped underneath it: founder, 5 Aug — it read "Preview off" while the
 *  HUD opened on every click. Same shape as the 22 July window-migration
 *  freeze, reached by a second door.
 *
 *  **A move never changes the mode.** Re-deriving the label truthfully was only
 *  half the fix: with the label honest, the flip itself became visible, and it
 *  was still wrong ("Preview is visibly turned on… better if it stays off").
 *  A placement DEFAULT decides how a coral OPENS in that spot — it has no
 *  business reaching into a coral already on screen and changing a mode the
 *  user can see. So a move with no explicit override adopts the OUTGOING
 *  effective state as one (`adoptOverride`), pinning what was showing; a coral
 *  that already carries a user choice is left alone, since there is nothing to
 *  preserve that isn't already preserved.
 *
 *  `prev === null` is a coral being BUILT, not moved: it adopts nothing, or
 *  every coral would pin an override the moment it opened and the placement
 *  defaults would never apply again. */
export function hudPlacementChange(
  prev: PlantPlacement | null,
  next: PlantPlacement,
  override: boolean | null,
): { resync: boolean; adoptOverride: boolean | null } {
  if (prev === next) return { resync: false, adoptOverride: null };
  const adopt = prev !== null && override === null ? effectiveHudEnabled(prev, null) : null;
  return { resync: true, adoptOverride: adopt };
}

/** What a node gesture does.
 *
 *  Double-click FITS the node's branch (zoom-to-fit, as Reveal-in-coral does).
 *  It used to open the note — but that is exactly what single-click does when
 *  the HUD is off, so in the sidebar the gesture was inert: it cancelled the
 *  pending single-click, then opened the very same note. Framing was otherwise
 *  reachable only from a command/menu, so the spare gesture now carries it.
 *  With the HUD on, the note stays one click away via the HUD's "Open note ↗".
 *
 *  Single-click opens the note when the HUD is off (file-explorer parity — one
 *  click opens), or previews via the HUD when it's on. */
export function nodeAction(
  hudEnabled: boolean,
  gesture: "single" | "double",
): "open" | "hud" | "fit" {
  if (gesture === "double") return "fit";
  return hudEnabled ? "hud" : "open";
}

/** Does a coral rooted at `folderPath` contain `filePath`? The vault-root coral
 *  ("/") contains everything; otherwise the file must be the folder itself or
 *  live directly beneath it. Used to match a note to an already-open coral —
 *  including a deferred leaf, whose folder we read from its saved view state
 *  (so we can't call the live view's own containsPath). */
export function folderContains(folderPath: string, filePath: string): boolean {
  if (folderPath === "/") return true;
  return filePath === folderPath || filePath.startsWith(folderPath + "/");
}

/** Does a rename event belong to any open coral? A rename carries both the OLD
 *  and the NEW path, and either side matching counts. Checking the old path is
 *  not optional: when the user renames an open coral's OWN root folder, the
 *  view state still holds the pre-rename `folderPath`, so only the old path
 *  matches — a new-path-only guard would skip the coral's own folder-note sync. */
export function renameInOpenCoral(
  coralFolderPaths: Iterable<string>,
  oldPath: string,
  newPath: string,
): boolean {
  for (const fp of coralFolderPaths) {
    if (folderContains(fp, oldPath) || folderContains(fp, newPath)) return true;
  }
  return false;
}

/** After a watcher rebuild (`mount.update`, which clears the canvas selection),
 *  decide the fate of the view's current HUD selection:
 *   - `"reselect"` — the selected node still exists in the new tree, so re-apply
 *     the canvas highlight and keep the HUD (preserving any half-typed draft);
 *   - `"clear"`    — it's gone (deleted/renamed/moved) OR nothing was selected,
 *     so drop `selectedNode` and close the HUD (no stale HUD lingering).
 *  Matched by stable node path (`hierarchyId`), never by position. */
export function selectionAfterRefresh(
  selectedPath: string | null,
  newTreePaths: Iterable<string>,
): "reselect" | "clear" {
  if (selectedPath === null) return "clear";
  for (const p of newTreePaths) if (p === selectedPath) return "reselect";
  return "clear";
}

/** Must a note-open re-anchor the workspace's active leaf to the coral's own
 *  leaf before `getLeaf("tab")`? getLeaf resolves against the app-global active
 *  leaf — and clicking a coral's CANVAS never moves leaf focus, so with a
 *  pop-out coral the active leaf can be a leaf in ANOTHER window entirely. The
 *  editor then opens over there and steals OS focus from the coral's window
 *  (16 July: a pop-out's new-branch starter lief opened in the main window; the
 *  occluded pop-out's rAF paused; the rebuild painted nothing until refocus).
 *  Same-window active leaf keeps today's behaviour — the tab lands beside the
 *  most recent editor, not on top of the coral. Sidebar placement has its own
 *  main-area routing (see leafForNoteOpen) and never re-anchors. */
export function noteOpenNeedsReanchor(
  placement: PlantPlacement,
  activeLeafInSameWindow: boolean,
): boolean {
  return placement !== "sidebar" && !activeLeafInSameWindow;
}

/** Must a watcher refresh be deferred (pendingRefresh) instead of run now?
 *  Two independent reasons, and BOTH matter:
 *   - zero layout size — a background TAB (display:none) has clientWidth 0;
 *   - a HIDDEN document — an occluded/minimised WINDOW keeps its layout size,
 *     but its rAF is paused (measured: 48 ticks/s visible vs ~0 hidden), so a
 *     rebuild would run, paint nothing, and leave camera moves queued on the
 *     dead rAF to replay stale — black over-zoomed frame — on refocus.
 *  Deferred refreshes replay via applyPendingIfVisible (active-leaf-change,
 *  onResize, and the one-shot visibilitychange listener armed at defer time). */
export function shouldDeferRefresh(
  clientWidth: number,
  clientHeight: number,
  visibilityState: string,
): boolean {
  return clientWidth <= 0 || clientHeight <= 0 || visibilityState === "hidden";
}

/** Which paths a vault create/delete/rename should record for a debounced plant
 *  rebuild. `oldPath` is present only on renames. `newAppears` is true when the
 *  new file can appear in the coral — a folder, a markdown file, or (in
 *  all-files mode) any file. `allFiles` reflects the display setting.
 *
 *  The subtlety: renaming a note (`note.md` → `note.txt`) makes the new file
 *  non-md AND (in notes-only mode) non-appearing, but its old `.md` path still
 *  has a live node that must be pruned — so a `.md` `oldPath` is always
 *  recorded even when `newAppears` is false. In all-files mode a non-md old
 *  path is pruned too. A folder rename records its (non-md) old path since
 *  nodes lived beneath it. */
export function pathsForVaultChange(
  newAppears: boolean,
  newPath: string,
  oldPath?: string,
  allFiles = false,
): string[] {
  const paths: string[] = [];
  if (newAppears) {
    paths.push(newPath);
    if (typeof oldPath === "string") paths.push(oldPath);
  } else if (typeof oldPath === "string" && (allFiles || oldPath.endsWith(".md"))) {
    paths.push(oldPath);
  }
  return paths;
}

/** Whether a branch (folder) can be demoted back to a single note: true only
 *  when the folder holds EXACTLY its own folder-note and nothing else. Any other
 *  child (a real lief, a sub-branch, a non-md file) or an empty folder with no
 *  folder-note makes it false. The caller adds the root guard (you never demote
 *  the vault root or the coral's own root folder). */
export function canDemoteBranch(childPaths: string[], folderNotePath: string): boolean {
  return childPaths.length === 1 && childPaths[0] === folderNotePath;
}

/** True when a cursor key belongs to the focused element, not the coral.
 *  Duck-typed, never instanceof: a pop-out window's elements come from THAT
 *  window's constructors, so instanceof against this realm's globals is always
 *  false there (the standing per-window law) — tagName survives. */
export function shouldIgnoreCursorKey(target: HTMLElement | null): boolean {
  if (!target) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/** What an arrow key should do in the coral. The keyboard cursor is a
 *  PREVIEW-mode feature — it moves a highlight and opens the HUD to preview it —
 *  so it "act"s only when the HUD is enabled and the key doesn't belong to a
 *  focused text field. With preview OFF (the explorer-like mode: a click just
 *  opens the note), or inside a compose field, it "passthrough"s: the handler
 *  must NOT consume the key or move the cursor, so an inert arrow neither drags
 *  the HUD back into view nor walks from a stale/null selection. */
export function cursorKeyAction(
  hudEnabled: boolean,
  target: HTMLElement | null,
): "act" | "passthrough" {
  if (shouldIgnoreCursorKey(target)) return "passthrough";
  if (!hudEnabled) return "passthrough";
  return "act";
}

const HUD_IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
]);

/** How the node HUD should present a file, by extension.
 *
 *  Only markdown may be read as text and rendered — feeding any other file's
 *  bytes to `cachedRead` + `MarkdownRenderer` decodes binary as UTF-8, which
 *  paints wingding garbage in the main window and CRASHES a pop-out window's
 *  renderer process (its async post-processors touch that window's realm).
 *  Images get an inline `<img>` preview from the vault resource path; every
 *  other kind gets a name/type card and is never opened as text. */
export function classifyHudFile(extension: string): "markdown" | "image" | "other" {
  const ext = extension.toLowerCase();
  if (ext === "md") return "markdown";
  return HUD_IMAGE_EXTENSIONS.has(ext) ? "image" : "other";
}
