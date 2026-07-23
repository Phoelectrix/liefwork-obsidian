/**
 * Stem gradient DOM id, namespaced by a per-mount instance token.
 *
 * `branch.id` resets to `br_0` on every engine build (structure.ts resets its
 * counter), so two plants mounted in the same document both contain `br_0`. The
 * stem gradient is referenced via `url(#stem-grad-br_0)`, and per the SVG spec a
 * fragment ref binds to the FIRST matching id in document order — so the second
 * plant's stems would resolve to the first plant's userSpaceOnUse gradient (a
 * different coordinate space) and paint transparent. The instance token keeps
 * the ids distinct so each plant's stems reference their own gradient.
 */
export function stemGradientId(branchId: string, instanceId?: string): string {
  return instanceId ? `stem-grad-${instanceId}-${branchId}` : `stem-grad-${branchId}`;
}
