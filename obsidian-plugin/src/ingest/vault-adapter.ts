import { type App, TFolder, TFile, FileSystemAdapter } from "obsidian";
import type { FolderNode } from "./folder-node.ts";
import { resolveCreated, resolveOrder } from "../lief-frontmatter.ts";
import { folderNotePath, folderNoteMeristemId } from "./folder-note-path.ts";
import { AGENT_POINTER_BASENAMES } from "../seed-templates.ts";

export { folderNotePath, folderNoteMeristemId };

/** Generated agent-pointer files — config breadcrumbs, not memory. Hidden from
 *  the coral in every display mode (they stay visible in the file explorer);
 *  the Growth Charter itself renders as a normal node. */
const POINTER_BASENAMES = new Set<string>(AGENT_POINTER_BASENAMES);

/** A folder's true creation time via the desktop filesystem (TFolder carries
 *  no stat). Without this, folders tie as "oldest" in the chronological sort
 *  and clump alphabetically at the branch base instead of interleaving with
 *  notes by date — "all items along a branch by date created" is the rule. */
function folderCreatedAt(folder: TFolder, app: App): string | undefined {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return undefined;
  try {
    // Desktop-only plugin (isDesktopOnly: true): Electron's window.require is
    // present at runtime, and node:fs is the only source of folder birthtime —
    // a static import would break the browser-targeted bundle. Typed locally
    // so no @types/node is needed to typecheck this file.
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    if (!req) return undefined;
    const fs = req("node:fs") as { statSync: (p: string) => { birthtime: Date } };
    const st = fs.statSync(adapter.getFullPath(folder.path));
    return new Date(st.birthtime).toISOString();
  } catch {
    return undefined;
  }
}

export interface VaultAdapterOpts {
  /** Include a note's headings as its children (default FALSE — canon is
   *  lief = note/leaf-folder; a transcript is ONE lief, not forty). Heading
   *  expansion is a future per-node action ("expand lief → branch"). */
  includeHeadings?: boolean;
  /** Include NON-markdown files as liefs (default FALSE — notes-only, §4). On,
   *  every file the explorer lists becomes a lief (full filename, ctime date). */
  allFiles?: boolean;
}

/**
 * Walk an Obsidian TFolder into a plain FolderNode tree.
 * Folders → branches; markdown notes → leaves; a note's headings → its
 * children (flat, in document order). Non-markdown files are skipped.
 */
export function vaultFolderToNode(
  folder: TFolder,
  app: App,
  opts: VaultAdapterOpts = {},
): FolderNode {
  const includeHeadings = opts.includeHeadings === true;
  const children: FolderNode[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile && POINTER_BASENAMES.has(child.name)) continue;
    if (child instanceof TFolder) {
      children.push(vaultFolderToNode(child, app, opts));
    } else if (child instanceof TFile && child.extension === "md") {
      children.push(fileToNode(child, app, includeHeadings));
    } else if (child instanceof TFile && opts.allFiles === true) {
      // All-files mode (§4): a non-md file becomes a lief. Name = FULL filename
      // incl. extension (so `diagram.png` stays distinct from a `diagram` note);
      // date from the fs ctime; no frontmatter (binaries have none).
      children.push(nonMdFileNode(child));
    }
  }

  // `order` is READ-ONLY: respected at render when present, never healed or
  // written into existing files. Children keep whatever `order`/`createdAt` they
  // genuinely carry; the engine's structure pass falls back to `createdAt` for
  // any branch not every child of which is ordered. (Notes the plugin CREATES —
  // Add Note, seeding, archive/restore — still stamp `order` at birth.)
  const node: FolderNode = {
    name: folder.name || app.vault.getName(),
    path: folder.path || "/",
    children,
    isBranch: true, // every folder is a branch (§1), set by the one producer that knows it's a directory
  };
  const meta = folderMeta(folder, app);
  if (meta.createdAt) node.createdAt = meta.createdAt;
  if (meta.order !== undefined) node.order = meta.order;
  if (meta.isArchive) node.isArchive = true;
  return node;
}

/** A folder's `created`/`order`/`isArchive` from its folder-note's frontmatter
 *  (the meristem's own MD, `<folder>/<name>.md`); `created` falls back to the
 *  fs birthtime. So a meristem orders durably/intentionally like a lief.
 *  `isArchive` is true when the folder-note has `kind: archive`. */
function folderMeta(
  folder: TFolder,
  app: App,
): { createdAt?: string; order?: number; isArchive?: boolean } {
  const note = app.vault.getAbstractFileByPath(
    folderNotePath(folder.path, folder.name, app.vault.getName()),
  );
  const birthtime = folderCreatedAt(folder, app);
  if (note instanceof TFile) {
    const fm = app.metadataCache.getFileCache(note)?.frontmatter;
    const createdAt = resolveCreated(fm?.created, birthtime ?? "");
    const kind: unknown = fm?.kind;
    return {
      createdAt: createdAt || undefined,
      order: resolveOrder(fm?.order),
      isArchive: kind === "archive",
    };
  }
  return { createdAt: birthtime };
}

/** A non-markdown file as a leaf FolderNode: full filename (with extension) as
 *  the label, fs ctime as `createdAt`, no frontmatter/order (binaries carry
 *  none). Used only in all-files mode. */
function nonMdFileNode(file: TFile): FolderNode {
  return {
    name: file.name,                                      // FULL filename incl. extension
    path: file.path,
    createdAt: new Date(file.stat.ctime).toISOString(),
    nonMd: true,                                          // → teal label tint (colour by file type)
  };
}

function fileToNode(file: TFile, app: App, includeHeadings: boolean): FolderNode {
  // Durable order from frontmatter; `created` falls back to the fs ctime, the
  // sort key `order` is used when present (immune to fs-timestamp re-stamping).
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const createdAt = resolveCreated(fm?.created, new Date(file.stat.ctime).toISOString());
  const order = resolveOrder(fm?.order);
  const node: FolderNode = {
    name: file.basename,
    path: file.path,
    createdAt,
  };
  if (order !== undefined) node.order = order;
  if (includeHeadings) {
    const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
    if (headings.length > 0) {
      node.children = headings.map((h, i) => ({
        name: h.heading,
        path: `${file.path}#${i}-${h.heading}`,
        createdAt,
      }));
    }
  }
  return node;
}
