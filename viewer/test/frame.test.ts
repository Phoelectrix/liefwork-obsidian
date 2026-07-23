import { describe, test, expect } from "bun:test";
import { expandBounds } from "../src/frame.ts";

describe("expandBounds", () => {
  test("expands a bounds about its centre by the factor", () => {
    const b = { min: { x: 0, y: 0 }, max: { x: 10, y: 20 } }; // centre (5,10), w10 h20
    const e = expandBounds(b, 1.2); // +20% → w12 h24, centre held
    expect(e.min.x).toBeCloseTo(-1);
    expect(e.max.x).toBeCloseTo(11);
    expect(e.min.y).toBeCloseTo(-2);
    expect(e.max.y).toBeCloseTo(22);
  });
  test("factor 1 is identity", () => {
    const b = { min: { x: 1, y: 2 }, max: { x: 3, y: 4 } };
    expect(expandBounds(b, 1)).toEqual(b);
  });
});
