import { describe, expect, test, afterAll } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here.
//
// New window bug ④: `clampState()` clamps `scale < zoomFloor` and nothing else —
// there was NO maximum zoom, so framing a brand-new one-lief branch (near-zero
// bounds) fit at 20–30×, past the size-cull cliff, and the frame hid the very
// thing it framed (blank space until Full View). The fix: fits/frames accept a
// `maxScale` ceiling, and the host derives it from the cull cliff. The same
// invariant shape as the 14-July peak-vs-target test: a ceiling must clear what
// is measured against it.
import { computeFitTransform, minZoomForFit } from "../src/fit.ts";
import { computeTargetScreenPx } from "../src/sizing/composition.ts";
import { cullDecision } from "../src/sizing/cull.ts";
import { installPanZoom } from "../src/pan-zoom.ts";
import { liefworkStylingDefaults } from "../src/liefwork-defaults.ts";
import type { Bounds } from "../../src/types.ts";

const viewport = { width: 1200, height: 800 };
const tinyBounds: Bounds = { min: { x: 500, y: 500 }, max: { x: 501, y: 501 } };

describe("computeFitTransform maxScale", () => {
  test("caps the scale on near-zero bounds and keeps them centred", () => {
    const uncapped = computeFitTransform(tinyBounds, viewport, {}, 0.12);
    expect(uncapped.scale).toBeGreaterThan(100); // the ④ failure mode: unbounded

    const capped = computeFitTransform(tinyBounds, viewport, {}, 0.12, 10);
    expect(capped.scale).toBe(10);
    // Bounds centre must sit at the viewport centre at the capped scale too.
    const cx = (tinyBounds.min.x + tinyBounds.max.x) / 2;
    const cy = (tinyBounds.min.y + tinyBounds.max.y) / 2;
    expect(capped.tx + cx * capped.scale).toBeCloseTo(viewport.width / 2, 6);
    expect(capped.ty + cy * capped.scale).toBeCloseTo(viewport.height / 2, 6);
  });

  test("is a no-op when the natural fit is below the ceiling", () => {
    const big: Bounds = { min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } };
    const free = computeFitTransform(big, viewport, {}, 0.12);
    const capped = computeFitTransform(big, viewport, {}, 0.12, 10);
    expect(capped).toEqual(free);
  });

  test("minZoomForFit uses the same ceiling — the floor can never exceed the capped fit", () => {
    const floor = minZoomForFit(tinyBounds, viewport, {}, 0.12, 0.8, 10);
    expect(floor).toBeCloseTo(8, 9); // capped fit (10) × margin (0.8)
  });
});

describe("the cull-cliff ceiling invariant — a frame can never hide what it framed", () => {
  // The host's ceiling formula (mount-plant frameMaxZoom), on the shipped
  // defaults, for a representative meristem block.
  const d = liefworkStylingDefaults;
  const titleSize = d.projection.titleSize;
  const shortSide = 40; // the standard meristem block edge at childScale 1

  const cliff = d.meristemPeakSize / (shortSide * titleSize * d.basalMag);
  const sizingCfg = {
    basalMag: d.basalMag,
    optimalSize: d.optimalSize,
    liefOptimalSize: d.liefOptimalSize,
    subtreeBoost: d.subtreeBoost,
    subtreeBoostShape: d.subtreeBoostShape,
    cursorMagnification: d.cursorMagnification,
  };
  const cullCfg = {
    meristemCullMinPx: 0, // isolate the PEAK edge — the min edge isn't under test
    meristemPeakSize: d.meristemPeakSize,
    liefCullMinPx: 0,
    liefPeakSize: d.liefPeakSize,
  };
  const targetAt = (zoom: number): number =>
    computeTargetScreenPx({
      shortSide, titleSize, zoom,
      attention: 1, subtreeNorm: 1, // worst case: fully lifted
      kind: "meristem", isLit: false, cfg: sizingCfg,
    });

  test("at the ceiling (cliff × margin) the block still renders", () => {
    const verdict = cullDecision(targetAt(cliff * 0.98), "meristem", false, cullCfg);
    expect(verdict).toBe("render");
  });

  test("past the cliff the block is culled — the ceiling is load-bearing", () => {
    const verdict = cullDecision(targetAt(cliff * 1.05), "meristem", false, cullCfg);
    expect(verdict).toBe("hide");
  });
});

describe("installPanZoom frameMaxZoom", () => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const plantBounds: Bounds = { min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } };

  // pan-zoom reads the layout box (clientWidth/Height) — stub it usable.
  const oW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const oH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const oRect = Element.prototype.getBoundingClientRect;
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 800 });
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() { return this; } } as DOMRect;
  };
  afterAll(() => {
    if (oW) Object.defineProperty(HTMLElement.prototype, "clientWidth", oW);
    else delete (Element.prototype as any).clientWidth;
    if (oH) Object.defineProperty(HTMLElement.prototype, "clientHeight", oH);
    else delete (Element.prototype as any).clientHeight;
    Element.prototype.getBoundingClientRect = oRect;
  });

  function mount(frameMaxZoom?: () => number) {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    const world = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(world);
    document.body.appendChild(svg);
    let lastScale = 0;
    const handle = installPanZoom(
      svg, world, plantBounds,
      (zoom) => { lastScale = zoom; },
      (_tx, _ty, scale) => { lastScale = scale; },
      null, undefined,
      { frameMaxZoom },
    );
    return { handle, scale: () => lastScale };
  }

  test("a focused refit on near-zero bounds lands AT the ceiling, not past it", () => {
    const { handle, scale } = mount(() => 12);
    handle.refit(tinyBounds);
    expect(scale()).toBe(12);
  });

  test("without a ceiling the same refit is unbounded — pins that the cap is doing the work", () => {
    const { handle, scale } = mount(undefined);
    handle.refit(tinyBounds);
    expect(scale()).toBeGreaterThan(100);
  });

  test("a junk ceiling (NaN / 0 / negative) is ignored rather than wedging the camera", () => {
    for (const bad of [Number.NaN, 0, -5]) {
      const { handle, scale } = mount(() => bad);
      handle.refit(tinyBounds);
      expect(scale()).toBeGreaterThan(100); // behaves as uncapped
    }
  });
});

describe("computeFitTransform minScale", () => {
  const wide: Bounds = { min: { x: 0, y: 0 }, max: { x: 100000, y: 100000 } };

  test("floors the scale on huge bounds and keeps the bounds centred", () => {
    const free = computeFitTransform(wide, viewport, {}, 0.12);
    expect(free.scale).toBeLessThan(0.02); // the failure mode: liefs become dots

    const floored = computeFitTransform(wide, viewport, {}, 0.12, Infinity, 0.5);
    expect(floored.scale).toBe(0.5);
    const cx = (wide.min.x + wide.max.x) / 2;
    const cy = (wide.min.y + wide.max.y) / 2;
    expect(floored.tx + cx * floored.scale).toBeCloseTo(viewport.width / 2, 6);
    expect(floored.ty + cy * floored.scale).toBeCloseTo(viewport.height / 2, 6);
  });

  test("is a no-op when the natural fit already clears the floor", () => {
    const big: Bounds = { min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } };
    const free = computeFitTransform(big, viewport, {}, 0.12);
    const floored = computeFitTransform(big, viewport, {}, 0.12, Infinity, 0.0001);
    expect(floored).toEqual(free);
  });

  test("the cull-cliff CEILING wins over the legibility FLOOR when they conflict", () => {
    // Blanking a block outright (past the peak) is worse than dotting it, so the
    // ceiling is applied last and is final.
    const t = computeFitTransform(tinyBounds, viewport, {}, 0.12, 4, 50);
    expect(t.scale).toBe(4);
  });

  test("omitting minScale reproduces today's transform exactly", () => {
    const before = computeFitTransform(tinyBounds, viewport, {}, 0.12, 10);
    const after = computeFitTransform(tinyBounds, viewport, {}, 0.12, 10, 0);
    expect(after).toEqual(before);
  });

  test("minZoomForFit is unaffected — the user's zoom-out floor is not a framing concern", () => {
    const a = minZoomForFit(tinyBounds, viewport, {}, 0.12, 0.8, 10);
    const b = minZoomForFit(tinyBounds, viewport, {}, 0.12, 0.8, 10);
    expect(a).toBe(b);
    expect(a).toBeCloseTo(8, 9);
  });
});
