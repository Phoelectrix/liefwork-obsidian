/**
 * Pure logic for the seeded-folder lifecycle: classifying a folder's coral
 * status (the Guard) and deciding which lifecycle menu items it offers.
 *
 * All archive-over-delete, none destructive. The Obsidian-facing I/O (reading
 * presence facts, renaming files, writing chronicle liefs) lives in the modal /
 * main.ts; everything reasoned about without the vault lives here so it can be
 * unit-tested. (Mirrors seed-coral.ts.)
 */

import { planSeed, type SeedOptions } from "./seed-coral.ts";
import { GROWTH_CHARTER_BASENAME } from "./seed-templates.ts";

/** Presence facts about a folder ITSELF (not its ancestry, except `insideCoral`). */
export interface FolderCoralFacts {
  /** This folder has its own `Growth Charter.md` — it governs as a root coral. */
  hasOwnCharter: boolean;
  /** This folder has its own `CLAUDE.md` — legacy pre-charter root marker (also
   *  present on charter corals as a generated pointer; either way: root). */
  hasOwnClaude: boolean;
  /** This folder has its own folder-note meristem (`<Name>.md`). */
  hasOwnMeristem: boolean;
  /** This folder has an `_archive — unseeded (…)/` subfolder — un-seeded, restorable. */
  hasUnseedArchive: boolean;
  /** An ancestor has a Charter/CLAUDE.md — this folder sits inside a governed coral. */
  insideCoral: boolean;
}

export type CoralStatus =
  | "fresh" // never seeded — seedable (root if !insideCoral, else a sub-coral)
  | "seeded-root" // its own Growth Charter (or legacy CLAUDE.md) governs it
  | "seeded-sub" // its own meristem, no own Charter (inherits the parent's)
  | "unseeded"; // no live markers, but an unseed archive sits here — restorable

/**
 * A folder's coral status from its own presence facts. The guard keys on what
 * *this* folder has, never on "is it inside a coral" — a fresh subfolder must
 * stay seedable as a sub-coral. Live markers (Charter/CLAUDE.md / meristem) win
 * over a leftover unseed archive (so a re-seed reads as seeded again, not
 * unseeded).
 */
export function classifyFolder(f: FolderCoralFacts): CoralStatus {
  if (f.hasOwnCharter || f.hasOwnClaude) return "seeded-root";
  if (f.hasOwnMeristem) return "seeded-sub";
  if (f.hasUnseedArchive) return "unseeded";
  return "fresh";
}

/** A seed-lifecycle menu action. (`open` — "Open as plant" — is offered on every
 *  folder by main.ts regardless, so it's not part of this status mapping.) */
export type CoralAction = "seed" | "reseed" | "undo" | "reactivate";

/** Which lifecycle items a folder of the given status offers. */
export function coralMenuActions(status: CoralStatus): CoralAction[] {
  switch (status) {
    case "fresh":
      return ["seed"];
    case "seeded-root":
      return ["reseed", "undo"]; // its own scaffold can be re-seeded or un-seeded (archived)
    case "seeded-sub":
      return ["reseed"]; // governance is the parent's; archiving its scaffold is Re-seed's job
    case "unseeded":
      return ["reactivate", "seed"]; // restore the archived scaffold, or seed anew
  }
}

/** The seed-badge helper: which of `folderPaths` are seeded-coral ROOTS — same
 *  "own Growth Charter.md or legacy CLAUDE.md" test as classifyFolder's
 *  "seeded-root" case, applied per-folder with no ancestry lookup, so a
 *  sub-coral (its own meristem, no own marker — governed by a parent's
 *  Charter) never matches. `exists` is the vault-presence check (the caller
 *  supplies `Boolean(app.vault.getAbstractFileByPath(path))`); kept as an
 *  injected function so this stays pure and unit-testable without a vault. */
export function seededRootPaths(
  folderPaths: readonly string[],
  exists: (path: string) => boolean,
): Set<string> {
  const result = new Set<string>();
  for (const folder of folderPaths) {
    const at = (name: string) => (folder === "" || folder === "/" ? name : `${folder}/${name}`);
    if (exists(at(GROWTH_CHARTER_BASENAME)) || exists(at("CLAUDE.md"))) {
      result.add(folder);
    }
  }
  return result;
}

// ── Lifecycle plans: rename ops + chronicle liefs (all archive-over-delete) ──

export interface RenameOp {
  from: string;
  to: string;
}

export interface ChronicleFile {
  path: string;
  content: string;
}

export interface LifecyclePlan {
  /** File moves to perform (never deletions). */
  renames: RenameOp[];
  /** Chronicle liefs to write — the honest record of the action. */
  writes: ChronicleFile[];
}

/** Join a coral-relative name onto its folder ("" / "/" = vault root → no prefix). */
function join(folderPath: string, name: string): string {
  return folderPath === "" || folderPath === "/" ? name : `${folderPath}/${name}`;
}

/** A dated chronicle/log note (no `kind` — it's a system record, not a turn). */
function chronicle(notePath: string, heading: string, today: string, body: string): ChronicleFile {
  return {
    path: notePath,
    content: `---\ncreated: ${today}\n---\n\n# ${heading}\n\n${body}\n`,
  };
}

/** A dated archive subfolder for a folder, e.g. `<folder>/_archive — unseeded (date)`. */
export function archiveFolderPath(folderPath: string, label: string, today: string): string {
  return join(folderPath, `_archive — ${label} (${today})`);
}

/**
 * The moves that tuck a folder's coral **scaffold** into an archive subfolder.
 * Markers = the Charter + the vendor pointers (legacy corals: a bare `CLAUDE.md`).
 * Marker files are **renamed on the way in** so the archive isn't itself read as
 * a coral: `CLAUDE.md` → `CLAUDE — archived (date).md` (only a bare `CLAUDE.md`
 * auto-loads up-tree or classifies as a coral; the descriptive name does neither),
 * and the meristem `<name>.md` → `<name> — archived (date).md` (so it isn't a
 * folder-note of the archive dir). The founding lief + any grown content move in
 * unchanged — plain notes, not markers. Shared by Undo (un-seed) and Re-seed.
 */
function archiveScaffoldRenames(
  folderPath: string,
  archiveFolder: string,
  today: string,
  opts: { meristemName: string; markerNames: string[]; hasFoundingLief: boolean; grownEntries: string[] },
): RenameOp[] {
  const into = (name: string) => `${archiveFolder}/${name}`;
  const renames: RenameOp[] = [];
  for (const marker of opts.markerNames) {
    const base = marker.replace(/\.md$/i, "");
    renames.push({ from: join(folderPath, marker), to: into(`${base} — archived (${today}).md`) });
  }
  const meristemBase = opts.meristemName.replace(/\.md$/i, "");
  renames.push({
    from: join(folderPath, opts.meristemName),
    to: into(`${meristemBase} — archived (${today}).md`),
  });
  if (opts.hasFoundingLief) {
    renames.push({
      from: join(folderPath, "prompt — founding intent.md"),
      to: into("prompt — founding intent.md"),
    });
  }
  for (const name of opts.grownEntries) {
    renames.push({ from: join(folderPath, name), to: into(name) });
  }
  return renames;
}

export interface UndoInput {
  folderPath: string;
  /** The folder-note (meristem) basename incl. extension, e.g. `"People Cert.md"`. */
  meristemName: string;
  /** Present coral-marker basenames — the Growth Charter + any vendor pointers
   *  (a legacy coral passes just ["CLAUDE.md"]). Empty for a sub-coral. */
  markerNames: string[];
  /** Is a `prompt — founding intent.md` present to archive? */
  hasFoundingLief: boolean;
  /** Are the keeper artifacts (`.claude/hooks/coral-log-keeper.mjs` + state + manifest) present to archive? */
  hasKeeper: boolean;
  today: string;
}

export interface ArchivePlan {
  /** The dated archive subfolder that receives the scaffold. */
  archiveFolder: string;
  /** Moves into the archive — markers renamed inert. */
  renames: RenameOp[];
  /** Notes to write (a provenance log; for Re-seed, also the fresh seed). */
  writes: ChronicleFile[];
}

/**
 * Undo Seeding (un-seed) — *archive, don't delete*. Tucks **all the seed
 * documents** (the growth-instruction markers + meristem + the founding-prompt lief) into a dated
 * `_archive — unseeded (date)/` subfolder, with a provenance log inside. The
 * user's own data is left untouched in place — only the scaffold moves. The
 * markers are renamed inert, so the archive isn't read as a coral. Reversible
 * via {@link planReactivate}.
 */
export function planUndo(input: UndoInput): ArchivePlan {
  const { folderPath, meristemName, markerNames, hasFoundingLief, hasKeeper, today } = input;
  const archiveFolder = archiveFolderPath(folderPath, "unseeded", today);
  const renames = archiveScaffoldRenames(folderPath, archiveFolder, today, {
    meristemName,
    markerNames,
    hasFoundingLief,
    grownEntries: [],
  });
  if (hasKeeper) {
    const into = (name: string) => `${archiveFolder}/${name}`;
    for (const rel of [
      ".claude/hooks/coral-log-keeper.mjs",
      ".claude/.coral-log-state.json",
      ".claude/.coral-seed-manifest.json",
    ]) {
      const base = rel.split("/").pop()!;
      renames.push({ from: join(folderPath, rel), to: into(base) });
    }
  }
  const name = meristemName.replace(/\.md$/i, "");
  return {
    archiveFolder,
    renames,
    writes: [
      chronicle(
        `${archiveFolder}/coral — unseeded (${today}).md`,
        `coral — unseeded from ${name} (${today})`,
        today,
        `These are the **seed documents** that were archived when *Undo Seeding* was run on **${name}** ` +
          `on ${today}. Your own data was left untouched in its folder — only the scaffold moved here.\n\n` +
          `Archived: the coral's growth instructions (the Growth Charter and/or agent pointer files, ` +
          `renamed "… — archived" so they no longer govern), the meristem ` +
          `(\`${name} — archived (${today}).md\`), and the founding-prompt lief.\n\n` +
          `**To restore:** run **Reactivate** on the folder (or move these back and strip the ` +
          `" — archived (…)" suffixes). Nothing was deleted.`,
      ),
    ],
  };
}

export interface ReactivateInput {
  folderPath: string;
  /** The unseed archive subfolder to restore from. */
  archiveFolder: string;
  /** The folder-note (meristem) basename to restore to, e.g. `"People Cert.md"`. */
  meristemName: string;
  /** Direct child basenames currently inside `archiveFolder`. */
  archivedNames: string[];
}

/** Matches an archived marker's descriptive name — the Growth Charter, a legacy
 *  CLAUDE.md, or a vendor pointer (AGENTS.md / GEMINI.md) — capturing its live base. */
const MARKER_RESTORE = /^(Growth Charter|CLAUDE|AGENTS|GEMINI) — archived \(/;

/**
 * Reactivate — the inverse of {@link planUndo}. Moves the archived scaffold back
 * to its active names (each marker "<base> — archived (…).md" → "<base>.md" —
 * the Growth Charter, CLAUDE/AGENTS/GEMINI pointers — the meristem back to
 * <name>.md, the founding lief back), restoring the coral. The provenance log is
 * left behind in the (now near-empty) archive as a record.
 */
export function planReactivate(input: ReactivateInput): LifecyclePlan {
  const { folderPath, archiveFolder, meristemName, archivedNames } = input;
  const from = (name: string) => `${archiveFolder}/${name}`;
  const renames: RenameOp[] = [];
  for (const name of archivedNames) {
    const marker = name.match(MARKER_RESTORE);
    if (marker) {
      renames.push({ from: from(name), to: join(folderPath, `${marker[1]}.md`) });
    } else if (name === "prompt — founding intent.md") {
      renames.push({ from: from(name), to: join(folderPath, name) });
    } else if (/ — archived \(/.test(name)) {
      // the meristem (any "<x> — archived (…).md" that isn't a marker file)
      renames.push({ from: from(name), to: join(folderPath, meristemName) });
    }
    // anything else (the provenance log, stray notes) stays in the archive
  }
  return { renames, writes: [] };
}

export interface ReseedInput {
  /** The fresh coral to grow once the old one is archived. `seed.today` is reused. */
  seed: SeedOptions;
  /** The old folder-note (meristem) basename incl. extension, e.g. `"People Cert.md"`. */
  meristemName: string;
  /** Present coral-marker basenames — the Growth Charter + any vendor pointers
   *  (a legacy coral passes just ["CLAUDE.md"]). Empty for a sub-coral. */
  markerNames: string[];
  /** Is a `prompt — founding intent.md` present to archive? */
  hasFoundingLief: boolean;
  /** Extra direct children (basenames) to archive too — empty = keep grown content in place. */
  grownEntries: string[];
}

export type ReseedPlan = ArchivePlan;

/**
 * Re-seed — the proper alternative to hand-deleting marker files. Per
 * archive-over-delete, it **moves the old scaffold aside** into a dated
 * `_archive — re-seeded (date)/` subfolder (markers renamed inert; see
 * {@link archiveScaffoldRenames}), then seeds fresh. The founding lief and any
 * grown content move in unchanged. Nothing is deleted.
 */
export function planReseed(input: ReseedInput): ReseedPlan {
  const { seed, meristemName, markerNames, hasFoundingLief, grownEntries } = input;
  const today = seed.today;
  const folder = seed.folderPath;
  const archiveFolder = archiveFolderPath(folder, "re-seeded", today);
  const renames = archiveScaffoldRenames(folder, archiveFolder, today, {
    meristemName,
    markerNames,
    hasFoundingLief,
    grownEntries,
  });

  const writes: ChronicleFile[] = [
    ...planSeed(seed),
    chronicle(
      join(folder, `coral — re-seeded (${today}).md`),
      `coral — re-seeded (${today})`,
      today,
      `This coral was re-seeded. The previous scaffold (growth instructions + meristem + founding lief` +
        `${grownEntries.length ? " + the grown content" : ""}) was **archived**, not deleted, into ` +
        `\`_archive — re-seeded (${today})\` — the growth-instruction files were renamed there so they no longer govern anything. ` +
        `A fresh coral was grown in its place. Recover anything from the archive folder.`,
    ),
  ];

  return { archiveFolder, renames, writes };
}
