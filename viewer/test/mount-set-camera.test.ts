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

HTMLCanvasElement.prototype.getContext = function(contextType: string) {
  if (contextType === "2d") {
    return mockCanvasContext as any;
  }
  return null;
};

import { mountPlant } from "../src/mount-plant.ts";
import { build } from "../../src/library/index.ts";
import { defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tiny: HierarchyInput = {
  root: {
    id: "root", name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
      { id: "b", name: "b" },
    ],
  },
};

describe("PlantMountHandle camera surface", () => {
  test("exposes setCamera, getBounds, viewport", () => {
    const plant = build(tiny, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);

    expect(typeof handle.setCamera).toBe("function");
    expect(typeof handle.viewport).toBe("function");

    const b = handle.getBounds();
    expect(b.max.x).toBeGreaterThan(b.min.x);

    // setCamera must not throw and must write the inner <g> transform.
    handle.setCamera(5, 6, 1.5);
    const g = container.querySelector("g");
    expect(g?.getAttribute("transform")).toBe("translate(5.000 6.000) scale(1.500)");

    handle.destroy();
  });
});
