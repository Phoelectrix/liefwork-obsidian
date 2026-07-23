/**
 * A plain, Obsidian-free representation of one node in the source tree.
 * A folder, a note, or a heading-within-a-note all share this shape — they
 * differ only by whether they carry `children`. Produced by the vault adapter,
 * consumed by `folderToHierarchy`.
 */
export interface FolderNode {
  /** Display name: folder name, note basename, or heading text. */
  name: string;
  /** Vault-relative path (notes), folder path, or `file.md#i-heading`
   *  (headings). The engine uses this as the node's stable identity. */
  path: string;
  /** ISO timestamp used for chronological (oldest-first) ordering. */
  createdAt?: string;
  /** Explicit per-branch sort key (frontmatter `order`). Overrides `createdAt`
   *  when present — durable, intentional order vs the fragile fs timestamp. */
  order?: number;
  /** Present on folders (and notes that have headings). Absent = a leaf. */
  children?: FolderNode[];
  /** Set by the vault adapter on every folder — the one producer that knows a
   *  node is a directory. Propagated to `HierarchyNode.isBranch` so an empty
   *  folder renders as a branch, not a lief. */
  isBranch?: boolean;
  /** Set by the vault adapter on a non-markdown file lief (all-files mode).
   *  Propagated to `HierarchyNode.nonMd` → the renderer tints it apart. */
  nonMd?: boolean;
  /** Set when this folder is a recognised archive branch (folder-note `kind: archive`). */
  isArchive?: boolean;
}
