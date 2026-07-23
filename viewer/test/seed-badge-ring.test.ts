import { describe, test, expect } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// ── The seed-badge ring: the only stroke()-consuming draw in the LABEL pass ──
// (stems are the only other stroke() call site in skeleton-canvas.ts, and they
// paint BEFORE labels — see the file's "Paint order" header comment). So a
// styling.agentGlow.seedBadges-gated ring shows up as extra stroke() calls
// relative to an identical render with the flag off / the block un-badged.

// Mock Path2D (happy-dom has no canvas backend) — same pattern as the other
// mount-level tests (mount-plant.test.ts, mount-furl.test.ts, mount-render-snapshot.test.ts).
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

let strokeCalls = 0;
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
  stroke: () => { strokeCalls++; },
  fill: () => {},
  fillText: () => {},
  strokeText: () => {},
  measureText: (text: string) => ({ width: text.length * 6 }),
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

import { mountPlant } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

const tree: HierarchyInput = {
  root: { id: "root", name: "root", children: [{ id: "a", name: "a", children: [{ id: "a1", name: "a1" }] }] },
};

describe("seed-badge ring — styling.agentGlow.seedBadges-gated", () => {
  test("badged block + flag on: draws MORE strokes than an unbadged render (the ring)", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant, { agentGlow: { seedBadges: true } });

    strokeCalls = 0;
    handle.renderSnapshot(plant); // forces stableMeristems: every meristem is "full" tier
    const baseline = strokeCalls;

    handle.setSeedBadges(new Set(["a"]));
    strokeCalls = 0;
    handle.renderSnapshot(plant);
    const badged = strokeCalls;

    expect(badged).toBeGreaterThan(baseline);
    handle.destroy();
  });

  test("flag OFF: setSeedBadges is a no-op — same stroke count as unbadged", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    // agentGlow.seedBadges defaults to false — the mount is never told to turn it on.
    const handle = mountPlant(container, plant);

    strokeCalls = 0;
    handle.renderSnapshot(plant);
    const baseline = strokeCalls;

    handle.setSeedBadges(new Set(["a"]));
    strokeCalls = 0;
    handle.renderSnapshot(plant);
    expect(strokeCalls).toBe(baseline);
    handle.destroy();
  });

  test("flag on but block not in the badge set: no ring drawn", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant, { agentGlow: { seedBadges: true } });

    strokeCalls = 0;
    handle.renderSnapshot(plant);
    const baseline = strokeCalls;

    handle.setSeedBadges(new Set(["not-a-real-path"]));
    strokeCalls = 0;
    handle.renderSnapshot(plant);
    expect(strokeCalls).toBe(baseline);
    handle.destroy();
  });
});
