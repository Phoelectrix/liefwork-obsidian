import { test, expect, mock } from "bun:test";
import { planSeed } from "../src/seed-coral.ts";
import { GROWTH_CHARTER_TEMPLATE, VENDOR_POINTER_TEMPLATE, GROWTH_CHARTER_BASENAME, AGENT_POINTER_BASENAMES, CORAL_SETTINGS_JSON, coralSeedManifest } from "../src/seed-templates.ts";
import { fakeObsidianModule } from "./helpers/fake-obsidian.ts";

// The vault writer + name guard live in seed-coral-modal.ts (imports "obsidian"
// for `new Notice`). Stub obsidian so the real code is unit-testable. Shared
// factory: `mock.module("obsidian", ...)` registers once per process — other
// test files mocking "obsidian" reuse this exact shape (see
// helpers/fake-obsidian.ts for why that matters).
mock.module("obsidian", fakeObsidianModule);
const { writeSeed, sanitizeCoralName, readCoralFacts, isSubCoral } = await import("../src/seed-coral-modal.ts");

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
  name = "Vault";
  getName() { return this.name; }
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
  fileManager = { renameFile: async () => {} };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asApp = (a: FakeApp): any => a;

// ── sub-fix 1: coral-name sanitization (illegal chars never reach a filename) ──

test("sanitizeCoralName strips illegal filename chars to spaces", () => {
  expect(sanitizeCoralName("Foo/Bar:Baz")).toBe("Foo Bar Baz");
  expect(sanitizeCoralName('a<b>c|d"e')).toBe("a b c d e");
});

test("sanitizeCoralName returns '' (rejected) when nothing usable survives", () => {
  expect(sanitizeCoralName("   ")).toBe("");
  expect(sanitizeCoralName("///:::")).toBe("");
});

test("planSeed produces clean paths when fed a sanitized name (no illegal chars leak)", () => {
  const safe = sanitizeCoralName("Q1/Roadmap:2026");
  const files = planSeed({
    folderPath: "Projects/X",
    name: safe,
    description: "",
    foundingPrompt: "",
    today: "2026-07-04",
    createdAt: "2026-07-04T09:00:00.000Z",
  });
  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf("/") + 1);
    expect(base).not.toMatch(/[\\/:*?"<>|#^[\]]/);
  }
});

// ── sub-fix 3: writeSeed reports skipped (never-overwritten) non-dot files ──

test("writeSeed returns the skipped non-dot paths and leaves them untouched", async () => {
  const app = new FakeApp();
  app.vault.files.set("X/Foo.md", "USER CONTENT");
  const skipped = await writeSeed(asApp(app), [
    { path: "X/Foo.md", content: "seed would overwrite" },
    { path: "X/Bar.md", content: "fresh" },
  ]);
  expect(skipped).toEqual(["X/Foo.md"]);
  expect(app.vault.files.get("X/Foo.md")).toBe("USER CONTENT"); // never overwritten
  expect(app.vault.files.get("X/Bar.md")).toBe("fresh"); // written
});

test("writeSeed returns [] when nothing pre-exists", async () => {
  const app = new FakeApp();
  const skipped = await writeSeed(asApp(app), [{ path: "X/A.md", content: "a" }]);
  expect(skipped).toEqual([]);
});

// ── sub-fix 4: an unparseable pre-existing settings.json is provenance-honest ──

test("writeSeed over an unparseable settings.json records settingsCreatedByUs: false", async () => {
  const app = new FakeApp();
  app.vault.adapter.fs.set("X/.claude/settings.json", "{ not: valid json,, }");
  await writeSeed(asApp(app), [
    { path: "X/.claude/settings.json", content: CORAL_SETTINGS_JSON },
    { path: "X/.claude/.coral-seed-manifest.json", content: coralSeedManifest() },
  ]);
  // the user's file is left exactly as it was (never overwritten)
  expect(app.vault.adapter.fs.get("X/.claude/settings.json")).toBe("{ not: valid json,, }");
  // and the manifest no longer claims we created settings.json (so Undo won't archive it)
  const manifest = JSON.parse(app.vault.adapter.fs.get("X/.claude/.coral-seed-manifest.json")!);
  expect(manifest.settingsCreatedByUs).toBe(false);
});

// ── the Growth Charter: canonical, self-contained, vendor-neutral ──

test("charter: carries the memory rules + the episode-boundary recording ritual", () => {
  expect(GROWTH_CHARTER_TEMPLATE).toMatch(/at each episode boundary/i);
  expect(GROWTH_CHARTER_TEMPLATE).toContain("## The memory rules of this coral");
  expect(GROWTH_CHARTER_TEMPLATE).toContain("## Session start ritual");
});

test("charter: keeps the keeper-state line, phrased as hook-support-conditional", () => {
  expect(GROWTH_CHARTER_TEMPLATE).toContain(".coral-log-state.json");
  expect(GROWTH_CHARTER_TEMPLATE).toContain("recordingPref");
  expect(GROWTH_CHARTER_TEMPLATE).toMatch(/agents with hook support/i);
});

test("charter: states who keeps the rules — the discipline is the agent's, the hook only reminds", () => {
  // 5 Aug: an agent terminal opened on a BRANCH meristem never had the keeper
  // running (a hook is read only from the directory a session starts in), and
  // nothing said so anywhere. The honest fix was documentation, not machinery —
  // so the Charter now carries the limit itself, in its own vendor-neutral idiom.
  expect(GROWTH_CHARTER_TEMPLATE).toContain("## Who keeps these rules");
  expect(GROWTH_CHARTER_TEMPLATE).toMatch(/started in the folder holding this Charter/);
  // …and says the rules still reach an agent started deeper, since only the
  // reminder is scoped that way — the distinction the whole note exists to make.
  expect(GROWTH_CHARTER_TEMPLATE).toMatch(/inherited down the tree/);
});

test("charter: is vendor-neutral — names no agent outside the pointer list + the hook-support parenthesis", () => {
  // The only allowed vendor mentions: the pointer-file enumeration and
  // "(currently Claude Code)" on the hook line. Strip those, then assert.
  const stripped = GROWTH_CHARTER_TEMPLATE
    .replace(/`CLAUDE\.md`, `AGENTS\.md`, `GEMINI\.md`/g, "")
    .replace(/\(currently Claude Code\)/g, "");
  expect(stripped).not.toMatch(/Claude|Gemini|Codex|Copilot|Cursor/);
});

test("pointer template: a short redirect to the Charter, marked disposable", () => {
  expect(VENDOR_POINTER_TEMPLATE).toContain("Growth Charter.md");
  expect(VENDOR_POINTER_TEMPLATE).toMatch(/Liefwork coral/);
  expect(VENDOR_POINTER_TEMPLATE).toMatch(/generated pointer/i);
  // a pointer is a breadcrumb: keep it under ~6 lines of content
  expect(VENDOR_POINTER_TEMPLATE.trim().split("\n").length).toBeLessThanOrEqual(6);
});

test("pointer constants: the locked v1 set + the charter basename", () => {
  expect([...AGENT_POINTER_BASENAMES]).toEqual(["CLAUDE.md", "AGENTS.md", "GEMINI.md"]);
  expect(GROWTH_CHARTER_BASENAME).toBe("Growth Charter.md");
});

// ── planSeed: the files written to turn a folder into a coral ──

// EVERY seed writes a Charter, nesting included. Seeding a folder inside a
// coral used to write only a meristem, on the theory that a second Charter
// would compete with the parent's. It doesn't: Claude Code loads every
// CLAUDE.md from the working directory upward and the NEAREST wins on conflict
// (AGENTS.md and GEMINI.md likewise), so a nested Charter governs its own
// subtree while the parent stays active above it. Founder, 28 July — seeding an
// already-governed folder and getting no Charter read as a broken command.
test("planSeed: a folder nested inside a coral still gets its own Charter and pointers", () => {
  const files = planSeed({
    folderPath: "Launch RoadMap",
    name: "Launch RoadMap",
    description: "go-to-market work for the Alpha plugin",
    foundingPrompt: "Get Alpha on sale by 1 July.",
    withKeeperHook: false,
    today: "2026-06-12",
    createdAt: "2026-06-12T09:00:00.000Z",
  });
  const paths = files.map((f) => f.path);
  for (const marker of ["Growth Charter.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    expect(paths).toContain(`Launch RoadMap/${marker}`);
  }
  expect(paths).toContain("Launch RoadMap/Launch RoadMap.md"); // root meristem
  expect(paths).toContain("Launch RoadMap/prompt — founding intent.md"); // founding lief
});

test("planSeed: a root coral gets the Growth Charter + the three agent pointers", () => {
  const files = planSeed({
    folderPath: "Projects/Foo",
    name: "Foo",
    description: "d",
    foundingPrompt: "",
    withKeeperHook: false,
    today: "2026-07-22",
    createdAt: "2026-07-22T10:00:00.000Z",
  });
  const paths = files.map((f) => f.path);
  expect(paths).toContain("Projects/Foo/Growth Charter.md");
  for (const p of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    expect(paths).toContain(`Projects/Foo/${p}`);
  }
});

test("planSeed: the founding lief is a prompt lief — frontmatter kind/order/created + the prompt verbatim", () => {
  const files = planSeed({
    folderPath: "X",
    name: "X",
    description: "",
    foundingPrompt: "Ship it by Friday.",
    today: "2026-06-12",
      createdAt: "2026-06-12T09:00:00.000Z",  });
  const lief = files.find((f) => f.path === "X/prompt — founding intent.md")!;
  expect(lief.content).toContain("kind: prompt");
  expect(lief.content).toContain("order: 10");
  expect(lief.content).toContain("created: 2026-06-12T09:00:00.000Z");
  expect(lief.content).toContain("Ship it by Friday.");
});

test("planSeed: an empty / whitespace founding prompt writes no founding lief", () => {
  const files = planSeed({
    folderPath: "X",
    name: "X",
    description: "",
    foundingPrompt: "   ",
    today: "2026-06-12",
      createdAt: "2026-06-12T09:00:00.000Z",  });
  expect(files.some((f) => f.path.endsWith("prompt — founding intent.md"))).toBe(false);
});

test("planSeed: the root meristem fills the template — name + date in, the Areas section present, no {{placeholders}}", () => {
  const files = planSeed({
    folderPath: "Foo",
    name: "Foo",
    description: "the Foo project",
    foundingPrompt: "go",
    today: "2026-06-12",
      createdAt: "2026-06-12T09:00:00.000Z",  });
  const meristem = files.find((f) => f.path === "Foo/Foo.md")!;
  expect(meristem.content).toContain("# Foo");
  expect(meristem.content).toContain("created: 2026-06-12T09:00:00.000Z");
  expect(meristem.content).toContain("Areas"); // from the root-meristem template
  expect(meristem.content).not.toContain("{{");
});

test("planSeed: the Charter carries the rules + ritual, filled, no {{placeholders}}; pointers point at it", () => {
  const files = planSeed({
    folderPath: "Foo",
    name: "Foo",
    description: "a test coral",
    foundingPrompt: "",
    withKeeperHook: false,
    today: "2026-07-22",
    createdAt: "2026-07-22T10:00:00.000Z",
  });
  const charter = files.find((f) => f.path === "Foo/Growth Charter.md")!;
  expect(charter.content).toContain("## The memory rules of this coral");
  expect(charter.content).toContain("[[Foo]]");
  expect(charter.content).not.toMatch(/\{\{\w+\}\}/);
  const pointer = files.find((f) => f.path === "Foo/AGENTS.md")!;
  expect(pointer.content).toContain("Growth Charter.md");
  expect(pointer.content).toContain("Foo");
  expect(pointer.content).not.toMatch(/\{\{\w+\}\}/);
});

test("planSeed: seeding the vault root ('') yields unprefixed paths", () => {
  const files = planSeed({
    folderPath: "",
    name: "Vault",
    description: "",
    foundingPrompt: "go",
    today: "2026-06-12",
      createdAt: "2026-06-12T09:00:00.000Z",  });
  const paths = files.map((f) => f.path).sort();
  expect(paths).toContain("Vault.md");
  expect(paths).toContain("prompt — founding intent.md");
});

test("planSeed: a root coral emits the keeper artifacts under .claude/", () => {
  const files = planSeed({
    folderPath: "Projects/Foo",
    name: "Foo",
    description: "a thing",
    foundingPrompt: "Build Foo.",
    withKeeperHook: true,
    today: "2026-06-17",
  });
  const paths = files.map((f) => f.path);
  expect(paths).toContain("Projects/Foo/.claude/settings.json");
  expect(paths).toContain("Projects/Foo/.claude/hooks/coral-log-keeper.mjs");
  expect(paths).toContain("Projects/Foo/.claude/.coral-log-state.json");
  expect(paths).toContain("Projects/Foo/.claude/.coral-seed-manifest.json");

  const settings = files.find((f) => f.path.endsWith(".claude/settings.json"))!.content;
  expect(settings).toContain("UserPromptSubmit");
  expect(settings).toContain("coral-log-keeper.mjs");

  const state = JSON.parse(files.find((f) => f.path.endsWith(".coral-log-state.json"))!.content);
  expect(state.recordingPref).toBe("default");
  expect(state.threshold).toBe(4);
});

// ── withKeeperHook: the seed-modal opt-out gates the .claude logging hook ──

const baseRootOpts = {
  folderPath: "Projects/Foo",
  name: "Foo",
  description: "a thing",
  foundingPrompt: "Build Foo.",
  today: "2026-07-07",
  createdAt: "2026-07-07T09:00:00.000Z",
};

test("planSeed with withKeeperHook:false plants no hook files", () => {
  const files = planSeed({ ...baseRootOpts, withKeeperHook: false });
  const paths = files.map((f) => f.path);
  expect(paths.some((p) => p.includes(".claude/settings.json"))).toBe(false);
  expect(paths.some((p) => p.includes("coral-log-keeper.mjs"))).toBe(false);
  expect(paths.some((p) => p.includes(".coral-log-state.json"))).toBe(false);
  // Provenance manifest still written — Undo seeding needs it.
  expect(paths.some((p) => p.includes(".coral-seed-manifest.json"))).toBe(true);
});

test("planSeed with withKeeperHook:true plants the hook files (root coral)", () => {
  const files = planSeed({ ...baseRootOpts, withKeeperHook: true });
  const paths = files.map((f) => f.path);
  expect(paths.some((p) => p.includes(".claude/settings.json"))).toBe(true);
  expect(paths.some((p) => p.includes("coral-log-keeper.mjs"))).toBe(true);
});

test("planSeed: the keeper hook is the toggle's call, nesting included", () => {
  const base = { folderPath: "Foo/Sub", name: "Sub", description: "", foundingPrompt: "", today: "2026-06-17" };
  expect(planSeed({ ...base, withKeeperHook: false }).some((f) => f.path.includes("/hooks/"))).toBe(false);
  expect(planSeed({ ...base, withKeeperHook: true }).some((f) => f.path.includes("/hooks/"))).toBe(true);
});

// ── finding 2: the root meristem is named after the REAL vault, never "Vault" ──
// The unified resolver (folder-note-path.ts) looks for "<vaultName>.md" at the
// root; the presence facts / seed / lifecycle sites must agree, or a seeded
// vault-root coral writes "Vault.md" while nothing ever finds it again.

type FolderArg = Parameters<typeof readCoralFacts>[1];
const rootFolder = () => ({ path: "", name: "", children: [], parent: null }) as unknown as FolderArg;

test("readCoralFacts: a root coral's meristem is resolved by the real vault name (not 'Vault')", () => {
  const app = new FakeApp();
  app.vault.name = "My Real Vault";
  app.vault.files.set("My Real Vault.md", "# root meristem"); // what the seed actually writes
  expect(readCoralFacts(asApp(app), rootFolder()).hasOwnMeristem).toBe(true);
});

test("readCoralFacts: a stale 'Vault.md' is NOT taken as the meristem of a differently-named vault", () => {
  const app = new FakeApp();
  app.vault.name = "My Real Vault";
  app.vault.files.set("Vault.md", "# stale literal");
  expect(readCoralFacts(asApp(app), rootFolder()).hasOwnMeristem).toBe(false);
});

test("readCoralFacts: when the vault IS literally named 'Vault', the fallback still resolves 'Vault.md'", () => {
  const app = new FakeApp();
  app.vault.name = "Vault";
  app.vault.files.set("Vault.md", "# root meristem");
  expect(readCoralFacts(asApp(app), rootFolder()).hasOwnMeristem).toBe(true);
});

// ── the Growth Charter as the primary root marker (legacy CLAUDE.md as fallback) ──

test("readCoralFacts: a folder with Growth Charter.md reads hasOwnCharter", () => {
  const app = new FakeApp();
  app.vault.files.set("Projects/Foo/Growth Charter.md", "charter");
  const facts = readCoralFacts(asApp(app), { path: "Projects/Foo", name: "Foo", children: [], parent: null } as never);
  expect(facts.hasOwnCharter).toBe(true);
});

test("isSubCoral: an ancestor Growth Charter.md (no CLAUDE.md) makes a child a sub-coral", () => {
  const app = new FakeApp();
  app.vault.files.set("Projects/Growth Charter.md", "charter");
  const folder = { path: "Projects/Sub", name: "Sub", parent: { path: "Projects", name: "Projects", parent: null } };
  expect(isSubCoral(asApp(app), folder as never)).toBe(true);
});
