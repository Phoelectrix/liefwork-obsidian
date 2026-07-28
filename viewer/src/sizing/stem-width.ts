/**
 * World-space width of a branch's stem ribbon.
 *
 * Two factors:
 *  1. **Subtree size** (`subtreeNorm` ∈ [0,1], shaped by `subtreeExp`) maps the
 *     width across `[minWidth, maxWidth]` — thick trunks, thin twigs.
 *  2. **Depth scale** — the result is multiplied by `childScale^(depth·phiOrder)`
 *     so the ribbon stays proportional to the branch's own (depth-shrunk)
 *     geometry. Without this, deep branches pinned the flat world-unit
 *     `minWidth` floor and rendered WIDER than the spacing around them, so
 *     neighbouring deep ribbons visually overlapped even though their
 *     centrelines never cross. The depth factor is expressed via
 *     `liefShortSideInverse = childScale^(-phiOrder)` (the value the cascade
 *     already carries): `childScale^(depth·phiOrder) = liefShortSideInverse^(-depth)`.
 *
 * The renderer still floors the *screen* width (`MIN_STEM_SCREEN_PX / scale`) so
 * thin deep ribbons stay visible when zoomed out; this only governs the
 * world-space contribution.
 */
export function stemWidthWorld(
  subtreeNorm: number,
  depth: number,
  v2Stem: { minWidth: number; maxWidth: number; subtreeExp: number },
  liefShortSideInverse: number,
): number {
  const t = v2Stem.subtreeExp === 1
    ? subtreeNorm
    : Math.pow(subtreeNorm, v2Stem.subtreeExp);
  const base = v2Stem.minWidth + t * (v2Stem.maxWidth - v2Stem.minWidth);
  return base * Math.pow(liefShortSideInverse, -depth);
}
