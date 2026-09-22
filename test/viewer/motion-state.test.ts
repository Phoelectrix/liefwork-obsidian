import { describe, expect, test, mock } from "bun:test";
import { createMotionStateMachine } from "../../viewer/src/motion-state.ts";

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    setTimeout(fn: () => void, ms: number): number {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id: number): void {
      pending.delete(id);
    },
    advance(ms: number): void {
      now += ms;
      const due = [...pending.entries()]
        .filter(([, e]) => e.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, e] of due) {
        pending.delete(id);
        e.fn();
      }
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}

describe("createMotionStateMachine", () => {
  test("markActive fires onRestEntered after debounceMs", () => {
    const timers = createFakeTimers();
    const onRest = mock(() => {});
    const sm = createMotionStateMachine({
      debounceMs: 150,
      onRestEntered: onRest,
      timers,
    });
    sm.markActive();
    expect(sm.isActive()).toBe(true);
    timers.advance(149);
    expect(onRest).toHaveBeenCalledTimes(0);
    timers.advance(1);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(sm.isActive()).toBe(false);
  });

  test("multiple markActive calls coalesce into one settle", () => {
    const timers = createFakeTimers();
    const onRest = mock(() => {});
    const sm = createMotionStateMachine({
      debounceMs: 150,
      onRestEntered: onRest,
      timers,
    });
    sm.markActive();
    timers.advance(100);
    sm.markActive();
    timers.advance(100);
    sm.markActive();
    timers.advance(149);
    expect(onRest).toHaveBeenCalledTimes(0);
    timers.advance(1);
    expect(onRest).toHaveBeenCalledTimes(1);
  });

  test("forceRest fires onRestEntered synchronously and cancels pending timer", () => {
    const timers = createFakeTimers();
    const onRest = mock(() => {});
    const sm = createMotionStateMachine({
      debounceMs: 150,
      onRestEntered: onRest,
      timers,
    });
    sm.markActive();
    expect(timers.pendingCount()).toBe(1);
    sm.forceRest();
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(sm.isActive()).toBe(false);
    expect(timers.pendingCount()).toBe(0);
    timers.advance(1000);
    expect(onRest).toHaveBeenCalledTimes(1); // still 1 — no late fire
  });

  test("forceRest is a no-op when not active", () => {
    const timers = createFakeTimers();
    const onRest = mock(() => {});
    const sm = createMotionStateMachine({
      debounceMs: 150,
      onRestEntered: onRest,
      timers,
    });
    sm.forceRest();
    expect(onRest).toHaveBeenCalledTimes(0);
    expect(sm.isActive()).toBe(false);
  });

  test("isActive reflects state across markActive/settle/forceRest", () => {
    const timers = createFakeTimers();
    const sm = createMotionStateMachine({
      debounceMs: 150,
      onRestEntered: () => {},
      timers,
    });
    expect(sm.isActive()).toBe(false);
    sm.markActive();
    expect(sm.isActive()).toBe(true);
    timers.advance(150);
    expect(sm.isActive()).toBe(false);
    sm.markActive();
    expect(sm.isActive()).toBe(true);
    sm.forceRest();
    expect(sm.isActive()).toBe(false);
  });
});
