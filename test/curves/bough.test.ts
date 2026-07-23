import { describe, expect, test } from "bun:test";
import { sampleBough } from "../../src/curves/bough.ts";

const params = {
  undulationAmp: 0, undulationFreq: 0, undulationPhase: 0,
  entryBow: 0, bowFalloff: 3, turnPoint: 1, turnSharpness: 6, spiralAngle: 0,
};

describe("bough curve (degenerate: all zeros = line)", () => {
  test("origin at t=0", () => {
    const r = sampleBough({ arcLength: 100, originAngle: 0, bough: params }, 0);
    expect(r.point.x).toBeCloseTo(0, 6);
    expect(r.point.y).toBeCloseTo(0, 6);
  });
  test("endpoint near (arcLength, 0) when all sculpting is zero", () => {
    const r = sampleBough({ arcLength: 100, originAngle: 0, bough: params }, 1);
    expect(r.point.x).toBeCloseTo(100, 1);
    expect(Math.abs(r.point.y)).toBeLessThan(1);
  });
});

describe("bough curve (with undulation)", () => {
  test("undulation produces lateral displacement", () => {
    const r = sampleBough(
      { arcLength: 100, originAngle: 0,
        bough: { ...params, undulationAmp: 0.3, undulationFreq: 1 } },
      0.5,
    );
    expect(Math.abs(r.point.y)).toBeGreaterThan(1);
  });
});
