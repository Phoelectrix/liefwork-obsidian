import type { Bounds } from "../../src/types.ts";
import { exceedsDragThreshold, shouldSuppressClick } from "./interaction-logic.ts";
import { computeFitTransform, minZoomForFit, clampPanToBounds, type Insets } from "./fit.ts";
import {
  foldWheelDeltas,
  compositeMotionTransform,
  clientPointToWorld,
  type CompositeDelta,
} from "./pan-zoom-math.ts";

const DRAG_THRESHOLD_PX = 4;
// Gap between the plant bounds and chrome edges, in px. Keeps fitted plants
// from hugging the studio panel or HUD when a branch is selected.
const CHROME_MARGIN_PX = 16;

interface ViewState {
  tx: number;
  ty: number;
  scale: number;
}

export type PanZoomHandle = {
  /** Re-fit the camera. If focusBounds provided, focus on that; otherwise
   *  reset focus to the full plant and fit. */
  refit(focusBounds?: Bounds): void;
  /** Animated re-fit. Tweens the camera from its current transform to the
   *  transform that fits focusBounds into the viewport, over durationMs using
   *  an easeInOutCubic curve. Cancels any previous animation in progress. */
  refitAnimated(focusBounds: Bounds, durationMs?: number, minScale?: number): void;
  /** "Rail-cam" animated move: the focal point travels ALONG the given
   *  world-space polyline (arc-length parameterised) instead of a straight line,
   *  while the scale eases from the current transform to the fit of
   *  `targetBounds`. Used to fly the camera along the coral's stems (current
   *  node → common ancestor → target) so deep-branch moves never cut across
   *  empty space. Cancels any in-flight tween; a <2-point path falls back to
   *  refitAnimated. */
  flyAlongPath(path: { x: number; y: number }[], targetBounds: Bounds, durationMs?: number): void;
  /** Update the immutable plant bounds (called after each plant rebuild).
   *  By default resets activeBounds to the new plant and refits immediately.
   *  With { preserveView: true } it keeps the current camera (re-clamped to the
   *  new bounds) instead of refitting — used for same-plant rebuilds. */
  setPlantBounds(newBounds: Bounds, opts?: { preserveView?: boolean }): void;
  /** Snap the camera to an arbitrary transform and commit it to the world <g>
   *  immediately (sharp, settled) — fires onCommit + onTransformChange so a
   *  sibling canvas layer redraws at the new transform in the same tick. Used
   *  by the film camera in canvas mode. Not clamped: scripted shots position
   *  freely, matching SVG-mode applyFilmTransform. */
  setTransform(tx: number, ty: number, scale: number): void;
  /** Mark the camera as user/host-owned: stop auto-fitting on pane reflow /
   *  window resize. Call when a node is clicked (before the host opens its HUD)
   *  so the HUD-open resize can't auto-fit over the framing that follows. */
  ownCamera(): void;
  /** Whether a real user GESTURE (pan, wheel zoom, pinch) has placed the
   *  camera — deliberately narrower than the internal owned state, which any
   *  host framing or the per-click ownCamera() also sets. Cleared when Full
   *  View resumes auto-fit. Hosts use this to skip camera moves the reader
   *  didn't ask for (an owned camera is already preserved through reflows). */
  isCameraUserOwned(): boolean;
  /** Update the fit padding used by subsequent fits/refits (site `?dev` panel).
   *  Does not move the camera — the next fit, frame or resize picks it up. */
  setFitPadding(padding: number): void;
  /** Update how far past Full View the camera may pull back (a multiple of the
   *  full-view frame). Unlike setFitPadding this takes effect AT ONCE: the floor
   *  is recomputed and the camera re-clamped, so lowering the limit while the
   *  camera sits beyond it pulls it back in rather than leaving the coral
   *  outside its own limit until the next fit. */
  setZoomOutMax(zoomOutMax: number): void;
  /** Update the trackpad-pinch gain (dev panel). Takes effect on the next wheel
   *  event; there is no camera state to re-clamp. */
  setPinchZoomGain(gain: number): void;
  /** Map a client point to world coordinates. Correct even mid-motion: during
   *  the settle window / frame tween the motion layer carries a live CSS
   *  transform, so the svg's gBCR is shifted+scaled by the composite delta —
   *  this inverts through the PAINTED wrapper against the settled transform
   *  instead of naively inverting the live state (which would be off by the
   *  wrapper translation). Use this for hit-testing canvas-rendered content. */
  clientToWorld(clientX: number, clientY: number): { x: number; y: number };
  /** Remove the window resize listener + ResizeObserver and cancel any
   *  in-flight animation. Call on mount teardown so a closed pop-out window
   *  leaves no listeners behind. */
  destroy(): void;
};

export interface PanZoomOptions {
  /** Canvas-mode node hit-test for the dblclick camera reset: blocks rendered
   *  on a sibling canvas have no DOM, so `closest('[data-block-id]')` can never
   *  match — the host injects this instead. Return true when a node (not empty
   *  space) is under the client point; the whole-plant refit is then skipped so
   *  double-clicking a node doesn't yank the camera. */
  isNodeAt?: (clientX: number, clientY: number) => boolean;
  /** Symmetric fit padding (fraction of the available viewport), passed
   *  through from `styling.camera.fitPadding`. Defaults to 0.12 (today's
   *  hardcoded value) when absent, so a default-configured caller sees no
   *  behaviour change. */
  fitPadding?: number;
  /** How far past Full View the camera may be pulled back, as a multiple of the
   *  full-view frame — `styling.camera.zoomOutMax`. Unset falls back to the
   *  shipped default (2), so every surface pulls back the same distance. */
  zoomOutMax?: number;
  /** How much harder a trackpad pinch zooms than a two-finger scroll of the
   *  same delta — `styling.camera.pinchZoomGain`. Unset falls back to the
   *  shipped default, so every surface pinches alike. */
  pinchZoomGain?: number;
  /** Ceiling on the zoom any FIT or FRAME may land at, queried live at each
   *  framing call so it tracks knob changes with no re-plumbing. The host
   *  derives it from the size-cull cliff (peak / (shortSide × titleSize ×
   *  basalMag)): framing near-zero bounds (a brand-new one-lief branch)
   *  otherwise fits at 20–30×, the cull fires, and the frame hides the very
   *  thing it framed — blank space until Full View. Caps automatic framing
   *  only; manual pinch/wheel zoom keeps its own limit (a user may
   *  deliberately zoom past the cliff). */
  frameMaxZoom?: () => number;
}

type Pt = { x: number; y: number };

/** Densify a polyline into a smooth CENTRIPETAL Catmull-Rom curve through every
 *  input point (Barry-Goldman form, alpha = 0.5). Centripetal parameterisation
 *  is loop- and cusp-free even for unevenly spaced points with sharp angles — so
 *  the camera rounds the coral's fishbone corners gracefully, with no overshoot
 *  wiggle, while still threading each node (tied to the geometry). Coincident
 *  points are dropped first (a rebuild can leave the start on top of a waypoint);
 *  <3 distinct points → returned unchanged (a single segment is already
 *  straight). */
function catmullRomDensify(input: Pt[], samplesPerSeg = 16, alpha = 0.5): Pt[] {
  // Drop consecutive duplicates so knot spacings never collapse to zero.
  const pts: Pt[] = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p);
  }
  if (pts.length < 3) return pts;

  const clamp = (i: number): Pt => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  const knot = (t: number, a: Pt, b: Pt): number => t + Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha);
  const lerp = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => {
    if (tb - ta <= 1e-9) return a;
    const f = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };

  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = clamp(i - 1), p1 = clamp(i), p2 = clamp(i + 1), p3 = clamp(i + 2);
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    const isLast = i === pts.length - 2;
    const count = samplesPerSeg + (isLast ? 1 : 0);
    for (let s = 0; s < count; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSeg;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/** Densify a single quadratic Bézier (start → control → end) into a polyline.
 *  Unlike a Catmull-Rom through the same three points, a quadratic Bézier has
 *  strictly monotonic curvature — it bows ONE way toward the control and never
 *  overshoots or S-curves. That makes it the smoothest camera arc with the
 *  fewest changes of direction: a single graceful bend (or a near-straight glide
 *  when the three points are roughly collinear). */
function quadBezierDensify(p0: Pt, p1: Pt, p2: Pt, samples = 48): Pt[] {
  const out: Pt[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/** How far the camera bows toward its (junction) control point on a framing
 *  move: 1 = the full geometry-tied bow, 0 = a straight glide. Lower = gentler.
 *  Applied by pulling the control point toward the start→target chord midpoint,
 *  so the path keeps its bend direction but loses the loop. */
const CAMERA_BOW = 0.45;

/** Ease a Bézier control point toward the chord midpoint by `CAMERA_BOW`, so a
 *  far-off junction gives a gentle bend rather than a loop. */
function gentleControl(p0: Pt, ctrl: Pt, p2: Pt): Pt {
  const mx = (p0.x + p2.x) / 2;
  const my = (p0.y + p2.y) / 2;
  return { x: mx + CAMERA_BOW * (ctrl.x - mx), y: my + CAMERA_BOW * (ctrl.y - my) };
}

/** Install pan (drag) + zoom (wheel) on an SVG, applying the combined transform
 *  to a child <g>. Auto-fits the given bounds to the viewport on install.
 *  Emits the full transform on every change so sibling layers (canvas skin,
 *  etc.) can stay in sync. */
/** `camera.zoomOutMax` (a multiple of the full-view frame) → the margin factor
 *  `minZoomForFit` takes. Below 1 is refused: a floor ABOVE the fit scale would
 *  wedge the camera inside the plant, with Full View itself unreachable.
 *
 *  The unset fallback is the SHIPPED default, not the historical 1.25 — Studio
 *  (main.ts) and the standalone public viewer (public.ts) install pan-zoom
 *  without camera options, and a third silent value is exactly the kind of
 *  drift `camera` was config-gated to end. */
const DEFAULT_ZOOM_OUT_MAX = 2;
export function marginFactorFor(zoomOutMax: number | undefined): number {
  const m = zoomOutMax;
  if (m === undefined || !Number.isFinite(m)) return 1 / DEFAULT_ZOOM_OUT_MAX;
  return 1 / Math.max(1, m);
}

/** `camera.pinchZoomGain` → the multiplier applied to a PINCH wheel delta.
 *  Below 1 is refused: a pinch must never be duller than the two-finger scroll
 *  it is meant to feel more direct than. Same fallback discipline as
 *  {@link marginFactorFor} — one shipped number, no third silent value. */
const DEFAULT_PINCH_ZOOM_GAIN = 7;
export function pinchGainFor(gain: number | undefined): number {
  if (gain === undefined || !Number.isFinite(gain)) return DEFAULT_PINCH_ZOOM_GAIN;
  return Math.max(1, gain);
}

export function installPanZoom(
  svg: SVGSVGElement,
  world: SVGGElement,
  bounds: Bounds,
  onZoomChange?: (zoom: number) => void,
  onTransformChange?: (tx: number, ty: number, scale: number) => void,
  motionLayer?: HTMLElement | null,
  onCommit?: (tx: number, ty: number, scale: number) => void,
  opts?: PanZoomOptions,
): PanZoomHandle {
  const state: ViewState = { tx: 0, ty: 0, scale: 1 };

  // The window this SVG lives in (its own rAF / resize), falling back to global.
  const win = svg.ownerDocument.defaultView ?? window;

  // Transform currently written to the SVG <g> (the "settled" view). During an
  // active gesture the <g> is frozen here and motion rides motionLayer as a
  // composited delta; on settle we snap the <g> to `state` and clear the layer.
  const settled: ViewState = { tx: 0, ty: 0, scale: 1 };
  let compositing = false;
  let settleTimer: number | null = null;
  const SETTLE_MS = 250;

  // The composite delta last WRITTEN to motionLayer.style (null = no wrapper
  // transform live). clientToWorld inverts through this so hit-testing agrees
  // with the pixels actually on screen — even if a scheduled rAF apply hasn't
  // landed the newest state yet.
  let paintedDelta: CompositeDelta | null = null;

  // Pop-out windows: force the direct-redraw (non-composited) path. The
  // composited path rides a live CSS transform on `motionLayer`; in a pop-out
  // (separate compositor/timing) a getBoundingClientRect() read taken while that
  // transform is live comes back transform-scaled, which feeds back into the
  // camera and blows the transform up to garbage (~1e21). Without compositing,
  // motionLayer never holds a transform, so every layout read stays clean. The
  // renderer redraws in ~1ms, so pop-out pan/zoom stays smooth on the sharp path.
  const inPopout = win !== window;
  const compositeDisabled = (): boolean =>
    inPopout ||
    (win as unknown as { __LIEF_DISABLE_COMPOSITE?: boolean }).__LIEF_DISABLE_COMPOSITE === true;

  // Write `state` to the SVG <g> (the sharp, reflowing path) and sync `settled`.
  const commitToWorld = (): void => {
    world.setAttribute(
      "transform",
      `translate(${fmt(state.tx)} ${fmt(state.ty)}) scale(${fmt(state.scale)})`,
    );
    settled.tx = state.tx;
    settled.ty = state.ty;
    settled.scale = state.scale;
    if (motionLayer) motionLayer.style.removeProperty("transform");
    paintedDelta = null;
    // Fire AFTER the wrapper transform is cleared and the <g> committed, so a
    // sibling layer (e.g. the canvas skeleton) can redraw at the settled
    // transform in the SAME tick — no jump between the cleared CSS delta and the
    // re-rendered layer.
    if (onCommit) onCommit(state.tx, state.ty, state.scale);
  };

  // Mark a gesture active and (re)arm the trailing snap-to-sharp.
  const armSettle = (): void => {
    if (!motionLayer || compositeDisabled()) return;
    compositing = true;
    if (settleTimer !== null) win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(() => {
      settleTimer = null;
      compositing = false;
      commitToWorld();
    }, SETTLE_MS);
  };

  // Force the SVG <g> to own the transform now (used before programmatic moves).
  const settleNow = (): void => {
    if (settleTimer !== null) { win.clearTimeout(settleTimer); settleTimer = null; }
    compositing = false;
    if (motionLayer) motionLayer.style.removeProperty("transform");
    paintedDelta = null;
  };

  let plantBounds: Bounds = bounds;     // Immutable per plant build.
  let activeBounds: Bounds = bounds;    // Camera focus; can change via refit.

  // Cached viewport rect — refreshed on resize / ResizeObserver / fit, NOT per
  // frame. Reading svg.getBoundingClientRect() inside the gesture loop forced a
  // synchronous layout of the whole SVG every frame (the "forced reflow" that
  // dominated the zoom profile); the rect only changes on resize, so cache it.
  // width/height come from the LAYOUT box (clientWidth/Height), NOT from
  // getBoundingClientRect(): gBCR includes the composited motionLayer transform,
  // so a ResizeObserver firing mid-composite (seen in Obsidian pop-out windows)
  // returns a transform-scaled size that corrupts the viewBox + fit. The layout
  // metrics are transform-independent. left/top stay from gBCR — they're only
  // read at settle (wheel anchor / insets), when no composite transform is live.
  type ViewportRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
  const readRect = (): ViewportRect => {
    const r = svg.getBoundingClientRect();
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: svg.clientWidth || r.width, height: svg.clientHeight || r.height,
    };
  };
  let cachedRect: ViewportRect = readRect();
  const refreshRect = (): void => { cachedRect = readRect(); };

  // Sanity ceiling for a viewport dimension (CSS px). Real viewports top out a
  // few thousand px; anything larger is a corrupted/transform-scaled read.
  const MAX_VIEWPORT_PX = 20000;

  // Recomputed on every fit() and on every resize. Floor for the zoom clamp.
  let zoomFloor = 0.02;
  // How far past Full View the camera may pull back, held as the margin FACTOR
  // the fit math wants (floor = fitScale × factor). The knob is its reciprocal —
  // `camera.zoomOutMax`, a MULTIPLE of the full-view frame — so the surfaced
  // number rises as you pull further back rather than falling. Was a hardcoded
  // 0.8, reachable from nowhere (founder, 5 Aug: "the user should be able to
  // pull back more than currently if they want").
  let ZOOM_MARGIN_FACTOR = marginFactorFor(opts?.zoomOutMax);
  // Trackpad pinch gain — see pinchGainFor. Mutable for the dev panel.
  let PINCH_ZOOM_GAIN = pinchGainFor(opts?.pinchZoomGain);
  // Mutable so the site `?dev` panel can retune it live (setFitPadding) —
  // every read below (fit/refitAnimated/flyAlongPath's computeFitTransform and
  // minZoomForFit calls) closes over this binding, so a set() takes effect on
  // the next fit with no other plumbing.
  let FIT_PADDING = opts?.fitPadding ?? 0.12;

  // Clamp `state` in-place to satisfy zoom floor + pan-keep-plant-in-view.
  // Both constraints reference plantBounds so the user can always reach the
  // whole plant (not just the currently focused branch).
  const clampState = (): void => {
    if (state.scale < zoomFloor) state.scale = zoomFloor;
    const c = clampPanToBounds(
      plantBounds,                       // always the full plant, not the focus
      { width: cachedRect.width, height: cachedRect.height },
      state.scale,
      state.tx,
      state.ty,
    );
    state.tx = c.tx;
    state.ty = c.ty;
  };

  const apply = (): void => {
    if (compositing && motionLayer && !compositeDisabled()) {
      // Frozen SVG + composited delta on the wrapper — no <g> reflow this frame.
      const d = compositeMotionTransform(settled, state);
      motionLayer.style.transform =
        `translate(${fmt(d.wx)}px, ${fmt(d.wy)}px) scale(${fmt(d.a)})`;
      paintedDelta = d;
    } else {
      commitToWorld();
    }
    if (onZoomChange) onZoomChange(state.scale);
    if (onTransformChange) onTransformChange(state.tx, state.ty, state.scale);
  };

  // rAF-coalesced apply. Pointermove and wheel can fire much faster than the
  // display refresh (and each apply triggers a reflow of the ~17k-element SVG
  // world at Shakespeare scale), so batching keeps us at one transform write
  // per frame no matter how many input events arrive.
  // Wheel input is coalesced: the wheel handler only accumulates deltaX +
  // deltaY + the latest cursor; the fold (deltaY → zoom, deltaX → pan) runs
  // ONCE per frame here, against the
  // last-rendered scale. Summing then folding once is identical to folding each
  // event in turn (exp(-Σd·k) === Πexp(-d·k)), so feel is unchanged at 60fps —
  // but input can no longer integrate ahead of the screen when frames are slow,
  // which is the "zoom too far, have to back up" overshoot.
  let pendingWheelDeltaX = 0;
  let pendingWheelDeltaY = 0;
  let pendingWheelCursor: { x: number; y: number } | null = null;

  let pendingFrame: number | null = null;
  const scheduleApply = (): void => {
    if (pendingFrame !== null) return;
    pendingFrame = win.requestAnimationFrame(() => {
      pendingFrame = null;
      if ((pendingWheelDeltaX !== 0 || pendingWheelDeltaY !== 0) && pendingWheelCursor) {
        const rect = cachedRect;           // cached — no per-frame forced reflow
        const folded = foldWheelDeltas(
          state.tx,
          state.ty,
          state.scale,
          pendingWheelDeltaX,
          pendingWheelDeltaY,
          pendingWheelCursor.x - rect.left,
          pendingWheelCursor.y - rect.top,
          zoomFloor,
          200,
        );
        state.tx = folded.tx;
        state.ty = folded.ty;
        state.scale = folded.scale;
        pendingWheelDeltaX = 0;
        pendingWheelDeltaY = 0;
        pendingWheelCursor = null;
        clampState();
      }
      armSettle();
      apply();
    });
  };

  // Deduct chrome (studio panel, HUD) from the usable viewport so that a
  // fit-to-bounds doesn't hide the selection under the right-hand panel.
  const readInsets = (svgRect: { left: number; right: number }): Insets => {
    const insets: Insets = {};
    const studio = document.getElementById("studio");
    if (studio) {
      const r = studio.getBoundingClientRect();
      insets.right = Math.max(0, svgRect.right - r.left) + CHROME_MARGIN_PX;
    }
    const hud = document.getElementById("hud");
    if (hud) {
      const r = hud.getBoundingClientRect();
      insets.left = Math.max(0, r.right - svgRect.left) + CHROME_MARGIN_PX;
    }
    // Site glass side-panel: when the mount marks the coral as insetting for the
    // panel (body.panel-inset), fit into the visible "coral panel" — the window
    // minus the panel — so focused content lands clear of the glass, with ~8%
    // breathing room. The coral still RENDERS full-width behind the glass; only
    // the fit target shrinks. The mount toggles the class for the SAME camera move
    // that opens the panel (which itself only fades in on settle), so there's no
    // second shifting move. Both the FRAMING and the zoom FLOOR use this inset so
    // the floor equals the initial (insetted) fit — you can zoom out exactly to it
    // and no jump. Only the right-docked PORTRAIT panel insets: SQUARE is a centred
    // card floating over a full-width coral (using its width as a right-edge inset
    // there would bloat the inset and collapse the fit).
    if (document.body.classList.contains("panel-inset")) {
      const panel = document.getElementById("side-panel");
      if (panel && !panel.classList.contains("size-square")) {
        // The panel is docked at the viewport's right edge, so its OWN width is
        // the right inset (plus ~8% breathing room). Use the panel's rect, not
        // svgRect.right: svgRect comes from the svg's getBoundingClientRect, which
        // carries the live motionLayer transform and collapses to the coral's
        // content box (giving a near-zero, useless inset). The panel is
        // position:fixed, outside that transform, so its width is reliable.
        const r = panel.getBoundingClientRect();
        // Right-docked panels only (left edge inside the viewport): the mobile
        // split view docks the panel BOTTOM at full width and shrinks the
        // #stage element instead — treating its 100vw width as a right inset
        // would collapse the usable fit viewport to nothing.
        if (r.width > 0 && r.left > 0) {
          insets.right = Math.max(insets.right ?? 0, r.width * 1.08 + CHROME_MARGIN_PX);
        }
      }
    }
    return insets;
  };

  // Until the user (or host) takes the camera — a pan, a zoom, or framing a node
  // — keep the plant auto-fitted as the pane settles. Pop-out windows (and any
  // pane that lays out after mount) grow to their final size over several
  // ResizeObserver fires; fitting once on the first non-zero size would lock in a
  // too-small scale (mounted at s≈0.037 instead of the real fit). Auto-fitting on
  // every reflow until the camera is owned lands the plant at the correct scale.
  let cameraOwned = false;
  // Narrower than cameraOwned: true only after a real user GESTURE (pan past
  // the drag threshold, wheel zoom, pinch) — never from host framing, scripted
  // moves or the pre-HUD ownCamera() call that fires on every node click.
  // Hosts read this to tell "the reader placed the camera" apart from "the
  // camera has merely been moved"; Full View (unfocused refit) clears it
  // alongside cameraOwned, so resuming auto-fit also resumes host framing.
  let userCameraOwned = false;
  const viewportUsable = (r: { width: number; height: number }): boolean =>
    Number.isFinite(r.width) && Number.isFinite(r.height) &&
    r.width > 0 && r.height > 0 && r.width <= MAX_VIEWPORT_PX && r.height <= MAX_VIEWPORT_PX;

  // The live frame/fit zoom ceiling (Infinity when the host supplies none, or
  // supplies junk — a NaN/≤0 ceiling must never wedge the camera at nothing).
  const frameCap = (): number => {
    const c = opts?.frameMaxZoom?.();
    return c !== undefined && Number.isFinite(c) && c > 0 ? c : Infinity;
  };

  const fit = (): void => {
    settleNow();
    refreshRect();
    const rect = cachedRect;
    // Never fit against a not-yet-laid-out viewport — it produces a junk camera.
    if (!viewportUsable(rect)) return;
    const t = computeFitTransform(
      activeBounds,                      // camera positions on the focus bounds
      { width: rect.width, height: rect.height },
      readInsets(rect),
      FIT_PADDING,
      frameCap(),
    );
    state.scale = t.scale;
    state.tx = t.tx;
    state.ty = t.ty;
    zoomFloor = minZoomForFit(
      plantBounds,                       // floor always calibrated to full plant
      { width: rect.width, height: rect.height },
      readInsets(rect),
      FIT_PADDING,
      ZOOM_MARGIN_FACTOR,
      frameCap(),
    );
    apply();
  };

  // Set SVG viewBox to the pixel space so world transforms are in pixels
  const setViewBox = (): void => {
    refreshRect();
    const { width, height } = cachedRect;
    // Defence-in-depth: never write a degenerate or absurd viewBox (corrupted read).
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_VIEWPORT_PX || height > MAX_VIEWPORT_PX) {
      return;
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  };

  setViewBox();
  fit();

  const onResize = (): void => {
    setViewBox();
    // Keep the plant fitted on resize until the user/host owns the camera; after
    // that, preserve their view (don't yank a framed node back to whole-plant).
    if (!cameraOwned) {
      fit();
    } else if (viewportUsable(cachedRect)) {
      // Camera is owned (user panned/zoomed) — don't move it, but the viewport
      // may have narrowed (e.g. the side panel opening), so the zoom floor
      // computed at the old size could now be wrong (too permissive, blocking
      // zoom-out to fit the new, smaller viewport). Recompute it against the
      // current rect and re-clamp in place.
      zoomFloor = minZoomForFit(
        plantBounds,
        { width: cachedRect.width, height: cachedRect.height },
        readInsets(cachedRect),
        FIT_PADDING,
        ZOOM_MARGIN_FACTOR,
        frameCap(),
      );
      clampState();
      apply();
    }
  };
  win.addEventListener("resize", onResize);

  // Keep the viewBox in sync whenever the SVG's CSS size changes due to layout
  // reflows that don't trigger window.resize (e.g. the side-panel opening which
  // narrows #stage via CSS `right: clamp(320px, 32%, 480px)`).
  // Without this, the viewBox maps original-width user units onto the narrower
  // element, so `e.clientX - rect.left` (CSS pixels) and the world transform tx
  // (SVG user units) are scaled differently — cursor-light drifts by ~panel-width.
  // ResizeObserver fires after the CSS reflow, so rect.width already reflects the
  // new size. We only update the viewBox here (not refit) so the user's current
  // pan/zoom position is preserved when the panel opens.
  // Construct from the ELEMENT'S OWN window, never the global. An Obsidian
  // pop-out is a separate window: the svg lives in its document, and resize
  // observations are gathered per-document, so a main-window observer pointed at
  // it never fires. That left every reflow which does NOT also fire
  // window.resize unnoticed there — a pane split being exactly that — so a
  // popped-out coral squashed on split and stretched when the split was removed.
  // Everything else in this module already resolves `win`; this call was the
  // one that didn't.
  const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  let ro: ResizeObserver | null = null;
  if (typeof RO !== "undefined") {
    ro = new RO(() => {
      setViewBox();
      // Keep the plant fitted as the pane settles to its final size (pop-out
      // windows grow after mount). Once the user/host owns the camera, later
      // reflows preserve their view instead of re-fitting.
      if (!cameraOwned && viewportUsable(cachedRect)) {
        fit();
      } else if (cameraOwned && viewportUsable(cachedRect)) {
        // Same reasoning as onResize above: e.g. the side panel narrowing
        // #stage via CSS fires here (not window resize). Recompute the zoom
        // floor against the new rect and re-clamp, without moving the camera.
        zoomFloor = minZoomForFit(
          plantBounds,
          { width: cachedRect.width, height: cachedRect.height },
          readInsets(cachedRect),
          FIT_PADDING,
          ZOOM_MARGIN_FACTOR,
          frameCap(),
        );
        clampState();
        apply();
      }
    });
    ro.observe(svg);
  }

  // --- animated tween ---
  // Tracks the rAF handle of any in-progress refitAnimated tween so we can
  // cancel it as soon as the user interacts (pan, zoom, or a new refit call).
  let animRafId: number | null = null;
  const cancelAnimation = (): void => {
    if (animRafId !== null) {
      win.cancelAnimationFrame(animRafId);
      animRafId = null;
    }
  };

  // --- pointer state machine ---
  // Mouse and touch share the same single-pointer flow:
  //   idle → armed (1st pointer down)
  //   armed → panning (motion > threshold) → idle (release): the trailing
  //     native click (Chromium fires one after ANY mousedown→mouseup pair on
  //     the same element — pointer capture retargets the release here) is
  //     swallowed by onClickCapture above.
  //   armed → idle (release before threshold): native click event fires
  //
  // A 2nd pointer (touch only in practice) escalates to gesturing:
  //   armed | panning → gesturing → idle (last release)
  //
  // Touch debouncing of accidental taps (a quick touch that lands while the
  // user is panning) is handled in interaction.ts, not here: the click
  // handler's pendingClickTimer gets cancelled if a new pointerdown arrives
  // within the debounce window.
  type Mode = "idle" | "armed" | "panning" | "gesturing";
  let mode: Mode = "idle";

  // Active pointer tracking. Map<pointerId, {x, y}> — preserves insertion
  // order so "first two pointers" is well-defined when a third lands.
  const pointers = new Map<number, { x: number; y: number }>();

  // Single-pan state (used in "armed" and "panning")
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  // Click-after-drag suppression. Pointer capture retargets the release to
  // this svg, so Chromium fires a native click after EVERY mousedown→mouseup
  // pair on it — including one that concludes a pan. Track the interaction's
  // maximum displacement from its start (Infinity once a multi-pointer gesture
  // begins) and swallow the trailing click when it reaches the pan threshold,
  // so ending a pan over a node's hit box can't select/open that node.
  let maxDragDistancePx = 0;
  let suppressNextClick = false;
  const onClickCapture = (e: MouseEvent): void => {
    if (!suppressNextClick) return;
    suppressNextClick = false; // one-shot: re-armed by the next pointer cycle
    e.stopImmediatePropagation(); // before this svg's own bubble listeners
    e.preventDefault();
  };
  svg.addEventListener("click", onClickCapture, true);

  // Gesture baseline (captured when entering "gesturing")
  let gestureStartDistance = 0;
  let gestureStartMidpoint = { x: 0, y: 0 };
  let gestureStartScale = 1;
  let gestureStartTx = 0;
  let gestureStartTy = 0;

  const firstTwoPointers = (): { p1: { x: number; y: number }; p2: { x: number; y: number } } | null => {
    const iter = pointers.values();
    const p1 = iter.next().value;
    const p2 = iter.next().value;
    if (!p1 || !p2) return null;
    return { p1, p2 };
  };

  const beginGesture = (): void => {
    const pair = firstTwoPointers();
    if (!pair) return;
    const { p1, p2 } = pair;
    gestureStartDistance = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    gestureStartMidpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    gestureStartScale = state.scale;
    gestureStartTx = state.tx;
    gestureStartTy = state.ty;
  };

  svg.addEventListener("pointerdown", (e) => {
    // Mouse: only primary button starts an interaction. Touch/pen always pass.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimation();

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // First pointer (mouse or touch): arm for tap-or-pan.
      mode = "armed";
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      // Fresh interaction: reset the drag record and any stale suppression (a
      // pointercancel'd drag never fires its click, which would otherwise
      // leave the flag armed to eat the NEXT legitimate click).
      maxDragDistancePx = 0;
      suppressNextClick = false;
    } else if (pointers.size === 2) {
      // Second pointer: enter pinch/pan gesture. A pinch is definitionally a
      // drag — its trailing click (if the browser synthesises one) is noise.
      maxDragDistancePx = Number.POSITIVE_INFINITY;
      mode = "gesturing";
      cameraOwned = true; // a pinch is a user camera move, same as pan/wheel
      userCameraOwned = true;
      svg.classList.add("panning");
      try { svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      beginGesture();
    }
    // 3+ pointers: tracked but unused. The first two drive the gesture.
  });

  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === "gesturing") {
      const pair = firstTwoPointers();
      if (!pair) return;
      const { p1, p2 } = pair;
      const currentDistance = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const currentMidpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const zoomFactor = currentDistance / gestureStartDistance;
      const nextScale = clamp(gestureStartScale * zoomFactor, zoomFloor, 200);

      const rect = cachedRect;             // cached — no per-frame forced reflow
      // World coords of the gesture-start midpoint, under the START transform.
      const m0x = gestureStartMidpoint.x - rect.left;
      const m0y = gestureStartMidpoint.y - rect.top;
      const worldX = (m0x - gestureStartTx) / gestureStartScale;
      const worldY = (m0y - gestureStartTy) / gestureStartScale;
      // New tx/ty: keep that world point under the CURRENT midpoint.
      state.tx = (currentMidpoint.x - rect.left) - worldX * nextScale;
      state.ty = (currentMidpoint.y - rect.top) - worldY * nextScale;
      state.scale = nextScale;
      clampState();
      scheduleApply();
      return;
    }

    // Track the farthest the pointer strays from its start — across pointer
    // capture — for the click-after-drag decision at release.
    if (mode === "armed" || mode === "panning") {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > maxDragDistancePx) maxDragDistancePx = dist;
    }

    if (mode === "armed") {
      if (!exceedsDragThreshold(
        { x: startX, y: startY },
        { x: e.clientX, y: e.clientY },
        DRAG_THRESHOLD_PX,
      )) return;
      mode = "panning";
      cameraOwned = true; // user is panning — stop auto-fitting on reflow
      userCameraOwned = true;
      svg.classList.add("panning");
      try { svg.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }

    if (mode === "panning") {
      state.tx += e.clientX - lastX;
      state.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      clampState();
      scheduleApply();
    }
  });

  const endPointer = (e: PointerEvent): void => {
    const wasTracked = pointers.delete(e.pointerId);
    if (!wasTracked) return;
    try { svg.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 0) {
      // Last pointer up: decide BEFORE the mode resets whether the trailing
      // native click (which always follows — capture retargeted the release
      // here) concludes a drag and must be swallowed by onClickCapture.
      suppressNextClick = shouldSuppressClick(maxDragDistancePx, DRAG_THRESHOLD_PX);
    }

    if (mode === "gesturing") {
      if (pointers.size >= 2) {
        // 3rd-finger lift while still two-finger pinching: rebaseline.
        beginGesture();
        return;
      }
      if (pointers.size === 1) {
        // Drop to single-pointer pan with the remaining finger. Rebaseline
        // lastX/Y so the next pointermove doesn't translate by the gap
        // between the two fingers.
        const remaining = pointers.values().next().value!;
        startX = remaining.x;
        startY = remaining.y;
        lastX = remaining.x;
        lastY = remaining.y;
        mode = "panning";
        return;
      }
      mode = "idle";
      svg.classList.remove("panning");
      return;
    }

    if (pointers.size === 0) {
      // Last pointer lifted from armed/panning.
      if (mode === "panning") svg.classList.remove("panning");
      mode = "idle";
    }
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  // pointerleave intentionally NOT wired: with pointer capture during pan/
  // gesture, moves arrive even outside the SVG; treating leave as end would
  // drop a finger mid-pinch if it grazed the SVG edge.

  // --- zoom ---
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelAnimation(); // user takes control — abort any in-progress tween
      cameraOwned = true; // user is zooming — stop auto-fitting on reflow
      userCameraOwned = true;
      // Cheap: just accumulate. The scale math + cursor anchoring run once per
      // frame in scheduleApply's rAF (see the coalescing note above). No
      // per-event getBoundingClientRect / state mutation, so a burst of wheel
      // events can't pile up faster than the screen can show the result.
      // A trackpad PINCH arrives here, not through the pointer handlers: the
      // OS reports it as a wheel event with ctrlKey set. It carries much
      // smaller deltas than a two-finger scroll of the same physical travel, so
      // one shared sensitivity left it feeling dead (founder, 5 Aug). Gain the
      // pinch delta alone — a plain scroll is untouched — and take no deltaX
      // from it: a pinch has no pan component, and treating stray horizontal
      // jitter as one would slide the coral while the fingers close.
      if (e.ctrlKey) {
        pendingWheelDeltaY += e.deltaY * PINCH_ZOOM_GAIN;
      } else {
        pendingWheelDeltaY += e.deltaY;
        pendingWheelDeltaX += e.deltaX;
      }
      pendingWheelCursor = { x: e.clientX, y: e.clientY };
      scheduleApply();
    },
    { passive: false },
  );

  // Double-click on empty space resets focus to the full plant and refits.
  // Block dblclicks are handled by the interaction layer — skip if a block is
  // under the cursor. Two detection paths: SVG-rendered blocks carry
  // data-block-id in the DOM (main.ts/public.ts); canvas-rendered blocks have
  // no DOM (the world <g> is intentionally empty in mount-plant), so the host
  // injects opts.isNodeAt (a canvas hit-test) instead — without it every
  // dblclick, including on a node, would reset the camera.
  svg.addEventListener("dblclick", (e) => {
    const target = e.target as Element | null;
    if (target?.closest("[data-block-id]")) return;
    if (opts?.isNodeAt?.(e.clientX, e.clientY)) return;
    activeBounds = plantBounds;
    fit();
  });

  let refitRetries = 0;
  const MAX_REFIT_RETRIES = 30; // ~0.5s at 60fps — bounded so we never spin forever

  const handle: PanZoomHandle = {
    refit(focusBounds?: Bounds) {
      settleNow();
      cancelAnimation();
      activeBounds = focusBounds ?? plantBounds;
      // Full View (no focus) resumes auto-fit; a focused refit owns the camera.
      cameraOwned = focusBounds !== undefined;
      if (focusBounds === undefined) userCameraOwned = false;
      fit();
    },
    refitAnimated(focusBounds: Bounds, durationMs = 500, minScale = 0) {
      // Don't animate a frame against a not-yet-laid-out viewport (pop-out panes
      // size after mount; the HUD-open reflow briefly reports 0×0). Defer to the
      // next frame, bounded, so the frame eventually lands at a real size instead
      // of computing a junk camera that leaves the coral compressed.
      refreshRect();
      if (!viewportUsable(cachedRect)) {
        if (refitRetries < MAX_REFIT_RETRIES) {
          refitRetries++;
          win.requestAnimationFrame(() => handle.refitAnimated(focusBounds, durationMs, minScale));
        }
        return;
      }
      refitRetries = 0;
      cameraOwned = true; // framing a node is an explicit camera move
      // Do NOT settleNow() — we want compositing to stay active so each tween
      // frame applies a cheap CSS transform on motionLayer (bitmap scale, GPU,
      // no canvas redraw), instead of calling commitToWorld() every frame.
      cancelAnimation();
      // Clear any pending settle timer so it can't fire and commitToWorld mid-tween.
      if (settleTimer !== null) { win.clearTimeout(settleTimer); settleTimer = null; }
      // Ensure we are in compositing mode. `settled` already holds the last
      // committed transform, so the composited delta will animate from there.
      compositing = true;

      activeBounds = focusBounds;

      // Transform-safe size (layout box, not gBCR) — see readRect.
      refreshRect();
      const rect = cachedRect;
      const target = computeFitTransform(
        focusBounds,
        { width: rect.width, height: rect.height },
        readInsets(rect),
        FIT_PADDING,
        frameCap(),
        minScale,
      );
      const startTx = state.tx;
      const startTy = state.ty;
      const startScale = state.scale;
      // First-rAF-tick start time — see flyAlongPath for why the ambient
      // performance.now() must never seed a tween consumed by another
      // window's rAF timestamps (the pop-out black-screen camera).
      let startTime: number | null = null;

      // Interpolate the WORLD point at the viewport centre (not tx/ty directly):
      // lerping tx linearly while scale changes makes the on-screen focal point
      // trace a hyperbola — on a big zoom-in to an off-centre branch the view
      // visibly drifts the "wrong way" before converging. Moving the focal
      // world-point in a straight line (and deriving tx/ty from it each frame)
      // keeps the target branch tracking straight to centre.
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const startCx = (cx - startTx) / startScale;
      const startCy = (cy - startTy) / startScale;
      const targetCx = (cx - target.tx) / target.scale;
      const targetCy = (cy - target.ty) / target.scale;

      const tick = (now: number): void => {
        if (startTime === null) startTime = now;
        const elapsed = now - startTime;
        const rawT = Math.min(1, elapsed / durationMs);
        const t = easeInOutCubic(rawT);

        const s = startScale + (target.scale - startScale) * t;
        const wcx = startCx + (targetCx - startCx) * t;
        const wcy = startCy + (targetCy - startCy) * t;
        state.scale = s;
        state.tx = cx - wcx * s;
        state.ty = cy - wcy * s;

        if (rawT < 1) {
          // Mid-tween: write only the composited CSS transform on motionLayer.
          // apply() checks `compositing` and will take the cheap wrapper path,
          // then fires onZoomChange / onTransformChange itself.
          apply();
          animRafId = win.requestAnimationFrame(tick);
        } else {
          // Final frame: commit once → sharp canvas redraw at the destination.
          // Set compositing = false BEFORE commitToWorld so apply() inside
          // commitToWorld writes the <g> transform (not the wrapper).
          animRafId = null;
          compositing = false;
          commitToWorld();
          if (onZoomChange) onZoomChange(state.scale);
          if (onTransformChange) onTransformChange(state.tx, state.ty, state.scale);
        }
      };

      animRafId = win.requestAnimationFrame(tick);
    },
    flyAlongPath(path, targetBounds, durationMs = 750) {
      refreshRect();
      if (!viewportUsable(cachedRect)) {
        if (refitRetries < MAX_REFIT_RETRIES) {
          refitRetries++;
          win.requestAnimationFrame(() => handle.flyAlongPath(path, targetBounds, durationMs));
        }
        return;
      }
      refitRetries = 0;
      if (path.length < 1) { handle.refitAnimated(targetBounds, durationMs); return; }
      cameraOwned = true;
      cancelAnimation();
      if (settleTimer !== null) { win.clearTimeout(settleTimer); settleTimer = null; }
      compositing = true;
      activeBounds = targetBounds;

      const rect = cachedRect;
      // No minScale floor here: flyAlongPath is the unfurl rail-cam, gated on
      // unfurlActive, which is always false in the plugin — the legibility
      // floor has nothing to protect on this path. See refitAnimated for the
      // floor's actual home.
      const target = computeFitTransform(
        targetBounds, { width: rect.width, height: rect.height }, readInsets(rect), FIT_PADDING,
        frameCap(),
      );
      // Recalibrate the zoom floor to the whole coral at the CURRENT insets. The
      // setPlantBounds floor was computed during the unfurl REBUILD, before the
      // panel inset went live, so it sat above this insetted fit — giving a
      // first-clamp jump and blocking zoom-out back to the initial fit. plantBounds
      // is the whole coral (not this branch's bounds), so the floor stays the
      // fit-to-coral view no matter which node we're framing. Site-only: the plugin
      // frames through refitAnimated, never flyAlongPath.
      zoomFloor = minZoomForFit(
        plantBounds,
        { width: rect.width, height: rect.height },
        readInsets(rect),
        FIT_PADDING,
        ZOOM_MARGIN_FACTOR,
        frameCap(),
      );
      const startScale = state.scale;
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // Start the rail from where the camera ACTUALLY is (the current
      // viewport-centre world point), not the first waypoint — otherwise frame 0
      // teleports to the waypoint (the "jump somewhere else" at the start of an
      // unfurl; the "snap back to the collapsed node before zooming out" on furl).
      // A rebuild can move the waypoints out from under a settled camera, so this
      // continuity fix matters even when the caller's first point looks right.
      const startFocal = { x: (cx - state.tx) / startScale, y: (cy - state.ty) / startScale };
      // The caller hands at most one geometry-tied control point (the common-
      // ancestor junction) plus the target, so [startFocal, ...path] is ≤3 points.
      // Three → a single quadratic Bézier: one smooth bow toward the junction, no
      // overshoot or S-curve. Two → a straight glide. Anything longer (defensive)
      // falls back to a centripetal Catmull-Rom.
      const raw = [startFocal, ...path];
      const fullPath =
        raw.length === 3 ? quadBezierDensify(raw[0]!, gentleControl(raw[0]!, raw[1]!, raw[2]!), raw[2]!)
        : raw.length < 3 ? raw
        : catmullRomDensify(raw);

      // Arc-length parameterise the polyline so the focal point moves at a
      // steady world-space speed regardless of segment lengths.
      const seg: number[] = [];
      let total = 0;
      for (let i = 1; i < fullPath.length; i++) {
        const d = Math.hypot(fullPath[i]!.x - fullPath[i - 1]!.x, fullPath[i]!.y - fullPath[i - 1]!.y);
        seg.push(d);
        total += d;
      }
      const focalAt = (u: number): { x: number; y: number } => {
        if (total <= 0) return fullPath[fullPath.length - 1]!;
        let dist = u * total;
        for (let i = 0; i < seg.length; i++) {
          if (dist <= seg[i]! || i === seg.length - 1) {
            const f = seg[i]! > 0 ? dist / seg[i]! : 0;
            return { x: fullPath[i]!.x + (fullPath[i + 1]!.x - fullPath[i]!.x) * f, y: fullPath[i]!.y + (fullPath[i + 1]!.y - fullPath[i]!.y) * f };
          }
          dist -= seg[i]!;
        }
        return fullPath[fullPath.length - 1]!;
      };

      // Where the FINAL focal sits on screen under the target transform. With a
      // panel inset the fit is off-centre (content in the coral-panel), so this
      // is left of screen-centre. Ease the focal's on-screen ANCHOR from centre
      // (where the start focal sits, by definition of startFocal) to this target
      // anchor, in step with the zoom — otherwise the tick would pin the focal to
      // screen-centre the whole way and only jump to the inset at the t=1 snap
      // (zoom and x-origin landing in two beats). No-op for centred fits, where
      // the target anchor IS screen-centre.
      const targetFocal = fullPath[fullPath.length - 1]!;
      const targetAnchorX = target.tx + targetFocal.x * target.scale;
      const targetAnchorY = target.ty + targetFocal.y * target.scale;

      // Start time comes from the FIRST rAF tick's own timestamp, never the
      // ambient performance.now(): `now` is on the element's window's clock,
      // and an Obsidian pop-out's performance timeline starts at ITS creation
      // — hours after the main window's. Mixing the two made `elapsed` hugely
      // negative, easeInOutCubic(≈−10⁵) ≈ 4t³ ≈ −10¹⁵, and the camera parked
      // at scale(−2.5e15): the pop-out "black screen". Same-window callers are
      // unaffected (first-frame capture ≈ call time).
      let startTime: number | null = null;
      const tick = (now: number): void => {
        if (startTime === null) startTime = now;
        const rawT = Math.min(1, (now - startTime) / durationMs);
        const t = easeInOutCubic(rawT);
        if (rawT < 1) {
          const f = focalAt(t);
          const s = startScale + (target.scale - startScale) * t;
          const anchorX = cx + (targetAnchorX - cx) * t;
          const anchorY = cy + (targetAnchorY - cy) * t;
          state.scale = s;
          state.tx = anchorX - f.x * s;
          state.ty = anchorY - f.y * s;
          apply();
          animRafId = win.requestAnimationFrame(tick);
        } else {
          // Snap exactly to the computed fit (honours insets/padding) and commit.
          animRafId = null;
          compositing = false;
          state.scale = target.scale;
          state.tx = target.tx;
          state.ty = target.ty;
          commitToWorld();
          if (onZoomChange) onZoomChange(state.scale);
          if (onTransformChange) onTransformChange(state.tx, state.ty, state.scale);
        }
      };
      animRafId = win.requestAnimationFrame(tick);
    },
    setPlantBounds(newBounds: Bounds, opts?: { preserveView?: boolean }) {
      settleNow();
      cancelAnimation();
      plantBounds = newBounds;
      if (opts?.preserveView) {
        // Same-plant rebuild: keep the current camera. Just recompute the zoom
        // floor against the new bounds and re-clamp the existing transform so it
        // stays valid (the plant may have grown). No refit → no jump to full view.
        refreshRect();
        zoomFloor = minZoomForFit(
          plantBounds,
          { width: cachedRect.width, height: cachedRect.height },
          readInsets(cachedRect),
          FIT_PADDING,
          ZOOM_MARGIN_FACTOR,
          frameCap(),
        );
        clampState();
        apply();
        return;
      }
      // Reset active focus to the new plant; callers (e.g. scheduleRebuild)
      // want both effects at once and don't need a separate refit() call.
      activeBounds = newBounds;
      fit();
    },
    setTransform(tx: number, ty: number, scale: number) {
      // settleNow() drops compositing so apply() takes the commitToWorld path
      // (sharp <g> transform + onCommit → canvas redraw), not the CSS-wrapper path.
      settleNow();
      cancelAnimation();
      cameraOwned = true; // scripted camera — don't let a reflow auto-fit over it
      state.tx = tx;
      state.ty = ty;
      state.scale = scale;
      apply();
    },
    ownCamera() {
      cameraOwned = true;
    },
    isCameraUserOwned() {
      return userCameraOwned;
    },
    setFitPadding(padding: number) {
      FIT_PADDING = padding;
    },
    setPinchZoomGain(gain: number) {
      PINCH_ZOOM_GAIN = pinchGainFor(gain);
    },
    setZoomOutMax(zoomOutMax: number) {
      ZOOM_MARGIN_FACTOR = marginFactorFor(zoomOutMax);
      if (!viewportUsable(cachedRect)) return; // no laid-out viewport → next fit picks it up
      zoomFloor = minZoomForFit(
        plantBounds,
        { width: cachedRect.width, height: cachedRect.height },
        readInsets(cachedRect),
        FIT_PADDING,
        ZOOM_MARGIN_FACTOR,
        frameCap(),
      );
      clampState();
      apply();
    },
    clientToWorld(clientX: number, clientY: number) {
      // The gBCR corner is the TRANSFORMED origin while a wrapper transform is
      // live: it already absorbs the wrapper translation (corner = untransformed
      // origin + (wx, wy)), so only the wrapper scale + the SETTLED transform
      // remain to invert — see clientPointToWorld. With no wrapper live this is
      // the plain (p - t) / scale inverse of the committed transform. Reads the
      // rect fresh (not cachedRect): unlike the gesture loop this runs once per
      // click, and the cached left/top may predate a layout shift.
      const r = svg.getBoundingClientRect();
      return clientPointToWorld(
        clientX - r.left,
        clientY - r.top,
        settled,
        paintedDelta ? paintedDelta.a : 1,
      );
    },
    destroy() {
      win.removeEventListener("resize", onResize);
      ro?.disconnect();
      cancelAnimation();
    },
  };
  return handle;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmt(n: number): string {
  return Math.abs(n) < 1e-4 ? "0" : n.toFixed(3);
}
