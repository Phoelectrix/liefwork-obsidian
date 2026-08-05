/** Per-branch archive folder + its folder-note (recognised by `kind: archive`). */
export function archivePaths(parentFolderPath: string): { archiveFolder: string; archiveNote: string } {
  const base = parentFolderPath === "/" || parentFolderPath === "" ? "" : `${parentFolderPath}/`;
  const archiveFolder = `${base}_archive`;
  return { archiveFolder, archiveNote: `${archiveFolder}/_archive.md` };
}

/** The archive branch folder-note: the marker the engine recognises + a label. */
export function archiveNoteContent(): string {
  return `---\nkind: archive\n---\n\n# Archive\n`;
}
