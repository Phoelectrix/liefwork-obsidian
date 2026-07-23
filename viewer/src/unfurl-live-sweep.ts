// Live-sweep driver for the unfurl-entry animation.
//
// The unfurl is one live per-frame rebuild: each frame we recompute override
// values (`growthFactor` / `foldFactor` / `liefAngleFrac`) and hand them to a
// caller-supplied `buildFrame` closure, which rebuilds the plant; `render`
// then paints that plant. This module owns only the rAF clock and the two
// sequential phases — it is pure over the injected clock/build/render, so it
// is fully unit-testable with a fake clock.
//
// An optional `startDelayMs` HOLDS the whole timeline: no render/buildFrame,
// no `t` advance, until `elapsedSinceStart >= startDelayMs` — lets a caller
// (e.g. a camera move) own the screen first, with the growth beginning right
// as the delay elapses. Cancel during the hold still routes through the same
// terminal `finish()` as any other cancel.
//
// Timeline (`t = clamp((elapsedSinceStart - startDelayMs) / durationMs, 0, 1)`),
// eased with `easeInOutCubic`, split at `PHASE_SPLIT`:
//   Phase A (t < PHASE_SPLIT): the stem grows in. `growthFactor` eases 0→1
//     while the fold/lief/text stay closed (all 0).
//   Phase B (t ≥ PHASE_SPLIT): the plant is full-size (`growthFactor = 1`) and
//     unfolds — `foldFactor` / `liefAngleFrac` / `textRevealFrac` ease 0→1.
//   t ≥ 1: one final full-open frame, then `done` resolves.
//
// Modelled on the cancellable tween loop in `pan-zoom.ts` (tick / animRafId /
// cancelAnimation): a single terminal `finish()`, guarded by a `settled` flag,
// is the sole exit for BOTH natural completion and `cancel()`.

import type { Plant } from "../../src/types.ts";
import { EASINGS } from "./shot-engine.ts";

/** Fraction of the timeline given to Phase A (grow-in); the rest is Phase B (unfold). */
export const PHASE_SPLIT = 0.6;

/** Default sweep duration, in ms. A little slower than the original 1000ms —
 *  tuned post-smoke so the growth doesn't outrun the camera settle. */
export const SWEEP_MS = 1300;

const ease = EASINGS.easeInOutCubic;

/** Override values fed to the caller's `buildFrame` closure each frame. */
export interface FrameOverrides {
  growthFactor: number;
  foldFactor: number;
  liefAngleFrac: number;
}

/** One rendered frame: the override triple to build with + the text-reveal
 *  fraction to paint. */
interface FrameValues {
  overrides: FrameOverrides;
  textRevealFrac: number;
}

/** The FORWARD schedule's values at progress `p ∈ [0,1]` — the single source of
 *  truth for both directions. Phase A (`p < PHASE_SPLIT`) grows `growthFactor`
 *  0→1 with fold/lief/text held at 0; Phase B (`p ≥ PHASE_SPLIT`) holds
 *  `growthFactor = 1` and eases `foldFactor`/`liefAngleFrac`/`textRevealFrac`
 *  0→1. A `reverse` sweep renders these same values at `(1 - t)`, so it plays
 *  the identical curve backwards; the terminal frame is `forwardValues(0)`
 *  (the stub) instead of `forwardValues(1)` (full-open). */
function forwardValues(p: number): FrameValues {
  if (p < PHASE_SPLIT) {
    const growthFactor = ease(p / PHASE_SPLIT);
    return { overrides: { growthFactor, foldFactor: 0, liefAngleFrac: 0 }, textRevealFrac: 0 };
  }
  const b = ease((p - PHASE_SPLIT) / (1 - PHASE_SPLIT));
  return { overrides: { growthFactor: 1, foldFactor: b, liefAngleFrac: b }, textRevealFrac: b };
}

export interface LiveSweepArgs {
  /** Identity of the node being unfurled (captured by the caller's closures). */
  nodeId: string;
  /** Rebuild the plant with the given per-frame override values. */
  buildFrame: (overrides: FrameOverrides) => Plant;
  /** Paint one frame. */
  render: (plant: Plant, opts: { textRevealFrac: number }) => void;
  /** Sweep duration in ms (default `SWEEP_MS`). */
  durationMs?: number;
  /** Delay, in ms, before the sweep timeline begins (default `0`). The driver
   *  HOLDS during this window — no `render`/`buildFrame` calls, `t` does not
   *  advance — then runs the normal Phase-A/Phase-B timeline exactly as if
   *  starting fresh at the end of the delay. Lets a caller sequence a camera
   *  move to finish before growth starts, without the sweep itself knowing
   *  anything about cameras. */
  startDelayMs?: number;
  /** Play the sweep in REVERSE (default `false`). Each frame at progress `t`
   *  renders the FORWARD values at `(1 - t)` — so the sweep starts fully-open
   *  and folds/shrinks back to the stub (first the unfold reverses: fold up +
   *  text out; then the grow reverses: shrink to stub). The terminal frame
   *  (`t ≥ 1`, and `cancel()`'s snap) renders the forward-`t=0` state — the stub
   *  `{ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 }` with textReveal 0 —
   *  NOT the `{1,1,1}` full-open that a forward sweep ends on. All other
   *  machinery (finish/settled/cancel-idempotency/startDelayMs/reschedule-guard)
   *  is identical. */
  reverse?: boolean;
  /** Injectable clock / rAF (default `performance.now` / `requestAnimationFrame`
   *  / `cancelAnimationFrame`) — tests pass fakes. */
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (handle: number) => void;
}

export interface LiveSweepHandle {
  /** Stop the sweep, snap to the terminal frame (forward → full-open; reverse →
   *  the stub), settle `done`. Idempotent. */
  cancel(): void;
  /** Resolves once the sweep has painted its final frame (naturally or via cancel). */
  done: Promise<void>;
}

export function runLiveSweep(args: LiveSweepArgs): LiveSweepHandle {
  const { buildFrame, render } = args;
  const durationMs = args.durationMs ?? SWEEP_MS;
  const startDelayMs = args.startDelayMs ?? 0;
  const reverse = args.reverse ?? false;
  const now = args.now ?? (() => performance.now());
  const raf = args.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const caf = args.caf ?? ((h) => window.cancelAnimationFrame(h));

  let settled = false;
  let rafHandle: number | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // The TERMINAL frame the sweep ends on: forward → full-open (`forwardValues(1)`
  // = {1,1,1}, text 1); reverse → the stub (`forwardValues(0)` = {0,0,0}, text 0).
  const terminal = forwardValues(reverse ? 0 : 1);

  // Shared terminal path for BOTH natural completion and cancel: cancel any
  // pending frame, paint the terminal frame exactly once, settle `done`.
  // `settled` makes this idempotent — a second cancel (or cancel after natural
  // completion) is a no-op: no double render, no double resolve, no orphan rAF.
  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (rafHandle !== null) {
      caf(rafHandle);
      rafHandle = null;
    }
    render(buildFrame(terminal.overrides), { textRevealFrac: terminal.textRevealFrac });
    resolveDone();
  };

  const start = now();

  const frame = (): void => {
    if (settled) return;

    const elapsedSinceStart = now() - start;
    if (elapsedSinceStart < startDelayMs) {
      // Holding: the caller (e.g. a camera move) owns this window. No
      // render/buildFrame, no `t` advance — just keep the loop alive so we
      // notice when the delay elapses.
      rafHandle = raf(frame);
      return;
    }

    const elapsed = elapsedSinceStart - startDelayMs;
    const t = Math.max(0, Math.min(1, elapsed / durationMs));

    if (t >= 1) {
      finish();
      return;
    }

    // Forward renders the schedule at `t`; reverse renders it at `(1 - t)`, so
    // the sweep plays the identical Phase-A/Phase-B curve backwards — starting
    // full-open and folding/shrinking back toward the stub.
    const { overrides, textRevealFrac } = forwardValues(reverse ? 1 - t : t);
    render(buildFrame(overrides), { textRevealFrac });

    // Guard the reschedule: if render (or buildFrame) re-entrantly called
    // cancel(), finish() has already run and settled — don't orphan a rAF.
    if (!settled) rafHandle = raf(frame);
  };

  rafHandle = raf(frame);

  return {
    cancel: finish,
    done,
  };
}
