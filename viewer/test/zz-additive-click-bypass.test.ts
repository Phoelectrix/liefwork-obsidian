import { describe, expect, test, mock, afterAll } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts).
//
// FILENAME NOTE — mirrors unfurl-steal.test.ts's own filename trick: happy-dom
// has no real canvas/SVG geometry, so proving a cmd/ctrl click or dblclick
// actually LANDS on a node needs the skeleton handle's `hitTest` forced to a
// chosen block id (real hit-testing can't be driven from synthetic clientX/Y
// here). That means mocking the whole `skeleton-canvas` module, which LEAKS
// FORWARD into every later-sorted file that imports the real module (bun's
// per-file auto-restore is defeated for this specific module — verified
// empirically in unfurl-steal.test.ts). This file is named to sort AFTER every
// other viewer test (including unfurl-steal.test.ts and wave-shapes.test.ts,
// the previous last-sorted file), so the leak has nothing left to land on.
// The afterAll below restores the real module anyway (belt-and-suspenders).
//
// Covers:
//  - issue 3: a cmd/ctrl-modified DOUBLE-click on a real node hit never fires
//    onNodeDoubleClick (so it never moves the camera) — additive selection
//    owns modified clicks, dblclick included.
//  - issue 7 (multi-select wiring, additive-click bypass, viewer side): a
//    cmd/ctrl SINGLE-click on a real node hit fires onNodeAdditiveClick and
//    never onNodeClick.
const realSkeleton = require("../src/skeleton-canvas.ts") as typeof import("../src/skeleton-canvas.ts");
const realInstall = realSkeleton.installSkeletonCanvas;

// Force the skeleton handle's hitTest to a chosen block id, leaving every
// other export (and every other handle method) real — same trick as
// unfurl-steal.test.ts. `forcedHitId` is set per-test.
let forcedHitId: string | null = null;
mock.module("../src/skeleton-canvas.ts", () => ({
  ...realSkeleton,
  installSkeletonCanvas: (...args: Parameters<typeof realInstall>) => {
    const h = realInstall(...args);
    return { ...h, hitTest: () => forcedHitId };
  },
}));

afterAll(() => {
  mock.module("../src/skeleton-canvas.ts", () => realSkeleton);
});

// Mock Path2D + a 2D context (happy-dom has no canvas backend) — same
// boilerplate as unfurl-steal.test.ts / mount-plant.test.ts.
if (typeof Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
    arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} closePath() {} addPath() {}
  };
}
const mockCanvasContext = new Proxy(
  {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 10 }),
    canvas: { width: 0, height: 0 },
    strokeStyle: "", fillStyle: "", globalAlpha: 1, lineWidth: 1,
    font: "12px sans-serif", textAlign: "left", textBaseline: "top",
  },
  { get: (t: any, p) => (p in t ? t[p] : () => {}) },
);
HTMLCanvasElement.prototype.getContext = function (contextType: string) {
  return contextType === "2d" ? (mockCanvasContext as any) : null;
};

import { mountPlant, nodeRefFor, type MountHandlers } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tree: HierarchyInput = {
  root: { id: "root", name: "root", children: [{ id: "a", name: "a" }, { id: "b", name: "b" }] },
};

/** The first block that's actually a clickable node (lief/meristem) — the
 *  built plant also carries spacer/growthBlock scaffolding blocks (kind
 *  "spacer"/"growthBlock", no hierarchyId) that nodeRefFor rejects. */
function firstNodeBlockId(plant: ReturnType<typeof build>): string {
  const b = plant.blocks.find((bl) => nodeRefFor(bl) !== null);
  if (!b) throw new Error("no clickable node block in fixture plant");
  return b.id;
}

function mountFor(handlers: MountHandlers) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const plant = build(tree, undefined, defaultEngineConfig);
  const handle = mountPlant(container, plant, undefined, handlers);
  const svg = container.querySelector("svg")!;
  Object.defineProperty(svg, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(svg, "clientHeight", { value: 600, configurable: true });
  (svg as any).getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 });
  return { handle, plant, svg };
}

describe("mountPlant additive (cmd/ctrl) click bypass — real node hit", () => {
  test("issue 3: a cmd/ctrl-modified DOUBLE-click on a real hit never fires onNodeDoubleClick", () => {
    let dblClicks = 0;
    const { handle, plant, svg } = mountFor({
      onNodeDoubleClick: () => dblClicks++,
      onNodeAdditiveClick: () => {},
    });
    forcedHitId = firstNodeBlockId(plant);
    svg.dispatchEvent(new MouseEvent("dblclick", { clientX: 400, clientY: 300, metaKey: true, bubbles: true }));
    svg.dispatchEvent(new MouseEvent("dblclick", { clientX: 400, clientY: 300, ctrlKey: true, bubbles: true }));
    expect(dblClicks).toBe(0);
    handle.destroy();
  });

  test("issue 3 sanity: an UNMODIFIED double-click on the same real hit DOES fire onNodeDoubleClick (the guard is additive-only)", () => {
    let dblClicks = 0;
    const { handle, plant, svg } = mountFor({
      onNodeDoubleClick: () => dblClicks++,
      onNodeAdditiveClick: () => {},
    });
    forcedHitId = firstNodeBlockId(plant);
    svg.dispatchEvent(new MouseEvent("dblclick", { clientX: 400, clientY: 300, bubbles: true }));
    expect(dblClicks).toBe(1);
    handle.destroy();
  });

  test("issue 7 wiring: a cmd/ctrl SINGLE-click on a real hit fires onNodeAdditiveClick and never onNodeClick", async () => {
    let clicks = 0;
    let additive = 0;
    const { handle, plant, svg } = mountFor({
      onNodeClick: () => clicks++,
      onNodeAdditiveClick: () => additive++,
    });
    forcedHitId = firstNodeBlockId(plant);
    svg.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, metaKey: true, bubbles: true }));
    // The additive channel fires IMMEDIATELY (no 250ms dblclick-cancel debounce);
    // wait past it anyway so a wrongly-debounced plain click would still show up.
    await new Promise((r) => setTimeout(r, 300));
    expect(additive).toBe(1);
    expect(clicks).toBe(0);
    handle.destroy();
  });
});
