// Pure bubble geometry. Two outputs from the same geometric inputs:
//   attention(branch)     — viewport-fill ratio, drives size lift
//   mountedBranch(branch) — bool: is branch within the bubble (viewport + decay zone)
//
// Inputs are deliberately small and concrete so the functions are trivially
// unit-testable without DOM, presence maps, or styling config.

import type { Bounds } from "../../../src/types.ts";

export interface View {
  tx: number;
  ty: number;
  scale: number;
}

export interface ViewportPx {
  width: number;
  height: number;
}

/** Convert a screen-space viewport rect to its world-space Bounds given the view. */
function viewportInWorld(view: View, viewport: ViewportPx): Bounds {
  // Screen (x, y) = world (x, y) * scale + (tx, ty)
  // World (x, y) = (screen − (tx, ty)) / scale
  const xMin = -view.tx / view.scale;
  const yMin = -view.ty / view.scale;
  return {
    min: { x: xMin, y: yMin },
    max: {
      x: xMin + viewport.width / view.scale,
      y: yMin + viewport.height / view.scale,
    },
  };
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const x = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const y = Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
  return x * y;
}

/** Viewport-fill ratio: fraction of the viewport occupied by branch.Bounds,
 *  clamped to [0, 1]. */
export function attention(
  branch: Bounds,
  view: View,
  viewport: ViewportPx,
): number {
  const vp = viewportInWorld(view, viewport);
  const vpArea = (vp.max.x - vp.min.x) * (vp.max.y - vp.min.y);
  if (vpArea <= 0) return 0;
  const clipped = intersectionArea(branch, vp);
  return Math.max(0, Math.min(1, clipped / vpArea));
}

/** True iff branch.Bounds overlaps the bubble's mount region (viewport inflated
 *  by `bubbleWidth × viewport` on each side). */
export function mountedBranch(
  branch: Bounds,
  view: View,
  viewport: ViewportPx,
  bubbleWidth: number,
): boolean {
  const inflated: ViewportPx = {
    width: viewport.width * (1 + 2 * bubbleWidth),
    height: viewport.height * (1 + 2 * bubbleWidth),
  };
  // Center the inflated rect on the original viewport.
  const offsetX = viewport.width * bubbleWidth;
  const offsetY = viewport.height * bubbleWidth;
  const inflatedView: View = {
    tx: view.tx + offsetX,
    ty: view.ty + offsetY,
    scale: view.scale,
  };
  const vp = viewportInWorld(inflatedView, inflated);
  return intersectionArea(branch, vp) > 0;
}
