import { test, expect, mock } from "bun:test";
import { folderNotePath, folderNoteMeristemId } from "../src/ingest/folder-note-path.ts";

test("folderNotePath: a nested folder → `<path>/<name>.md`", () => {
  expect(folderNotePath("Work/Alpha", "Alpha", "MyVault")).toBe("Work/Alpha/Alpha.md");
});

test("folderNotePath: a top-level folder → `<name>/<name>.md`", () => {
  expect(folderNotePath("Work", "Work", "MyVault")).toBe("Work/Work.md");
});

test("folderNotePath: the vault ROOT (empty path + empty name) → `<vault>.md`, never `.md`", () => {
  // The root TFolder has name === "" and path "/" (or "") — a naive `${name}.md`
  // would yield the invisible ".md" dotfile. The vault name is the root's note.
  expect(folderNotePath("/", "", "MyVault")).toBe("MyVault.md");
  expect(folderNotePath("", "", "MyVault")).toBe("MyVault.md");
});

// ── folderNoteMeristemId: the reverse mapping (note path → meristem node id) ──

test("folderNoteMeristemId: a nested folder-note → its folder's node id", () => {
  expect(folderNoteMeristemId("Work/Alpha/Alpha.md", "MyVault")).toBe("Work/Alpha");
});

test("folderNoteMeristemId: a top-level folder-note → its folder", () => {
  expect(folderNoteMeristemId("Work/Work.md", "MyVault")).toBe("Work");
});

test("folderNoteMeristemId: the vault-root note (`<vault>.md`) → \"/\" (the root node id)", () => {
  // vault-adapter stamps the root FolderNode with path "/" (folder.path || "/"),
  // so the vault name resolves there, not to an empty string.
  expect(folderNoteMeristemId("MyVault.md", "MyVault")).toBe("/");
});

test("folderNoteMeristemId: an ordinary lief is NOT a folder-note → null", () => {
  expect(folderNoteMeristemId("Work/Alpha/notes.md", "MyVault")).toBe(null);
  expect(folderNoteMeristemId("Work/Alpha/Beta.md", "MyVault")).toBe(null);
});

test("folderNoteMeristemId: a root-level note not named after the vault → null", () => {
  expect(folderNoteMeristemId("Other.md", "MyVault")).toBe(null);
});

test("folderNoteMeristemId: non-md files never match, even named like the folder", () => {
  expect(folderNoteMeristemId("Work/Alpha/Alpha.png", "MyVault")).toBe(null);
});

// ── vaultFolderToNode: pointer files hidden from the coral render ──
//
// vault-adapter.ts imports the REAL "obsidian" package for `TFolder`/`TFile`/
// `FileSystemAdapter`, which at test-time is a types-only stub (no runtime
// export) — so, following the idiom in seed-coral.test.ts / archive-ops.test.ts,
// we `mock.module("obsidian", ...)` with fake classes BEFORE a dynamic
// `await import(...)` of the module under test, so its `instanceof` checks see
// the same class references our fixtures are built from. The fake classes are
// shared (helpers/fake-obsidian.ts) rather than declared locally: bun's
// `mock.module("obsidian", ...)` only honours the FIRST registration per
// process, so whichever test file's call wins, it must be built from the same
// class objects this file's fixtures use — see that file's header comment.
import { FakeTFolder, FakeTFile, fakeObsidianModule } from "./helpers/fake-obsidian.ts";

mock.module("obsidian", fakeObsidianModule);
const { vaultFolderToNode } = await import("../src/ingest/vault-adapter.ts");

function fakeFolder(name: string, children: unknown[] = []): FakeTFolder {
  return new FakeTFolder(name, children);
}
function fakeFile(name: string): FakeTFile {
  return new FakeTFile(name);
}
function fakeApp() {
  return {
    vault: {
      adapter: {}, // not a FakeFileSystemAdapter instance → folderCreatedAt bails out cleanly
      getName: () => "TestVault",
      getAbstractFileByPath: () => null, // no folder-note found → falls back cleanly
    },
    metadataCache: {
      getFileCache: () => undefined,
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asApp = (a: ReturnType<typeof fakeApp>): any => a;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asFolder = (f: FakeTFolder): any => f;

test("agent pointer files are hidden from the coral; the Growth Charter renders", () => {
  const folder = fakeFolder("Coral", [
    fakeFile("CLAUDE.md"),
    fakeFile("AGENTS.md"),
    fakeFile("GEMINI.md"),
    fakeFile("Growth Charter.md"),
    fakeFile("A note.md"),
  ]);
  const node = vaultFolderToNode(asFolder(folder), asApp(fakeApp()), {});
  const names = (node.children ?? []).map((c) => c.name);
  expect(names).not.toContain("CLAUDE");
  expect(names).not.toContain("AGENTS");
  expect(names).not.toContain("GEMINI");
  expect(names).toContain("Growth Charter");
  expect(names).toContain("A note");
});

test("pointer files stay hidden in all-files mode too", () => {
  const folder = fakeFolder("Coral", [fakeFile("AGENTS.md"), fakeFile("photo.png")]);
  const node = vaultFolderToNode(asFolder(folder), asApp(fakeApp()), { allFiles: true });
  const names = (node.children ?? []).map((c) => c.name);
  expect(names.some((n) => n.startsWith("AGENTS"))).toBe(false);
  expect(names).toContain("photo.png");
});

test("a folder at depth with pointer files still hides them (nested, not just top-level)", () => {
  const nested = fakeFolder("Sub", [fakeFile("CLAUDE.md"), fakeFile("deep note.md")]);
  const root = fakeFolder("Coral", [nested]);
  const node = vaultFolderToNode(asFolder(root), asApp(fakeApp()), {});
  const sub = (node.children ?? []).find((c) => c.name === "Sub")!;
  const names = (sub.children ?? []).map((c) => c.name);
  expect(names).not.toContain("CLAUDE");
  expect(names).toContain("deep note");
});
