import { describe, expect, test } from "bun:test";
import { build, defaultEngineConfig } from "../../../src/library/index.ts";
import type { EngineConfig } from "../../../src/library/types.ts";
import { tutorial } from "../../fixtures/tutorial.ts";
import golden from "../fixtures/tutorial-label-sizes.golden.json" with { type: "json" };

// Golden baseline: per-block label sizes (= shortSide, the pre-textScale/
// textContrast label basis) captured from the tutorial fixture BEFORE the
// text-sizing knobs existed. Defaults must reproduce it bit-for-bit.
const goldenSizes = golden as Record<string, number>;

function withSizing(over: Partial<EngineConfig["sizing"]>): EngineConfig {
  return { ...defaultEngineConfig, sizing: { ...defaultEngineConfig.sizing, ...over } };
}

/** Build the tutorial fixture and collect blockId → labelSize for every
 *  labelled block (liefs + meristems). */
function labelSizes(cfg: EngineConfig): Map<string, number> {
  const plant = build(tutorial, undefined, cfg);
  const out = new Map<string, number>();
  for (const b of plant.blocks) {
    if (b.kind !== "lief" && b.kind !== "meristem") continue;
    expect(b.labelSize).toBeDefined();
    out.set(b.id, b.labelSize!);
  }
  return out;
}

/** max/min over the sizes — the spread the contrast knob reshapes. */
function spread(sizes: Map<string, number>): number {
  const v = [...sizes.values()];
  return Math.max(...v) / Math.min(...v);
}

describe("text sizing: textScale / textContrast", () => {
  test("defaults are exact identity — bit-for-bit the pre-change golden sizes", () => {
    const sizes = labelSizes(defaultEngineConfig);
    expect(sizes.size).toBe(Object.keys(goldenSizes).length);
    for (const [id, size] of sizes) {
      expect(size).toBe(goldenSizes[id]!); // exact, not toBeCloseTo
    }
  });

  test("defaults leave labelSize equal to shortSide", () => {
    const plant = build(tutorial, undefined, defaultEngineConfig);
    for (const b of plant.blocks) {
      if (b.kind !== "lief" && b.kind !== "meristem") continue;
      expect(b.labelSize).toBe(b.shortSide);
    }
  });

  test("textScale multiplies every label size uniformly", () => {
    const base = labelSizes(defaultEngineConfig);
    const doubled = labelSizes(withSizing({ textScale: 2 }));
    for (const [id, size] of base) {
      expect(doubled.get(id)).toBe(2 * size); // ×2 is exact in IEEE 754
    }
  });

  test("textContrast > 1 strictly widens the size spread, < 1 narrows it", () => {
    const base = labelSizes(defaultEngineConfig);
    const steep = labelSizes(withSizing({ textContrast: 1.5 }));
    const flat = labelSizes(withSizing({ textContrast: 0.5 }));
    expect(spread(base)).toBeGreaterThan(1); // fixture spans several depths
    expect(spread(steep)).toBeGreaterThan(spread(base));
    expect(spread(flat)).toBeLessThan(spread(base));
    expect(spread(flat)).toBeGreaterThan(1); // flattened, not collapsed
  });

  test("contrast preserves the order of sizes (monotone: ties stay ties, bigger stays bigger)", () => {
    const base = labelSizes(defaultEngineConfig);
    for (const contrast of [0.5, 1.5]) {
      const shaped = labelSizes(withSizing({ textContrast: contrast }));
      const ids = [...base.keys()];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const d0 = base.get(ids[i]!)! - base.get(ids[j]!)!;
          const d1 = shaped.get(ids[i]!)! - shaped.get(ids[j]!)!;
          expect(Math.sign(d1)).toBe(Math.sign(d0));
        }
      }
    }
  });

  test("extreme knob values stay finite and positive", () => {
    const extremes: Partial<EngineConfig["sizing"]>[] = [
      { textScale: 1000 },
      { textScale: 1e-4 },
      { textContrast: 8 },
      { textContrast: 0.05 },
      { textScale: 1000, textContrast: 8 },
      { textScale: 1e-4, textContrast: 0.05 },
    ];
    for (const over of extremes) {
      for (const size of labelSizes(withSizing(over)).values()) {
        expect(Number.isFinite(size)).toBe(true);
        expect(size).toBeGreaterThan(0);
      }
    }
  });
});
