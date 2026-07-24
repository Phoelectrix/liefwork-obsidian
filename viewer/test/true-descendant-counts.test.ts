import { describe, test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { installCascadePass } from "../src/cascade-pass.ts";
import { mergeStylingConfig } from "../src/styling.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

// "a" is a SMALL branch (one grandchild); "big" is a large sibling. So a's real
// subtreeNorm is low — the override has clear room to lift it.
const nested: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }] }] },
      { id: "big", name: "big", children: [
        { id: "g1", name: "g1", children: [{ id: "g1a", name: "g1a" }, { id: "g1b", name: "g1b" }] },
        { id: "g2", name: "g2", children: [{ id: "g2a", name: "g2a" }, { id: "g2b", name: "g2b" }] },
        { id: "g3", name: "g3", children: [{ id: "g3a", name: "g3a" }, { id: "g3b", name: "g3b" }] },
      ] },
    ],
  },
};

function targetPxForA(plant: any, styling: any, trueCounts: Map<string, number> | null | "omit"): number | undefined {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const world = document.createElementNS(SVG_NS, "g") as SVGGElement;
  svg.appendChild(world);
  const cascade = installCascadePass({
    svg, world,
    plant: () => plant,
    stylingConfig: () => styling,
    litBlockIds: () => new Set<string>(),
    initialLiefsHidden: () => false,
    ...(trueCounts === "omit" ? {} : { trueDescendantCounts: () => trueCounts }),
  });
  cascade.refreshMaps();
  // Low-zoom whole-plant view: attention is small, so subtree boost — not
  // viewport-fill — differentiates the sizes (mirrors the furled fit).
  const cx = (plant.bounds.min.x + plant.bounds.max.x) / 2;
  const cy = (plant.bounds.min.y + plant.bounds.max.y) / 2;
  const scale = 0.05;
  const view = { tx: 500 - cx * scale, ty: 400 - cy * scale, scale };
  const aMer = plant.blocks.find((b: any) => b.kind === "meristem" && b.name === "a");
  const d = cascade.computeDecisions(view, { width: 1000, height: 800 }).get(aMer.id);
  cascade.destroy();
  return d?.targetPx;
}

describe("trueDescendantCounts overlay (furled-stub sizing)", () => {
  test("injecting a larger true count lifts a meristem's target size via subtree boost", () => {
    const styling = mergeStylingConfig({ subtreeBoost: 0.8, subtreeBoostShape: 1 });
    const plant = build(nested, undefined, defaultEngineConfig) as any;
    const aMer = plant.blocks.find((b: any) => b.kind === "meristem" && b.name === "a");
    expect(aMer).toBeDefined();

    const base = targetPxForA(plant, styling, null)!;
    // As if "a" were a furled stub whose TRUE subtree is the biggest in the tree.
    const boosted = targetPxForA(plant, styling, new Map([[aMer.branchId, 9999]]))!;

    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(base);
  });

  test("default-off: null override is identical to omitting the dep (plugin byte-identical)", () => {
    const styling = mergeStylingConfig({ subtreeBoost: 0.8 });
    const plant = build(nested, undefined, defaultEngineConfig) as any;
    expect(targetPxForA(plant, styling, null)).toBeCloseTo(targetPxForA(plant, styling, "omit")!, 10);
  });
});
