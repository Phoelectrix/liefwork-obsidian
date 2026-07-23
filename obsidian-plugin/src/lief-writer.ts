/**
 * Pure path/name helpers for the HUD's "add a lief" writer.
 *
 * The Obsidian-facing writer (create the note, promote a lief to a folder)
 * lives in plant-view.ts; everything that can be reasoned about without the
 * vault — deriving a filename, computing a promotion's target paths — lives
 * here so it can be unit-tested.
 */

/** Max characters of prompt text kept in a derived filename (before ".md"). */
const NAME_MAX = 60;

/** Characters Obsidian / the filesystem disallow (or that break wikilinks).
 *  Hyphens and spaces are legal and meaningful, so they're kept. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/**
 * A short, human-readable `.md` filename derived from `promptText`, unique
 * against `existing` (the target folder's current filenames, with extension).
 * Illegal characters become spaces; the text is truncated at a word boundary;
 * collisions get a " 2", " 3", … counter. Empty input falls back to "lief".
 */
export function liefFilename(promptText: string, existing: string[]): string {
  let base = promptText.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  if (base.length > NAME_MAX) {
    const cut = base.slice(0, NAME_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  }
  if (base === "") base = "lief";

  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let candidate = `${base}.md`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${n}.md`;
    n++;
  }
  return candidate;
}

/**
 * Where a lief's MD must move so the lief becomes a meristem: a sibling folder
 * named after the lief, holding a folder-note of the same name. e.g.
 * `parent/X.md` → folder `parent/X`, folder-note `parent/X/X.md`.
 */
export function promotionPaths(liefPath: string): { folder: string; folderNote: string } {
  const dir = liefPath.includes("/") ? liefPath.slice(0, liefPath.lastIndexOf("/")) : "";
  const base = liefPath.slice(liefPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const folder = dir ? `${dir}/${base}` : base;
  return { folder, folderNote: `${folder}/${base}.md` };
}

/**
 * Obsidian's naming for a brand-new (empty) note: "Untitled.md", then
 * "Untitled 1.md", "Untitled 2.md", … — collision-free against `existing`.
 * Used when "Add Note & Open" is clicked with an empty box (= make me a new
 * note to edit, like Obsidian's New Note).
 */
export function untitledFilename(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has("untitled.md")) return "Untitled.md";
  let n = 1;
  while (taken.has(`untitled ${n}.md`)) n++;
  return `Untitled ${n}.md`;
}

/** The folder levels at which a note's plant could be rooted, from the vault
 *  root (`""`) down to the note's immediate parent. e.g.
 *  `"A/B/C/note.md"` → `["", "A", "A/B", "A/B/C"]`. Used by "Reveal in Liefwork
 *  coral" to let the user pick which level to open the plant at. */
export function ancestorFolders(notePath: string): string[] {
  const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const out = [""]; // vault root
  if (dir === "") return out;
  let acc = "";
  for (const part of dir.split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}

/** Sanitise a user-typed branch name to a safe vault folder/file base.
 *  Mirrors liefFilename's illegal-char handling; empty → "Untitled". */
export function sanitizeName(name: string): string {
  const base = name.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return base === "" ? "Untitled" : base;
}

/** Paths for a brand-new child branch named `name` under `parentFolder`
 *  ("" = vault root): the branch folder and its folder-note (the summary, same
 *  name). The branch is born EMPTY (§2) — no starter lief. */
export function childBranchPaths(
  parentFolder: string,
  name: string,
): { folder: string; folderNote: string } {
  const safe = sanitizeName(name);
  const folder = parentFolder ? `${parentFolder}/${safe}` : safe;
  return { folder, folderNote: `${folder}/${safe}.md` };
}

/**
 * Where a note added from a *lief's* HUD should go, and whether the lief must be
 * promoted first. Default (`promote=false`) = a **sibling** in the lief's parent
 * folder (same parent branch — responding to a note shouldn't branch it).
 * `promote=true` = upgrade the lief to a meristem (its MD → folder-note) and
 * nest the new note under it; the returned `promote` is the side-effect to run.
 * `targetFolder` is the new note's folder ("" = vault root).
 */
export function liefNotePlan(
  liefPath: string,
  promote: boolean,
): { targetFolder: string; promote: { folder: string; folderNote: string } | null } {
  if (promote) {
    const p = promotionPaths(liefPath);
    return { targetFolder: p.folder, promote: p };
  }
  const dir = liefPath.includes("/") ? liefPath.slice(0, liefPath.lastIndexOf("/")) : "";
  return { targetFolder: dir, promote: null };
}
