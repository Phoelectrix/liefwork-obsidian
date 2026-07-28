import type { Bounds } from "../../src/types.ts";

export interface Transform {
  tx: number;
  ty: number;
  scale: number;
}

export type Easing = "linear" | "easeInOutCubic" | "easeInOutQuad";

export const EASINGS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    scale: lerp(a.scale, b.scale, t),
  };
}

/** Zoom keeping the viewport centre's world point fixed. */
export function zoomedAt(
  t: Transform,
  factor: number,
  vp: { width: number; height: number },
): Transform {
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  return {
    tx: cx - (cx - t.tx) * factor,
    ty: cy - (cy - t.ty) * factor,
    scale: t.scale * factor,
  };
}

/** Fit world-space `bounds` into `vp` with `paddingFraction` (0..0.49) margin. */
export function computeFit(
  bounds: Bounds,
  vp: { width: number; height: number },
  paddingFraction = 0.1,
): Transform {
  const w = bounds.max.x - bounds.min.x;
  const h = bounds.max.y - bounds.min.y;
  const padX = vp.width * paddingFraction;
  const padY = vp.height * paddingFraction;
  const sx = (vp.width - padX * 2) / Math.max(w, 1);
  const sy = (vp.height - padY * 2) / Math.max(h, 1);
  const scale = Math.min(sx, sy);
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  return {
    tx: vp.width / 2 - cx * scale,
    ty: vp.height / 2 - cy * scale,
    scale,
  };
}

/** The world-space rectangle currently visible under `t` in `vp`. Inverse of a
 *  zero-padding computeFit; used to capture an aspect-robust "current view". */
export function boundsFromTransform(
  t: Transform,
  vp: { width: number; height: number },
): Bounds {
  return {
    min: { x: (0 - t.tx) / t.scale, y: (0 - t.ty) / t.scale },
    max: { x: (vp.width - t.tx) / t.scale, y: (vp.height - t.ty) / t.scale },
  };
}

import type { SceneSpec, Keyframe } from "./film-spec.ts";

export interface ResolveCtx {
  plantBounds: Bounds;
  viewport: { width: number; height: number };
  /** Branch bounds by name substring, or null if not found. */
  branchBounds: (substr: string) => Bounds | null;
}

export interface ResolvedSpec {
  transforms: Transform[];
  easing: Easing;
}

function resolveKeyframe(kf: Keyframe, ctx: ResolveCtx): Transform {
  if ("transform" in kf) return kf.transform;
  if ("fitBounds" in kf) return computeFit(kf.fitBounds, ctx.viewport, 0);
  if ("fit" in kf) return computeFit(ctx.plantBounds, ctx.viewport, 0.1);
  // frameBranch
  const b = ctx.branchBounds(kf.frameBranch);
  if (!b) throw new Error(`frameBranch not found: ${kf.frameBranch}`);
  return computeFit(b, ctx.viewport, 0.42);
}

export function resolveSpec(spec: SceneSpec, ctx: ResolveCtx): ResolvedSpec {
  return {
    transforms: spec.camera.keyframes.map((k) => resolveKeyframe(k, ctx)),
    easing: spec.camera.easing,
  };
}

export function sampleCamera(resolved: ResolvedSpec, t: number): Transform {
  const ks = resolved.transforms;
  const clamped = Math.max(0, Math.min(1, t));
  if (ks.length === 1) return ks[0]!;
  const segCount = ks.length - 1;
  const scaled = clamped * segCount;
  const i = Math.min(segCount - 1, Math.floor(scaled));
  const localT = scaled - i;
  const eased = EASINGS[resolved.easing](localT);
  return lerpTransform(ks[i]!, ks[i + 1]!, eased);
}
