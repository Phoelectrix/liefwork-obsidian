/**
 * Pure zoom math, extracted so it can be unit-tested without a DOM. Used by
 * pan-zoom.ts's wheel handler, which coalesces all wheel deltas arriving within
 * a single animation frame into ONE application — summing the deltas first and
 * folding once is mathematically identical to folding each event in turn
 * (`exp(-Σd·k) === Πexp(-d·k)`), so zoom feel is unchanged at 60fps but input
 * can no longer accumulate ahead of what's rendered when frames are slow.
 */

/** Wheel-delta → zoom-factor sensitivity (per deltaY unit). */
export const ZOOM_WHEEL_K = 0.0015;

/** Fold a (possibly summed) wheel deltaY into the scale, clamped to [floor, ceil].
 *  Negative deltaY zooms in, positive zooms out. */
export function foldWheelZoom(
  currentScale: number,
  summedDeltaY: number,
  floor: number,
  ceil = 200,
): number {
  const factor = Math.exp(-summedDeltaY * ZOOM_WHEEL_K);
  return Math.min(ceil, Math.max(floor, currentScale * factor));
}

/** New translation that keeps the world point currently under (px, py) — screen
 *  coords relative to the SVG — fixed while the scale changes oldScale→newScale.
 *  Screen projection is `screen = world * scale + t`. */
export function zoomAboutPoint(
  tx: number,
  ty: number,
  oldScale: number,
  newScale: number,
  px: number,
  py: number,
): { tx: number; ty: number } {
  const k = newScale / oldScale;
  return { tx: px - (px - tx) * k, ty: py - (py - ty) * k };
}

/** Fold one frame's summed wheel deltas into the transform. deltaY zooms
 *  (foldWheelZoom, anchored at the cursor); deltaX pans horizontally —
 *  `tx -= sumDeltaX`, so content follows the fingers under macOS natural
 *  scrolling. Cursor coords are screen px relative to the SVG rect. The
 *  hybrid model (8 July 2026): a diagonal trackpad swipe still zooms from
 *  its vertical component by design; this fixes the dominant left-right
 *  pan case, which previously did nothing. */
export function foldWheelDeltas(
  tx: number,
  ty: number,
  scale: number,
  sumDeltaX: number,
  sumDeltaY: number,
  cursorX: number,
  cursorY: number,
  floor: number,
  ceil = 200,
): { tx: number; ty: number; scale: number } {
  const nextScale = foldWheelZoom(scale, sumDeltaY, floor, ceil);
  const anchored = zoomAboutPoint(tx, ty, scale, nextScale, cursorX, cursorY);
  return { tx: anchored.tx - sumDeltaX, ty: anchored.ty, scale: nextScale };
}

/** A view transform in the screen-projection model `screen = world * scale + t`. */
export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

/** CSS wrapper transform `W(q) = a*q + (wx,wy)` (transform-origin 0 0). */
export interface CompositeDelta {
  a: number;
  wx: number;
  wy: number;
}

/** The wrapper CSS transform that, applied on top of a frozen SVG already
 *  drawing at `settled`, reproduces the `current` view. Lets motion ride a
 *  GPU-composited layer while the SVG `<g>` stays untouched (no reflow). */
export function compositeMotionTransform(
  settled: ViewTransform,
  current: ViewTransform,
): CompositeDelta {
  const a = current.scale / settled.scale;
  return { a, wx: current.tx - a * settled.tx, wy: current.ty - a * settled.ty };
}

/** Invert a screen point to world coordinates, correct even while a composited
 *  wrapper transform is live (the pan/zoom settle window, the frame tween).
 *
 *  `px`/`py` must be measured from the pan surface's live gBCR corner — its
 *  TRANSFORMED origin. That corner already absorbs the wrapper's translation
 *  (corner = untransformed origin + (wx, wy)), so the translation cancels and
 *  only the wrapper scale `a` plus the SETTLED transform remain to invert:
 *
 *      client = corner + a·(settled.scale·world + settled.t)
 *
 *  With no wrapper live (`a = 1`, settled ≡ current) this reduces to the plain
 *  `world = (p - t) / scale` inverse. Inverting the LIVE state against the
 *  transformed corner instead (the pre-fix bug) misses by the full wrapper
 *  translation — e.g. a whole pan's worth of pixels. */
export function clientPointToWorld(
  px: number,
  py: number,
  settled: ViewTransform,
  wrapperScale = 1,
): { x: number; y: number } {
  return {
    x: (px / wrapperScale - settled.tx) / settled.scale,
    y: (py / wrapperScale - settled.ty) / settled.scale,
  };
}
