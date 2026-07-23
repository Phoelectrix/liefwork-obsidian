import { test, expect } from "bun:test";
import { folderNoteSyncRename, folderRenameFromNote } from "../src/folder-note-sync.ts";

test("renaming a meristem folder yields its folder-note rename", () => {
  // Folder Parent/Old renamed to Parent/New; folder-note already moved with it.
  const exists = (p: string) => p === "Parent/New/Old.md";
  expect(folderNoteSyncRename("Parent/Old", "Parent/New", exists)).toEqual({
    from: "Parent/New/Old.md",
    to: "Parent/New/New.md",
  });
});

test("folder without a matching folder-note → no-op (not a meristem)", () => {
  const exists = (_p: string) => false;
  expect(folderNoteSyncRename("Parent/Old", "Parent/New", exists)).toBeNull();
});

test("a move (basename unchanged) → no-op", () => {
  const exists = (_p: string) => true;
  expect(folderNoteSyncRename("A/Topic", "B/Topic", exists)).toBeNull();
});

test("root-level folder rename", () => {
  const exists = (p: string) => p === "New/Old.md";
  expect(folderNoteSyncRename("Old", "New", exists)).toEqual({
    from: "New/Old.md",
    to: "New/New.md",
  });
});

// ── Reverse direction: renaming the meristem note itself must rename its folder ──

test("renaming a folder-note yields its folder rename", () => {
  // Note Parent/Topic/Topic.md (the folder-note) → Parent/Topic/New.md.
  expect(folderRenameFromNote("Parent/Topic/Topic.md", "Parent/Topic/New.md")).toEqual({
    from: "Parent/Topic",
    to: "Parent/New",
  });
});

test("root-level folder-note rename", () => {
  expect(folderRenameFromNote("Topic/Topic.md", "Topic/New.md")).toEqual({
    from: "Topic",
    to: "New",
  });
});

test("renaming a non-folder-note (basename ≠ folder) → no-op", () => {
  // An ordinary lief inside a branch — not the folder-note.
  expect(folderRenameFromNote("Parent/Topic/lief.md", "Parent/Topic/renamed.md")).toBeNull();
});

test("a note at vault root → no-op (no folder to rename)", () => {
  expect(folderRenameFromNote("Note.md", "Renamed.md")).toBeNull();
});

test("moving a folder-note to another folder → no-op (move, not rename)", () => {
  expect(folderRenameFromNote("Parent/Topic/Topic.md", "Other/Topic.md")).toBeNull();
});

test("loop-safety: the folder→note rename does NOT re-trigger a folder rename", () => {
  // folderNoteSyncRename renames New/Old.md → New/New.md inside folder New.
  // Its OLD basename (Old) ≠ the folder name (New), so this must be a no-op.
  expect(folderRenameFromNote("New/Old.md", "New/New.md")).toBeNull();
});
