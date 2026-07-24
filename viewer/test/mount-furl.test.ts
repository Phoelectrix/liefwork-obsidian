import { describe, test, expect } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// ── Pure-transition tests (Task-4 fixtures) ─────────────────────────────────
// `mountPlant`'s toggleFurl delegates directly to these pure helpers; this
// section pins the exact reveal/collapse semantics it relies on.
import type { Plant, Branch, Block, LiefBlock, MeristemBlock } from "../../src/types.ts";
import {
  seedFurledByDepth,
  hiddenBranchIds,
  unfurlOneLevel,
  furlBranch,
} from "../src/furl-tree.ts";

function makeBranch(id: string, parentBranchId: string | null, depth: number): Branch {
  return {
    id,
    parentBranchId,
    parentBranchNodeId: null,
    depth,
    shortSide: 1,
    departureAngle: 0,
    blockIds: [],
    curve: { type: "straight", arcLength: 10, originAngle: 0 },
    arcLength: 10,
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  };
}

function makePlant(branches: Branch[], blocks: Block[] = []): Plant {
  return {
    schemaVersion: "1.0.0",
    id: "fake",
    metadata: {
      builtAt: "",
      engineVersion: "",
      configHash: "",
      hierarchyHash: "",
      counts: { events: 0, blocks: blocks.length, branches: branches.length },
    },
    config: {} as Plant["config"],
    events: [],
    anchor: { position: { x: 0, y: 0 }, orientationAngle: 0 },
    stemBranchId: branches[0]?.id ?? "root",
    branches,
    blocks,
    rings: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  } satisfies Plant;
}

// root(0) -> a(1) -> a1(2) -> a1x(3); root(0) -> b(1) [leaf]
function buildTree() {
  const root = makeBranch("root", null, 0);
  const a = makeBranch("a", "root", 1);
  const a1 = makeBranch("a1", "a", 2);
  const a1x = makeBranch("a1x", "a1", 3);
  const b = makeBranch("b", "root", 1);
  const plant = makePlant([root, a, a1, a1x, b]);
  return { plant };
}

describe("mount-plant furl transitions (pure delegate helpers)", () => {
  test("unfurlOneLevel reveals direct children furled; grandchildren stay hidden", () => {
    const { plant } = buildTree();
    const seed = seedFurledByDepth(plant, 1);
    const next = unfurlOneLevel(plant, seed, "a");
    expect(hiddenBranchIds(plant, next).has("a1")).toBe(false); // a1 now visible…
    expect(next.has("a1")).toBe(true);                          // …as a furled boundary (its own children stay hidden)
    expect(hiddenBranchIds(plant, next).has("a1x")).toBe(true);
  });

  test("furlBranch re-collapses a branch's children", () => {
    const { plant } = buildTree();
    expect(hiddenBranchIds(plant, furlBranch(new Set(), "a")).has("a1")).toBe(true);
  });
});

// ── Live-DOM mount smoke tests ──────────────────────────────────────────────
// A real DOM mount harness DOES exist (viewer/test/mount-set-camera.test.ts,
// viewer/test/mount-render-snapshot.test.ts) — reuse its canvas-mocking setup
// so this task's mount-level API (toggleFurl/unfurlAll/furlAll/isFurled/
// isFurlable) is exercised end to end, not just at the pure-helper level.

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
  if (contextType === "2d") return mockCanvasContext as any;
  return null;
};

import { mountPlant } from "../src/mount-plant.ts";
import { build } from "../../src/library/index.ts";
import { defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";

// root -> a -> a1 -> a1x (leaf); root -> b (leaf). A single-child folder
// collapses into a lief on its parent's branch (the engine only spins up a
// new BRANCH when there's a sibling to fan, per place.ts), so this fixture
// needs a two-deep nest under "a" to force "a" into its own furlable branch
// (a direct child branch "a1") while "a1" itself stays a leaf branch (its
// child "a1x" collapses to a lief, no further branch) — and "b" collapses
// straight onto root, never becoming a branch at all.
const nested: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    children: [
      {
        id: "a",
        name: "a",
        children: [{ id: "a1", name: "a1", children: [{ id: "a1x", name: "a1x" }] }],
      },
      { id: "b", name: "b" },
    ],
  },
};

describe("PlantMountHandle furl API — default-off (disabled)", () => {
  test("every method no-ops when unfurl.enabled is false (default)", () => {
    const plant = build(nested, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);

    const aBranch = plant.branches.find((b) => b.depth === 1 && b.parentBranchId !== null);
    expect(aBranch).toBeDefined();
    const aId = aBranch!.id;

    expect(handle.isFurled(aId)).toBe(false);
    handle.toggleFurl(aId);
    expect(handle.isFurled(aId)).toBe(false); // no-op: disabled
    handle.furlAll();
    expect(handle.isFurled(aId)).toBe(false); // no-op: disabled

    handle.destroy();
  });
});

// ── Determinism guard (Task 10) ─────────────────────────────────────────────
// The frozen/`?plain`/plugin path must NEVER take the build-per-state unfurl
// branch (Task 9a) — it stays on the original visibility-gating-only mount,
// byte-identical to pre-unfurl behaviour. `getPlant()` reference identity is
// the tell: build-per-state calls `build()` again on every furl change,
// which always returns a NEW Plant object; the legacy/frozen path only
// mutates the hidden-id gate and never touches `plant` at all.
describe("Determinism guard — frozen/legacy path never rebuilds (Task 10)", () => {
  test("no mountOptions.unfurl: getPlant() stays the EXACT object passed in (the frozen/?plain/plugin call shape — no build-per-state engaged)", () => {
    const plant = build(nested, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant); // no stylingOverrides, no mountOptions
    expect(handle.getPlant()).toBe(plant);
    handle.destroy();
  });

  test("styling.unfurl.enabled=true but no mountOptions.unfurl (legacy visibility-gating, Task 5): toggleFurl hides/reveals blocks WITHOUT rebuilding — getPlant() stays the same object", () => {
    const plant = build(nested, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant, { unfurl: { enabled: true, initialDepth: 1 } });
    const aBranch = plant.branches.find((br) =>
      plant.blocks.some((b) => b.branchId === br.id && b.kind === "meristem" && (b as any).name === "a"),
    );
    const aId = aBranch!.id;
    expect(handle.getPlant()).toBe(plant);
    handle.toggleFurl(aId);
    expect(handle.isFurled(aId)).toBe(false);
    expect(handle.getPlant()).toBe(plant); // still the SAME object — gated, not rebuilt
    handle.destroy();
  });
});

describe("PlantMountHandle furl API — enabled", () => {
  test("mount seeds furled state; toggleFurl/unfurlAll/furlAll/isFurled/isFurlable", () => {
    const plant = build(nested, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant, { unfurl: { enabled: true, initialDepth: 1 } });

    // "a" (its meristem named "a") is the furlable branch (has direct child
    // branch "a1"); "a1" (meristem named "a1") is a leaf branch (its own
    // child "a1x" collapsed to a lief, no further branch) — not furlable.
    const aBranch = plant.branches.find((br) =>
      plant.blocks.some((b) => b.branchId === br.id && b.kind === "meristem" && (b as any).name === "a"),
    );
    const a1Branch = plant.branches.find((br) =>
      plant.blocks.some((b) => b.branchId === br.id && b.kind === "meristem" && (b as any).name === "a1"),
    );
    expect(aBranch).toBeDefined();
    expect(a1Branch).toBeDefined();
    const aId = aBranch!.id;
    const a1Id = a1Branch!.id;

    // Seeded at mount: "a" (furlable, depth>=1) starts furled; "a1" (leaf
    // branch) is not furlable so never furled.
    expect(handle.isFurlable(aId)).toBe(true);
    expect(handle.isFurlable(a1Id)).toBe(false);
    expect(handle.isFurled(aId)).toBe(true);

    // toggleFurl unfurls a furled branch.
    handle.toggleFurl(aId);
    expect(handle.isFurled(aId)).toBe(false);

    // toggleFurl furls it back.
    handle.toggleFurl(aId);
    expect(handle.isFurled(aId)).toBe(true);

    // unfurlAll clears all furl state.
    handle.unfurlAll();
    expect(handle.isFurled(aId)).toBe(false);

    // furlAll re-seeds to initialDepth.
    handle.furlAll();
    expect(handle.isFurled(aId)).toBe(true);

    handle.destroy();
  });
});
