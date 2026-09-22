import { describe, expect, test } from "bun:test";
import { fanOffsetForLief } from "../../viewer/src/projection.ts";

describe("fanOffsetForLief", () => {
  test("count <= 1 returns 0 (no chain to fan)", () => {
    expect(fanOffsetForLief(0, 1, 0.5, "right")).toBe(0);
    expect(fanOffsetForLief(0, 0, 0.5, "right")).toBe(0);
  });

  test("middle lief of odd chain sits at 0", () => {
    expect(fanOffsetForLief(2, 5, 0.5, "right")).toBe(0);
  });

  test("rear lief (idx 0) tilts back, tip lief (idx count-1) tilts forward, right side", () => {
    // On the right side, tilting back toward base means increasing θ_rel past
    // perpendicular (π/2). So rear is +range/2 and tip is -range/2.
    const range = 0.5;
    const rear = fanOffsetForLief(0, 5, range, "right");
    const tip = fanOffsetForLief(4, 5, range, "right");
    expect(rear).toBeCloseTo(range / 2, 10);
    expect(tip).toBeCloseTo(-range / 2, 10);
  });

  test("offset is side-independent (liefSunAzimuth applies the mirror)", () => {
    // Since liefSunAzimuth now mirrors the static angle across the branch
    // axis on the left side, fanOffsetForLief returns the same signed offset
    // for both sides — the visible direction stays symmetric automatically.
    const range = 0.5;
    for (let i = 0; i < 5; i++) {
      expect(fanOffsetForLief(i, 5, range, "left")).toBeCloseTo(
        fanOffsetForLief(i, 5, range, "right"),
        10,
      );
    }
  });

  test("fanRange = 0 returns 0 at every index", () => {
    for (let i = 0; i < 5; i++) {
      expect(fanOffsetForLief(i, 5, 0, "right")).toBe(0);
      expect(fanOffsetForLief(i, 5, 0, "left")).toBe(0);
    }
  });
});
