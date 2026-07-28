import { describe, expect, test } from "bun:test";
import { visualTier, type TierConfig } from "../../viewer/src/sizing/tier.ts";

const cfg: TierConfig = { dotsAbovePx: 4, fullAbovePx: 20 };

describe("visualTier", () => {
  test("at or above fullAbovePx → full", () => {
    expect(visualTier(20, cfg)).toBe("full");
    expect(visualTier(60, cfg)).toBe("full");
  });

  test("at or above dotsAbovePx but below fullAbovePx → dot-glyphs", () => {
    expect(visualTier(4, cfg)).toBe("dot-glyphs");
    expect(visualTier(10, cfg)).toBe("dot-glyphs");
    expect(visualTier(19.9, cfg)).toBe("dot-glyphs");
  });

  test("below dotsAbovePx → single-dot", () => {
    expect(visualTier(3.9, cfg)).toBe("single-dot");
    expect(visualTier(1, cfg)).toBe("single-dot");
    expect(visualTier(0, cfg)).toBe("single-dot");
  });
});
