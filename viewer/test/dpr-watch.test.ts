import { describe, test, expect } from "bun:test";
import { watchDevicePixelRatio } from "../src/dpr-watch.ts";

/** Minimal fake Window whose devicePixelRatio + matchMedia we drive by hand. */
function fakeWin(initialDpr: number) {
  let dpr = initialDpr;
  let armedHandler: (() => void) | null = null;
  let armedQuery = "";
  let armCount = 0;
  const win = {
    get devicePixelRatio() { return dpr; },
    matchMedia(query: string) {
      armCount++;
      armedQuery = query;
      const mql = {
        media: query,
        addEventListener: (_type: string, h: () => void) => { armedHandler = h; },
        removeEventListener: (_type: string, h: () => void) => { if (armedHandler === h) armedHandler = null; },
      };
      return mql as unknown as MediaQueryList;
    },
  } as unknown as Window;
  return {
    win,
    /** Simulate the monitor's DPR changing → fire the armed listener. */
    flipDpr(next: number) { dpr = next; armedHandler?.(); },
    armedQuery: () => armedQuery,
    armCount: () => armCount,
    hasListener: () => armedHandler !== null,
  };
}

describe("watchDevicePixelRatio", () => {
  test("arms a matchMedia query for the current DPR on install", () => {
    const f = fakeWin(2);
    watchDevicePixelRatio(f.win, () => {});
    expect(f.armedQuery()).toBe("(resolution: 2dppx)");
    expect(f.armCount()).toBe(1);
  });

  test("on DPR change → calls onChange and re-arms against the new DPR", () => {
    const f = fakeWin(2);
    let calls = 0;
    watchDevicePixelRatio(f.win, () => { calls++; });
    f.flipDpr(1);
    expect(calls).toBe(1);
    expect(f.armedQuery()).toBe("(resolution: 1dppx)");
    expect(f.armCount()).toBe(2);
  });

  test("teardown removes the listener (no further callbacks)", () => {
    const f = fakeWin(2);
    let calls = 0;
    const stop = watchDevicePixelRatio(f.win, () => { calls++; });
    stop();
    expect(f.hasListener()).toBe(false);
    f.flipDpr(1);
    expect(calls).toBe(0);
  });
});
