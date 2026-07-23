import { test, expect } from "bun:test";
import {
  liefFilename,
  promotionPaths,
  liefNotePlan,
  untitledFilename,
  sanitizeName,
  childBranchPaths,
  ancestorFolders,
} from "../src/lief-writer.ts";

// ── liefFilename: a short, sanitised, collision-free `.md` name from prompt text ──

test("liefFilename: derives a name from the prompt, preserving words + case", () => {
  expect(liefFilename("Start the M2 HUD work", [])).toBe("Start the M2 HUD work.md");
});

test("liefFilename: strips characters illegal in vault paths", () => {
  // slash / colon / question-mark / etc. become spaces, collapsed
  expect(liefFilename('fix: a/b "thing"?', [])).toBe("fix a b thing.md");
});

test("liefFilename: truncates long prompts at a word boundary", () => {
  const long =
    "this is a very long prompt that goes well beyond any reasonable filename length and keeps going";
  const out = liefFilename(long, []);
  expect(out.endsWith(".md")).toBe(true);
  expect(out.length).toBeLessThanOrEqual(63); // 60 char cap + ".md"
  expect(out).not.toContain("  "); // no double spaces from a mid-word cut
  // cut on a word boundary — does not end mid-word with a dangling fragment
  expect(out).toBe("this is a very long prompt that goes well beyond any.md");
});

test("liefFilename: empty / whitespace-only prompt falls back to 'lief'", () => {
  expect(liefFilename("   ", [])).toBe("lief.md");
  expect(liefFilename("", [])).toBe("lief.md");
});

test("liefFilename: avoids collisions by appending a counter", () => {
  expect(liefFilename("Note", ["Note.md"])).toBe("Note 2.md");
  expect(liefFilename("Note", ["Note.md", "Note 2.md"])).toBe("Note 3.md");
});

test("liefFilename: collision check is case-insensitive (vault is)", () => {
  expect(liefFilename("note", ["Note.md"])).toBe("note 2.md");
});

// ── promotionPaths: lief MD → folder + folder-note (so a lief becomes a meristem) ──

test("promotionPaths: nested lief → sibling folder + folder-note", () => {
  expect(promotionPaths("parent/X.md")).toEqual({
    folder: "parent/X",
    folderNote: "parent/X/X.md",
  });
});

test("promotionPaths: root-level lief", () => {
  expect(promotionPaths("X.md")).toEqual({
    folder: "X",
    folderNote: "X/X.md",
  });
});

test("promotionPaths: deep path keeps full parent chain", () => {
  expect(promotionPaths("a/b/c/leaf.md")).toEqual({
    folder: "a/b/c/leaf",
    folderNote: "a/b/c/leaf/leaf.md",
  });
});

// ── liefNotePlan: where a new note goes when added from a lief's HUD ──

test("liefNotePlan: default adds a SIBLING on the same parent branch (no promotion)", () => {
  expect(liefNotePlan("Topic/a.md", false)).toEqual({ targetFolder: "Topic", promote: null });
});

test("liefNotePlan: sibling of a root-level lief lands at the vault root", () => {
  expect(liefNotePlan("a.md", false)).toEqual({ targetFolder: "", promote: null });
});

test("liefNotePlan: promote upgrades the lief to a meristem and nests under it", () => {
  expect(liefNotePlan("Topic/a.md", true)).toEqual({
    targetFolder: "Topic/a",
    promote: { folder: "Topic/a", folderNote: "Topic/a/a.md" },
  });
});

// ── untitledFilename: Obsidian-style "Untitled" naming for an empty new note ──

test("untitledFilename: bare 'Untitled.md' when free", () => {
  expect(untitledFilename([])).toBe("Untitled.md");
  expect(untitledFilename(["other.md"])).toBe("Untitled.md");
});

test("untitledFilename: then 'Untitled 1', 'Untitled 2', … (Obsidian's scheme)", () => {
  expect(untitledFilename(["Untitled.md"])).toBe("Untitled 1.md");
  expect(untitledFilename(["Untitled.md", "Untitled 1.md"])).toBe("Untitled 2.md");
});

test("untitledFilename: collision check is case-insensitive", () => {
  expect(untitledFilename(["untitled.md"])).toBe("Untitled 1.md");
});

// ── sanitizeName / childBranchPaths: a new child branch's folder + summary + lief ──

test("sanitizeName: strips path-illegal characters and trims", () => {
  expect(sanitizeName("  My/Branch:?  ")).toBe("My Branch");
  expect(sanitizeName("Plain Name")).toBe("Plain Name");
});

test("sanitizeName: empty / illegal-only falls back to 'Untitled'", () => {
  expect(sanitizeName("   ")).toBe("Untitled");
  expect(sanitizeName("/:*?")).toBe("Untitled");
});

test("childBranchPaths: born empty — folder + folder-note only (no starter lief) under a parent", () => {
  const paths = childBranchPaths("Parent/Sub", "Ideas");
  expect(paths).toEqual({
    folder: "Parent/Sub/Ideas",
    folderNote: "Parent/Sub/Ideas/Ideas.md",
  });
  expect((paths as Record<string, unknown>).starterLief).toBeUndefined();
});

test("childBranchPaths: at the vault root ('' parent)", () => {
  expect(childBranchPaths("", "Ideas")).toEqual({
    folder: "Ideas",
    folderNote: "Ideas/Ideas.md",
  });
});

test("childBranchPaths: sanitises the name", () => {
  expect(childBranchPaths("P", "A/B?").folder).toBe("P/A B");
});

// ── ancestorFolders: levels at which a note's plant could be rooted ──

test("ancestorFolders: root → immediate parent for a nested note", () => {
  expect(ancestorFolders("A/B/C/note.md")).toEqual(["", "A", "A/B", "A/B/C"]);
});

test("ancestorFolders: a root-level note has only the vault root", () => {
  expect(ancestorFolders("note.md")).toEqual([""]);
});

test("ancestorFolders: one level deep", () => {
  expect(ancestorFolders("Topic/note.md")).toEqual(["", "Topic"]);
});
