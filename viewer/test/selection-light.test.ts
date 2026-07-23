import { describe, expect, test } from "bun:test";
// The coral pane never lit anything: mount-plant declared `litBlockIds` and
// nothing ever wrote to it, so a selected node got colour but none of the
// engine's emphasis. Selection now feeds that set (gated), which is what makes
// the keyboard cursor legible at a glance.

// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

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

import { mountPlant } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

// Vault-path-shaped hierarchyIds (matching real usage) — a root meristem with
// two direct liefs.
const tree: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    children: [
      { id: "root/a.md", name: "a" },
      { id: "root/b.md", name: "b" },
    ],
  },
};

// Mirrors the mount-construction preamble other mount tests use (e.g.
// highlightNodes in mount-plant.test.ts): a fresh container + a real build()
// plant, mounted with defaults. Exposes the lit set via the read-only
// debugLitBlockIds() handle accessor (the litBlockIds getter handed to the
// cascade is internal to mount-plant.ts and not otherwise reachable).
function mountFixture() {
  const plant = build(tree, undefined, defaultEngineConfig);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const handle = mountPlant(container, plant);
  const litIds = () => handle.debugLitBlockIds();
  const blockIdFor = (hierarchyId: string): string => {
    const block = plant.blocks.find(
      (b) => (b as { hierarchyId?: string }).hierarchyId === hierarchyId,
    );
    if (!block) throw new Error(`no block for ${hierarchyId}`);
    return block.id;
  };
  return { handle, litIds, blockIdFor };
}

describe("selection light", () => {
  test("is off by default in the mount until the host enables it", () => {
    const { handle, litIds } = mountFixture();
    handle.selectNode("root/a.md");
    expect([...litIds()]).toEqual([]);
  });

  test("a selected node becomes lit once enabled", () => {
    const { handle, litIds, blockIdFor } = mountFixture();
    handle.setSelectionLight(true);
    handle.selectNode("root/a.md");
    expect([...litIds()]).toEqual([blockIdFor("root/a.md")]);
  });

  test("selecting another node moves the light, never accumulates", () => {
    const { handle, litIds, blockIdFor } = mountFixture();
    handle.setSelectionLight(true);
    handle.selectNode("root/a.md");
    handle.selectNode("root/b.md");
    expect([...litIds()]).toEqual([blockIdFor("root/b.md")]);
  });

  test("multi-select lights the whole set", () => {
    const { handle, litIds } = mountFixture();
    handle.setSelectionLight(true);
    handle.highlightNodes(["root/a.md", "root/b.md"]);
    expect([...litIds()].length).toBe(2);
  });

  test("disabling clears the lit set immediately", () => {
    const { handle, litIds } = mountFixture();
    handle.setSelectionLight(true);
    handle.selectNode("root/a.md");
    handle.setSelectionLight(false);
    expect([...litIds()]).toEqual([]);
  });
});
