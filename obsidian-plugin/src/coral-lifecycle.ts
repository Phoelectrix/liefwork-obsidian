/**
 * Pure logic for the seeded-folder lifecycle: classifying a folder's coral
 * status (the Guard) and deciding which lifecycle menu items it offers.
 *
 * All archive-over-delete, none destructive. The Obsidian-facing I/O (reading
 * presence facts, renaming files, writing chronicle liefs) lives in the modal /
 * main.ts; everything reasoned about without the vault lives here so it can be
 * unit-tested. (Mirrors seed-coral.ts.)
 */

import {
  GROWTH_CHARTER_BASENAME,
  AGENT_POINTER_BASENAMES,
  VENDOR_POINTER_TEMPLATE,
  fillTemplate,
} from "./seed-templates.ts";

/** Presence facts about a folder ITSELF (not its ancestry, except `insideCoral`). */
export interface FolderCoralFacts {
  /** This folder has its own `Growth Charter.md` — it governs as a root coral. */
  hasOwnCharter: boolean;
  /** This folder has its own folder-note meristem (`<Name>.md`). */
  hasOwnMeristem: boolean;
  /** This folder has a de-seed archive subfolder — dormant, restorable. */
  hasDeseedArchive: boolean;
  /** An ancestor has a Charter — this folder sits inside a governed coral. */
  insideCoral: boolean;
}

export type CoralStatus =
  | "fresh" // never seeded — seedable (root if !insideCoral, else a sub-coral)
  | "seeded-root" // its own Growth Charter governs it
  | "seeded-sub" // its own meristem, no own Charter (inherits the parent's)
  | "de-seeded"; // no live markers, but a de-seed archive sits here — restorable

/**
 * A folder's coral status from its own presence facts. The guard keys on what
 * *this* folder has, never on "is it inside a coral" — a fresh subfolder must
 * stay seedable. Live markers (Charter / meristem) win over a leftover de-seed
 * archive (so a re-seed reads as seeded again, not de-seeded).
 *
 * ROOT MEANS "HAS ITS OWN GROWTH CHARTER" — nothing else. A bare `CLAUDE.md`
 * used to count too, as a pre-Charter legacy marker. It cannot: the file is
 * also what a user hand-writes as their own agent brief, and presence alone
 * can't tell the two apart. That misread every hand-written CLAUDE.md as a
 * seeded root — badging it, and offering "Undo seeding", which would have
 * archived the user's own brief and stopped it governing. Five folders in the
 * founder's vault were in that state on 28 July and not one held a generated
 * pointer. Nothing is lost by dropping it: the Charter landed 22 July, two
 * days BEFORE the first public release, so no released version ever seeded a
 * coral without one.
 */
export function classifyFolder(f: FolderCoralFacts): CoralStatus {
  if (f.hasOwnCharter) return "seeded-root";
  if (f.hasOwnMeristem) return "seeded-sub";
  if (f.hasDeseedArchive) return "de-seeded";
  return "fresh";
}

/** A seed-lifecycle menu action. (`open` — "Open as plant" — is offered on every
 *  folder by main.ts regardless, so it's not part of this status mapping.) */
export type CoralAction = "seed" | "deseed" | "reactivate";

/**
 * Which lifecycle items a folder of the given status offers.
 *
 * The whole model, in the founder's words (28 July): a folder without a Growth
 * Charter can be **seeded** with one; a folder with one can only be
 * **de-seeded**; a folder with no active Charter but an archived one can be
 * **reactivated** or **seeded anew**. Re-seeding is retired as a concept — it
 * is de-seed then seed, two deliberate steps, and the user can still do exactly
 * that.
 *
 * Note "seeded-sub" offers "seed" like a fresh folder: a folder inside a coral
 * has no Charter of its own, so it is seedable, and seeding gives it one that
 * governs it and its descendants while the parent's stays active (nearest file
 * wins, so the closer Charter takes precedence). The modal confirms that before
 * writing anything.
 */
export function coralMenuActions(status: CoralStatus): CoralAction[] {
  switch (status) {
    case "fresh":
      return ["seed"];
    case "seeded-root":
      return ["deseed"]; // its Charter governs — the only move is to make it dormant
    case "seeded-sub":
      return ["seed"]; // no Charter of its own yet — seeding gives it one
    case "de-seeded":
      return ["reactivate", "seed"]; // restore the archived scaffold, or seed anew
  }
}

/** The seed-badge helper: which of `folderPaths` are seeded-coral ROOTS — same
 *  "own Growth Charter.md" test as classifyFolder's
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
    if (exists(at(GROWTH_CHARTER_BASENAME))) {
      result.add(folder);
    }
  }
  return result;
}

/**
 * Is this pointer file still the generated breadcrumb, untouched by the user?
 *
 * Decides whether De-seed may trash it (regenerable, holds nothing of theirs)
 * or must archive it (their words, keep them). Compares everything BELOW the
 * H1 — the heading interpolates the coral name, which a rename would change
 * without the user having touched the file. Whitespace-insensitive at the
 * edges; anything else differing means they wrote in it.
 */
export function isPristinePointer(content: string): boolean {
  const body = (text: string) => {
    const nl = text.indexOf("\n");
    return (nl === -1 ? "" : text.slice(nl + 1)).trim();
  };
  return body(content) === body(VENDOR_POINTER_TEMPLATE);
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
  /** File moves to perform. */
  renames: RenameOp[];
  /** Chronicle liefs to write — the honest record of the action. */
  writes: ChronicleFile[];
  /** Paths to send to the user's trash once the moves are done. */
  deletes?: string[];
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

/** A dated archive subfolder for a folder, e.g. `<folder>/_archive — de-seeded (date)`. */
export function archiveFolderPath(folderPath: string, label: string, today: string): string {
  return join(folderPath, `_archive — ${label} (${today})`);
}

/**
 * The moves that tuck a folder's coral **scaffold** into an archive subfolder.
 * The scaffold ONLY: grown notes always stay where they are. (A "blank slate"
 * toggle used to move them in here too — removed 28 July, because a re-seed
 * archive is invisible to classifyFolder and planReactivate leaves non-scaffold
 * files behind, so archived content had no route back through the UI. In a
 * plugin built on archive-over-delete-and-restore, it was the one irreversible
 * operation. Moving notes aside is now the user's own deliberate act.)
 * Markers = the Charter + the vendor pointers (legacy corals: a bare `CLAUDE.md`).
 * Marker files are **renamed on the way in** so the archive isn't itself read as
 * a coral: `CLAUDE.md` → `CLAUDE — archived (date).md` (only a bare `CLAUDE.md`
 * auto-loads up-tree or classifies as a coral; the descriptive name does neither),
 * and the meristem `<name>.md` → `<name> — archived (date).md` (so it isn't a
 * folder-note of the archive dir). The founding lief + any grown content move in
 * unchanged — plain notes, not markers.
 */
function archiveScaffoldRenames(
  folderPath: string,
  archiveFolder: string,
  today: string,
  opts: { meristemName: string; markerNames: string[]; hasFoundingLief: boolean },
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
  return renames;
}

export interface DeseedInput {
  folderPath: string;
  /** The folder-note (meristem) basename incl. extension, e.g. `"People Cert.md"`. */
  meristemName: string;
  /** Marker basenames to ARCHIVE (renamed inert): the Growth Charter, plus any
   *  vendor pointer the user has edited away from the generated text. */
  markerNames: string[];
  /** Pointer basenames that still hold the generated text verbatim — trashed
   *  rather than archived, and regenerated by {@link planReactivate}. */
  pointerNames?: string[];
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
  /** Notes to write — the provenance log. */
  writes: ChronicleFile[];
  /** Untouched generated pointer files to send to the user's trash instead of
   *  the archive. They carry no content of the user's — Reactivate regenerates
   *  them byte-for-byte — so archiving them only padded the archive folder with
   *  files nobody would ever read. (Founder, 28 July.) Anything the user has
   *  EDITED is never listed here; it goes to the archive like any other marker.
   *  Optional: a plan built without it simply trashes nothing. */
  deletes?: string[];
}

/**
 * De-seed — *archive, don't delete*. Tucks **all the seed
 * documents** (the growth-instruction markers + meristem + the founding-prompt lief) into a dated
 * `_archive — de-seeded (date)/` subfolder, with a provenance log inside. The
 * user's own data is left untouched in place — only the scaffold moves. The
 * markers are renamed inert, so the archive isn't read as a coral. Reversible
 * via {@link planReactivate}.
 */
export function planDeseed(input: DeseedInput): ArchivePlan {
  const { folderPath, meristemName, markerNames, pointerNames = [], hasFoundingLief, hasKeeper, today } = input;
  const archiveFolder = archiveFolderPath(folderPath, "de-seeded", today);
  const renames = archiveScaffoldRenames(folderPath, archiveFolder, today, {
    meristemName,
    markerNames,
    hasFoundingLief,
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
    deletes: pointerNames.map((n) => join(folderPath, n)),
    writes: [
      chronicle(
        `${archiveFolder}/coral — de-seeded (${today}).md`,
        `coral — de-seeded from ${name} (${today})`,
        today,
        `These are the **seed documents** that were made dormant when *De-seed* was run on **${name}** ` +
          `on ${today}. Your own data was left untouched in its folder — only the scaffold moved here.\n\n` +
          `Archived: the coral's growth instructions (the Growth Charter, renamed "… — archived" so it no ` +
          `longer governs), the meristem (\`${name} — archived (${today}).md\`), and the founding-prompt lief.\n\n` +
          `The agent pointer files (\`CLAUDE.md\`, \`AGENTS.md\`, \`GEMINI.md\`) went to your trash rather than ` +
          `here — they are generated breadcrumbs holding no content of your own, and **Reactivate** writes ` +
          `them again. Any you had edited yourself were archived here instead.\n\n` +
          `**To restore:** run **Reactivate** on the folder (or move these back and strip the ` +
          `" — archived (…)" suffixes). Nothing was deleted.`,
      ),
    ],
  };
}

export interface ReactivateInput {
  folderPath: string;
  /** The de-seed archive subfolder to restore from. */
  archiveFolder: string;
  /** The folder-note (meristem) basename to restore to, e.g. `"People Cert.md"`. */
  meristemName: string;
  /** Direct child basenames currently inside `archiveFolder`. */
  archivedNames: string[];
}

/** The provenance log De-seed leaves inside its archive (either spelling — the
 *  command was "Undo seeding" until 28 July). */
const PROVENANCE_LOG = /^coral — (de-seeded|unseeded) \(/;

/** The keeper artifacts De-seed parks in the archive, flattened to basenames.
 *  They live under `.claude/`, which the vault API cannot see, so Reactivate
 *  moves them back through the filesystem adapter (main.ts) rather than through
 *  this plan's renames. Listed here so the leftover test knows they are ON
 *  THEIR WAY OUT and does not treat them as the user's own files. */
export const KEEPER_ARCHIVE_NAMES: readonly string[] = [
  "coral-log-keeper.mjs",
  "settings.json",
  ".coral-log-state.json",
  ".coral-seed-manifest.json",
];

/** Matches an archived marker's descriptive name — the Growth Charter, a legacy
 *  CLAUDE.md, or a vendor pointer (AGENTS.md / GEMINI.md) — capturing its live base. */
const MARKER_RESTORE = /^(Growth Charter|CLAUDE|AGENTS|GEMINI) — archived \(/;

/**
 * Reactivate — the inverse of {@link planDeseed}. Moves the archived scaffold back
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
  // Once everything meaningful is out, the archive folder holds only the
  // provenance log — a note about an action that has just been reversed, in a
  // folder that now looks empty. Trash the folder with it. Anything ELSE the
  // user left in there keeps the folder alive: their files are never swept up
  // by a tidy-up. (Founder, 28 July.)
  const restored = new Set(renames.map((r) => r.from.slice(archiveFolder.length + 1)));
  const leftovers = archivedNames.filter((n) => !restored.has(n));
  const disposable = (n: string) => PROVENANCE_LOG.test(n) || KEEPER_ARCHIVE_NAMES.includes(n);
  const deletes = leftovers.every(disposable) ? [archiveFolder] : [];

  // Regenerate the pointer files De-seed trashed. Skipped for any pointer being
  // restored from the archive — that one was edited by the user, and their text
  // wins over the template.
  const restoring = new Set(renames.map((r) => r.to));
  const writes: ChronicleFile[] = [];
  const coralName = meristemName.replace(/\.md$/i, "");
  for (const pointer of AGENT_POINTER_BASENAMES) {
    const path = join(folderPath, pointer);
    if (restoring.has(path)) continue;
    writes.push({ path, content: fillTemplate(VENDOR_POINTER_TEMPLATE, { Project: coralName }) });
  }
  return { renames, writes, deletes };
}
