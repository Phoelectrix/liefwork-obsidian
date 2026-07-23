import { describe, expect, test } from "bun:test";
import { attention, mountedBranch } from "../../viewer/src/sizing/bubble.ts";

const branchBounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  min: { x: minX, y: minY },
  max: { x: maxX, y: maxY },
});

describe("attention", () => {
  test("returns 1 when viewport fully inside branch AABB (zoomed in)", () => {
    const a = attention(
      branchBounds(0, 0, 1000, 1000),
      { tx: 0, ty: 0, scale: 1 },
      { width: 200, height: 200 },
    );
    expect(a).toBeCloseTo(1.0);
  });

  test("returns ~0 when branch is far outside the viewport", () => {
    const a = attention(
      branchBounds(5000, 5000, 5100, 5100),
      { tx: 0, ty: 0, scale: 1 },
      { width: 100, height: 100 },
    );
    expect(a).toBe(0);
  });

  test("returns small fraction when branch fills small part of viewport (wide zoom-out)", () => {
    const a = attention(
      branchBounds(0, 0, 100, 100),
      { tx: 0, ty: 0, scale: 1 },
      { width: 1000, height: 1000 },
    );
    expect(a).toBeCloseTo(0.01);
  });

  test("scales with zoom: at zoom 2, viewport in world is smaller", () => {
    const a = attention(
      branchBounds(0, 0, 100, 100),
      { tx: 0, ty: 0, scale: 2 },
      { width: 200, height: 200 },
    );
    expect(a).toBeCloseTo(1.0);
  });

  test("clamps to [0, 1]", () => {
    const a = attention(
      branchBounds(-1000, -1000, 2000, 2000),
      { tx: 0, ty: 0, scale: 1 },
      { width: 100, height: 100 },
    );
    expect(a).toBeLessThanOrEqual(1);
    expect(a).toBeGreaterThanOrEqual(0);
  });
});

describe("mountedBranch", () => {
  test("true when branch overlaps viewport", () => {
    expect(
      mountedBranch(
        branchBounds(50, 50, 150, 150),
        { tx: 0, ty: 0, scale: 1 },
        { width: 100, height: 100 },
        0.5,
      ),
    ).toBe(true);
  });

  test("true when branch is in decay zone (just outside viewport)", () => {
    expect(
      mountedBranch(
        branchBounds(125, 125, 140, 140),
        { tx: 0, ty: 0, scale: 1 },
        { width: 100, height: 100 },
        0.5,
      ),
    ).toBe(true);
  });

  test("false when branch is beyond the decay zone", () => {
    expect(
      mountedBranch(
        branchBounds(200, 200, 250, 250),
        { tx: 0, ty: 0, scale: 1 },
        { width: 100, height: 100 },
        0.5,
      ),
    ).toBe(false);
  });

  test("bubbleWidth=0 = strict viewport only", () => {
    expect(
      mountedBranch(
        branchBounds(105, 105, 120, 120),
        { tx: 0, ty: 0, scale: 1 },
        { width: 100, height: 100 },
        0,
      ),
    ).toBe(false);
  });
});
