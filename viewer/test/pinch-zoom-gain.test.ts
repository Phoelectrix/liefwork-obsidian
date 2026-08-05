// Trackpad pinch sensitivity.
//
// A trackpad pinch produces no touch or pointer events: macOS/Windows deliver
// it as a WHEEL event with `ctrlKey` set. Until now nothing in pan-zoom looked
// at `ctrlKey`, so a pinch ran through the same `ZOOM_WHEEL_K` as a two-finger
// scroll — and since a pinch carries much smaller deltas for the same physical
// travel, it felt dead by comparison (founder, 5 Aug: "it is not sensitive
// enough on pinch"). `camera.pinchZoomGain` multiplies the pinch delta alone.
//
// The two-pointer pinch in pan-zoom.ts is the TOUCH path (phones, the site's
// mobile view) and is untouched by any of this.
import { describe, expect, test, afterAll } from "bun:test";
import { installPanZoom, marginFactorFor } from "../src/pan-zoom.ts";
import { ZOOM_WHEEL_K } from "../src/pan-zoom-math.ts";
import { liefworkStylingDefaults } from "../src/liefwork-defaults.ts";
import { defaultStylingConfig } from "../src/styling.ts";
import type { Bounds } from "../../src/types.ts";

const VIEW = { width: 1200, height: 800 };
const bounds: Bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };

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

function scaleOf(world: SVGGElement): number {
  const m = /scale\(([-\d.]+)\)/.exec(world.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : NaN;
}

/** One wheel event, then the once-per-frame fold. `pinch` sets ctrlKey, which
 *  is exactly how the OS reports a trackpad pinch.
 *
 *  ctrlKey is DEFINED onto the event rather than passed in the init dict:
 *  happy-dom's WheelEvent silently drops modifier keys from its init, so the
 *  dict form yields ctrlKey === false and every assertion here would pass for
 *  the wrong reason (both branches measuring a plain scroll). Compensating for
 *  the DOM stub, not for the code under test — real browsers populate it. */
async function wheel(svg: SVGSVGElement, deltaY: number, pinch: boolean): Promise<void> {
  const e = new WheelEvent("wheel", { deltaY, clientX: 600, clientY: 400, cancelable: true });
  Object.defineProperty(e, "ctrlKey", { value: pinch, configurable: true });
  svg.dispatchEvent(e);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Install with a generous pull-back so no test bumps the zoom floor. */
function install(svg: SVGSVGElement, world: SVGGElement, pinchZoomGain?: number) {
  return installPanZoom(svg, world, bounds, undefined, undefined, null, undefined, {
    zoomOutMax: 6,
    ...(pinchZoomGain === undefined ? {} : { pinchZoomGain }),
  });
}

describe("pinch is geared up relative to two-finger scroll", () => {
  test("the same delta zooms further when it arrives as a pinch", async () => {
    const a = makeSvg();
    install(a.svg, a.world);
    const scrollStart = scaleOf(a.world);
    await wheel(a.svg, -100, false);
    const scrollFactor = scaleOf(a.world) / scrollStart;

    const b = makeSvg();
    install(b.svg, b.world);
    const pinchStart = scaleOf(b.world);
    await wheel(b.svg, -100, true);
    const pinchFactor = scaleOf(b.world) / pinchStart;

    expect(pinchFactor).toBeGreaterThan(scrollFactor);
    // …and by exactly the configured gain, in the exponent.
    const gain = defaultStylingConfig.camera.pinchZoomGain;
    expect(Math.log(pinchFactor)).toBeCloseTo(Math.log(scrollFactor) * gain, 2);
  });

  test("a plain two-finger scroll is untouched — the feel that already works", async () => {
    const { svg, world } = makeSvg();
    install(svg, world, 4);
    const start = scaleOf(world);
    await wheel(svg, -100, false);
    expect(Math.log(scaleOf(world) / start)).toBeCloseTo(100 * ZOOM_WHEEL_K, 3);
  });

  test("gain 1 makes a pinch behave exactly like a scroll (the knob can be turned off)", async () => {
    const { svg, world } = makeSvg();
    install(svg, world, 1);
    const start = scaleOf(world);
    await wheel(svg, -100, true);
    expect(Math.log(scaleOf(world) / start)).toBeCloseTo(100 * ZOOM_WHEEL_K, 3);
  });

  test("setPinchZoomGain retunes a live camera (dev-panel slider)", async () => {
    const { svg, world } = makeSvg();
    const handle = install(svg, world, 1);
    handle.setPinchZoomGain(5);
    const start = scaleOf(world);
    await wheel(svg, -100, true);
    expect(Math.log(scaleOf(world) / start)).toBeCloseTo(100 * ZOOM_WHEEL_K * 5, 2);
  });

  test("a gain below 1 is refused — a pinch may never be duller than a scroll", async () => {
    const { svg, world } = makeSvg();
    const handle = install(svg, world, 0.2);
    handle.setPinchZoomGain(0.2);
    const start = scaleOf(world);
    await wheel(svg, -100, true);
    expect(Math.log(scaleOf(world) / start)).toBeCloseTo(100 * ZOOM_WHEEL_K, 3);
  });

  test("the default is the same on both config surfaces", () => {
    expect(liefworkStylingDefaults.camera.pinchZoomGain).toBe(defaultStylingConfig.camera.pinchZoomGain);
    expect(defaultStylingConfig.camera.pinchZoomGain).toBeGreaterThan(1);
    // The unset fallback matches, so Studio and the standalone viewer agree too.
    expect(marginFactorFor(undefined)).toBeCloseTo(1 / defaultStylingConfig.camera.zoomOutMax, 12);
  });
});
