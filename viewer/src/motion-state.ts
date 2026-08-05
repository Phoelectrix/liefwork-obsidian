/// <reference lib="dom" />

// Motion vs. rest state machine. Pure logic; timer source is injectable so
// the debounce behaviour can be unit-tested without browser globals.
//
// Lifecycle:
//   markActive() — flips state to active, (re)arms the debounce timer.
//                  Calling repeatedly during motion coalesces into a single
//                  trailing settle.
//   forceRest()  — cancels the pending timer and fires onRestEntered() now.
//                  Used by scripted-camera end-of-beat hooks.
//   isActive()   — current state.

export interface TimerSource {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const defaultTimers: TimerSource = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export interface MotionStateMachineOpts {
  /** Trailing-debounce window in ms. After this many ms with no markActive(),
   *  the state machine fires onRestEntered() and flips active=false. */
  debounceMs: number;
  /** Called once on the active→inactive transition. */
  onRestEntered: () => void;
  /** Override for tests. Defaults to window.setTimeout/clearTimeout. */
  timers?: TimerSource;
}

export interface MotionStateMachine {
  markActive(): void;
  forceRest(): void;
  isActive(): boolean;
}

export function createMotionStateMachine(
  opts: MotionStateMachineOpts,
): MotionStateMachine {
  const timers = opts.timers ?? defaultTimers;
  let active = false;
  let timer: number | null = null;

  function settle(): void {
    timer = null;
    active = false;
    opts.onRestEntered();
  }

  return {
    markActive(): void {
      active = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(settle, opts.debounceMs);
    },
    forceRest(): void {
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      if (active) {
        active = false;
        opts.onRestEntered();
      }
    },
    isActive(): boolean {
      return active;
    },
  };
}
