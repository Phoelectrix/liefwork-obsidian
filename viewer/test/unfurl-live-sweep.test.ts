import { describe, test, expect } from "bun:test";
import type { Plant } from "../../src/types.ts";
import {
  runLiveSweep,
  PHASE_SPLIT,
  SWEEP_MS,
  type FrameOverrides,
} from "../src/unfurl-live-sweep.ts";

// A frame records the overrides that produced its plant plus the render opts,
// so the two live side-by-side and we can assert the schedule per frame.
interface FrameRecord {
  overrides: FrameOverrides;
  textRevealFrac: number;
}

function harness(overrides: Partial<Parameters<typeof runLiveSweep>[0]> = {}) {
  let clock = 0;
  let nextId = 1;
  const pending = new Map<number, (t: number) => void>();
  const buildCalls: FrameOverrides[] = [];
  const frames: FrameRecord[] = [];

  // buildFrame tags the (fake) plant with the overrides it was given, so render
  // can pair the plant it paints with the schedule values that built it.
  const buildFrame = (o: FrameOverrides): Plant => {
    buildCalls.push({ ...o });
    return { __overrides: { ...o } } as unknown as Plant;
  };
  const render = (plant: Plant, opts: { textRevealFrac: number }): void => {
    const o = (plant as unknown as { __overrides: FrameOverrides }).__overrides;
    frames.push({ overrides: o, textRevealFrac: opts.textRevealFrac });
  };

  const args: Parameters<typeof runLiveSweep>[0] = {
    nodeId: "node-1",
    durationMs: 100,
    buildFrame,
    render,
    now: () => clock,
    raf: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    caf: (id) => { pending.delete(id); },
    ...overrides,
  };

  const handle = runLiveSweep(args);

  // Advance the fake clock by `ms` and fire the single outstanding rAF callback.
  const advance = (ms: number) => {
    clock += ms;
    const entries = [...pending.entries()];
    pending.clear();
    for (const [, cb] of entries) cb(clock);
  };

  return { handle, advance, buildCalls, frames, pendingCount: () => pending.size };
}

describe("runLiveSweep", () => {
  test("exposes the named schedule constants", () => {
    expect(PHASE_SPLIT).toBe(0.6);
    expect(SWEEP_MS).toBe(1300);
  });

  test("ticks through the duration: Phase A grows, Phase B unfolds, one final frame, done resolves", async () => {
    const { handle, advance, frames } = harness();

    // 100ms duration, 10ms steps: t = 0.1 .. 0.9 render (9 frames), t = 1.0 finishes.
    for (let i = 0; i < 9; i++) advance(10);
    expect(frames.length).toBe(9);

    const phaseA = frames.filter((f) => f.overrides.foldFactor === 0);
    const phaseB = frames.filter((f) => f.overrides.foldFactor > 0);
    expect(phaseA.length).toBeGreaterThan(0);
    expect(phaseB.length).toBeGreaterThan(0);

    // Phase A: growthFactor rising 0→1, everything else pinned at 0.
    for (const f of phaseA) {
      expect(f.overrides.growthFactor).toBeGreaterThanOrEqual(0);
      expect(f.overrides.growthFactor).toBeLessThanOrEqual(1);
      expect(f.overrides.foldFactor).toBe(0);
      expect(f.overrides.liefAngleFrac).toBe(0);
      expect(f.textRevealFrac).toBe(0);
    }
    // growthFactor is monotonically rising across Phase A.
    for (let i = 1; i < phaseA.length; i++) {
      expect(phaseA[i]!.overrides.growthFactor).toBeGreaterThanOrEqual(
        phaseA[i - 1]!.overrides.growthFactor,
      );
    }

    // Phase B: full-size, fold/lief/text rising 0→1 in lockstep.
    for (const f of phaseB) {
      expect(f.overrides.growthFactor).toBe(1);
      expect(f.overrides.foldFactor).toBeGreaterThan(0);
      expect(f.overrides.foldFactor).toBeLessThanOrEqual(1);
      expect(f.overrides.liefAngleFrac).toBe(f.overrides.foldFactor);
      expect(f.textRevealFrac).toBe(f.overrides.foldFactor);
    }
    for (let i = 1; i < phaseB.length; i++) {
      expect(phaseB[i]!.overrides.foldFactor).toBeGreaterThanOrEqual(
        phaseB[i - 1]!.overrides.foldFactor,
      );
    }

    // Crossing t >= 1 paints exactly one final full-open frame.
    advance(10);
    expect(frames.length).toBe(10);
    const final = frames.at(-1)!;
    expect(final.overrides).toEqual({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    expect(final.textRevealFrac).toBe(1);

    await handle.done;
  });

  test("no further frames scheduled after natural completion", async () => {
    const { handle, advance, frames, pendingCount } = harness();
    for (let i = 0; i < 10; i++) advance(10); // reaches t = 1.0
    const countAtFinish = frames.length;
    expect(pendingCount()).toBe(0);
    advance(10); // nothing left to fire
    expect(frames.length).toBe(countAtFinish);
    await handle.done;
  });

  test("cancel() mid-way renders the final full-open frame once, settles done, schedules no more rAF", async () => {
    const { handle, advance, frames, pendingCount } = harness();

    advance(10); // one Phase-A frame rendered
    expect(frames.length).toBe(1);
    expect(frames[0]!.overrides.foldFactor).toBe(0);

    handle.cancel();
    expect(frames.length).toBe(2);
    expect(frames.at(-1)!.overrides).toEqual({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    expect(frames.at(-1)!.textRevealFrac).toBe(1);
    expect(pendingCount()).toBe(0);

    const after = frames.length;
    advance(10); // any queued frame must be dead
    expect(frames.length).toBe(after);

    handle.cancel(); // second cancel: no-op
    expect(frames.length).toBe(after);

    await handle.done;
  });

  test("cancel() after natural completion is a no-op", async () => {
    const { handle, advance, frames } = harness();
    for (let i = 0; i < 10; i++) advance(10);
    const countAtFinish = frames.length;
    expect(frames.at(-1)!.textRevealFrac).toBe(1);

    handle.cancel();
    expect(frames.length).toBe(countAtFinish); // no extra render

    await handle.done;
  });
});

// ── startDelayMs (camera-first sequencing, tune-camera-sequence) ───────────
// Lets a caller (mount-plant's unfurl path) hold the sweep during a camera
// move: no render/buildFrame, no `t` advance, until the delay elapses, then
// the normal Phase-A/Phase-B timeline resumes exactly as the undelayed case.
describe("runLiveSweep — startDelayMs", () => {
  test("holds during the delay (no render/buildFrame calls), then resumes the normal timeline once it elapses", async () => {
    const { handle, advance, frames, buildCalls } = harness({ startDelayMs: 45 });

    // 40ms < 45ms delay: fully held, nothing rendered or built.
    for (let i = 0; i < 4; i++) advance(10);
    expect(frames.length).toBe(0);
    expect(buildCalls.length).toBe(0);

    // Crossing the delay: elapsedSinceStart=50, t=(50-45)/100=0.05 — the
    // first real Phase-A frame, picking up exactly where an undelayed sweep
    // would be at t=0.05.
    advance(10);
    expect(frames.length).toBe(1);
    const first = frames[0]!;
    expect(first.overrides.growthFactor).toBeGreaterThan(0);
    expect(first.overrides.growthFactor).toBeLessThan(1);
    expect(first.overrides.foldFactor).toBe(0);
    expect(first.overrides.liefAngleFrac).toBe(0);
    expect(first.textRevealFrac).toBe(0);

    // Drive to completion — the timeline resumes exactly as the undelayed
    // case, just offset by the delay, ending on one final full-open frame.
    for (let i = 0; i < 20; i++) advance(10);
    const final = frames.at(-1)!;
    expect(final.overrides).toEqual({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    expect(final.textRevealFrac).toBe(1);

    await handle.done;
  });

  test("cancel() during the delay renders the final full-open frame once and settles — no render during the hold besides that final frame", async () => {
    const { handle, advance, frames, pendingCount } = harness({ startDelayMs: 45 });

    for (let i = 0; i < 3; i++) advance(10); // 30ms, well inside the hold
    expect(frames.length).toBe(0);

    handle.cancel();
    expect(frames.length).toBe(1);
    expect(frames[0]!.overrides).toEqual({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    expect(frames[0]!.textRevealFrac).toBe(1);
    expect(pendingCount()).toBe(0);

    advance(10); // any queued frame must be dead
    expect(frames.length).toBe(1);

    handle.cancel(); // idempotent
    expect(frames.length).toBe(1);

    await handle.done;
  });

  test("default startDelayMs is 0 — undelayed sweeps render immediately, unaffected", () => {
    const { frames, advance } = harness();
    advance(10);
    expect(frames.length).toBe(1);
    expect(frames[0]!.overrides.growthFactor).toBeGreaterThan(0);
  });
});

// ── reverse (collapse/furl playback, tune-reverse-furl) ────────────────────
// A reverse sweep plays the forward curve backwards: values at progress `t`
// equal the forward values at `(1 - t)`. So it starts fully-open (fold/text
// high) and folds+shrinks back to the stub — first the unfold reverses (fold
// up, text out), then the grow reverses (shrink to stub). The terminal frame
// (and cancel's snap) is the STUB ({0,0,0}, text 0), not the {1,1,1} full-open
// a forward sweep ends on. Forward behaviour (no flag) is unchanged — covered
// above; here we assert only the reverse-specific shape.
describe("runLiveSweep — reverse", () => {
  test("plays back to the stub: first frames near-full, unfold reverses before grow, terminal frame is the stub", async () => {
    const { handle, advance, frames } = harness({ reverse: true });

    // 100ms duration, 10ms steps: t = 0.1 .. 0.9 render (9 frames), t = 1.0 finishes.
    for (let i = 0; i < 9; i++) advance(10);
    expect(frames.length).toBe(9);

    // First rendered frame is near-full-open: growth already 1 (past the split
    // in the reversed timeline), fold high — the branch begins folded-out.
    const first = frames[0]!;
    expect(first.overrides.growthFactor).toBe(1);
    expect(first.overrides.foldFactor).toBeGreaterThan(0.5);
    expect(first.overrides.liefAngleFrac).toBe(first.overrides.foldFactor);
    expect(first.textRevealFrac).toBe(first.overrides.foldFactor);

    // The unfold reverses FIRST (fold falls while growth stays pinned at 1),
    // THEN the grow reverses (growth falls while fold sits at 0). Split the
    // rendered frames by the reversed phase and check each direction.
    const unfoldPhase = frames.filter((f) => f.overrides.growthFactor === 1);
    const growPhase = frames.filter((f) => f.overrides.growthFactor < 1);
    expect(unfoldPhase.length).toBeGreaterThan(0);
    expect(growPhase.length).toBeGreaterThan(0);

    // Unfold-reversing: fold/lief/text fall 0→ monotonically (in lockstep).
    for (const f of unfoldPhase) {
      expect(f.overrides.liefAngleFrac).toBe(f.overrides.foldFactor);
      expect(f.textRevealFrac).toBe(f.overrides.foldFactor);
    }
    for (let i = 1; i < unfoldPhase.length; i++) {
      expect(unfoldPhase[i]!.overrides.foldFactor).toBeLessThanOrEqual(
        unfoldPhase[i - 1]!.overrides.foldFactor,
      );
    }
    // Grow-reversing: fold/text pinned at 0, growth falls monotonically.
    for (const f of growPhase) {
      expect(f.overrides.foldFactor).toBe(0);
      expect(f.overrides.liefAngleFrac).toBe(0);
      expect(f.textRevealFrac).toBe(0);
    }
    for (let i = 1; i < growPhase.length; i++) {
      expect(growPhase[i]!.overrides.growthFactor).toBeLessThanOrEqual(
        growPhase[i - 1]!.overrides.growthFactor,
      );
    }

    // Crossing t >= 1 paints exactly one final STUB frame (forward-t=0 state).
    advance(10);
    expect(frames.length).toBe(10);
    const final = frames.at(-1)!;
    expect(final.overrides).toEqual({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 });
    expect(final.textRevealFrac).toBe(0);

    await handle.done;
  });

  test("cancel() mid-reverse snaps to the STUB once, settles done, schedules no more rAF", async () => {
    const { handle, advance, frames, pendingCount } = harness({ reverse: true });

    advance(10); // one near-full frame rendered
    expect(frames.length).toBe(1);
    expect(frames[0]!.overrides.growthFactor).toBe(1);

    handle.cancel();
    expect(frames.length).toBe(2);
    expect(frames.at(-1)!.overrides).toEqual({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 });
    expect(frames.at(-1)!.textRevealFrac).toBe(0);
    expect(pendingCount()).toBe(0);

    const after = frames.length;
    advance(10); // any queued frame must be dead
    expect(frames.length).toBe(after);

    handle.cancel(); // idempotent
    expect(frames.length).toBe(after);

    await handle.done;
  });
});
