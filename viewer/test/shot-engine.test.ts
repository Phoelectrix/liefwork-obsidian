import { describe, test, expect } from "bun:test";
import {
  lerp,
  lerpTransform,
  zoomedAt,
  computeFit,
  boundsFromTransform,
  EASINGS,
  type Transform,
} from "../src/shot-engine.ts";

const VP = { width: 1920, height: 1080 };

describe("shot-engine math", () => {
  test("lerp interpolates endpoints", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  test("lerpTransform interpolates each field", () => {
    const a: Transform = { tx: 0, ty: 0, scale: 1 };
    const b: Transform = { tx: 100, ty: 200, scale: 3 };
    expect(lerpTransform(a, b, 0)).toEqual(a);
    expect(lerpTransform(a, b, 1)).toEqual(b);
    expect(lerpTransform(a, b, 0.5)).toEqual({ tx: 50, ty: 100, scale: 2 });
  });

  test("zoomedAt keeps the viewport centre fixed", () => {
    const t: Transform = { tx: 10, ty: 20, scale: 1 };
    const z = zoomedAt(t, 2, VP);
    // The world point under the screen centre must be unchanged after zoom.
    const before = { x: (VP.width / 2 - t.tx) / t.scale, y: (VP.height / 2 - t.ty) / t.scale };
    const after = { x: (VP.width / 2 - z.tx) / z.scale, y: (VP.height / 2 - z.ty) / z.scale };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(z.scale).toBe(2);
  });

  test("computeFit centres bounds and fits with padding", () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 960, y: 540 } };
    const fit = computeFit(bounds, VP, 0);
    // No padding: scale fits the limiting axis (both axes same ratio here → 2).
    expect(fit.scale).toBeCloseTo(2, 6);
    // Centre of bounds (480,270) maps to viewport centre (960,540).
    expect(480 * fit.scale + fit.tx).toBeCloseTo(960, 6);
    expect(270 * fit.scale + fit.ty).toBeCloseTo(540, 6);
  });

  test("boundsFromTransform is the inverse of computeFit (round-trip)", () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 960, y: 540 } };
    const fit = computeFit(bounds, VP, 0);
    const back = boundsFromTransform(fit, VP);
    expect(back.min.x).toBeCloseTo(bounds.min.x, 6);
    expect(back.min.y).toBeCloseTo(bounds.min.y, 6);
    expect(back.max.x).toBeCloseTo(bounds.max.x, 6);
    expect(back.max.y).toBeCloseTo(bounds.max.y, 6);
  });

  test("easeInOutCubic hits 0,1 and 0.5 midpoint", () => {
    const e = EASINGS.easeInOutCubic;
    expect(e(0)).toBeCloseTo(0, 6);
    expect(e(1)).toBeCloseTo(1, 6);
    expect(e(0.5)).toBeCloseTo(0.5, 6);
  });
});
