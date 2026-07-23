import { describe, expect, test, mock, afterAll } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts).
//
// FILENAME NOTE — this file is deliberately named to SORT AFTER
// `unfurl-live-sweep.test.ts` (and every other file that uses the REAL
// skeleton-canvas / unfurl-live-sweep). bun runs test files alphabetically and
// `mock.module` LEAKS FORWARD into later-sorted files (the same hazard the
// comment in mount-open-as-page.test.ts documents). Because this file mocks
// both `unfurl-live-sweep` and `skeleton-canvas`, sorting it last means its
// leak lands only on files that don't use the real modules. The afterAll
// below also restores the reals (belt-and-suspenders). If you rename this file
// to sort earlier, the real-sweep / furl-settle tests will break.
//
// This suite proves the "keep-the-note-open-on-steal" fix in mount-plant.ts:
// clicking a furled meristem DEFERS the note-open to the unfurl sweep's settle.
// If a pan/zoom STEALS the camera mid-sweep, the deferred open must STILL fire
// (the user asked to open that node). If a SUPERSEDING toggle cancels the sweep,
// the stale open must be DROPPED (the new action owns the next open).
//
// The immediate/deferred sweep is exercised through the REAL onClick → route →
// toggleFurlByNode wiring. Two collaborators are mocked so the deferred window
// is observable and holdable:
//  1. unfurl-live-sweep — a MANUALLY-resolvable `done` promise, so the deferred
//     window stays open until we resolve it (and a captured `cancel` spy).
//  2. skeleton-canvas — the real module, with the returned handle's `hitTest`
//     forced to a chosen block id, so a dispatched click deterministically hits
//     the meristem we want (happy-dom has no real canvas geometry to hit-test).

// Capture the REAL modules BEFORE registering any mock (via synchronous
// require, so the file stays non-async): we both build our mocks on top of the
// reals AND restore them in afterAll. bun's per-file module-mock auto-restore is
// defeated by mocking skeleton-canvas here (verified empirically), which would
// otherwise leak these mocks into unfurl-live-sweep.test.ts / furl-settle-
// reveal.test.ts and break the whole-suite run — so we restore explicitly.
const realLiveSweep = require("../src/unfurl-live-sweep.ts") as typeof import("../src/unfurl-live-sweep.ts");
const realSkeleton = require("../src/skeleton-canvas.ts") as typeof import("../src/skeleton-canvas.ts");
const realInstall = realSkeleton.installSkeletonCanvas;

const liveSweepCalls: Array<{ args: any; cancel: ReturnType<typeof mock>; resolve: () => void }> = [];
// Mock the live sweep with a MANUALLY-resolvable `done` (so the deferred-open
// window stays open until we resolve it) and a captured `cancel` spy.
mock.module("../src/unfurl-live-sweep.ts", () => ({
  ...realLiveSweep,
  runLiveSweep: (args: any) => {
    const cancel = mock(() => {});
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    liveSweepCalls.push({ args, cancel, resolve });
    return { cancel, done };
  },
}));

// Force the skeleton handle's hitTest to a chosen block id, leaving every other
// export (and every other handle method) real. `forcedHitId` is set per-test.
// (`import *` can't be used: bun re-points its binding to the mock → recursion.)
let forcedHitId: string | null = null;
mock.module("../src/skeleton-canvas.ts", () => ({
  ...realSkeleton,
  installSkeletonCanvas: (...args: Parameters<typeof realInstall>) => {
    const h = realInstall(...args);
    return { ...h, hitTest: () => forcedHitId };
  },
}));

// Restore the real modules so these mocks don't leak into later test files.
afterAll(() => {
  mock.module("../src/unfurl-live-sweep.ts", () => realLiveSweep);
  mock.module("../src/skeleton-canvas.ts", () => realSkeleton);
});

// Mock Path2D + a 2D context (happy-dom has no canvas backend).
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

import { mountPlant, type MountHandlers } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { injectAffordanceLiefs } from "../../scripts/lib/inject-affordance-liefs.ts";
import type { Plant } from "../../src/types.ts";

const furlTree: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [
        { id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }, { id: "a1y", name: "a1y" }] },
        { id: "a2", name: "a2" },
      ] },
      { id: "b", name: "b" },
    ],
  },
};
const injected = injectAffordanceLiefs(furlTree, { expandLabel: "expand", furlLabel: "furl" });

function mountDeepUnfurl(handlers: MountHandlers = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const full = build(injected, undefined, defaultEngineConfig) as unknown as Plant;
  const handle = mountPlant(
    container, full,
    { unfurl: { enabled: true, initialDepth: 1 } },
    handlers,
    { unfurl: { hierarchy: injected, engineConfig: defaultEngineConfig } },
  );
  const svg = container.querySelector("svg")!;
  // happy-dom clientWidth/Height default to 0 (would stall refit); give a size.
  Object.defineProperty(svg, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(svg, "clientHeight", { value: 600, configurable: true });
  (svg as any).getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 });
  return { handle, container, svg };
}

// The current plant's meristem block id for a furled node (its hierarchyId).
function meristemBlockId(handle: ReturnType<typeof mountPlant>, hierarchyId: string): string {
  const b = handle.getPlant().blocks.find(
    (bl) => bl.kind === "meristem" && (bl as { hierarchyId?: string }).hierarchyId === hierarchyId,
  );
  if (!b) throw new Error(`no meristem block for ${hierarchyId}`);
  return b.id;
}

// Drive a real click on the furled meristem `nodeId`: force hitTest to that
// block, dispatch a click, and flush onClick's 250ms debounce.
async function clickFurledMeristem(handle: ReturnType<typeof mountPlant>, svg: SVGSVGElement, nodeId: string): Promise<void> {
  forcedHitId = meristemBlockId(handle, nodeId);
  svg.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, bubbles: true }));
  await new Promise((r) => setTimeout(r, 300)); // > 250ms debounce
}

describe("mountPlant deferred note-open on input-steal vs supersede", () => {
  test("a pan/zoom steal mid-sweep STILL runs the deferred note-open", async () => {
    liveSweepCalls.length = 0;
    let opened = 0;
    const { handle, svg } = mountDeepUnfurl({ onNodeClick: () => opened++ });

    // `a` is furled on landing → clicking it unfurls AND owes a note-open,
    // deferred to the sweep's settle.
    await clickFurledMeristem(handle, svg, "a");
    expect(liveSweepCalls.length).toBe(1);        // sweep armed
    expect(liveSweepCalls[0]!.args.reverse).toBeUndefined(); // forward (unfurl)
    expect(opened).toBe(0);                        // open is DEFERRED, not yet run

    // A genuine pan/zoom steals the camera mid-sweep.
    svg.dispatchEvent(new Event("pointerdown"));
    expect(liveSweepCalls[0]!.cancel).toHaveBeenCalled(); // sweep cancelled
    expect(opened).toBe(1);                        // …but the note STILL opened

    // Now let the (cancelled) sweep's done settle — must NOT double-fire.
    liveSweepCalls[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toBe(1);                        // exactly once

    handle.destroy();
  });

  test("a superseding toggle mid-sweep DROPS the deferred note-open", async () => {
    liveSweepCalls.length = 0;
    let opened = 0;
    const { handle, svg } = mountDeepUnfurl({ onNodeClick: () => opened++ });

    await clickFurledMeristem(handle, svg, "a");
    expect(liveSweepCalls.length).toBe(1);
    expect(opened).toBe(0);                        // deferred

    // A superseding toggle (public API, no note-open) cancels the sweep.
    // `a` is now OPEN (unfurl committed its state synchronously); toggling it
    // again starts a fresh (reverse) sweep and its top-of-fn cancel drops the
    // pending open.
    const branchIdA = handle.getPlant().blocks.find(
      (b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === "a",
    )!.branchId;
    handle.toggleFurl(branchIdA);
    expect(liveSweepCalls[0]!.cancel).toHaveBeenCalled();
    expect(liveSweepCalls.length).toBe(2);         // a new sweep supersedes

    // Resolving the ORIGINAL sweep's done must not fire the dropped open.
    liveSweepCalls[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toBe(0);                        // dropped — never opened

    handle.destroy();
  });
});
