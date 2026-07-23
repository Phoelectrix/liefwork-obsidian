import { describe, expect, test, mock, afterAll } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts).

// Spy on the skeleton's setBlockAlpha by mocking the skeleton-canvas module.
//
// This USED to be a fully hand-stubbed handle (no real installSkeletonCanvas
// call at all). That stub predated `setSelectedMany` and — because bun's
// per-file module-mock auto-restore is defeated for this specific module (the
// mock LEAKS FORWARD into every later-sorted file that imports the real
// skeleton-canvas, same hazard documented in unfurl-steal.test.ts /
// zz-additive-click-bypass.test.ts, and an afterAll restore alone did not stop
// it empirically) — any later-sorted file exercising a real selection call
// would crash on the stale, incomplete stub (Task 5's selection-light.test.ts
// hit exactly this). Fixed the same way those two files stay leak-safe: wrap
// the REAL installSkeletonCanvas handle and spy on just setBlockAlpha, so a
// forward leak is a no-op functionally (every other method is the real one).
const realSkeleton = require("../src/skeleton-canvas.ts") as typeof import("../src/skeleton-canvas.ts");
const realInstall = realSkeleton.installSkeletonCanvas;
const setBlockAlphaCalls: Array<Map<string, number> | null> = [];

mock.module("../src/skeleton-canvas.ts", () => ({
  ...realSkeleton,
  installSkeletonCanvas: (...args: Parameters<typeof realInstall>) => {
    const h = realInstall(...args);
    return {
      ...h,
      setBlockAlpha(alphaById: Map<string, number> | null) {
        setBlockAlphaCalls.push(alphaById);
        h.setBlockAlpha(alphaById);
      },
    };
  },
}));

afterAll(() => {
  mock.module("../src/skeleton-canvas.ts", () => realSkeleton);
});

// Mock Path2D + a 2D context (happy-dom has no canvas backend) — needed now
// that installSkeletonCanvas is the real implementation (same boilerplate as
// mount-set-camera.test.ts / mount-plant.test.ts).
if (typeof Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
    arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} closePath() {} addPath() {}
  };
}
const mockCanvasContext = {
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
  fillText: () => {},
  strokeText: () => {},
  measureText: () => ({ width: 0 }),
  save: () => {},
  restore: () => {},
  scale: () => {},
  translate: () => {},
  rotate: () => {},
  drawImage: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo() {},
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
  if (contextType === "2d") return mockCanvasContext as any;
  return null;
};

import { mountPlant } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tree: HierarchyInput = {
  root: { id: "root", name: "root", children: [{ id: "a", name: "a" }] },
};

describe("PlantMountHandle.renderSnapshot — alpha clear", () => {
  test("clears the per-block alpha (setBlockAlpha(null)) before rendering", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);

    setBlockAlphaCalls.length = 0; // ignore any calls during mount
    handle.renderSnapshot(plant);

    // renderSnapshot must clear the alpha channel, and null must be the first
    // thing it does (before setPlant/redraw) so no stale alpha survives.
    expect(setBlockAlphaCalls.length).toBeGreaterThan(0);
    expect(setBlockAlphaCalls[0]).toBeNull();

    handle.destroy();
  });
});
