import type { HierarchyInput, HierarchyNode } from "../../../src/types.ts";
import type { FolderNode } from "./folder-node.ts";

/**
 * Convert a FolderNode tree into the engine's HierarchyInput.
 * - `path` becomes the node `id` (stable identity across rebuilds).
 * - A node with a non-empty `children` array becomes a branch (meristem);
 *   without children it is a leaf (lief) — the engine infers kind from this.
 * - `createdAt` is passed through so the engine's chronological sort can order
 *   children oldest→newest (append-at-tip). Ordering itself is the engine's job
 *   via EngineConfig.sort, not this function's.
 */
export interface FolderToHierarchyOpts {
  /** Show each branch's folder-note as a lief pinned at the branch base
   *  (explorer parity, §3). Default false — the folder-note is filtered out and
   *  renders only as the meristem's own content. Plugin ingest only. */
  showMeristemNotes?: boolean;
}

export function folderToHierarchy(
  root: FolderNode,
  opts: FolderToHierarchyOpts = {},
): HierarchyInput {
  return { root: toHierarchyNode(root, opts.showMeristemNotes === true) };
}

/** Total node count of a FolderNode tree (the node itself + all descendants).
 *  Used to guard the engine against trees beyond its smooth-rendering band. */
export function countFolderNodes(node: FolderNode): number {
  let n = 1;
  if (node.children) {
    for (const c of node.children) n += countFolderNodes(c);
  }
  return n;
}

/**
 * Deepest depth limit whose truncated tree fits `cap` nodes, or null when even
 * depth 1 (root + direct children) exceeds it. Truncating at depth d keeps
 * every node at depth ≤ d (collapsed subtrees count as one leaf each).
 */
export function depthLimitForCap(root: FolderNode, cap: number): number | null {
  const counts: number[] = []; // counts[d] = nodes at exactly depth d
  const walk = (n: FolderNode, d: number): void => {
    counts[d] = (counts[d] ?? 0) + 1;
    if (n.children) for (const c of n.children) walk(c, d + 1);
  };
  walk(root, 0);
  let cumulative = 0;
  let best: number | null = null;
  for (let d = 0; d < counts.length; d++) {
    cumulative += counts[d];
    if (cumulative > cap) break;
    if (d >= 1) best = d;
  }
  return best;
}

/**
 * Structural LOD: truncate the tree at `maxDepth`. A collapsed branch becomes
 * a leaf keeping its path-identity, with a "(+N)" suffix telling the user how
 * many descendants are folded inside. Wide view shows the big shape; detail
 * comes from opening the subfolder as its own plant (M2: click-to-drill).
 */
export function truncateAtDepth(
  node: FolderNode,
  maxDepth: number,
  depth = 0,
): FolderNode {
  if (!node.children || node.children.length === 0) return node;
  if (depth >= maxDepth) {
    const hidden = countFolderNodes(node) - 1;
    const out: FolderNode = { name: `${node.name} (+${hidden})`, path: node.path };
    if (node.createdAt) out.createdAt = node.createdAt;
    if (node.order != null) out.order = node.order;
    return out;
  }
  return {
    ...node,
    children: node.children.map((c) => truncateAtDepth(c, maxDepth, depth + 1)),
  };
}

function toHierarchyNode(node: FolderNode, showMeristem: boolean): HierarchyNode {
  const out: HierarchyNode = { id: node.path, name: node.name };
  if (node.createdAt) out.createdAt = node.createdAt;
  if (node.order != null) out.order = node.order;
  if (node.isBranch) out.isBranch = true;
  if (node.nonMd) out.nonMd = true;

  if (node.isArchive) {
    out.isArchive = true;
    // One node per archived entry: collapse each entry to a leaf (drop grandchildren),
    // keep its identity/order so the spiral can sort by archivedAt-derived order.
    const entries = (node.children ?? []).filter(
      (c) => !(c.name === node.name && c.path.toLowerCase().endsWith(".md")),
    );
    if (entries.length > 0) {
      out.children = entries.map((c) => {
        const leaf: HierarchyNode = { id: c.path, name: c.name };
        if (c.createdAt) leaf.createdAt = c.createdAt;
        if (c.order != null) leaf.order = c.order;
        return leaf;
      });
    }
    return out;
  }

  if (node.children && node.children.length > 0) {
    // The folder-note — a `.md` file named exactly like its folder — is the
    // meristem's own MD. Identified by the `.md` extension so a same-named
    // SUBfolder is never mistaken for it.
    const isFolderNote = (c: FolderNode): boolean =>
      c.name === node.name && c.path.toLowerCase().endsWith(".md");
    // Off: exclude it (renders as the meristem's content, not a duplicate lief).
    // On: keep it as a lief pinned at the branch base (explorer parity, §3).
    const kids = showMeristem ? node.children : node.children.filter((c) => !isFolderNote(c));
    if (kids.length > 0) {
      out.children = kids.map((c) => {
        const hn = toHierarchyNode(c, showMeristem);
        if (showMeristem && isFolderNote(c)) hn.sortPin = "base";
        return hn;
      });
    }
  }
  return out;
}
