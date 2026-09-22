import { describe, expect, test } from "bun:test";
import { siblingAngles } from "../../src/math/phi.ts";
import { INV_PHI } from "../../src/constants.ts";

describe("siblingAngles", () => {
  test("n=0 returns empty array", () => {
    expect(siblingAngles(0, 90, true)).toEqual([]);
  });

  test("n=1 returns a single angle equal to the seed", () => {
    expect(siblingAngles(1, 90, true)).toEqual([90]);
  });

  test("alternate=false: magnitudes decay by the factor each index", () => {
    const angles = siblingAngles(4, 90, false);
    expect(angles).toHaveLength(4);
    expect(angles[0]).toBe(90);
    expect(angles[1]).toBeCloseTo(90 * INV_PHI, 9);
    expect(angles[2]).toBeCloseTo(90 * INV_PHI * INV_PHI, 9);
    expect(angles[3]).toBeCloseTo(90 * Math.pow(INV_PHI, 3), 9);
  });

  test("alternate=true: each side runs its own decay independently", () => {
    // Index 0/2 (left, +) share side-local decay sequence starting at 90.
    // Index 1/3 (right, −) share their own side-local decay starting at 90.
    // Pairs at the same side-local step have identical magnitudes — symmetric.
    const angles = siblingAngles(4, 90, true);
    expect(angles[0]).toBeCloseTo(90, 9);
    expect(angles[1]).toBeCloseTo(-90, 9);
    expect(angles[2]).toBeCloseTo(90 * INV_PHI, 9);
    expect(angles[3]).toBeCloseTo(-90 * INV_PHI, 9);
  });

  test("alternate=true with odd count: extra sibling lands on the positive side", () => {
    const angles = siblingAngles(5, 90, true);
    expect(angles[0]).toBeCloseTo(90, 9);
    expect(angles[1]).toBeCloseTo(-90, 9);
    expect(angles[2]).toBeCloseTo(90 * INV_PHI, 9);
    expect(angles[3]).toBeCloseTo(-90 * INV_PHI, 9);
    expect(angles[4]).toBeCloseTo(90 * INV_PHI * INV_PHI, 9);
  });

  test("alternate=false keeps all angles positive for positive seed", () => {
    const angles = siblingAngles(5, 90, false);
    expect(angles.every((a) => a > 0)).toBe(true);
  });

  test("custom decay overrides INV_PHI", () => {
    const angles = siblingAngles(3, 90, false, 0.5);
    expect(angles).toEqual([90, 45, 22.5]);
  });

  test("all magnitudes stay ≤ seed", () => {
    const angles = siblingAngles(10, 90, true);
    expect(angles.every((a) => Math.abs(a) <= 90 + 1e-9)).toBe(true);
  });

  test("negative seed is passed through (caller responsibility)", () => {
    const angles = siblingAngles(2, -60, false);
    expect(angles[0]).toBe(-60);
    expect(angles[1]).toBeCloseTo(-60 * INV_PHI, 9);
  });
});

// Capped decay (10 Sept 2026): the plugin shipped decay 1 because a decaying
// fan collapses toward 0° (a 50-sibling fan at 0.97 reaches ~0.22× its seed).
// `minAngle` floors every magnitude so decay tightens a fan but never flattens
// it against the parent. The floor never RAISES an angle above the seed.
describe("siblingAngles — minAngle floor", () => {
  test("magnitudes decay until the floor, then hold it", () => {
    const a = siblingAngles(6, 60, false, 0.5, false, 20);
    expect(a[0]).toBe(60);
    expect(a[1]).toBe(30);
    expect(a[2]).toBe(20); // 15 floored to 20
    expect(a[3]).toBe(20);
    expect(a[5]).toBe(20);
  });
  test("the floor keeps its side under alternation and flipFirst", () => {
    const a = siblingAngles(6, 60, true, 0.5, true, 20);
    expect(a[0]).toBe(-60);
    expect(a[1]).toBe(60);
    expect(a[4]).toBe(-20); // left side, third step: 15 → 20, negated by flipFirst
    expect(a[5]).toBe(20);
  });
  test("a floor above the seed never raises the seed", () => {
    expect(siblingAngles(3, 30, false, 0.5, false, 45)).toEqual([30, 30, 30]);
  });
  test("floor 0 (the default) is the pre-0.2.0 sequence exactly", () => {
    expect(siblingAngles(5, 90, true, 0.8, true, 0)).toEqual(siblingAngles(5, 90, true, 0.8, true));
  });
});
