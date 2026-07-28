import { describe, expect, test } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here.
import { installPanZoom } from "../src/pan-zoom.ts";
import { installSkeletonCanvas } from "../src/skeleton-canvas.ts";
import { defaultStylingConfig } from "../src/styling.ts";
import type { Bounds } from "../../src/types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const bounds: Bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };

/**
 * Obsidian pop-outs are SEPARATE windows with their own document and their own
 * ResizeObserver constructor. A ResizeObserver built from the MAIN window's
 * global and pointed at an element in the pop-out's document never delivers
 * observations — they're gathered per-document — so every reflow that does NOT
 * also fire window.resize goes unnoticed there. Splitting a pane is exactly such
 * a reflow, which is why a popped-out coral squashes on split and stretches when
 * the split is removed: the canvas backing store keeps its old size and CSS
 * scales the bitmap.
 *
 * Both modules already resolve the element's own window for their listeners and
 * rAF (`ownerDocument.defaultView`); these tests pin that the ResizeObserver is
 * resolved the same way, since it's the one that gets missed.
 */

/** A document whose defaultView carries its OWN ResizeObserver, so we can tell
 *  which realm's constructor a module reached for. Mirrors the pop-out case:
 *  same DOM API, different window object from the global one. */
function foreignRealm() {
  const observed: Element[] = [];
  class ForeignResizeObserver {
    constructor(_cb: () => void) {}
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  const doc = document.implementation.createHTMLDocument("popout");
  const win = {
    ResizeObserver: ForeignResizeObserver,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout: () => 0,
    clearTimeout() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    // dpr-watch arms a media query off the element's window (it already resolves
    // `win` correctly — only the ResizeObservers didn't).
    devicePixelRatio: 2,
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
  };
  // happy-dom documents expose defaultView as a getter; override it so the
  // module under test resolves OUR window, as it would in a real pop-out.
  Object.defineProperty(doc, "defaultView", { value: win, configurable: true });
  return { doc, observed };
}

describe("pop-out windows: the ResizeObserver must come from the element's own window", () => {
  test("pan-zoom observes via the pop-out's ResizeObserver, not the main window's", () => {
    const { doc, observed } = foreignRealm();
    const svg = doc.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
    const world = doc.createElementNS(SVG_NS, "g") as unknown as SVGGElement;
    svg.appendChild(world);
    doc.body.appendChild(svg);

    installPanZoom(svg, world, bounds);

    expect(observed).toContain(svg as unknown as Element);
  });

  test("skeleton-canvas observes via the pop-out's ResizeObserver, not the main window's", () => {
    const { doc, observed } = foreignRealm();
    const canvas = doc.createElement("canvas") as unknown as HTMLCanvasElement;
    doc.body.appendChild(canvas);
    // happy-dom ships no 2D context and installSkeletonCanvas throws without one,
    // so stand in a no-op ctx: this test is about which realm the observer comes
    // from, not about painting.
    const ctx: unknown = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "canvas" ? canvas : prop === "measureText" ? () => ({ width: 0 }) : () => undefined,
        set: () => true,
      },
    );
    (canvas as unknown as { getContext: () => unknown }).getContext = () => ctx;

    installSkeletonCanvas(
      canvas,
      { blocks: [], branches: [], bounds } as never,
      defaultStylingConfig,
    );

    expect(observed).toContain(canvas as unknown as Element);
  });
});
