import { test, expect } from "bun:test";
import {
  classifyFolder,
  coralMenuActions,
  planUndo,
  planReactivate,
  planReseed,
  seededRootPaths,
} from "../src/coral-lifecycle.ts";

const ALL_MARKERS = ["Growth Charter.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md"];

const RESEED_SEED = {
  folderPath: "Employment/People Cert",
  name: "People Cert",
  description: "a fresh start",
  foundingPrompt: "Start over.",
  isSubCoral: false,
  today: "2026-06-13",
};

// ── classifyFolder: a folder's coral status, from presence facts about ITSELF ──
// (the guard keys on "does THIS folder already have its own meristem / CLAUDE.md?",
//  NOT "is it inside a coral" — a fresh subfolder must stay seedable as a sub-coral.)

test("classifyFolder: a bare folder with nothing of its own is fresh (seedable)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: false,
      hasOwnMeristem: false,
      hasUnseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("fresh");
});

test("classifyFolder: a fresh subfolder INSIDE a coral is still fresh (seedable as a sub-coral)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: false,
      hasOwnMeristem: false,
      hasUnseedArchive: false,
      insideCoral: true,
    }),
  ).toBe("fresh");
});

test("classifyFolder: its own CLAUDE.md → seeded-root (a governed root coral)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: true,
      hasOwnMeristem: true,
      hasUnseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

test("classifyFolder: its own Growth Charter → seeded-root (charter-centric marker)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: true,
      hasOwnClaude: false,
      hasOwnMeristem: true,
      hasUnseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

test("classifyFolder: legacy CLAUDE.md-only coral (pre-charter seed) still reads seeded-root", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: true,
      hasOwnMeristem: true,
      hasUnseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

test("classifyFolder: an own meristem but no CLAUDE.md, inside a coral → seeded-sub", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: false,
      hasOwnMeristem: true,
      hasUnseedArchive: false,
      insideCoral: true,
    }),
  ).toBe("seeded-sub");
});

test("classifyFolder: no live markers but an unseed archive present → unseeded (restorable)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: false,
      hasOwnMeristem: false,
      hasUnseedArchive: true,
      insideCoral: false,
    }),
  ).toBe("unseeded");
});

test("classifyFolder: a re-seed over an old unseed archive is seeded-root again (live markers win)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnClaude: true,
      hasOwnMeristem: true,
      hasUnseedArchive: true,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

// ── coralMenuActions: status → which seed-lifecycle items the folder menu offers ──

test("coralMenuActions: a fresh folder offers only Seed", () => {
  expect(coralMenuActions("fresh")).toEqual(["seed"]);
});

test("coralMenuActions: a seeded root coral offers Re-seed + Undo (it has its own scaffold to archive)", () => {
  expect(coralMenuActions("seeded-root")).toEqual(["reseed", "undo"]);
});

test("coralMenuActions: a seeded sub-coral offers Re-seed only", () => {
  expect(coralMenuActions("seeded-sub")).toEqual(["reseed"]);
});

test("coralMenuActions: an unseeded folder offers Reactivate (restore) + Seed (start anew)", () => {
  expect(coralMenuActions("unseeded")).toEqual(["reactivate", "seed"]);
});

// ── planUndo: un-seed — archive ALL the seed documents (not data) into a dated
//    _archive folder with a provenance log; the user's own data is left in place. ──

const UNDO = {
  folderPath: "Projects/People Cert",
  meristemName: "People Cert.md",
  markerNames: ALL_MARKERS,
  hasFoundingLief: true,
  today: "2026-06-12",
};
const UNDO_ARCHIVE = "Projects/People Cert/_archive — unseeded (2026-06-12)";

test("planUndo: archives into a dated _archive — unseeded subfolder", () => {
  expect(planUndo(UNDO).archiveFolder).toBe(UNDO_ARCHIVE);
});

test("planUndo: moves the CLAUDE.md, the meristem, AND the founding lief into the archive", () => {
  const plan = planUndo(UNDO);
  for (const base of ["Growth Charter", "CLAUDE", "AGENTS", "GEMINI"]) {
    expect(plan.renames).toContainEqual({
      from: `Projects/People Cert/${base}.md`,
      to: `${UNDO_ARCHIVE}/${base} — archived (2026-06-12).md`,
    });
  }
  expect(plan.renames).toContainEqual({
    from: "Projects/People Cert/People Cert.md",
    to: `${UNDO_ARCHIVE}/People Cert — archived (2026-06-12).md`,
  });
  expect(plan.renames).toContainEqual({
    from: "Projects/People Cert/prompt — founding intent.md",
    to: `${UNDO_ARCHIVE}/prompt — founding intent.md`, // the initial prompt, no longer left behind
  });
  expect(plan.renames).toHaveLength(6); // 4 markers + meristem + founding lief
});

test("planUndo: the archived markers are renamed inert (no bare marker / Inactive-CLAUDE.md in the archive)", () => {
  const plan = planUndo(UNDO);
  for (const bare of ["Growth Charter.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md", "Inactive-CLAUDE.md"]) {
    expect(plan.renames.some((r) => r.to === `${UNDO_ARCHIVE}/${bare}`)).toBe(false);
  }
});

test("planUndo: writes a provenance log INSIDE the archive (where it came from + how to restore)", () => {
  const plan = planUndo(UNDO);
  expect(plan.writes).toHaveLength(1);
  const log = plan.writes[0];
  expect(log.path).toBe(`${UNDO_ARCHIVE}/coral — unseeded (2026-06-12).md`);
  expect(log.content).toContain("created: 2026-06-12");
  expect(log.content).toContain("People Cert"); // where it came from
  expect(log.content.toLowerCase()).toContain("reactivate"); // how to restore
  expect(log.content).not.toContain("{{");
});

test("planUndo: a sub-coral (no own CLAUDE.md) archives only the meristem + founding lief", () => {
  const plan = planUndo({ ...UNDO, markerNames: [] });
  expect(plan.renames.some((r) => r.from.endsWith("/CLAUDE.md"))).toBe(false);
  expect(plan.renames).toHaveLength(2);
});

// ── planReactivate: restore the seed documents from an unseed archive (the inverse) ──

test("planReactivate: moves the archived scaffold back to active names", () => {
  const plan = planReactivate({
    folderPath: "Projects/People Cert",
    archiveFolder: UNDO_ARCHIVE,
    meristemName: "People Cert.md",
    archivedNames: [
      "CLAUDE — archived (2026-06-12).md",
      "People Cert — archived (2026-06-12).md",
      "prompt — founding intent.md",
      "coral — unseeded (2026-06-12).md", // the log — stays in the archive
    ],
  });
  expect(plan.renames).toContainEqual({
    from: `${UNDO_ARCHIVE}/CLAUDE — archived (2026-06-12).md`,
    to: "Projects/People Cert/CLAUDE.md",
  });
  expect(plan.renames).toContainEqual({
    from: `${UNDO_ARCHIVE}/People Cert — archived (2026-06-12).md`,
    to: "Projects/People Cert/People Cert.md",
  });
  expect(plan.renames).toContainEqual({
    from: `${UNDO_ARCHIVE}/prompt — founding intent.md`,
    to: "Projects/People Cert/prompt — founding intent.md",
  });
});

test("planReactivate: restores all archived markers to their live names (charter + pointers + legacy CLAUDE)", () => {
  const plan = planReactivate({
    folderPath: "Projects/People Cert",
    archiveFolder: UNDO_ARCHIVE,
    meristemName: "People Cert.md",
    archivedNames: [
      "Growth Charter — archived (2026-06-12).md",
      "CLAUDE — archived (2026-06-12).md",
      "AGENTS — archived (2026-06-12).md",
      "GEMINI — archived (2026-06-12).md",
      "People Cert — archived (2026-06-12).md",
      "prompt — founding intent.md",
      "coral — unseeded (2026-06-12).md",
    ],
  });
  for (const base of ["Growth Charter", "CLAUDE", "AGENTS", "GEMINI"]) {
    expect(plan.renames).toContainEqual({
      from: `${UNDO_ARCHIVE}/${base} — archived (2026-06-12).md`,
      to: `Projects/People Cert/${base}.md`,
    });
  }
  // the meristem still restores to its own name, and the log stays put
  expect(plan.renames).toContainEqual({
    from: `${UNDO_ARCHIVE}/People Cert — archived (2026-06-12).md`,
    to: "Projects/People Cert/People Cert.md",
  });
  expect(plan.renames.some((r) => r.from.includes("coral — unseeded"))).toBe(false);
});

test("planReactivate: leaves the provenance log behind (only the scaffold is restored)", () => {
  const plan = planReactivate({
    folderPath: "Projects/People Cert",
    archiveFolder: UNDO_ARCHIVE,
    meristemName: "People Cert.md",
    archivedNames: [
      "CLAUDE — archived (2026-06-12).md",
      "People Cert — archived (2026-06-12).md",
      "coral — unseeded (2026-06-12).md",
    ],
  });
  expect(plan.renames).toHaveLength(2); // CLAUDE + meristem; the log is not moved
  expect(plan.renames.some((r) => r.from.includes("coral — unseeded"))).toBe(false);
});

// ── planReseed: archive the old scaffold into a dated subfolder (markers RENAMED
//    so the archive isn't itself read as a coral), then seed fresh. Archive-over-delete. ──

test("planReseed: archives into a dated _archive subfolder under the folder", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  expect(plan.archiveFolder).toBe("Employment/People Cert/_archive — re-seeded (2026-06-13)");
});

test("planReseed: a root coral's CLAUDE.md is moved AND renamed so the archive isn't an active brief", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  const archive = "Employment/People Cert/_archive — re-seeded (2026-06-13)";
  // moved out of the auto-loaded name: a folder with "CLAUDE — archived ….md" is NOT
  // governed (only "CLAUDE.md" auto-loads) and classifies as fresh, not undone.
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/CLAUDE.md",
    to: `${archive}/CLAUDE — archived (2026-06-13).md`,
  });
  // no bare CLAUDE.md and no Inactive-CLAUDE.md ever lands inside the archive folder
  expect(plan.renames.some((r) => r.to === `${archive}/CLAUDE.md`)).toBe(false);
  expect(plan.renames.some((r) => r.to.endsWith("/Inactive-CLAUDE.md"))).toBe(false);
});

test("planReseed: the old meristem is moved AND renamed (so it isn't a folder-note of the archive dir)", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  const archive = "Employment/People Cert/_archive — re-seeded (2026-06-13)";
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/People Cert.md",
    to: `${archive}/People Cert — archived (2026-06-13).md`,
  });
});

test("planReseed: the old founding lief is moved into the archive unchanged (a plain note, not a marker)", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  const archive = "Employment/People Cert/_archive — re-seeded (2026-06-13)";
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/prompt — founding intent.md",
    to: `${archive}/prompt — founding intent.md`,
  });
});

test("planReseed: keeps grown content in place by default (no grown entries → only scaffold archived)", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  // the 4 markers + meristem + founding lief move; nothing else
  expect(plan.renames).toHaveLength(6);
});

test("planReseed: archiving grown content moves the named entries into the archive too (blank slate)", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: ["Cover Letter", "prompt — drafted the CV.md"],
  });
  const archive = "Employment/People Cert/_archive — re-seeded (2026-06-13)";
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/Cover Letter",
    to: `${archive}/Cover Letter`,
  });
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/prompt — drafted the CV.md",
    to: `${archive}/prompt — drafted the CV.md`,
  });
});

test("planReseed: writes the fresh seed (Growth Charter + pointers + meristem + founding lief) at the folder root", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  const paths = plan.writes.map((w) => w.path);
  expect(paths).toContain("Employment/People Cert/Growth Charter.md");
  expect(paths).toContain("Employment/People Cert/CLAUDE.md");
  expect(paths).toContain("Employment/People Cert/AGENTS.md");
  expect(paths).toContain("Employment/People Cert/GEMINI.md");
  expect(paths).toContain("Employment/People Cert/People Cert.md");
  expect(paths).toContain("Employment/People Cert/prompt — founding intent.md");
});

test("planReseed: writes a re-seed chronicle at the folder root naming the archive", () => {
  const plan = planReseed({
    seed: RESEED_SEED,
    meristemName: "People Cert.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    grownEntries: [],
  });
  const chron = plan.writes.find((w) => w.path.includes("coral — re-seeded"));
  expect(chron).toBeDefined();
  expect(chron!.path).toBe("Employment/People Cert/coral — re-seeded (2026-06-13).md");
  expect(chron!.content).toContain("_archive — re-seeded (2026-06-13)");
  expect(chron!.content).toContain("created: 2026-06-13");
});

// ── planUndo: keeper artifacts are archived when hasKeeper is set ──

test("planUndo: when a keeper is present, its artifacts are archived too", () => {
  const plan = planUndo({
    folderPath: "Projects/Foo",
    meristemName: "Foo.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: true,
    hasKeeper: true,
    today: "2026-06-17",
  });
  const froms = plan.renames.map((r) => r.from);
  expect(froms).toContain("Projects/Foo/.claude/hooks/coral-log-keeper.mjs");
  expect(froms).toContain("Projects/Foo/.claude/.coral-log-state.json");
  expect(froms).toContain("Projects/Foo/.claude/.coral-seed-manifest.json");
  // settings.json is un-merged by the writer, not moved here:
  expect(froms.some((f) => f.endsWith(".claude/settings.json"))).toBe(false);
});

test("planUndo: no keeper → no .claude artifacts in the plan", () => {
  const plan = planUndo({
    folderPath: "Projects/Foo",
    meristemName: "Foo.md",
    markerNames: ALL_MARKERS,
    hasFoundingLief: false,
    hasKeeper: false,
    today: "2026-06-17",
  });
  expect(plan.renames.some((r) => r.from.includes("/.claude/"))).toBe(false);
});

test("planReseed: a sub-coral (no own CLAUDE.md) archives only meristem + founding lief, and seeds no fresh CLAUDE.md", () => {
  const plan = planReseed({
    seed: { ...RESEED_SEED, isSubCoral: true },
    meristemName: "People Cert.md",
    markerNames: [],
    hasFoundingLief: true,
    grownEntries: [],
  });
  // no CLAUDE.md to archive
  expect(plan.renames.some((r) => r.from.endsWith("/CLAUDE.md"))).toBe(false);
  // and the fresh seed writes no CLAUDE.md (inherits the parent's)
  expect(plan.writes.some((w) => w.path.endsWith("/CLAUDE.md"))).toBe(false);
});

// ── seededRootPaths: the seed-badge helper (pure — classifyFolder's
//    "seeded-root" test, run over every rendered folder path). Truth table:
//    charter, legacy CLAUDE, neither, sub-coral folder (own meristem, no own
//    marker — badges only on what THIS folder itself carries). ──────────────

test("seededRootPaths: a folder with its own Growth Charter.md is a badged root", () => {
  const exists = (p: string) => p === "Projects/Alpha/Growth Charter.md";
  expect(seededRootPaths(["Projects/Alpha"], exists)).toEqual(new Set(["Projects/Alpha"]));
});

test("seededRootPaths: a folder with a legacy CLAUDE.md (no Charter) is also a badged root", () => {
  const exists = (p: string) => p === "Projects/Beta/CLAUDE.md";
  expect(seededRootPaths(["Projects/Beta"], exists)).toEqual(new Set(["Projects/Beta"]));
});

test("seededRootPaths: a folder with neither marker is not badged", () => {
  const exists = () => false;
  expect(seededRootPaths(["Projects/Gamma"], exists)).toEqual(new Set());
});

test("seededRootPaths: a sub-coral folder (own meristem, inherits the parent's Charter) is not badged", () => {
  // Only "Projects" (the parent) carries a Charter; "Projects/Sub" carries
  // just its own meristem note — classifyFolder would call it "seeded-sub",
  // and seededRootPaths must agree: no marker of ITS OWN, no badge.
  const exists = (p: string) => p === "Projects/Growth Charter.md";
  expect(seededRootPaths(["Projects", "Projects/Sub"], exists)).toEqual(new Set(["Projects"]));
});

test("seededRootPaths: the vault root (\"\") joins the marker name with no leading slash", () => {
  const exists = (p: string) => p === "Growth Charter.md";
  expect(seededRootPaths([""], exists)).toEqual(new Set([""]));
});

test("seededRootPaths: several folders — only the badged ones come back", () => {
  const exists = (p: string) => p === "A/Growth Charter.md" || p === "C/CLAUDE.md";
  expect(seededRootPaths(["A", "B", "C"], exists)).toEqual(new Set(["A", "C"]));
});

test("seededRootPaths: an empty folder list returns an empty set (no-op)", () => {
  expect(seededRootPaths([], () => true)).toEqual(new Set());
});
