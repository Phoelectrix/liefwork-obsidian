/** Path to a folder's own metadata note (`<folder>/<name>.md`).
 *
 *  Root special-case: the vault-root TFolder has an EMPTY name (`""`), so a naive
 *  `${name}.md` resolves to `.md` — an invisible dotfile that never matches a real
 *  root folder-note. The root's note is named after the VAULT (`<vault>.md`), so
 *  callers pass `app.vault.getName()` as `vaultName`. This is the single source of
 *  truth for the folder-note path (imported by both vault-adapter.ts and
 *  plant-view.ts — no diverging copy). Kept obsidian-free so it unit-tests in
 *  isolation. */
export function folderNotePath(folderPath: string, folderName: string, vaultName: string): string {
  const isRoot = folderPath === "/" || folderPath === "";
  const noteName = `${isRoot ? vaultName : folderName}.md`;
  return isRoot ? noteName : `${folderPath}/${noteName}`;
}

/** Reverse of `folderNotePath`: the meristem node id a folder-note's FILE path
 *  stands for, or null when the path isn't a folder-note at all. A meristem's
 *  node id is its FOLDER path (folder-to-hierarchy stamps `id = node.path`) and
 *  the default display filters the folder-note out of the tree entirely — so
 *  anything selecting nodes by a file path (Reveal-in-coral) needs this mapping
 *  to reach a meristem. Root special-case mirrors folderNotePath: the vault
 *  root's note is `<vault>.md` and its node id is "/" (vault-adapter's
 *  `folder.path || "/"`). */
export function folderNoteMeristemId(filePath: string, vaultName: string): string | null {
  const slash = filePath.lastIndexOf("/");
  const base = slash === -1 ? filePath : filePath.slice(slash + 1);
  if (!base.toLowerCase().endsWith(".md")) return null;
  const stem = base.slice(0, -3);
  if (slash === -1) return stem === vaultName ? "/" : null;
  const parent = filePath.slice(0, slash);
  const parentName = parent.slice(parent.lastIndexOf("/") + 1);
  return stem === parentName ? parent : null;
}
