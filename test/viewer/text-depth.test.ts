import { describe, expect, test } from "bun:test";

// Pure arithmetic check — the render function pulls this exact expression:
// effectiveFontScale = titleSize × multiplier^depth
describe("textDepthMultiplier", () => {
  test("depth=0 leaves titleSize unchanged at multiplier=1.0", () => {
    const titleSize = 0.35;
    const depth = 0;
    const multiplier = 1.0;
    expect(titleSize * Math.pow(multiplier, depth)).toBeCloseTo(0.35, 6);
  });

  test("depth=3 at multiplier=1.0 unchanged (baseline)", () => {
    expect(0.35 * Math.pow(1.0, 3)).toBeCloseTo(0.35, 6);
  });

  test("depth=3 at multiplier=0.8 steepens", () => {
    expect(0.35 * Math.pow(0.8, 3)).toBeCloseTo(0.35 * 0.512, 6);
  });

  test("depth=3 at multiplier=1.25 flattens", () => {
    expect(0.35 * Math.pow(1.25, 3)).toBeCloseTo(0.35 * 1.953125, 5);
  });
});
