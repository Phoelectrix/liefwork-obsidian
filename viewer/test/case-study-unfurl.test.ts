import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// happy-dom is registered by the preload (setup-dom.ts). This test proves a
// CASE-STUDY hierarchy bundle (built by scripts/lib/build-case-study-live.ts +
// publish-site) does the homepage's live collapse-and-grow unfurl through
// mountPlant — i.e. top-level branches start furled/collapsed and materialise
// their subtree on unfurl, rather than the old frozen "fully grown but empty".

// ── Canvas + layout stubs (same pattern as furl-settle-reveal.test.ts) ──────
if (typeof Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
    arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} closePath() {} addPath() {}
  };
}
const mockCtx: any = {
  clearRect() {}, setTransform() {}, transform() {}, strokeStyle: "", lineWidth: 1,
  lineCap: "butt", lineJoin: "miter", fillStyle: "", globalAlpha: 1, font: "12px sans-serif",
  canvas: { width: 0, height: 0 },
  createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  stroke() {}, fill() {}, fillText() {}, strokeText() {},
  measureText: (t: string) => ({ width: t.length * 6 }),
  save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
  quadraticCurveTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {},
  textAlign: "left", textBaseline: "top",
};
HTMLCanvasElement.prototype.getContext = function (t: string) { return t === "2d" ? mockCtx : null; } as any;
const oW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const oH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const oRect = Element.prototype.getBoundingClientRect;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() { return this; } } as DOMRect;
};
afterAll(() => {
  if (oW) Object.defineProperty(HTMLElement.prototype, "clientWidth", oW);
  if (oH) Object.defineProperty(HTMLElement.prototype, "clientHeight", oH);
  Element.prototype.getBoundingClientRect = oRect;
});

import { mountPlant } from "../src/mount-plant.ts";
import { build } from "../../src/library/index.ts";
// The REAL case-study bundle emitted by publish-site (run `bun run publish:site`
// first — local-only, dist-site is gitignored), so the suite SKIPS rather than
// fails where it hasn't been built — e.g. a fresh clone.
const bundlePath = fileURLToPath(
  new URL("../../dist-site/bundles/holographia.geometry.liefwork.json", import.meta.url),
);
const bundle: any = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, "utf-8")) : null;

describe.skipIf(!bundle)("case study live unfurl (Holographia)", () => {
  test("top-level branches start furled and materialise their subtree on unfurl", async () => {
    const hierarchy = (bundle as any).source.hierarchy;
    const engineConfig = (bundle as any).source.engineConfig;
    const styling = { ...(bundle as any).stylingConfig, unfurl: { ...(bundle as any).stylingConfig.unfurl, enabled: true, initialDepth: 1 } };

    const plant = build(hierarchy, undefined, engineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Controllable clock + rAF so the live sweep runs to completion.
    let now = 1000, nextId = 1;
    const q = new Map<number, (t: number) => void>();
    const oRaf = globalThis.requestAnimationFrame, oCaf = globalThis.cancelAnimationFrame, oPerf = globalThis.performance;
    (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { const id = nextId++; q.set(id, cb); return id; };
    (globalThis as any).cancelAnimationFrame = (id: number) => { q.delete(id); };
    (globalThis as any).performance = { now: () => now };
    const flush = (n: number) => { for (let i = 0; i < n; i++) { now += 20; const e = [...q.values()]; q.clear(); for (const cb of e) cb(now); } };

    try {
      const handle = mountPlant(container, plant, styling as any, {}, { unfurl: { hierarchy, engineConfig } });

      const topMeristem = () => handle.getPlant().blocks.find(
        (b) => b.kind === "meristem" && b.branchId !== handle.getPlant().branches[0]?.id,
      );
      const top = topMeristem();
      expect(top).toBeTruthy();                       // a top-level branch is present at entry
      const topId = (top as any).branchId;
      expect(handle.isFurled(topId)).toBe(true);      // …and it starts COLLAPSED

      const blocksBefore = handle.getPlant().blocks.length;
      handle.toggleFurl(topId);                        // unfurl it
      flush(200);
      await new Promise((r) => setTimeout(r, 0));

      expect(handle.isFurled(topMeristem() ? (topMeristem() as any).branchId : topId)).toBe(false);
      // GROW: unfurling built the subtree that was collapsed away → more blocks.
      expect(handle.getPlant().blocks.length).toBeGreaterThan(blocksBefore);

      handle.destroy();
    } finally {
      globalThis.requestAnimationFrame = oRaf;
      globalThis.cancelAnimationFrame = oCaf;
      globalThis.performance = oPerf;
    }
  });
});
