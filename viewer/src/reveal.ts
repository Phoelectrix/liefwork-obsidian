// Pure fade reveal timing (Task 8): drives the opacity ramp for a newly-unfurled
// subtree. No DOM, no canvas — just a clamped, eased 0→1 progress function so
// it's exhaustively unit-testable and shareable between the canvas draw loop and
// any future non-canvas reveal consumer.

import { EASINGS } from "./shot-engine.ts";

const easeInOutCubic = EASINGS.easeInOutCubic;

/** Reveal progress at `nowMs` for an animation that started at `startMs` and
 *  runs for `durationMs`. Clamped: 0 at/before start, 1 at/after
 *  `startMs + durationMs`, eased (easeInOutCubic) and monotonic between.
 *  `durationMs <= 0` resolves immediately to 1 (no animation). */
export function revealProgress(startMs: number, nowMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const elapsed = nowMs - startMs;
  if (elapsed <= 0) return 0;
  if (elapsed >= durationMs) return 1;
  return easeInOutCubic(elapsed / durationMs);
}
