/** Pure resolver for folder-note rename sync.
 *
 * Obsidian fires `rename` AFTER moving a folder's children, so when folder
 * `oldFolderPath` becomes `newFolderPath` the folder-note is already at
 * `<newFolderPath>/<oldBase>.md`. To keep the folder-note convention
 * (basename == folder name) it must be renamed to `<newFolderPath>/<newBase>.md`.
 * Returns null when there's nothing to do (a move, or no folder-note → not a meristem).
 */
export function folderNoteSyncRename(
  oldFolderPath: string,
  newFolderPath: string,
  noteExists: (path: string) => boolean,
): { from: string; to: string } | null {
  const oldBase = baseName(oldFolderPath);
  const newBase = baseName(newFolderPath);
  if (oldBase === newBase) return null; // moved, not renamed
  const from = `${newFolderPath}/${oldBase}.md`;
  if (!noteExists(from)) return null; // no folder-note → not a meristem
  const to = `${newFolderPath}/${newBase}.md`;
  return { from, to };
}

/** Reverse sync: when a *folder-note* (a meristem's summary, whose basename
 * matches its parent folder's name) is itself renamed, the folder must follow so
 * the folder-note convention (basename == folder name) holds. Returns the folder
 * rename `{from, to}`, or null when the renamed note isn't a folder-note, sits at
 * the vault root, or was moved to another folder rather than renamed in place.
 *
 * Loop-safe against `folderNoteSyncRename`: that path renames `<f>/Old.md` →
 * `<f>/New.md` inside folder `f` named `New`; the note's OLD basename (`Old`) ≠
 * the folder name (`New`), so this returns null and no folder rename re-fires.
 */
export function folderRenameFromNote(
  oldNotePath: string,
  newNotePath: string,
): { from: string; to: string } | null {
  const oldParent = dirName(oldNotePath);
  const newParent = dirName(newNotePath);
  if (oldParent !== newParent) return null; // moved to another folder, not renamed
  if (oldParent === "") return null; // a note at vault root has no folder-note role
  const oldBase = noteBase(oldNotePath);
  const newBase = noteBase(newNotePath);
  if (oldBase === newBase) return null;
  if (oldBase !== baseName(oldParent)) return null; // wasn't this folder's folder-note
  const grand = dirName(oldParent);
  return { from: oldParent, to: grand ? `${grand}/${newBase}` : newBase };
}

function baseName(p: string): string {
  return p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
}

/** The directory portion of a path ("" when the path has no slash). */
function dirName(p: string): string {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}

/** A note's basename without its `.md` extension. */
function noteBase(p: string): string {
  const b = baseName(p);
  return b.endsWith(".md") ? b.slice(0, -3) : b;
}
