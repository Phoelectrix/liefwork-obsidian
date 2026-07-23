import { describe, expect, test } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here.
//
// The framing legibility floor. Framing a large branch zooms out until the
// selected node's targetPx falls under `fullAbovePx` and visualTier returns
// dots — the node is still painted (cull floors are 0 in the plugin) but is
// illegible, so the user loses the cursor. The floor is the exact mirror of the
// ④ cull-cliff CEILING: a frame must never zoom past what it framed, in either
// direction.
import { minScaleForText } from "../src/sizing/legibility.ts";
import { computeTargetScreenPx, type SizingConfig } from "../src/sizing/composition.ts";
import { liefworkStylingDefaults as S } from "../src/liefwork-defaults.ts";

const PHI = (1 + Math.sqrt(5)) / 2;

const cfg = {
  titleSize: S.projection.titleSize,
  basalMag: S.basalMag,
  liefShortSideInverse: PHI,
  liefFullAbovePx: S.liefFullAbovePx,
  meristemFullAbovePx: S.meristemFullAbovePx,
};

describe("minScaleForText", () => {
  test("inverts the basal size relation for a lief (φ factor applied)", () => {
    const block = { kind: "lief" as const, shortSide: 4, labelSize: 4 };
    const expected = cfg.liefFullAbovePx / (4 * PHI * cfg.titleSize * cfg.basalMag);
    expect(minScaleForText({ block, ...cfg })).toBeCloseTo(expected, 9);
  });

  test("a meristem takes no φ factor and its own threshold", () => {
    const block = { kind: "meristem" as const, shortSide: 10, labelSize: 10 };
    const expected = cfg.meristemFullAbovePx / (10 * cfg.titleSize * cfg.basalMag);
    expect(minScaleForText({ block, ...cfg })).toBeCloseTo(expected, 9);
  });

  test("prefers the engine-baked labelSize over shortSide", () => {
    const a = minScaleForText({ block: { kind: "meristem", shortSide: 10, labelSize: 20 }, ...cfg });
    const b = minScaleForText({ block: { kind: "meristem", shortSide: 20 }, ...cfg });
    expect(a).toBeCloseTo(b, 9);
  });

  test("a bigger label needs less zoom to stay readable", () => {
    const small = minScaleForText({ block: { kind: "meristem", shortSide: 2 }, ...cfg });
    const big = minScaleForText({ block: { kind: "meristem", shortSide: 40 }, ...cfg });
    expect(big).toBeLessThan(small);
  });

  test("degenerate styling yields no constraint rather than Infinity", () => {
    expect(minScaleForText({ block: { kind: "lief", shortSide: 4 }, ...cfg, titleSize: 0 })).toBe(0);
    expect(minScaleForText({ block: { kind: "lief", shortSide: 0 }, ...cfg })).toBe(0);
  });

  // THE LOAD-BEARING TEST. The floor inverts `targetPx >= basalScreenPx`, which
  // holds only because every later cascade term is monotone upward from basal
  // (sizeMultiplier >= 1; liefMaxLift clamps to basal × 1.1; lit only multiplies
  // up). If that ever stops being true the floor stops guaranteeing legibility
  // and this test must fail loudly rather than the cursor quietly vanishing.
  test("targetPx never falls below basal — the assumption the floor inverts", () => {
    const sizing: SizingConfig = S;
    for (const kind of ["lief", "meristem"] as const) {
      for (const attention of [0, 0.25, 0.5, 1]) {
        for (const subtreeNorm of [0, 0.5, 1]) {
          for (const isLit of [false, true]) {
            for (const zoom of [0.01, 0.1, 1, 10]) {
              const shortSide = kind === "lief" ? 4 * PHI : 4;
              const basal = shortSide * cfg.titleSize * cfg.basalMag * zoom;
              const target = computeTargetScreenPx({
                shortSide, titleSize: cfg.titleSize, zoom, attention, subtreeNorm, kind, isLit, cfg: sizing,
              });
              expect(target).toBeGreaterThanOrEqual(basal - 1e-9);
            }
          }
        }
      }
    }
  });
});
