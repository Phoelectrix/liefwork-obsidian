import { test, expect } from "bun:test";
import {
  classifyHudFile,
  hudDefaultForPlacement,
  effectiveHudEnabled,
  nodeAction,
  folderContains,
  renameInOpenCoral,
  pathsForVaultChange,
  selectionAfterRefresh,
  noteOpenNeedsReanchor,
  shouldDeferRefresh,
  canDemoteBranch,
} from "../src/view-behavior.ts";
import { folderNoteSyncRename } from "../src/folder-note-sync.ts";

test("HUD default: off in the sidebar, on in main + popout", () => {
  expect(hudDefaultForPlacement("sidebar")).toBe(false);
  expect(hudDefaultForPlacement("main")).toBe(true);
  expect(hudDefaultForPlacement("popout")).toBe(true);
});

test("effectiveHudEnabled: override wins over the placement default", () => {
  // No override → placement default.
  expect(effectiveHudEnabled("sidebar", null)).toBe(false);
  expect(effectiveHudEnabled("main", null)).toBe(true);
  // Override forces the value regardless of placement.
  expect(effectiveHudEnabled("sidebar", true)).toBe(true);
  expect(effectiveHudEnabled("main", false)).toBe(false);
});

// Double-click used to open the note — exactly what single-click already does
// when the HUD is off, so in the sidebar (HUD off by default) the gesture read
// as inert: it cancelled the pending single-click and then opened the same note.
// It now frames the node's branch, a camera move otherwise reachable only via
// Reveal-in-coral. With the HUD on the note stays reachable through the HUD's
// own "Open note ↗" button, so nothing loses its way in.
test("nodeAction: double-click fits the node's branch, whatever the HUD state", () => {
  expect(nodeAction(true, "double")).toBe("fit");
  expect(nodeAction(false, "double")).toBe("fit");
});

test("nodeAction: single-click opens when HUD off (explorer parity), previews when on", () => {
  expect(nodeAction(false, "single")).toBe("open");
  expect(nodeAction(true, "single")).toBe("hud");
});

test("folderContains: vault-root coral contains every path", () => {
  expect(folderContains("/", "a.md")).toBe(true);
  expect(folderContains("/", "deep/nested/note.md")).toBe(true);
});

test("folderContains: a subfolder coral contains itself and its descendants only", () => {
  expect(folderContains("Work", "Work")).toBe(true); // the folder itself
  expect(folderContains("Work", "Work/note.md")).toBe(true);
  expect(folderContains("Work", "Work/sub/deep.md")).toBe(true);
  expect(folderContains("Work", "Play/note.md")).toBe(false);
  // Prefix collision: "Work-log" is not inside "Work".
  expect(folderContains("Work", "Work-log/note.md")).toBe(false);
});

test("renameInOpenCoral: regression — renaming the open coral's OWN root folder syncs its folder note", () => {
  // The open view's state still holds the PRE-rename folderPath ("Work"), so
  // only the OLD path matches; a new-path-only guard skipped the sync here.
  expect(renameInOpenCoral(["Work"], "Work", "Projects")).toBe(true);
  // …and with the guard passed, the folder-note sync plan does fire.
  const exists = (p: string) => p === "Projects/Work.md";
  expect(folderNoteSyncRename("Work", "Projects", exists)).toEqual({
    from: "Projects/Work.md",
    to: "Projects/Projects.md",
  });
});

test("renameInOpenCoral: an unrelated folder outside any open coral does NOT sync", () => {
  expect(renameInOpenCoral(["Work"], "Play/Old", "Play/New")).toBe(false);
  // Prefix collision stays excluded on both sides.
  expect(renameInOpenCoral(["Work"], "Work-log", "Work-archive")).toBe(false);
  // No open corals at all → never sync.
  expect(renameInOpenCoral([], "Work", "Projects")).toBe(false);
});

test("renameInOpenCoral: renames inside an open coral still match on the new path", () => {
  expect(renameInOpenCoral(["Work"], "Work/Old", "Work/New")).toBe(true);
});

test("pathsForVaultChange: an md create/delete records just the new path", () => {
  expect(pathsForVaultChange(true, "a.md")).toEqual(["a.md"]);
});

test("pathsForVaultChange: an md rename records both new and old paths", () => {
  expect(pathsForVaultChange(true, "b.md", "a.md")).toEqual(["b.md", "a.md"]);
});

test("pathsForVaultChange: a folder rename records both (non-md) paths", () => {
  expect(pathsForVaultChange(true, "New", "Old")).toEqual(["New", "Old"]);
});

test("pathsForVaultChange: renaming a note to a non-md extension still prunes its old .md path", () => {
  expect(pathsForVaultChange(false, "note.txt", "note.md")).toEqual(["note.md"]);
});

test("pathsForVaultChange: a non-md create records nothing", () => {
  expect(pathsForVaultChange(false, "image.png")).toEqual([]);
});

test("pathsForVaultChange: a non-md → non-md rename records nothing (never in the plant)", () => {
  expect(pathsForVaultChange(false, "b.png", "a.png")).toEqual([]);
});

test("pathsForVaultChange: all-files off — a NEW non-md create records nothing", () => {
  expect(pathsForVaultChange(false, "pics/x.png", undefined, false)).toEqual([]);
});

test("pathsForVaultChange: all-files on — a NEW non-md create records its path", () => {
  // The handler computes newAppears=true when allFiles is on.
  expect(pathsForVaultChange(true, "pics/x.png", undefined, true)).toEqual(["pics/x.png"]);
});

test("pathsForVaultChange: all-files on — a non-md rename records BOTH paths", () => {
  expect(pathsForVaultChange(true, "pics/b.png", "pics/a.png", true)).toEqual([
    "pics/b.png",
    "pics/a.png",
  ]);
});

test("pathsForVaultChange: back-compat — a note renamed to non-md still prunes the stale .md", () => {
  expect(pathsForVaultChange(false, "note.txt", "note.md", false)).toEqual(["note.md"]);
});

test("pathsForVaultChange: all-files on prunes a non-md old path even when the new file doesn't appear", () => {
  // newAppears=false + allFiles=true → the widened else branch records the
  // (non-md) old path so a stale image node is pruned.
  expect(pathsForVaultChange(false, "x.png", "old.png", true)).toEqual(["old.png"]);
});

test("selectionAfterRefresh: reselect when the selected node still exists in the new tree", () => {
  expect(selectionAfterRefresh("Work/note.md", ["Work", "Work/note.md", "Work/other.md"])).toBe(
    "reselect",
  );
});

test("selectionAfterRefresh: clear when the selected node is gone (deleted/renamed/moved)", () => {
  expect(selectionAfterRefresh("Work/note.md", ["Work", "Work/other.md"])).toBe("clear");
});

test("selectionAfterRefresh: clear when nothing was selected (no stale HUD to keep)", () => {
  expect(selectionAfterRefresh(null, ["Work", "Work/note.md"])).toBe("clear");
});

test("selectionAfterRefresh: clear against an empty tree", () => {
  expect(selectionAfterRefresh("Work/note.md", [])).toBe("clear");
});

// ── The pop-out create-a-branch jank (16 July): two pure decisions ──────────

test("noteOpenNeedsReanchor: re-anchor when the active leaf lives in ANOTHER window", () => {
  // getLeaf("tab") resolves against the app-global active leaf; clicking a
  // pop-out coral's canvas never moves leaf focus, so the editor opened in the
  // MAIN window and stole focus from the pop-out.
  expect(noteOpenNeedsReanchor("popout", false)).toBe(true);
  expect(noteOpenNeedsReanchor("main", false)).toBe(true);
});

test("noteOpenNeedsReanchor: same window → keep today's behaviour (reuse the active context)", () => {
  expect(noteOpenNeedsReanchor("popout", true)).toBe(false);
  expect(noteOpenNeedsReanchor("main", true)).toBe(false);
});

test("noteOpenNeedsReanchor: sidebar keeps its own main-area routing, never re-anchors", () => {
  expect(noteOpenNeedsReanchor("sidebar", false)).toBe(false);
  expect(noteOpenNeedsReanchor("sidebar", true)).toBe(false);
});

test("shouldDeferRefresh: zero-size view defers (background tab)", () => {
  expect(shouldDeferRefresh(0, 0, "visible")).toBe(true);
});

test("shouldDeferRefresh: HIDDEN document defers even at full size — a hidden window's rAF is paused, so a rebuild would never paint and queued camera moves replay stale on refocus", () => {
  expect(shouldDeferRefresh(1280, 760, "hidden")).toBe(true);
});

test("shouldDeferRefresh: visible document at real size runs now", () => {
  expect(shouldDeferRefresh(1280, 760, "visible")).toBe(false);
});

test("canDemoteBranch: a folder holding only its folder-note → true", () => {
  expect(canDemoteBranch(["Work/Work.md"], "Work/Work.md")).toBe(true);
});

test("canDemoteBranch: folder-note + another note → false (would orphan)", () => {
  expect(canDemoteBranch(["Work/Work.md", "Work/task.md"], "Work/Work.md")).toBe(false);
});

test("canDemoteBranch: a single child that is NOT the folder-note → false", () => {
  expect(canDemoteBranch(["Work/task.md"], "Work/Work.md")).toBe(false);
});

test("canDemoteBranch: an empty folder (no folder-note) → false", () => {
  expect(canDemoteBranch([], "Work/Work.md")).toBe(false);
});

test("canDemoteBranch: folder-note + a sub-branch folder → false", () => {
  expect(canDemoteBranch(["Work/Work.md", "Work/Sub"], "Work/Work.md")).toBe(false);
});

// classifyHudFile — the HUD must never read a non-markdown file as text. Doing
// so decodes an image's bytes as UTF-8 and feeds them to the markdown renderer,
// which shows wingding garbage in the main window and CRASHES a pop-out window's
// renderer process. Markdown gets the rendered body; images an inline preview;
// everything else a name/type card.
test("classifyHudFile: markdown is the only text-rendered kind", () => {
  expect(classifyHudFile("md")).toBe("markdown");
  expect(classifyHudFile("MD")).toBe("markdown");
});

test("classifyHudFile: common image extensions get an inline preview", () => {
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]) {
    expect(classifyHudFile(ext)).toBe("image");
    expect(classifyHudFile(ext.toUpperCase())).toBe("image");
  }
});

test("classifyHudFile: everything else is an opaque 'other' card, never read as text", () => {
  for (const ext of ["pdf", "canvas", "mp4", "zip", "bin", ""]) {
    expect(classifyHudFile(ext)).toBe("other");
  }
});
