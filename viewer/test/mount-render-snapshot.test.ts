import { describe, expect, test } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// Mock Path2D
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

// Mock canvas 2D context with all required methods
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
  createLinearGradient: () => ({
    addColorStop: () => {},
  }),
  createRadialGradient: () => ({
    addColorStop: () => {},
  }),
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

HTMLCanvasElement.prototype.getContext = function(contextType: string) {
  if (contextType === "2d") {
    return mockCanvasContext as any;
  }
  return null;
};

import { mountPlant } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tree: HierarchyInput = {
  root: { id: "root", name: "root", children: [
    { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
    { id: "b", name: "b" },
  ] },
};

describe("PlantMountHandle.renderSnapshot", () => {
  test("renders a snapshot at the current camera without moving it", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);
    handle.setCamera(10, 20, 2);
    expect(typeof handle.renderSnapshot).toBe("function");
    handle.renderSnapshot(plant);
    const g = container.querySelector("g");
    expect(g?.getAttribute("transform")).toBe("translate(10.000 20.000) scale(2.000)");
    handle.destroy();
  });
});
