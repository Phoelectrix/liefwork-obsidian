import { describe, expect, test } from "bun:test";
import { sampleSpiral } from "../../src/curves/spiral.ts";

const spec = { arcLength: 100, originAngle: 0, spiral: { turns: 2, startRadius: 50, shrink: 1.5, handedness: 1 as const } };

describe("sampleSpiral", () => {
  test("starts at the local origin", () => {
    const { point } = sampleSpiral(spec, 0);
    expect(Math.abs(point.x)).toBeLessThan(1e-9);
    expect(Math.abs(point.y)).toBeLessThan(1e-9);
  });

  test("radius to the spiral centre decreases monotonically (coils inward)", () => {
    // canonical centre is (0, startRadius) before rotation; with originAngle 0 the
    // rotation is identity, so the world centre is (0, startRadius).
    const cx = 0, cy = spec.spiral.startRadius;
    let prev = Infinity;
    for (let i = 0; i <= 10; i++) {
      const { point } = sampleSpiral(spec, i / 10);
      const r = Math.hypot(point.x - cx, point.y - cy);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  test("all samples are finite and tangent is finite", () => {
    for (let i = 0; i <= 20; i++) {
      const { point, tangent } = sampleSpiral(spec, i / 20);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(tangent)).toBe(true);
    }
  });

  test("originAngle rotates the whole curve (point at t=1 rotates with it)", () => {
    const a = sampleSpiral(spec, 1);
    const b = sampleSpiral({ ...spec, originAngle: Math.PI / 2 }, 1);
    // 90° rotation: (x,y) -> (-y, x)
    expect(b.point.x).toBeCloseTo(-a.point.y, 6);
    expect(b.point.y).toBeCloseTo(a.point.x, 6);
  });
});
