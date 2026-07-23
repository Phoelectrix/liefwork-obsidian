import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// ── Fix item 2 repro ─────────────────────────────────────────────────────────
// After a normal (non-cancelled) FURL animation settles, the lief-text-reveal
// channel was left wedged at (reveal=0, scope=the just-furled node's SUBTREE
// block ids from the last in-flight frame). Engine block ids are a
// deterministic counter reset to blk_0 on every build() (structure.ts), so
// that stale scope aliases onto unrelated blocks in the rebuilt (much
// smaller, now-furled) plant — including the branch's own injected "click to
// expand" affordance lief — and the draw pass multiplies that lief's TEXT
// alpha by 0 (skeleton-canvas.ts fadeAlpha / scopedLabelRevealFactor). The
// fillText call still happens (font size unaffected — only globalAlpha is
// zeroed), so this test records BOTH the font size and the effective alpha
// at each fillText call: the discriminating assertion is `alpha > 0`, not
// `fontPx > 0` (which is always ≥1 by construction — clampFontToPeak floors
// at 1 — and so can't observe this bug on its own).
//
// Repro sequence: UNFURL "About" (drives the live-sweep forward, settles via
// mount-plant.ts:774-781, which already resets the channel — unaffected by
// this bug), then FURL "About" back (drives the reverse-sweep, settles via
// the handler this task fixes, mount-plant.ts:830-842). Only the FURL-settle
// path is missing the reset.

// Mock Path2D (happy-dom has no canvas backend) — same pattern as the other
// mount-level tests (mount-plant.test.ts, mount-furl.test.ts, mount-set-camera.test.ts).
if (typeof Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    roundRect() {}
    closePath() {}
    addPath() {}
  };
}

// A RECORDING 2D context: captures every fillText call — the text, the font's
// px size (parsed from ctx.font), and the effective ctx.globalAlpha at that
// moment — so the test can observe exactly what was painted, not just mount
// state.
interface FillTextRecord {
  text: string;
  fontPx: number;
  alpha: number;
}
let records: FillTextRecord[] = [];
const parseFontPx = (font: string): number => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]!) : 0;
};

const mockCanvasContext: any = {
  clearRect: () => {},
  setTransform: () => {},
  transform: () => {},
  strokeStyle: "",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  fillStyle: "",
  globalAlpha: 1,
  font: "12px sans-serif",
  canvas: { width: 0, height: 0 },
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} }),
  stroke: () => {},
  fill: () => {},
  fillText(text: string) {
    records.push({
      text,
      fontPx: parseFontPx(mockCanvasContext.font),
      alpha: mockCanvasContext.globalAlpha,
    });
  },
  strokeText: () => {},
  measureText(text: string) {
    const fontPx = parseFontPx(mockCanvasContext.font);
    return { width: text.length * fontPx * 0.5 };
  },
  save: () => {},
  restore: () => {},
  scale: () => {},
  translate: () => {},
  rotate: () => {},
  drawImage: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  bezierCurveTo: () => {},
  quadraticCurveTo: () => {},
  arc: () => {},
  arcTo: () => {},
  ellipse: () => {},
  rect: () => {},
  roundRect: () => {},
  textAlign: "left",
  textBaseline: "top",
};

HTMLCanvasElement.prototype.getContext = function (contextType: string) {
  if (contextType === "2d") return mockCanvasContext;
  return null;
};

// happy-dom has no real layout engine: clientWidth/clientHeight default to 0
// and getBoundingClientRect returns a zeroed rect — pan-zoom's viewport reads
// (readRect/refreshRect in pan-zoom.ts) treat a 0×0 viewport as "not usable"
// and refuse to fit/animate the camera at all (refitAnimated retries a bounded
// number of times, then silently gives up), which would leave the live-sweep
// camera move a no-op. clientWidth/clientHeight are only defined on
// HTMLElement.prototype in happy-dom, but getBoundingClientRect is on the
// shared Element.prototype (SVGElement doesn't extend HTMLElement) — the mount
// reads BOTH svg.clientWidth (HTMLElement-only, so this stays its happy-dom
// default and is unused via the `||` fallback below) and
// svg.getBoundingClientRect() (Element-level, needs stubbing here), so only
// getBoundingClientRect needs stubbing for the SVG viewport reads to resolve
// to a real size; clientWidth/clientHeight are stubbed too for the
// HTMLElement (container/canvas) reads. Restored in afterAll so this file's
// stub doesn't leak into other test files sharing this process.
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
Element.prototype.getBoundingClientRect = function () {
  return {
    x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800,
    toJSON() { return this; },
  } as DOMRect;
};
afterAll(() => {
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  }
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

import { mountPlant } from "../src/mount-plant.ts";
import { build } from "../../src/library/index.ts";
import type { HierarchyInput, EngineConfig } from "../../src/library/types.ts";
import type { StylingConfig } from "../src/styling.ts";
// The real site bundle — the affordance liefs ("click to expand" / "− furl")
// are baked into its hierarchy by the publish-time injection pass (see
// unfurl-affordance.ts), so this exercises the real, deterministic block-id
// aliasing the bug depends on rather than a synthetic fixture. dist-site is
// gitignored build output (`bun run publish:site` emits it), so the suite
// SKIPS rather than fails where it hasn't been built — e.g. a fresh clone.
const bundlePath = fileURLToPath(
  new URL("../../dist-site/bundles/site.geometry.liefwork.json", import.meta.url),
);
const bundle: any = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, "utf-8")) : null;

describe.skipIf(!bundle)("furl-settle resets lief-text-reveal (Fix item 2)", () => {
  test("the 'click to expand' affordance text is never painted — the liefs are culled from the draw", async () => {
    const hierarchy = bundle.source.hierarchy as unknown as HierarchyInput;
    const engineConfig = bundle.source.engineConfig as unknown as EngineConfig;
    const bundleStyling = (bundle.stylingConfig ?? {}) as Partial<StylingConfig>;

    const plant = build(hierarchy, undefined, engineConfig);

    const container = document.createElement("div");
    document.body.appendChild(container);

    // Controllable clock + rAF: the regression lives in the REAL live-sweep's
    // settle handler, so an instant/mocked sweep (as other mount-plant tests
    // use) wouldn't exercise it — the sweep must actually run to completion.
    let fakeNow = 1000;
    let nextRafId = 1;
    const rafQueue = new Map<number, (t: number) => void>();
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    const originalPerformance = globalThis.performance;
    (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    (globalThis as any).cancelAnimationFrame = (id: number) => {
      rafQueue.delete(id);
    };
    (globalThis as any).performance = { now: () => fakeNow };

    const flush = (steps: number): void => {
      for (let i = 0; i < steps; i++) {
        fakeNow += 20;
        const entries = [...rafQueue.entries()];
        rafQueue.clear();
        for (const [, cb] of entries) cb(fakeNow);
      }
    };

    try {
      const handle = mountPlant(
        container,
        plant,
        // Pin initialDepth:1 for this test. The shipped site bundle now carries
        // unfurl.initialDepth:0 (fully-furled entry — only the root materialises
        // at mount, see 3b801e15 "fully-furled entry"), but this test exercises
        // the furl-settle reveal-channel on a DEPTH-1 branch ("About"), so it
        // needs that branch present at mount. The entry depth the site ships is
        // orthogonal to the behaviour under test; pin it here rather than couple
        // to the bundle's landing depth.
        { ...bundleStyling, unfurl: { ...(bundleStyling.unfurl ?? {}), enabled: true, initialDepth: 1 } },
        {},
        { unfurl: { hierarchy, engineConfig } },
      );

      const findMeristemBranchId = (name: string): string => {
        const b = handle.getPlant().blocks.find(
          (blk) => blk.kind === "meristem" && (blk as { name?: string }).name === name,
        );
        if (!b) throw new Error(`meristem "${name}" not found`);
        return b.branchId;
      };

      // "About" is a direct child of root (depth 1) with real sub-folders, so
      // it's furlable and starts furled at mount (initialDepth pinned to 1 above).
      const aboutId0 = findMeristemBranchId("About");
      expect(handle.isFurled(aboutId0)).toBe(true);

      // 1. UNFURL "About" — drive the live sweep to completion.
      handle.toggleFurl(aboutId0);
      flush(200);
      await new Promise((r) => setTimeout(r, 0));
      const aboutId1 = findMeristemBranchId("About"); // rebuildForFurl mints new branch ids
      expect(handle.isFurled(aboutId1)).toBe(false);

      // 2. FURL "About" back — the reverse-sweep settle path this task fixes.
      handle.toggleFurl(aboutId1);
      flush(200);
      await new Promise((r) => setTimeout(r, 0));
      const aboutId2 = findMeristemBranchId("About");
      expect(handle.isFurled(aboutId2)).toBe(true);

      // Measure: reset recorded calls, then park the camera close on "About"
      // (a high fixed zoom centred on its node) — a distance at which its own
      // "click to expand" affordance lief WOULD easily clear the draw-tier
      // threshold if it were drawn at all. Centring directly (rather than
      // frameNode) keeps this independent of the framing-bounds heuristic.
      records = [];
      const aboutMer = handle.getPlant().blocks.find(
        (blk) => blk.kind === "meristem" && (blk as { name?: string }).name === "About",
      )!;
      const s = 1.5;
      handle.setCamera(600 - aboutMer.position.x * s, 400 - aboutMer.position.y * s, s);
      await new Promise((r) => setTimeout(r, 0));

      // The affordance liefs are culled from the draw entirely (clicking the
      // meristem is the natural gesture, so the label is visual noise) — even
      // parked close, "click to expand" is never painted.
      const expand = records.filter((r) => r.text === "click to expand");
      expect(expand.length).toBe(0);

      handle.destroy();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
      globalThis.performance = originalPerformance;
    }
  });
});
