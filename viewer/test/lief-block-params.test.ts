import { describe, test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { __collectLabelParamsForTest as collectLabelParams } from "../src/skeleton-canvas.ts";
import { defaultStylingConfig, mergeStylingConfig, type StylingConfig } from "../src/styling.ts";

// Fake measurer: width in font-size units == character count (mirrors
// lief-block.test.ts's convention — space width == 1).
const measureUnit = (t: string) => t.length;

// Minimal hierarchy: a root meristem with a single leaf child, so the leaf
// becomes a lone lief ("Alpha") — count<=1, unconstrained by the fan-slot
// budget (mirrors frozen-plant.test.ts's build() fixture style).
function buildMinimalPlant() {
  const hierarchy: HierarchyInput = {
    root: { id: "root", name: "Root", children: [{ id: "a", name: "Alpha" }] },
  };
  return build(hierarchy, undefined, defaultEngineConfig);
}

function stylingWithMode(mode: "label" | "block"): StylingConfig {
  return mergeStylingConfig({ liefBlock: { ...defaultStylingConfig.liefBlock, mode } });
}

describe("collectLabelParams — lief summary-block layout", () => {
  test("mode 'label' -> blockLayout stays null even with a summary map", () => {
    const plant = buildMinimalPlant();
    const styling = stylingWithMode("label");
    const summaryByName = new Map([["Alpha", "some summary text about this lief here"]]);
    const params = collectLabelParams(
      plant, styling, undefined, null, undefined, summaryByName, measureUnit,
    );
    const alpha = params.find((p) => p.kind === "lief");
    expect(alpha).toBeDefined();
    expect(alpha!.blockLayout ?? null).toBeNull();
    expect(alpha!.blockSizeRatio).toBeUndefined();
  });

  test("mode 'block' + a summary for the lief -> blockLayout truthy + blockSizeRatio set", () => {
    const plant = buildMinimalPlant();
    const styling = stylingWithMode("block");
    const summaryByName = new Map([["Alpha", "some summary text about this lief here"]]);
    const params = collectLabelParams(
      plant, styling, undefined, null, undefined, summaryByName, measureUnit,
    );
    const alpha = params.find((p) => p.kind === "lief");
    expect(alpha).toBeDefined();
    expect(alpha!.blockLayout).toBeTruthy();
    expect(alpha!.blockSizeRatio).toBe(styling.liefBlock.sizeRatio);
  });

  test("mode 'block' + empty summary map -> blockLayout null (no summary available)", () => {
    const plant = buildMinimalPlant();
    const styling = stylingWithMode("block");
    const summaryByName = new Map<string, string>();
    const params = collectLabelParams(
      plant, styling, undefined, null, undefined, summaryByName, measureUnit,
    );
    const alpha = params.find((p) => p.kind === "lief");
    expect(alpha).toBeDefined();
    expect(alpha!.blockLayout ?? null).toBeNull();
    expect(alpha!.blockSizeRatio).toBeUndefined();
  });

  test("mode 'block' but no summary map (undefined) -> blockLayout null (inert default)", () => {
    const plant = buildMinimalPlant();
    const styling = stylingWithMode("block");
    const params = collectLabelParams(plant, styling, undefined, null, undefined);
    const alpha = params.find((p) => p.kind === "lief");
    expect(alpha).toBeDefined();
    expect(alpha!.blockLayout ?? null).toBeNull();
  });
});
