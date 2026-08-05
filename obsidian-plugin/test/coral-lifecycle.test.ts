import { test, expect } from "bun:test";
import {
  classifyFolder,
  coralMenuActions,
  planDeseed,
  planReactivate,
  isPristinePointer,
  seededRootPaths,
} from "../src/coral-lifecycle.ts";
import { VENDOR_POINTER_TEMPLATE, fillTemplate } from "../src/seed-templates.ts";

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
      hasOwnMeristem: false,
      hasDeseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("fresh");
});

test("classifyFolder: a fresh subfolder INSIDE a coral is still fresh (seedable as a sub-coral)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnMeristem: false,
      hasDeseedArchive: false,
      insideCoral: true,
    }),
  ).toBe("fresh");
});

// A bare CLAUDE.md is what a user hand-writes as their own agent brief. Reading
// it as a seeded root badged those folders and offered "Undo seeding", which
// would have archived the brief and stopped it governing. Five such folders sat
// in the founder's vault on 28 July, none of them a generated pointer.
test("classifyFolder: a hand-written CLAUDE.md is NOT a seeded root", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnMeristem: false,
      hasDeseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("fresh");
});

test("classifyFolder: its own Growth Charter → seeded-root (charter-centric marker)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: true,
      hasOwnMeristem: true,
      hasDeseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

// No released version ever seeded without a Charter — it landed 22 July, two
// days before the first public release — so "legacy pre-charter coral" names
// nothing that exists. A folder with a meristem but no Charter is a sub-coral.
test("classifyFolder: a meristem and a hand-written CLAUDE.md, no Charter → seeded-sub", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnMeristem: true,
      hasDeseedArchive: false,
      insideCoral: false,
    }),
  ).toBe("seeded-sub");
});

test("classifyFolder: an own meristem but no CLAUDE.md, inside a coral → seeded-sub", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnMeristem: true,
      hasDeseedArchive: false,
      insideCoral: true,
    }),
  ).toBe("seeded-sub");
});

test("classifyFolder: no live markers but an unseed archive present → unseeded (restorable)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: false,
      hasOwnMeristem: false,
      hasDeseedArchive: true,
      insideCoral: false,
    }),
  ).toBe("de-seeded");
});

test("classifyFolder: a re-seed over an old unseed archive is seeded-root again (live markers win)", () => {
  expect(
    classifyFolder({
      hasOwnCharter: true,
      hasOwnMeristem: true,
      hasDeseedArchive: true,
      insideCoral: false,
    }),
  ).toBe("seeded-root");
});

// ── coralMenuActions: status → which seed-lifecycle items the folder menu offers ──

test("coralMenuActions: a fresh folder offers only Seed", () => {
  expect(coralMenuActions("fresh")).toEqual(["seed"]);
});

// One move per state (founder, 28 July): no Charter → Seed · own Charter →
// De-seed · archived Charter → Reactivate or Seed anew. Re-seed is retired —
// it is de-seed then seed, two deliberate steps the user can still take.
test("coralMenuActions: a folder whose own Charter governs it can only be de-seeded", () => {
  expect(coralMenuActions("seeded-root")).toEqual(["deseed"]);
});

test("coralMenuActions: a folder inside a coral is seedable — it has no Charter of its own", () => {
  expect(coralMenuActions("seeded-sub")).toEqual(["seed"]);
});

test("coralMenuActions: an unseeded folder offers Reactivate (restore) + Seed (start anew)", () => {
  expect(coralMenuActions("de-seeded")).toEqual(["reactivate", "seed"]);
});

// ── planDeseed: un-seed — archive ALL the seed documents (not data) into a dated
//    _archive folder with a provenance log; the user's own data is left in place. ──

const UNDO = {
  folderPath: "Projects/People Cert",
  meristemName: "People Cert.md",
  markerNames: ALL_MARKERS,
  hasFoundingLief: true,
  today: "2026-06-12",
};
const UNDO_ARCHIVE = "Projects/People Cert/_archive — de-seeded (2026-06-12)";

test("planDeseed: archives into a dated _archive — unseeded subfolder", () => {
  expect(planDeseed(UNDO).archiveFolder).toBe(UNDO_ARCHIVE);
});

test("planDeseed: moves the CLAUDE.md, the meristem, AND the founding lief into the archive", () => {
  const plan = planDeseed(UNDO);
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

test("planDeseed: the archived markers are renamed inert (no bare marker / Inactive-CLAUDE.md in the archive)", () => {
  const plan = planDeseed(UNDO);
  for (const bare of ["Growth Charter.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md", "Inactive-CLAUDE.md"]) {
    expect(plan.renames.some((r) => r.to === `${UNDO_ARCHIVE}/${bare}`)).toBe(false);
  }
});

test("planDeseed: writes a provenance log INSIDE the archive (where it came from + how to restore)", () => {
  const plan = planDeseed(UNDO);
  expect(plan.writes).toHaveLength(1);
  const log = plan.writes[0];
  expect(log.path).toBe(`${UNDO_ARCHIVE}/coral — de-seeded (2026-06-12).md`);
  expect(log.content).toContain("created: 2026-06-12");
  expect(log.content).toContain("People Cert"); // where it came from
  expect(log.content.toLowerCase()).toContain("reactivate"); // how to restore
  expect(log.content).not.toContain("{{");
});

test("planDeseed: a sub-coral (no own CLAUDE.md) archives only the meristem + founding lief", () => {
  const plan = planDeseed({ ...UNDO, markerNames: [] });
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
      "coral — de-seeded (2026-06-12).md", // the log — stays in the archive
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
      "coral — de-seeded (2026-06-12).md",
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
  expect(plan.renames.some((r) => r.from.includes("coral — de-seeded"))).toBe(false);
});

test("planReactivate: leaves the provenance log behind (only the scaffold is restored)", () => {
  const plan = planReactivate({
    folderPath: "Projects/People Cert",
    archiveFolder: UNDO_ARCHIVE,
    meristemName: "People Cert.md",
    archivedNames: [
      "CLAUDE — archived (2026-06-12).md",
      "People Cert — archived (2026-06-12).md",
      "coral — de-seeded (2026-06-12).md",
    ],
  });
  expect(plan.renames).toHaveLength(2); // CLAUDE + meristem; the log is not moved
  expect(plan.renames.some((r) => r.from.includes("coral — de-seeded"))).toBe(false);
});


// The badge means "a Growth Charter governs here" and nothing else. A bare
// CLAUDE.md is just as likely to be the user's own hand-written agent brief,
// and presence alone cannot tell the two apart — so badging on it marked
// folders that were never seeded. (Founder, 28 July: Alpha wore the seed mark
// with no Charter anywhere in it.)
test("seededRootPaths: a bare CLAUDE.md earns no badge — the Charter is the marker", () => {
  const exists = (p: string) => p === "Projects/Beta/CLAUDE.md";
  expect(seededRootPaths(["Projects/Beta"], exists)).toEqual(new Set());
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
  // C carries only a hand-written CLAUDE.md, so it is not a root.
  const exists = (p: string) => p === "A/Growth Charter.md" || p === "C/CLAUDE.md";
  expect(seededRootPaths(["A", "B", "C"], exists)).toEqual(new Set(["A"]));
});

test("seededRootPaths: an empty folder list returns an empty set (no-op)", () => {
  expect(seededRootPaths([], () => true)).toEqual(new Set());
});

// ── De-seed trashes the untouched pointer files instead of archiving them ──
// Founder, 28 July: "we archive all the pointer files although these are not
// important… the archive folder suddenly seem[s] to gain a bunch of files."
// They are generated breadcrumbs — Reactivate writes them back byte-for-byte —
// so the only thing archiving them bought was clutter. The safeguard: a pointer
// the user has EDITED is archived like any other marker, never trashed.

test("planDeseed: untouched pointers are listed for the trash, not the archive", () => {
  const plan = planDeseed({
    folderPath: "Employment/People Cert",
    meristemName: "People Cert.md",
    markerNames: ["Growth Charter.md"],
    pointerNames: ["CLAUDE.md", "AGENTS.md", "GEMINI.md"],
    hasFoundingLief: false,
    hasKeeper: false,
    today: "2026-07-28",
  });
  expect(plan.deletes).toEqual([
    "Employment/People Cert/CLAUDE.md",
    "Employment/People Cert/AGENTS.md",
    "Employment/People Cert/GEMINI.md",
  ]);
  for (const r of plan.renames) expect(r.from).not.toContain("CLAUDE.md");
});

test("planDeseed: the Growth Charter is always archived, never trashed", () => {
  const plan = planDeseed({
    folderPath: "Employment/People Cert",
    meristemName: "People Cert.md",
    markerNames: ["Growth Charter.md"],
    pointerNames: ["CLAUDE.md"],
    hasFoundingLief: false,
    hasKeeper: false,
    today: "2026-07-28",
  });
  expect(plan.deletes).not.toContain("Employment/People Cert/Growth Charter.md");
  expect(plan.renames.map((r) => r.from)).toContain("Employment/People Cert/Growth Charter.md");
});

test("planDeseed: an EDITED pointer is archived, so the user's words survive", () => {
  // main.ts passes an edited pointer through markerNames instead of pointerNames.
  const plan = planDeseed({
    folderPath: "Employment/People Cert",
    meristemName: "People Cert.md",
    markerNames: ["Growth Charter.md", "CLAUDE.md"],
    pointerNames: ["AGENTS.md", "GEMINI.md"],
    hasFoundingLief: false,
    hasKeeper: false,
    today: "2026-07-28",
  });
  expect(plan.deletes).not.toContain("Employment/People Cert/CLAUDE.md");
  expect(plan.renames).toContainEqual({
    from: "Employment/People Cert/CLAUDE.md",
    to: "Employment/People Cert/_archive — de-seeded (2026-07-28)/CLAUDE — archived (2026-07-28).md",
  });
});

test("planDeseed: no pointerNames → nothing is trashed (back-compatible default)", () => {
  const plan = planDeseed({
    folderPath: "X",
    meristemName: "X.md",
    markerNames: ["Growth Charter.md"],
    hasFoundingLief: false,
    hasKeeper: false,
    today: "2026-07-28",
  });
  expect(plan.deletes).toEqual([]);
});

test("planReactivate: regenerates the trashed pointers alongside the restored Charter", () => {
  const plan = planReactivate({
    folderPath: "Employment/People Cert",
    archiveFolder: "Employment/People Cert/_archive — de-seeded (2026-07-28)",
    meristemName: "People Cert.md",
    archivedNames: ["Growth Charter — archived (2026-07-28).md", "People Cert — archived (2026-07-28).md"],
  });
  expect(plan.writes.map((w) => w.path)).toEqual([
    "Employment/People Cert/CLAUDE.md",
    "Employment/People Cert/AGENTS.md",
    "Employment/People Cert/GEMINI.md",
  ]);
  // Each names the coral and points at the Charter.
  for (const w of plan.writes) {
    expect(w.content).toContain("People Cert");
    expect(w.content).toContain("Growth Charter.md");
  }
});

test("planReactivate: a pointer restored from the archive is NOT overwritten by a fresh one", () => {
  // It only sits in the archive because the user had edited it — their text wins.
  const plan = planReactivate({
    folderPath: "Employment/People Cert",
    archiveFolder: "Employment/People Cert/_archive — de-seeded (2026-07-28)",
    meristemName: "People Cert.md",
    archivedNames: [
      "Growth Charter — archived (2026-07-28).md",
      "CLAUDE — archived (2026-07-28).md",
      "People Cert — archived (2026-07-28).md",
    ],
  });
  expect(plan.renames.map((r) => r.to)).toContain("Employment/People Cert/CLAUDE.md");
  expect(plan.writes.map((w) => w.path)).not.toContain("Employment/People Cert/CLAUDE.md");
  expect(plan.writes.map((w) => w.path)).toEqual([
    "Employment/People Cert/AGENTS.md",
    "Employment/People Cert/GEMINI.md",
  ]);
});

test("isPristinePointer: the generated text is pristine; a user's edit is not", () => {
  const generated = fillTemplate(VENDOR_POINTER_TEMPLATE, { Project: "People Cert" });
  expect(isPristinePointer(generated)).toBe(true);
  // A rename changes only the H1, which must not count as an edit.
  expect(isPristinePointer(fillTemplate(VENDOR_POINTER_TEMPLATE, { Project: "Something Else" }))).toBe(true);
  expect(isPristinePointer(generated + "\n\nAlways run the tests first.\n")).toBe(false);
  expect(isPristinePointer("# My own brief\n\nDo it my way.\n")).toBe(false);
});

// ── Reactivate clears the spent archive folder ──
// Founder, 28 July: after reactivating, "the archive folder remains but empty
// for a note that doesn't make much sense". The provenance log describes an
// action that has just been reversed, sitting in a folder that now looks empty.
// It goes with the folder — UNLESS the user left something else in there.

test("planReactivate: the spent archive folder is trashed once only its own log remains", () => {
  const archive = "Employment/People Cert/_archive — de-seeded (2026-07-28)";
  const plan = planReactivate({
    folderPath: "Employment/People Cert",
    archiveFolder: archive,
    meristemName: "People Cert.md",
    archivedNames: [
      "Growth Charter — archived (2026-07-28).md",
      "People Cert — archived (2026-07-28).md",
      "coral — de-seeded (2026-07-28).md",
    ],
  });
  expect(plan.deletes).toEqual([archive]);
});

test("planReactivate: a log written under the old 'unseeded' spelling counts too", () => {
  const archive = "X/_archive — unseeded (2026-07-20)";
  const plan = planReactivate({
    folderPath: "X",
    archiveFolder: archive,
    meristemName: "X.md",
    archivedNames: ["Growth Charter — archived (2026-07-20).md", "coral — unseeded (2026-07-20).md"],
  });
  expect(plan.deletes).toEqual([archive]);
});

test("planReactivate: a file the user left in the archive keeps the folder alive", () => {
  const archive = "Employment/People Cert/_archive — de-seeded (2026-07-28)";
  const plan = planReactivate({
    folderPath: "Employment/People Cert",
    archiveFolder: archive,
    meristemName: "People Cert.md",
    archivedNames: [
      "Growth Charter — archived (2026-07-28).md",
      "coral — de-seeded (2026-07-28).md",
      "my own notes.md", // never swept up by a tidy-up
    ],
  });
  expect(plan.deletes).toEqual([]);
});

// Founder, 28 July: reactivating left the archive folder standing. It wasn't
// "empty for a note" — it held the KEEPER ARTIFACTS, which De-seed parks there
// and Reactivate had never taken back. So the coral came back without its
// logging hook: Reactivate was not the inverse of De-seed, only most of it.
// main.ts now moves them home through the adapter (they are dot-paths the vault
// API cannot see); this rule knows they are on their way out.
test("planReactivate: keeper artifacts in the archive don't keep the folder standing", () => {
  const archive = "My Project/_archive — de-seeded (2026-07-28)";
  const plan = planReactivate({
    folderPath: "My Project",
    archiveFolder: archive,
    meristemName: "My Project.md",
    archivedNames: [
      "Growth Charter — archived (2026-07-28).md",
      "My Project — archived (2026-07-28).md",
      "prompt — founding intent.md",
      "coral — de-seeded (2026-07-28).md",
      "coral-log-keeper.mjs",
      "settings.json",
      ".coral-log-state.json",
      ".coral-seed-manifest.json",
    ],
  });
  expect(plan.deletes).toEqual([archive]);
});

test("planReactivate: a user's own file still outranks every tidy-up rule", () => {
  const archive = "My Project/_archive — de-seeded (2026-07-28)";
  const plan = planReactivate({
    folderPath: "My Project",
    archiveFolder: archive,
    meristemName: "My Project.md",
    archivedNames: ["coral — de-seeded (2026-07-28).md", "coral-log-keeper.mjs", "thoughts.md"],
  });
  expect(plan.deletes).toEqual([]);
});
