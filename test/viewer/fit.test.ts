import { describe, expect, test } from "bun:test";
import { computeFitTransform, minZoomForFit, clampPanToBounds } from "../../viewer/src/fit.ts";

const b = (x0: number, y0: number, x1: number, y1: number) => ({
  min: { x: x0, y: y0 },
  max: { x: x1, y: y1 },
});

describe("computeFitTransform", () => {
  test("centres bounds in viewport with no insets, no padding", () => {
    const r = computeFitTransform(
      b(0, 0, 100, 100),
      { width: 200, height: 200 },
      {},
      0,
    );
    expect(r.scale).toBe(2);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(0);
  });

  test("applies symmetric padding so bounds don't touch edges", () => {
    const r = computeFitTransform(
      b(0, 0, 100, 100),
      { width: 200, height: 200 },
      {},
      0.1,
    );
    expect(r.scale).toBeCloseTo(1.6, 5);
    expect(r.tx).toBeCloseTo(20, 5);
    expect(r.ty).toBeCloseTo(20, 5);
  });

  test("right inset shrinks effective width and shifts centre left", () => {
    const r = computeFitTransform(
      b(0, 0, 100, 100),
      { width: 200, height: 200 },
      { right: 100 },
      0,
    );
    expect(r.scale).toBe(1);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(50);
  });

  test("top + left inset shifts centre down-right within the reduced area", () => {
    const r = computeFitTransform(
      b(0, 0, 100, 100),
      { width: 200, height: 200 },
      { top: 20, left: 40 },
      0,
    );
    expect(r.scale).toBeCloseTo(1.6, 5);
    expect(r.tx).toBeCloseTo(40, 5);
    expect(r.ty).toBeCloseTo(30, 5);
  });

  test("picks the constraining axis (min of sx, sy)", () => {
    const r = computeFitTransform(
      b(0, 0, 100, 200),
      { width: 200, height: 200 },
      {},
      0,
    );
    expect(r.scale).toBe(1);
  });

  test("handles bounds offset from origin", () => {
    const r = computeFitTransform(
      b(100, 50, 200, 150),
      { width: 200, height: 200 },
      {},
      0,
    );
    expect(r.scale).toBe(2);
    expect(r.tx).toBe(-200);
    expect(r.ty).toBe(-100);
  });

  test("degenerate zero-extent bounds do not divide by zero", () => {
    const r = computeFitTransform(
      b(50, 50, 50, 50),
      { width: 200, height: 200 },
      {},
      0,
    );
    expect(Number.isFinite(r.scale)).toBe(true);
    expect(Number.isFinite(r.tx)).toBe(true);
    expect(Number.isFinite(r.ty)).toBe(true);
  });
});

describe("minZoomForFit", () => {
  const B = { min: { x: -100, y: -100 }, max: { x: 100, y: 100 } };

  test("returns fit-scale × marginFactor", () => {
    // viewport 400×400, no insets, padding 0.12 → fit ≈ (400 × 0.76) / 200 = 1.52
    // × marginFactor 0.8 = 1.216
    const z = minZoomForFit(B, { width: 400, height: 400 }, {}, 0.12, 0.8);
    expect(z).toBeCloseTo(1.216, 3);
  });

  test("respects insets", () => {
    const z1 = minZoomForFit(B, { width: 400, height: 400 }, {}, 0.12, 0.8);
    const z2 = minZoomForFit(B, { width: 400, height: 400 }, { right: 100 }, 0.12, 0.8);
    expect(z2).toBeLessThan(z1);
  });
});

describe("clampPanToBounds", () => {
  const B = { min: { x: -100, y: -100 }, max: { x: 100, y: 100 } };

  test("passes pan that keeps bounds intersecting viewport", () => {
    // bounds 200×200 centred at origin; at scale 1, world (0,0) is at screen (tx,ty).
    // Viewport 400×400. Pan (200, 200): world bounds project to screen [100..300]×[100..300] — fully inside.
    const r = clampPanToBounds(B, { width: 400, height: 400 }, 1, 200, 200);
    expect(r).toEqual({ tx: 200, ty: 200 });
  });

  test("clamps pan that pushes the entire AABB off-screen on the right", () => {
    // To push bounds off the right edge: tx > viewport.width + |bounds.min.x| × scale
    // = 400 + 100 = 500. Clamp to the boundary.
    const r = clampPanToBounds(B, { width: 400, height: 400 }, 1, 1000, 0);
    expect(r.tx).toBeLessThan(1000);
    // After clamp, bounds still intersect viewport: world.max.x × scale + tx >= 0
    expect(100 * 1 + r.tx).toBeGreaterThanOrEqual(0);
  });

  test("clamps off-screen left", () => {
    const r = clampPanToBounds(B, { width: 400, height: 400 }, 1, -1000, 0);
    // world.min.x × scale + tx <= viewport.width
    expect(-100 * 1 + r.tx).toBeLessThanOrEqual(400);
  });
});
