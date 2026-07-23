import type { Bounds } from "../../src/types.ts";

export type Viewport = { width: number; height: number };
export type Insets = { top?: number; right?: number; bottom?: number; left?: number };
export type FitTransform = { scale: number; tx: number; ty: number };

// Pure fit math. Given bounds (plant space), a viewport (px), optional UI-chrome
// insets (px, sides that shouldn't count as usable area), and symmetric padding
// (fraction of the *available* area), returns the transform that centres the
// bounds inside the unobstructed region.
//
// `maxScale` caps the fit's zoom-in: near-zero bounds (a brand-new one-lief
// branch) otherwise fit at 20–30×, past the size-cull cliff, and the frame
// hides the very thing it framed. The capped transform keeps the bounds
// CENTRED — only the scale is held down.
export function computeFitTransform(
  bounds: Bounds,
  viewport: Viewport,
  insets: Insets = {},
  padding = 0.12,
  maxScale = Infinity,
  minScale = 0,
): FitTransform {
  const top = insets.top ?? 0;
  const right = insets.right ?? 0;
  const bottom = insets.bottom ?? 0;
  const left = insets.left ?? 0;

  const availW = Math.max(1, viewport.width - left - right);
  const availH = Math.max(1, viewport.height - top - bottom);
  const bw = Math.max(1, bounds.max.x - bounds.min.x);
  const bh = Math.max(1, bounds.max.y - bounds.min.y);

  const sx = (availW * (1 - padding * 2)) / bw;
  const sy = (availH * (1 - padding * 2)) / bh;
  // Floor first, ceiling last: `minScale` keeps a framed node legible (below it
  // the label drops to a glyph and the user loses the cursor), `maxScale` keeps
  // it from crossing the size-cull cliff. When they conflict the CEILING wins —
  // blanking a block is worse than dotting it. Both keep the bounds centred;
  // only the scale is held.
  const scale = Math.min(Math.max(Math.min(sx, sy), minScale), maxScale);

  const centreX = left + availW / 2;
  const centreY = top + availH / 2;
  const boundsCx = (bounds.min.x + bounds.max.x) / 2;
  const boundsCy = (bounds.min.y + bounds.max.y) / 2;

  return {
    scale,
    tx: centreX - boundsCx * scale,
    ty: centreY - boundsCy * scale,
  };
}

/** Minimum zoom such that the plant always fits the viewport (with the given
 *  padding) times a margin factor. marginFactor=0.8 means "you can zoom out
 *  to 80% of fit-scale" — leaves a 25% empty frame around the fitted plant
 *  but never lets it shrink to nothing.
 *
 *  Recompute on rebuild (bounds may change) and resize (viewport changes). */
export function minZoomForFit(
  bounds: Bounds,
  viewport: Viewport,
  insets: Insets,
  padding: number,
  marginFactor: number,
  maxScale = Infinity,
): number {
  // Same maxScale as the fit itself: a floor derived from an UNCAPPED fit of a
  // tiny plant would sit above the capped fit scale, wedging the camera.
  const fit = computeFitTransform(bounds, viewport, insets, padding, maxScale);
  return fit.scale * marginFactor;
}

/** Clamp a candidate (tx, ty) so the plant's AABB still intersects the
 *  viewport at the given scale. "Permissive" — only prevents the bounds
 *  from leaving the viewport entirely. The plant can be pushed right up
 *  against any edge but not past it. */
export function clampPanToBounds(
  bounds: Bounds,
  viewport: Viewport,
  scale: number,
  tx: number,
  ty: number,
): { tx: number; ty: number } {
  // World-bounds AABB in screen coords = [bounds.min × scale + t .. bounds.max × scale + t].
  // Intersection with [0..viewport] requires:
  //   bounds.max × scale + t >= 0   (right/bottom edge of plant >= left/top of viewport)
  //   bounds.min × scale + t <= viewport  (left/top edge of plant <= right/bottom of viewport)
  // Solve for t:
  //   t >= -bounds.max × scale            (lower bound)
  //   t <= viewport - bounds.min × scale  (upper bound)
  const txMin = -bounds.max.x * scale;
  const txMax = viewport.width - bounds.min.x * scale;
  const tyMin = -bounds.max.y * scale;
  const tyMax = viewport.height - bounds.min.y * scale;
  return {
    tx: Math.min(txMax, Math.max(txMin, tx)),
    ty: Math.min(tyMax, Math.max(tyMin, ty)),
  };
}
