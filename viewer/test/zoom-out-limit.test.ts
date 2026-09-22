// How far past Full View the camera may pull back.
//
// It was `ZOOM_MARGIN_FACTOR = 0.8` — a constant in pan-zoom.ts, reachable from
// nowhere: the floor sat at 0.8 × the full-view scale, so the coral could never
// be pushed further away than a 25% empty frame. Founder, 5 Aug: "the user
// should be able to pull back more than currently if they want."
//
// It is now `camera.zoomOutMax`, expressed the way it is asked for — a MULTIPLE
// of the full-view frame (1 = no further than Full View, 1.25 = the old 25%
// extra, 3 = three times the frame). The margin factor the fit math wants is its
// reciprocal, which keeps the confusing "lower means further" out of the knob.
import { describe, expect, test, afterAll } from "bun:test";
import { minZoomForFit } from "../src/fit.ts";
import { installPanZoom, marginFactorFor } from "../src/pan-zoom.ts";
import { computeTargetScreenPx } from "../src/sizing/composition.ts";
import { liefworkStylingDefaults } from "../src/liefwork-defaults.ts";
import { defaultStylingConfig } from "../src/styling.ts";
import type { Bounds } from "../../src/types.ts";

const VIEW = { width: 1200, height: 800 };
const PAD = 0.12;
const bounds: Bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };

// The full-view scale for `bounds` in VIEW: the shorter axis wins.
const fitScale = Math.min(
  (VIEW.width * (1 - PAD * 2)) / 100,
  (VIEW.height * (1 - PAD * 2)) / 100,
);

describe("the zoomOutMax knob", () => {
  test("the shipped default is 2 — founder-tuned, and the same on every surface", () => {
    // Tuned at the vault, 5 Aug: on a WIDE coral with long meristem labels the
    // text ran out of frame and could not be pulled back into view. 1.25 (the
    // hardcoded 0.8 margin this knob replaced) was not enough room to read them.
    // Both config surfaces carry it, so the plugin and the site can't drift.
    expect(liefworkStylingDefaults.camera.zoomOutMax).toBe(2);
    expect(defaultStylingConfig.camera.zoomOutMax).toBe(2);
  });

  test("an unconfigured caller pulls back the same distance as a configured one", () => {
    // Studio (main.ts) and the standalone public viewer (public.ts) install
    // pan-zoom with no camera options. If the fallback drifted from the shipped
    // default, two surfaces would quietly disagree about how far back is allowed.
    expect(marginFactorFor(undefined)).toBeCloseTo(1 / defaultStylingConfig.camera.zoomOutMax, 12);
  });

  test("why the limit exists: a fit alone cannot frame a long label", () => {
    // The reason this is headroom rather than a wider fit. A label's screen size
    // is its basal size (zoom-proportional) LIFTED toward a fixed screen-px
    // optimum, so zooming out shrinks the geometry while the label keeps its
    // size — any label-inclusive bounds is only true at the zoom it was measured
    // at. Here: same block, half the zoom, and the label does NOT halve.
    const at = (zoom: number) =>
      computeTargetScreenPx({
        shortSide: 40, titleSize: liefworkStylingDefaults.projection.titleSize, zoom,
        attention: 0.5, subtreeNorm: 0.5, kind: "meristem", isLit: false,
        cfg: {
          basalMag: liefworkStylingDefaults.basalMag,
          optimalSize: liefworkStylingDefaults.optimalSize,
          liefOptimalSize: liefworkStylingDefaults.liefOptimalSize,
          subtreeBoost: liefworkStylingDefaults.subtreeBoost,
          subtreeBoostShape: liefworkStylingDefaults.subtreeBoostShape,
          cursorMagnification: liefworkStylingDefaults.cursorMagnification,
        },
      });
    expect(at(0.5)).toBeGreaterThan(at(1) * 0.5);
  });

  test("the floor is the full-view scale divided by the multiple", () => {
    expect(minZoomForFit(bounds, VIEW, {}, PAD, 1 / 1.25)).toBeCloseTo(fitScale / 1.25, 9);
    expect(minZoomForFit(bounds, VIEW, {}, PAD, 1 / 3)).toBeCloseTo(fitScale / 3, 9);
    // 1 = you may pull back exactly to Full View and no further.
    expect(minZoomForFit(bounds, VIEW, {}, PAD, 1)).toBeCloseTo(fitScale, 9);
  });
});

// ── live, through pan-zoom ──────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";
const originalRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  return {
    x: 0, y: 0, top: 0, left: 0,
    right: VIEW.width, bottom: VIEW.height, width: VIEW.width, height: VIEW.height,
    toJSON() { return this; },
  } as DOMRect;
};
afterAll(() => { Element.prototype.getBoundingClientRect = originalRect; });

function makeSvg() {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const world = document.createElementNS(SVG_NS, "g") as SVGGElement;
  svg.appendChild(world);
  document.body.appendChild(svg);
  return { svg, world };
}

/** The scale currently written to the world <g> (3-decimal transform text —
 *  hence the 3-place tolerance on every live assertion below). */
function scaleOf(world: SVGGElement): number {
  const m = /scale\(([-\d.]+)\)/.exec(world.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : NaN;
}

/** Wheel the camera all the way out and let the once-per-frame fold run. */
async function wheelOutHard(svg: SVGSVGElement): Promise<void> {
  svg.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 100000, clientX: 600, clientY: 400, cancelable: true }),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

describe("pan-zoom honours zoomOutMax, live", () => {
  test("a bigger multiple lets the camera pull further back", async () => {
    const { svg, world } = makeSvg();
    const handle = installPanZoom(svg, world, bounds, undefined, undefined, null, undefined, {
      fitPadding: PAD,
      zoomOutMax: 1.25,
    });

    await wheelOutHard(svg);
    expect(scaleOf(world)).toBeCloseTo(fitScale / 1.25, 3);

    handle.setZoomOutMax(3);
    await wheelOutHard(svg);
    expect(scaleOf(world)).toBeCloseTo(fitScale / 3, 3);
  });

  test("lowering the multiple pulls a too-far camera back in immediately", async () => {
    // Otherwise the knob would only bite on the NEXT fit and the coral would sit
    // outside its own limit — visibly wrong while dragging the slider.
    const { svg, world } = makeSvg();
    const handle = installPanZoom(svg, world, bounds, undefined, undefined, null, undefined, {
      fitPadding: PAD,
      zoomOutMax: 4,
    });

    await wheelOutHard(svg);
    expect(scaleOf(world)).toBeCloseTo(fitScale / 4, 3);

    handle.setZoomOutMax(1);
    expect(scaleOf(world)).toBeCloseTo(fitScale, 3);
  });

  test("a multiple below 1 is refused — it would wedge the camera inside the plant", () => {
    // marginFactor > 1 puts the floor ABOVE the fit: the user could no longer
    // reach Full View at all. Clamped to 1 rather than trusted.
    const { svg, world } = makeSvg();
    const handle = installPanZoom(svg, world, bounds, undefined, undefined, null, undefined, {
      fitPadding: PAD,
      zoomOutMax: 0.2,
    });
    handle.setZoomOutMax(0.2);
    expect(scaleOf(world)).toBeCloseTo(fitScale, 3);
  });
});
