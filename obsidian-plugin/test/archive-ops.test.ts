import { test, expect, mock } from "bun:test";
import { archivePaths, archiveNoteContent } from "../src/archive-paths.ts";
import { fakeObsidianModule } from "./helpers/fake-obsidian.ts";

// The vault writer (applyArchivePlan / dedupePath) lives in seed-coral-modal.ts,
// which imports "obsidian" for `new Notice`. Stub it so the real code is
// testable. Shared factory: `mock.module("obsidian", ...)` registers once
// per process — other test files mocking "obsidian" reuse this exact shape
// (see helpers/fake-obsidian.ts for why that matters).
mock.module("obsidian", fakeObsidianModule);
const { applyArchivePlan, dedupePath } = await import("../src/seed-coral-modal.ts");

// ── A minimal in-memory Obsidian App (vault + adapter + fileManager) ──
class FakeAdapter {
  fs = new Map<string, string>();
  dirs = new Set<string>();
  async exists(p: string) { return this.fs.has(p) || this.dirs.has(p); }
  async read(p: string) { if (!this.fs.has(p)) throw new Error(`ENOENT ${p}`); return this.fs.get(p)!; }
  async write(p: string, c: string) { this.fs.set(p, c); }
  async mkdir(p: string) { this.dirs.add(p); }
  async rename(from: string, to: string) { const c = this.fs.get(from)!; this.fs.delete(from); this.fs.set(to, c); }
}
class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  adapter = new FakeAdapter();
  getAbstractFileByPath(p: string): unknown {
    if (this.files.has(p)) return { path: p };
    if (this.folders.has(p)) return { path: p, children: [] };
    return null;
  }
  async create(p: string, c: string) { if (this.files.has(p)) throw new Error(`exists ${p}`); this.files.set(p, c); }
  async createFolder(p: string) { this.folders.add(p); }
}
class FakeApp {
  vault = new FakeVault();
  fileManager = {
    renameFile: async (file: { path: string }, to: string) => {
      const c = this.vault.files.get(file.path)!;
      this.vault.files.delete(file.path);
      this.vault.files.set(to, c);
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asApp = (a: FakeApp): any => a;

// ── dedupePath: never overwrites; " 2" before .md, appended for folders/other ──

test("dedupePath returns the path unchanged when nothing is there", () => {
  const app = new FakeApp();
  expect(dedupePath(asApp(app), "X/note.md")).toBe("X/note.md");
});

test("dedupePath inserts ' 2' before .md when the file exists, then ' 3'", () => {
  const app = new FakeApp();
  app.vault.files.set("X/note.md", "a");
  expect(dedupePath(asApp(app), "X/note.md")).toBe("X/note 2.md");
  app.vault.files.set("X/note 2.md", "b");
  expect(dedupePath(asApp(app), "X/note.md")).toBe("X/note 3.md");
});

test("dedupePath appends ' 2' for a folder / non-.md path", () => {
  const app = new FakeApp();
  app.vault.folders.add("X/_archive");
  expect(dedupePath(asApp(app), "X/_archive")).toBe("X/_archive 2");
  app.vault.files.set("X/keeper.mjs", "js");
  expect(dedupePath(asApp(app), "X/keeper.mjs")).toBe("X/keeper.mjs 2");
});

// ── applyArchivePlan: a same-day re-run collision must dedupe, never abort ──

test("applyArchivePlan dedupes a colliding rename destination (vault path) instead of overwriting", async () => {
  const app = new FakeApp();
  const archive = "X/_archive — unseeded (2026-07-04)";
  const dest = `${archive}/CLAUDE — archived (2026-07-04).md`;
  app.vault.folders.add(archive);
  app.vault.files.set(dest, "PRIOR"); // a leftover from an earlier same-day undo
  app.vault.files.set("X/CLAUDE.md", "brief");
  await applyArchivePlan(asApp(app), {
    archiveFolder: archive,
    renames: [{ from: "X/CLAUDE.md", to: dest }],
    writes: [],
  });
  expect(app.vault.files.get(dest)).toBe("PRIOR"); // not overwritten
  expect(app.vault.files.get(`${archive}/CLAUDE — archived (2026-07-04) 2.md`)).toBe("brief");
  expect(app.vault.files.has("X/CLAUDE.md")).toBe(false); // moved
});

test("applyArchivePlan dedupes a colliding .claude/ (adapter) rename destination", async () => {
  const app = new FakeApp();
  const archive = "X/_archive — unseeded (2026-07-04)";
  const dest = `${archive}/coral-log-keeper.mjs`;
  app.vault.folders.add(archive);
  app.vault.files.set(dest, "PRIOR"); // prior same-day archive of the keeper (dotless, vault-visible)
  app.vault.adapter.fs.set("X/.claude/hooks/coral-log-keeper.mjs", "js");
  await applyArchivePlan(asApp(app), {
    archiveFolder: archive,
    renames: [{ from: "X/.claude/hooks/coral-log-keeper.mjs", to: dest }],
    writes: [],
  });
  expect(app.vault.files.get(dest)).toBe("PRIOR"); // untouched
  expect(app.vault.adapter.fs.get(`${archive}/coral-log-keeper.mjs 2`)).toBe("js"); // deduped move
});

test("archivePaths puts _archive inside the parent folder", () => {
  expect(archivePaths("Builds/Alpha")).toEqual({
    archiveFolder: "Builds/Alpha/_archive",
    archiveNote: "Builds/Alpha/_archive/_archive.md",
  });
});
test("archivePaths handles the root", () => {
  expect(archivePaths("")).toEqual({
    archiveFolder: "_archive", archiveNote: "_archive/_archive.md",
  });
});
test("archiveNoteContent carries kind: archive frontmatter", () => {
  expect(archiveNoteContent()).toContain("kind: archive");
});
