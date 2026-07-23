import { describe, test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { __collectLabelParamsForTest as collectLabelParams, labelPeakPx, MERISTEM_TITLE_MAX_PX } from "../src/skeleton-canvas.ts";
import { installCascadePass } from "../src/cascade-pass.ts";
import { defaultStylingConfig } from "../src/styling.ts";
import { labelSizeBasis } from "../src/sizing/composition.ts";

const PHI = (1 + Math.sqrt(5)) / 2;
const SVG_NS = "http://www.w3.org/2000/svg";

// Minimal hierarchy (mirrors lief-block-params.test.ts): a root meristem with
// a single leaf child, so the leaf becomes a lone lief ("Alpha").
const hierarchy: HierarchyInput = {
  root: { id: "root", name: "Root", children: [{ id: "a", name: "Alpha" }] },
};

/** Build with non-default text-sizing knobs so the engine bakes a `labelSize`
 *  that DIFFERS from `shortSide` (at the defaults the two are bit-for-bit
 *  identical, which would make the assertions vacuous). */
function buildKnobbedPlant() {
  const cfg = structuredClone(defaultEngineConfig);
  cfg.sizing.textScale = 1.5;
  cfg.sizing.textContrast = 1.25;
  return build(hierarchy, undefined, cfg);
}

/** Simulate a plant built by an older engine: strip the baked labelSize. */
function stripLabelSizes(plant: { blocks: unknown[] }): void {
  for (const b of plant.blocks) delete (b as { labelSize?: number }).labelSize;
}

function labelledBlocks(plant: ReturnType<typeof buildKnobbedPlant>) {
  const rootBranch = plant.branches[0]!;
  const meristem = plant.blocks.find(
    (b) => b.kind === "meristem" && b.branchId === rootBranch.id,
  )! as { id: string; shortSide: number; labelSize?: number };
  const lief = plant.blocks.find((b) => b.kind === "lief")! as {
    id: string;
    shortSide: number;
    labelSize?: number;
  };
  return { meristem, lief };
}

describe("labelSize consumption — canvas label params (collectLabelParams)", () => {
  test("font + wrap budget derive from labelSize when it differs from shortSide", () => {
    const plant = buildKnobbedPlant();
    const { meristem, lief } = labelledBlocks(plant);

    // Precondition: the knobs actually produced a distinct label basis.
    expect(typeof lief.labelSize).toBe("number");
    expect(lief.labelSize).not.toBe(lief.shortSide);
    expect(meristem.labelSize).not.toBe(meristem.shortSide);

    const styling = defaultStylingConfig;
    const titleSize = styling.projection.titleSize;
    const params = collectLabelParams(plant, styling);

    for (const block of [lief, meristem]) {
      const p = params.find((q) => q.blockId === block.id)!;
      expect(p).toBeDefined();
      expect(p.baseWorldFontSize).toBeCloseTo(block.labelSize! * titleSize, 10);
      expect(p.intrinsicFontSize).toBeCloseTo(block.labelSize! * titleSize, 10);
      // Wrap budget rides the same basis (char budget invariant under knobs).
      expect(p.boxLength).toBeCloseTo(block.labelSize! * PHI, 10);
      // ... and NOT the geometry basis.
      expect(p.baseWorldFontSize).not.toBeCloseTo(block.shortSide * titleSize, 10);
    }
  });

  test("falls back to shortSide when labelSize is absent (older-engine plants)", () => {
    const plant = buildKnobbedPlant();
    stripLabelSizes(plant);
    const { meristem, lief } = labelledBlocks(plant);
    expect(lief.labelSize).toBeUndefined();

    const styling = defaultStylingConfig;
    const titleSize = styling.projection.titleSize;
    const params = collectLabelParams(plant, styling);

    for (const block of [lief, meristem]) {
      const p = params.find((q) => q.blockId === block.id)!;
      expect(p.baseWorldFontSize).toBeCloseTo(block.shortSide * titleSize, 10);
      expect(p.intrinsicFontSize).toBeCloseTo(block.shortSide * titleSize, 10);
      expect(p.boxLength).toBeCloseTo(block.shortSide * PHI, 10);
    }
  });

  test("geometry is untouched: label anchors identical with and without labelSize", () => {
    const plant = buildKnobbedPlant();
    const withLabelSize = collectLabelParams(plant, defaultStylingConfig);
    stripLabelSizes(plant);
    const without = collectLabelParams(plant, defaultStylingConfig);

    expect(withLabelSize.length).toBe(without.length);
    for (let i = 0; i < withLabelSize.length; i++) {
      expect(withLabelSize[i]!.anchorX).toBe(without[i]!.anchorX);
      expect(withLabelSize[i]!.anchorY).toBe(without[i]!.anchorY);
      expect(withLabelSize[i]!.nodeX).toBe(without[i]!.nodeX);
      expect(withLabelSize[i]!.nodeY).toBe(without[i]!.nodeY);
    }
  });
});

describe("labelSize consumption — cascade decisions (font-size driver)", () => {
  /** The canvas draw pass renders each label at `round(decision.targetPx)`,
   *  and `decision.effectiveShortSide` is the basis targetPx was computed
   *  from — so this is the contract that makes the text-sizing sliders
   *  visible on screen. */
  function decisionsFor(plant: ReturnType<typeof buildKnobbedPlant>) {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    const world = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(world);
    const cascade = installCascadePass({
      svg,
      world,
      plant: () => plant,
      stylingConfig: () => defaultStylingConfig,
      litBlockIds: () => new Set<string>(),
      initialLiefsHidden: () => false,
    });
    cascade.refreshMaps();
    // View that puts the whole (small) plant inside the viewport.
    const view = { tx: -plant.bounds.min.x + 100, ty: -plant.bounds.min.y + 100, scale: 1 };
    const decisions = cascade.computeDecisions(view, { width: 2000, height: 2000 });
    cascade.destroy();
    return decisions;
  }

  test("effectiveShortSide (basis of targetPx) uses labelSize, falling back to shortSide", () => {
    const plant = buildKnobbedPlant();
    const { meristem, lief } = labelledBlocks(plant);

    const withKnobs = decisionsFor(plant);
    const m = withKnobs.get(meristem.id)!;
    const l = withKnobs.get(lief.id)!;
    expect(m).toBeDefined();
    expect(l).toBeDefined();
    expect(m.effectiveShortSide).toBeCloseTo(meristem.labelSize!, 10);
    // Liefs keep their depth-decoupling factor (liefShortSideInverse = PHI by
    // default) on top of the label basis.
    expect(l.effectiveShortSide).toBeCloseTo(lief.labelSize! * PHI, 10);
    expect(labelSizeBasis(meristem)).toBe(meristem.labelSize!);

    stripLabelSizes(plant);
    const fallback = decisionsFor(plant);
    expect(fallback.get(meristem.id)!.effectiveShortSide).toBeCloseTo(meristem.shortSide, 10);
    expect(fallback.get(lief.id)!.effectiveShortSide).toBeCloseTo(lief.shortSide * PHI, 10);
  });
});

describe("labelPeakPx — child-meristem title cap (unfurl balloon fix)", () => {
  // defaultStylingConfig: meristemPeakSize 200, liefPeakSize 100.
  const styling = defaultStylingConfig;
  const lp = (kind: "lief" | "meristem", anchorH: "left" | "right" | "center") =>
    ({ kind, anchorH }) as unknown as Parameters<typeof labelPeakPx>[0];

  test("liefs keep their own peak", () => {
    expect(labelPeakPx(lp("lief", "right"), styling)).toBe(styling.liefPeakSize);
  });

  test("root title (anchorH 'center') is exempt — keeps the full meristem peak", () => {
    expect(labelPeakPx(lp("meristem", "center"), styling)).toBe(styling.meristemPeakSize);
  });

  test("child meristems (left/right) cap at MERISTEM_TITLE_MAX_PX when the peak is higher", () => {
    expect(MERISTEM_TITLE_MAX_PX).toBeLessThan(styling.meristemPeakSize);
    expect(labelPeakPx(lp("meristem", "right"), styling)).toBe(MERISTEM_TITLE_MAX_PX);
    expect(labelPeakPx(lp("meristem", "left"), styling)).toBe(MERISTEM_TITLE_MAX_PX);
  });

  test("a lower configured peak still wins over the cap (min semantics)", () => {
    const tight = { ...styling, meristemPeakSize: 30 };
    expect(labelPeakPx(lp("meristem", "right"), tight)).toBe(30);
  });
});
