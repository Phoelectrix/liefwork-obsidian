// Staged-reveal queue. Orders branch state changes so the DOM mutations can
// be processed in bounded batches over multiple rAFs:
//   - Mounts first: shallow + bigger-subtree first (trunk before twigs)
//   - Unmounts second: deep + smaller first (leaves before parents)
//
// The queue is pure data — the caller (main.ts) drains it across rAF ticks.

export interface BranchStateChange {
  id: string;
  action: "mount" | "unmount";
  depth: number;
  descendantCount: number;
}

export function buildRevealQueue(
  changes: readonly BranchStateChange[],
): BranchStateChange[] {
  const mounts = changes.filter((c) => c.action === "mount");
  const unmounts = changes.filter((c) => c.action === "unmount");

  mounts.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth; // shallow first
    return b.descendantCount - a.descendantCount; // bigger subtree first
  });

  unmounts.sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth; // deep first
    return a.descendantCount - b.descendantCount; // smaller first
  });

  return [...mounts, ...unmounts];
}
