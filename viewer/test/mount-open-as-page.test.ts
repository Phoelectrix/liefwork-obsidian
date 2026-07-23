import { describe, expect, test } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).
//
// Unlike mount-plant.test.ts, this file does NOT mock agent-tint.ts or
// unfurl-live-sweep.ts: getUnfurlState/restoreUnfurlState/revealNode never
// call setAgentTints (so applyAgentTintsInternal's resolveAgentTints call is
// never reached — cachedTintColorsByPath stays empty) and never go through
// toggleFurlByNode's animated unfurl/furl path (so runLiveSweep is never
// invoked) — they mutate `furled` and rebuild directly. Bun's mock.module
// hot-swaps the shared module cache for the rest of the `bun test` process,
// so an unneeded mock here would risk leaking into unrelated files (e.g.
// agent-tint.test.ts) depending on file scheduling — skip it, nothing in
// this file needs it.

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

import { mountPlant, type MountHandlers } from "../src/mount-plant.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { injectAffordanceLiefs } from "../../scripts/lib/inject-affordance-liefs.ts";
import type { Plant } from "../../src/types.ts";

// Same fixture shape as mount-plant.test.ts's furlTree: `a` is a deep furlable
// branch (furled on landing at initialDepth 1), `b` is a plain leaf sibling.
const furlTree: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    children: [
      {
        id: "a",
        name: "a",
        children: [
          { id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }, { id: "a1y", name: "a1y" }] },
          { id: "a2", name: "a2" },
        ],
      },
      { id: "b", name: "b" },
    ],
  },
};

const injected = injectAffordanceLiefs(furlTree, { expandLabel: "expand", furlLabel: "furl" });

function mountDeepUnfurl(initialDepth = 1, handlers: MountHandlers = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const full = build(injected, undefined, defaultEngineConfig) as unknown as Plant;
  const handle = mountPlant(
    container,
    full,
    { unfurl: { enabled: true, initialDepth } },
    handlers,
    { unfurl: { hierarchy: injected, engineConfig: defaultEngineConfig } },
  );
  return { handle, container };
}

describe("mount open-as-page state", () => {
  test("getUnfurlState + restoreUnfurlState round-trip", () => {
    const { handle } = mountDeepUnfurl(1);

    // Landing state at initialDepth 1: `a` is furled, so it is the only
    // furlable node NOT yet revealed.
    const before = handle.getUnfurlState();

    // Reveal `a` — a real, furlable node-id from the fixture (its hierarchyId
    // IS its node-id in build-per-state mode).
    handle.revealNode("a");
    const after = handle.getUnfurlState();
    expect(after).not.toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("a");
    expect(before).not.toContain("a");

    // Round-trip back to the pre-reveal state.
    handle.restoreUnfurlState(before);
    expect(handle.getUnfurlState().sort()).toEqual([...before].sort());

    // And forward again to the revealed state.
    handle.restoreUnfurlState(after);
    expect(handle.getUnfurlState().sort()).toEqual([...after].sort());

    handle.destroy();
  });

  test("revealNode frames the target without leaving it furled", () => {
    const { handle } = mountDeepUnfurl(1);
    expect(handle.isFurled(handle.getPlant().blocks.find(
      (b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === "a",
    )!.branchId)).toBe(true);

    handle.revealNode("a");

    const branchIdA = handle.getPlant().blocks.find(
      (b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === "a",
    )!.branchId;
    expect(handle.isFurled(branchIdA)).toBe(false);
    handle.destroy();
  });

  test("onUnfurlChange fires on reveal", () => {
    let fired = 0;
    const { handle } = mountDeepUnfurl(1, { onUnfurlChange: () => fired++ });
    handle.revealNode("a");
    expect(fired).toBeGreaterThan(0);
    handle.destroy();
  });
});
