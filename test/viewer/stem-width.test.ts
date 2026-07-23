import { describe, expect, test } from "bun:test";
import { stemWidthWorld } from "../../viewer/src/sizing/stem-width.ts";

// childScale 0.62, phiOrder 1 → liefShortSideInverse = 0.62^-1 ≈ 1.6129
const LSI = 1 / 0.62;
const v2 = { minWidth: 3, maxWidth: 12, subtreeExp: 1 };

describe("stemWidthWorld: depth-scaled branch ribbon width", () => {
  test("depth 0 reduces to the plain subtree-width formula (trunk unchanged)", () => {
    // sn=1 → maxWidth; sn=0 → minWidth
    expect(stemWidthWorld(1, 0, v2, LSI)).toBeCloseTo(12, 6);
    expect(stemWidthWorld(0, 0, v2, LSI)).toBeCloseTo(3, 6);
    expect(stemWidthWorld(0.5, 0, v2, LSI)).toBeCloseTo(7.5, 6);
  });

  test("deeper branch gets a proportionally smaller world width (same subtree)", () => {
    const shallow = stemWidthWorld(0, 0, v2, LSI);
    const deep = stemWidthWorld(0, 7, v2, LSI);
    expect(deep).toBeLessThan(shallow);
    // factor must be childScale^(depth*phiOrder) = 0.62^7
    expect(deep).toBeCloseTo(3 * Math.pow(0.62, 7), 6);
  });

  test("monotonically decreasing in depth", () => {
    let prev = Infinity;
    for (let d = 0; d <= 8; d++) {
      const w = stemWidthWorld(0.4, d, v2, LSI);
      expect(w).toBeLessThan(prev);
      prev = w;
    }
  });

  test("subtreeExp shapes the base curve before depth-scaling", () => {
    const v2e = { minWidth: 0, maxWidth: 10, subtreeExp: 2 };
    // sn=0.5, depth 0 → 10 * 0.5^2 = 2.5
    expect(stemWidthWorld(0.5, 0, v2e, LSI)).toBeCloseTo(2.5, 6);
  });
});
