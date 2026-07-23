import { describe, expect, test } from "bun:test";
import { compoundAngle, localFrame, multiSegmentLocalFrame } from "../../src/math/chain-walk.ts";

describe("compoundAngle", () => {
  test("lief on the ancestor's own chain: angle is 0", () => {
    expect(compoundAngle([])).toBe(0);
  });

  test("single intermediate branch: angle = its departure", () => {
    expect(compoundAngle([0.5])).toBe(0.5);
  });

  test("multiple branches: sum of departure angles", () => {
    expect(compoundAngle([0.3, -0.2, 0.1])).toBeCloseTo(0.2, 9);
  });
});

describe("localFrame", () => {
  test("straightforward along axis: dx = liefArc, dy = 0", () => {
    const { dx, dy } = localFrame(0, 10, 0);
    expect(dx).toBeCloseTo(10, 9);
    expect(dy).toBeCloseTo(0, 9);
  });

  test("perpendicular departure: dx = 0, dy = liefArc", () => {
    const { dx, dy } = localFrame(Math.PI / 2, 10, 0);
    expect(dx).toBeCloseTo(0, 9);
    expect(dy).toBeCloseTo(10, 9);
  });

  test("accounts for BranchNode arcPosition on ancestor chain", () => {
    const { dx, dy } = localFrame(Math.PI / 2, 0, 5);
    expect(dx).toBeCloseTo(5, 9);
    expect(dy).toBeCloseTo(0, 9);
  });
});

describe("multiSegmentLocalFrame", () => {
  test("single segment matches localFrame at zero ancestor offset", () => {
    const α = Math.PI / 6;
    const arc = 100;
    const out = multiSegmentLocalFrame([{ arcOnChain: arc, departureAngle: α }]);
    expect(out.dx).toBeCloseTo(arc * Math.cos(α), 10);
    expect(out.dy).toBeCloseTo(arc * Math.sin(α), 10);
  });

  test("two segments accumulate via compound angles", () => {
    const α1 = 0.5;  // first chain heads at +0.5 rad from BN's tangent
    const α2 = -0.2; // second chain bends -0.2 from first chain's tangent
    const arc1 = 50;
    const arc2 = 30;
    const out = multiSegmentLocalFrame([
      { arcOnChain: arc1, departureAngle: α1 },
      { arcOnChain: arc2, departureAngle: α2 },
    ]);
    // Expected: vector along α1 of length arc1, then vector along (α1+α2) of length arc2.
    const expectedDx = arc1 * Math.cos(α1) + arc2 * Math.cos(α1 + α2);
    const expectedDy = arc1 * Math.sin(α1) + arc2 * Math.sin(α1 + α2);
    expect(out.dx).toBeCloseTo(expectedDx, 10);
    expect(out.dy).toBeCloseTo(expectedDy, 10);
  });

  test("three segments compound correctly", () => {
    const segs = [
      { arcOnChain: 40, departureAngle: 0.3 },
      { arcOnChain: 25, departureAngle: -0.4 },
      { arcOnChain: 15, departureAngle: 0.1 },
    ];
    const out = multiSegmentLocalFrame(segs);
    let cumα = 0;
    let dxExp = 0;
    let dyExp = 0;
    for (const s of segs) {
      cumα += s.departureAngle;
      dxExp += s.arcOnChain * Math.cos(cumα);
      dyExp += s.arcOnChain * Math.sin(cumα);
    }
    expect(out.dx).toBeCloseTo(dxExp, 10);
    expect(out.dy).toBeCloseTo(dyExp, 10);
  });

  test("empty segments returns origin", () => {
    const out = multiSegmentLocalFrame([]);
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
  });

  test("zero-arc segments are no-ops", () => {
    const out = multiSegmentLocalFrame([
      { arcOnChain: 0, departureAngle: 0.5 },
      { arcOnChain: 0, departureAngle: -0.3 },
    ]);
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
  });

  test("zero-angle straight chain: dx is sum of arcs, dy is zero", () => {
    const out = multiSegmentLocalFrame([
      { arcOnChain: 10, departureAngle: 0 },
      { arcOnChain: 20, departureAngle: 0 },
      { arcOnChain: 30, departureAngle: 0 },
    ]);
    expect(out.dx).toBeCloseTo(60, 10);
    expect(out.dy).toBeCloseTo(0, 10);
  });
});
