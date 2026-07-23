import { describe, expect, test } from "bun:test";
import { sampleStraight } from "../../src/curves/straight.ts";

describe("straight curve", () => {
  test("origin at t=0", () => {
    const r = sampleStraight({ arcLength: 100, originAngle: 0 }, 0);
    expect(r.point.x).toBeCloseTo(0, 9);
    expect(r.point.y).toBeCloseTo(0, 9);
    expect(r.tangent).toBeCloseTo(0, 9);
    expect(r.arcLength).toBe(0);
  });
  test("endpoint at t=1", () => {
    const r = sampleStraight({ arcLength: 100, originAngle: 0 }, 1);
    expect(r.point.x).toBeCloseTo(100, 9);
    expect(r.point.y).toBeCloseTo(0, 9);
    expect(r.arcLength).toBe(100);
  });
  test("angle rotates the line", () => {
    const r = sampleStraight({ arcLength: 10, originAngle: Math.PI / 2 }, 1);
    expect(r.point.x).toBeCloseTo(0, 9);
    expect(r.point.y).toBeCloseTo(10, 9);
  });
});
