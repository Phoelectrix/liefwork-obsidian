import { describe, expect, test } from "bun:test";
import { extent, attribute, magnitude } from "../../src/math/projection.ts";
import { PHI } from "../../src/constants.ts";

describe("extent(α)", () => {
  test("at α = 0, returns S (short side along axis)", () => {
    expect(extent(1, 0)).toBeCloseTo(1, 9);
  });

  test("at α = π/2, returns S·φ (long side along axis)", () => {
    expect(extent(1, Math.PI / 2)).toBeCloseTo(PHI, 9);
  });

  test("bounded in [S, S·√(1+φ²)] for arbitrary α", () => {
    const S = 7;
    const upper = S * Math.sqrt(1 + PHI * PHI);
    for (let deg = -720; deg <= 720; deg += 13) {
      const e = extent(S, (deg * Math.PI) / 180);
      expect(e).toBeGreaterThanOrEqual(S - 1e-9);
      expect(e).toBeLessThanOrEqual(upper + 1e-9);
    }
  });

  test("maximum is S·√(1+φ²) at α = arctan(φ)", () => {
    const S = 7;
    const αMax = Math.atan(PHI);
    const peak = extent(S, αMax);
    expect(peak).toBeCloseTo(S * Math.sqrt(1 + PHI * PHI), 9);
  });

  test("periodic with period π", () => {
    const S = 3;
    for (let i = 0; i < 20; i++) {
      const α = (i / 20) * 2 * Math.PI;
      expect(extent(S, α)).toBeCloseTo(extent(S, α + Math.PI), 9);
    }
  });
});

describe("attribute(dx, extent, branchBuffer)", () => {
  test("lief fully ahead → forward only", () => {
    const { forward, backward } = attribute(100, 20, 1.0);
    expect(forward).toBeGreaterThan(0);
    expect(backward).toBe(0);
  });

  test("lief fully behind → backward only", () => {
    const { forward, backward } = attribute(-100, 20, 1.0);
    expect(forward).toBe(0);
    expect(backward).toBeGreaterThan(0);
  });

  test("straddling (dx=0) → both sides equal half-extent", () => {
    const { forward, backward } = attribute(0, 20, 1.0);
    expect(forward).toBeCloseTo(10, 9);
    expect(backward).toBeCloseTo(10, 9);
  });

  test("branchBuffer scales both sides uniformly", () => {
    const a = attribute(0, 20, 1.0);
    const b = attribute(0, 20, 2.0);
    expect(b.forward).toBeCloseTo(a.forward * 2, 9);
    expect(b.backward).toBeCloseTo(a.backward * 2, 9);
  });
});

describe("magnitude(S, α, dy) — Candidate α (additive perpendicular)", () => {
  test("(b)-1: reduces to extent(S, α) when dy = 0 (backward compat)", () => {
    for (const S of [1, 7, 30, 100]) {
      for (let deg = -180; deg <= 180; deg += 17) {
        const α = (deg * Math.PI) / 180;
        expect(magnitude(S, α, 0)).toBeCloseTo(extent(S, α), 9);
      }
    }
  });

  test("(b)-2: monotone non-decreasing in |dy|", () => {
    const S = 30;
    const α = (-82 * Math.PI) / 180;  // Umberfall-like
    let prev = -Infinity;
    for (let dy = 0; dy <= 500; dy += 25) {
      const m = magnitude(S, α, dy);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = m;
    }
    // Sign symmetry: magnitude depends on |dy|, not signed dy.
    expect(magnitude(S, α, 100)).toBeCloseTo(magnitude(S, α, -100), 9);
  });

  test("(b)-3: feeds both forward and backward symmetrically via attribute()", () => {
    const S = 30;
    const α = (-82 * Math.PI) / 180;
    const dy = 427;
    const buf = 1.0;
    const m = magnitude(S, α, dy);
    const fwdLean = attribute(96, m, buf);
    const bwdLean = attribute(-96, m, buf);
    expect(fwdLean.forward).toBeCloseTo(bwdLean.backward, 9);
    expect(fwdLean.backward).toBeCloseTo(bwdLean.forward, 9);
    const baseline = attribute(96, magnitude(S, α, 0), buf);
    expect(fwdLean.forward).toBeGreaterThan(baseline.forward);
  });

  test("(b)-4: Umberfall-like case produces backward ring of expected order", () => {
    // S ≈ 30, α ≈ -82°, dy ≈ 427, dx ≈ 96, branchBuffer = 1.0
    // Expected: mag = extent(30, -82°) + 427 ≈ 52 + 427 = 479
    //           backward = max(0, mag·buf/2 - dx) ≈ 240 - 96 = 144
    const S = 30;
    const α = (-82 * Math.PI) / 180;
    const dy = 427;
    const dx = 96;
    const buf = 1.0;
    const { backward } = attribute(dx, magnitude(S, α, dy), buf);
    expect(backward).toBeGreaterThan(100);
    expect(backward).toBeLessThan(200);
  });

  test("(b)-5: branchBuffer doubles every ring uniformly", () => {
    const S = 30;
    const α = (-50 * Math.PI) / 180;
    const dy = 200;
    const m = magnitude(S, α, dy);
    // Note: dx=0 (straddling) for the doubling identity to hold cleanly —
    // attribute() applies dx as an additive offset OUTSIDE the buffer scale,
    // matching the existing "branchBuffer scales both sides uniformly" test.
    const a1 = attribute(0, m, 1.0);
    const a2 = attribute(0, m, 2.0);
    expect(a2.forward).toBeCloseTo(a1.forward * 2, 9);
    expect(a2.backward).toBeCloseTo(a1.backward * 2, 9);
  });
});
