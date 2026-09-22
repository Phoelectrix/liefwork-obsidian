import { expect, test } from "bun:test";
// Canvas mock — happy-dom has no canvas backend (same shim as mount-plant.test.ts).

// Mock Path2D (happy-dom has no canvas backend).
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

// Minimal 2D context mock with every method/prop the skeleton draw passes touch.
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
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { mountPlant } from "../src/mount-plant.ts";
import type { Plant } from "../../src/types.ts";

// The first branch angle joins the mount's engine knobs (22 Sept 2026) so the
// organic style's seed can be tuned live on the site host as well as in the
// plugin (which serves the group through the view — see engine-config.ts).
const tree: HierarchyInput = {
  root: { id: "r", name: "r", children: [{ id: "a", name: "a", children: [{ id: "a1", name: "a1" }] }, { id: "b", name: "b" }] },
};

test("getEngineKnobs reads firstBranchAngle from the live engine config and setEngineKnobs writes it", () => {
  const cfg = structuredClone(defaultEngineConfig);
  cfg.angles.firstBranchAngle = 60;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const plant = build(tree, undefined, cfg) as unknown as Plant;
  const handle = mountPlant(container, plant, { unfurl: { enabled: true, initialDepth: 9 } }, {}, { unfurl: { hierarchy: tree, engineConfig: cfg } });
  expect(handle.getEngineKnobs().firstBranchAngle).toBe(60);
  handle.setEngineKnobs({ firstBranchAngle: 85 });
  expect(cfg.angles.firstBranchAngle).toBe(85);
  expect(handle.getEngineKnobs().firstBranchAngle).toBe(85);
  handle.destroy();
});
