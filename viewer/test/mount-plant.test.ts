import { describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// Spy on resolveAgentTints by mocking the (tiny, pure) agent-tint module — NOT
// the whole skeleton-canvas module, so every other test in this file keeps
// using the real skeleton/panzoom/projection pipeline untouched. Nothing else
// in mount-plant.test.ts calls setAgentTints, so mocking this for the whole
// file is safe. Must be declared BEFORE importing mount-plant.ts (module mocks
// apply at import-resolution time).
const resolveAgentTintsCalls: Array<{ plantBlockIds: string[]; colorsByPath: Map<string, string[]> }> = [];
mock.module("../src/agent-tint.ts", () => ({
  resolveAgentTints: (plant: { blocks: Array<{ id: string }> }, colorsByPath: Map<string, string[]>) => {
    resolveAgentTintsCalls.push({
      plantBlockIds: plant.blocks.map((b) => b.id),
      colorsByPath,
    });
    return { meristemColorsByBlockId: new Map(), stemColorsByBranchId: new Map() };
  },
}));

// Spy on the live-sweep driver by mocking the (small) unfurl-live-sweep module:
// the UNFURL wiring becomes observable (captured LiveSweepArgs + a per-call
// cancel spy) without driving a real rAF clock, and the mount's synchronous
// state update (rebuildForFurl) is untouched. The fake handle settles `done`
// immediately. Declared BEFORE importing mount-plant.ts (module mocks apply at
// import-resolution time). bun restores mock.module per test file, so the real
// runLiveSweep tests (unfurl-live-sweep.test.ts) are unaffected.
const liveSweepCalls: Array<{ args: any; cancel: ReturnType<typeof mock> }> = [];
mock.module("../src/unfurl-live-sweep.ts", () => ({
  SWEEP_MS: 1300,
  PHASE_SPLIT: 0.6,
  runLiveSweep: (args: any) => {
    const cancel = mock(() => {});
    liveSweepCalls.push({ args, cancel });
    return { cancel, done: Promise.resolve() };
  },
}));

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

import {
  mountPlant,
  buildProjectionConfigMap,
  applyLiefAngleOverrides,
  subtreeLabelBlockIds,
  framedBoundsForBranch,
} from "../src/mount-plant.ts";
import {
  liefLabelRevealFactor,
  clampUnitInterval,
  scopedLabelRevealFactor,
  clampFontToPeak,
} from "../src/skeleton-canvas.ts";
import { mergeStylingConfig } from "../src/styling.ts";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { injectAffordanceLiefs } from "../../scripts/lib/inject-affordance-liefs.ts";
import { computeFitTransform } from "../src/fit.ts";
import { fitLabelInsetPx } from "../src/skeleton-canvas.ts";
// The mount reserves the root title height (+ any screen lift) on every side
// (pan-zoom extraInsetPx) — the independent fit must reserve the same.
const labelInsets = (em: number) => { const i = fitLabelInsetPx(em); return { top: i, right: i, bottom: i, left: i }; };
import { expandBounds } from "../src/frame.ts";
import type { Plant } from "../../src/types.ts";

const tree: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    children: [
      { id: "a", name: "a", children: [{ id: "a1", name: "a1" }, { id: "a2", name: "a2" }] },
      { id: "b", name: "b" },
    ],
  },
};

function liefIds(plant: ReturnType<typeof build>): string[] {
  return plant.blocks.filter((b) => b.kind === "lief").map((b) => b.id);
}

describe("applyLiefAngleOverrides (pure)", () => {
  test("overrides only the listed lief's liefRelativeAngle, leaving others and the input map untouched", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const styling = mergeStylingConfig({});
    const map = buildProjectionConfigMap(plant, styling);

    const ids = liefIds(plant);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const [targetId, otherId] = ids;

    const originalTarget = map.get(targetId!)!.liefRelativeAngle;
    const originalOther = map.get(otherId!)!.liefRelativeAngle;
    const override = originalTarget + 0.75; // distinct radian value

    const out = applyLiefAngleOverrides(map, new Map([[targetId!, override]]));

    // Overridden entry carries the new angle.
    expect(out.get(targetId!)!.liefRelativeAngle).toBe(override);
    // Sibling lief is unchanged.
    expect(out.get(otherId!)!.liefRelativeAngle).toBe(originalOther);
    // Purity: the input map (and its config object) is not mutated.
    expect(map.get(targetId!)!.liefRelativeAngle).toBe(originalTarget);
  });

  test("returns the same map (no clone) when the override map is empty or undefined", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const map = buildProjectionConfigMap(plant, mergeStylingConfig({}));
    expect(applyLiefAngleOverrides(map, undefined)).toBe(map);
    expect(applyLiefAngleOverrides(map, new Map())).toBe(map);
  });

  test("ignores ids not present in the projection map", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const map = buildProjectionConfigMap(plant, mergeStylingConfig({}));
    const out = applyLiefAngleOverrides(map, new Map([["no-such-id", 1.23]]));
    expect(out.has("no-such-id")).toBe(false);
    expect(out.size).toBe(map.size);
  });
});

// ── Build-per-state unfurl (Task 9a) ────────────────────────────────────────
// A tree with a DEEP furlable branch: `a` is furlable (it has children), so
// seeding at initialDepth 1 furls `a` on the landing — and a furled `a` must
// have its real descendants (a1x/a1y/a2) ABSENT from the built plant, not
// merely hidden. `a1` is itself a lief-only branch (children a1x/a1y are
// leaves) — under the "any children" furlable rule it is ALSO furlable, so
// unfurling `a` one level lands `a1` as its own furled stub (progressive
// disclosure), not its real liefs in full.
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

const hasNode = (plant: Plant, hid: string): boolean =>
  plant.blocks.some((b) => (b as { hierarchyId?: string }).hierarchyId === hid);
const meristemBranchId = (plant: Plant, hid: string): string | undefined =>
  plant.blocks.find((b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === hid)
    ?.branchId;

function mountUnfurl(initialDepth = 1) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const full = build(injected, undefined, defaultEngineConfig) as unknown as Plant;
  const handle = mountPlant(
    container,
    full,
    { unfurl: { enabled: true, initialDepth } },
    {},
    { unfurl: { hierarchy: injected, engineConfig: defaultEngineConfig } },
  );
  return { handle, container };
}

describe("mountPlant build-per-state unfurl (Task 9a)", () => {
  test("(a) landing plant is furled — a deep furlable branch's real liefs are ABSENT", () => {
    const { handle } = mountUnfurl(1);
    const landing = handle.getPlant();
    // `a` is furled on the landing: its real descendants are not built at all.
    expect(hasNode(landing, "a1x")).toBe(false);
    expect(hasNode(landing, "a1y")).toBe(false);
    expect(hasNode(landing, "a2")).toBe(false);
    // But `a`'s own meristem + `b` (unfurled siblings) are present.
    expect(hasNode(landing, "a")).toBe(true);
    expect(hasNode(landing, "b")).toBe(true);
    handle.destroy();
  });

  test("(b) toggleFurl on a furled node reveals its direct liefs; a lief-only child now lands as its own furled stub; toggling back removes everything", async () => {
    const { handle } = mountUnfurl(1);
    const branchId = meristemBranchId(handle.getPlant(), "a")!;
    expect(branchId).toBeDefined();

    handle.toggleFurl(branchId); // unfurl `a` one level
    const opened = handle.getPlant();
    // `a1` is itself furlable now (lief-only branch), so progressive
    // disclosure lands it as a furled stub — its own real liefs (a1x/a1y)
    // stay absent until `a1` is unfurled too.
    expect(hasNode(opened, "a1x")).toBe(false);
    expect(hasNode(opened, "a1y")).toBe(false);
    expect(hasNode(opened, "a1")).toBe(true);
    // `a2` is a genuine leaf (no children) — not furlable — so it is
    // revealed in full alongside `a`'s other direct children.
    expect(hasNode(opened, "a2")).toBe(true);

    // Unfurling `a1` itself reveals its real liefs.
    const branchIdA1 = meristemBranchId(opened, "a1")!;
    expect(branchIdA1).toBeDefined();
    handle.toggleFurl(branchIdA1);
    const openedFully = handle.getPlant();
    expect(hasNode(openedFully, "a1x")).toBe(true);
    expect(hasNode(openedFully, "a1y")).toBe(true);

    // Branch ids are not stable across a rebuild — re-resolve by node id.
    const branchId2 = meristemBranchId(handle.getPlant(), "a")!;
    handle.toggleFurl(branchId2); // furl `a` again — now an animated reverse
    // sweep; the collapse is DEFERRED to the (mocked, immediate) sweep's done,
    // so flush the microtask before asserting the collapsed state.
    await Promise.resolve();
    const closed = handle.getPlant();
    expect(hasNode(closed, "a1x")).toBe(false);
    expect(hasNode(closed, "a2")).toBe(false);
    handle.destroy();
  });

  test("(c) isFurled / isFurlable via branchId reflect state", () => {
    const { handle } = mountUnfurl(1);
    const branchId = meristemBranchId(handle.getPlant(), "a")!;
    expect(handle.isFurlable(branchId)).toBe(true);
    expect(handle.isFurled(branchId)).toBe(true);

    handle.toggleFurl(branchId); // unfurl
    const branchId2 = meristemBranchId(handle.getPlant(), "a")!;
    expect(handle.isFurled(branchId2)).toBe(false);
    handle.destroy();
  });

  test("(d) unfurlAll clears furl-state — every real lief is present", () => {
    const { handle } = mountUnfurl(1);
    handle.unfurlAll();
    const open = handle.getPlant();
    expect(hasNode(open, "a1x")).toBe(true);
    expect(hasNode(open, "a1y")).toBe(true);
    expect(hasNode(open, "a2")).toBe(true);
    handle.destroy();
  });
});

// ── Fix 1: agent tints must survive a furl rebuild ─────────────────────────
// rebuildForFurl() assigns fresh, ephemeral block/branch ids every time. The
// mount must cache the last colorsByPath passed to setAgentTints and RE-APPLY
// it (re-resolving against the NEW plant's ids) after every rebuild — verified
// here via the resolveAgentTints spy above.
describe("PlantMountHandle.setAgentTints — cached re-apply across furl rebuild (Fix 1)", () => {
  test("re-applies the last colorsByPath against the freshly rebuilt plant", () => {
    resolveAgentTintsCalls.length = 0;
    const { handle } = mountUnfurl(1);
    const colorsByPath = new Map<string, string[]>([["a", ["#fff"]]]);

    handle.setAgentTints(colorsByPath);
    expect(resolveAgentTintsCalls.length).toBe(1);
    expect(resolveAgentTintsCalls[0]!.colorsByPath).toBe(colorsByPath);
    const plantBlockIdsBefore = resolveAgentTintsCalls[0]!.plantBlockIds;

    const branchId = meristemBranchId(handle.getPlant(), "a")!;
    handle.toggleFurl(branchId); // triggers rebuildForFurl -> brand-new block ids

    // A second resolveAgentTints call, carrying the SAME cached colorsByPath,
    // but resolved against the NEW plant (different block ids than before).
    expect(resolveAgentTintsCalls.length).toBe(2);
    expect(resolveAgentTintsCalls[1]!.colorsByPath).toBe(colorsByPath);
    expect(resolveAgentTintsCalls[1]!.plantBlockIds).not.toEqual(plantBlockIdsBefore);

    handle.destroy();
  });

  test("never re-applies when no tints were ever set (avoids needless work)", () => {
    resolveAgentTintsCalls.length = 0;
    const { handle } = mountUnfurl(1);
    const branchId = meristemBranchId(handle.getPlant(), "a")!;
    handle.toggleFurl(branchId);
    expect(resolveAgentTintsCalls.length).toBe(0);
    handle.destroy();
  });
});

// ── Fix 2: progressive disclosure with a furlable grandchild ───────────────
// The `furlTree` fixture above (Task 9a/(b)) already exercises this with a
// lief-only direct child (`a1`). This fixture goes one level deeper: `b`'s
// own child `c` is itself a branch (`c` -> `d`), so `b` is furlable AND has
// furlable descendants beyond one hop — exercising the "add direct furlable
// children as furled stubs" branch of toggleFurlByNode.
const deepTree: HierarchyInput = {
  root: {
    id: "root",
    name: "root",
    children: [
      {
        id: "a",
        name: "a",
        children: [
          {
            id: "b",
            name: "b",
            children: [{ id: "c", name: "c", children: [{ id: "d", name: "d" }] }],
          },
          { id: "l", name: "l" },
        ],
      },
    ],
  },
};
const deepInjected = injectAffordanceLiefs(deepTree, { expandLabel: "expand", furlLabel: "furl" });

function mountDeepUnfurl(initialDepth = 1) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const full = build(deepInjected, undefined, defaultEngineConfig) as unknown as Plant;
  const handle = mountPlant(
    container,
    full,
    { unfurl: { enabled: true, initialDepth } },
    {},
    { unfurl: { hierarchy: deepInjected, engineConfig: defaultEngineConfig } },
  );
  return { handle, container };
}

describe("mountPlant progressive disclosure — furlable grandchild (Fix 2)", () => {
  test("unfurling `a` reveals its direct liefs AND leaves furlable child `b` as a furled stub", () => {
    const { handle } = mountDeepUnfurl(1);
    // Landing: `a` is furled — nothing beneath it is built at all.
    const landing = handle.getPlant();
    expect(hasNode(landing, "b")).toBe(false);
    expect(hasNode(landing, "l")).toBe(false);

    const branchIdA = meristemBranchId(landing, "a")!;
    expect(branchIdA).toBeDefined();
    handle.toggleFurl(branchIdA); // unfurl `a` one level

    const opened = handle.getPlant();
    // (a) `a`'s direct liefs/children are revealed.
    expect(hasNode(opened, "l")).toBe(true);
    expect(hasNode(opened, "b")).toBe(true);

    // (b) `b` itself is furlable, so it lands as a FURLED STUB: its own
    // meristem is present, but its real deep descendants (c, d) are ABSENT —
    // only b's meristem + injected "click to expand" affordance are built.
    expect(hasNode(opened, "c")).toBe(false);
    expect(hasNode(opened, "d")).toBe(false);

    const branchIdB = meristemBranchId(opened, "b")!;
    expect(branchIdB).toBeDefined();
    expect(handle.isFurlable(branchIdB)).toBe(true);
    expect(handle.isFurled(branchIdB)).toBe(true);

    handle.destroy();
  });
});

// ── Live-sweep unfurl wiring (Task 6) ───────────────────────────────────────
// UNFURL drives the live-sweep driver (runLiveSweep, mocked above so the wiring
// is observable without a real rAF clock). We assert: the unfurl INITIATES a
// live sweep on node N with working buildFrame/render closures that rebuild
// with a sparse growthFactor/foldFactor override on N; mount state is ALREADY
// the instant-9a natural target synchronously; FURL of an OPEN node now
// initiates a REVERSE sweep (deferring its collapse to done, tune-reverse-furl);
// and a genuine user input mid-sweep cancels it.
describe("mountPlant live-sweep unfurl wiring (Task 6)", () => {
  test("unfurl initiates a live sweep on node N (buildFrame rebuilds with overrides[N], render paints); state == instant-9a target; FURL initiates a reverse sweep", async () => {
    liveSweepCalls.length = 0;
    const { handle } = mountDeepUnfurl(1);
    const nodeId = "a";
    const branchIdA = meristemBranchId(handle.getPlant(), nodeId)!;

    const before = liveSweepCalls.length;
    handle.toggleFurl(branchIdA); // UNFURL `a` → live sweep

    // (1) runLiveSweep was invoked once, for node N, with the driver closures.
    expect(liveSweepCalls.length).toBe(before + 1);
    const call = liveSweepCalls[liveSweepCalls.length - 1]!;
    expect(call.args.nodeId).toBe(nodeId);
    expect(typeof call.args.buildFrame).toBe("function");
    expect(typeof call.args.render).toBe("function");

    // (2) mount's held plant is already the instant-9a natural target.
    const opened = handle.getPlant();
    expect(hasNode(opened, "l")).toBe(true);
    expect(hasNode(opened, "b")).toBe(true);
    expect(hasNode(opened, "c")).toBe(false); // `b` lands as a furled stub

    // (3) buildFrame rebuilds with the sparse fold/growth override on N. Full-
    //     open (growthFactor/foldFactor 1 = identity) reproduces the natural
    //     block set; a folded/ungrown frame (0) changes the geometry — proving
    //     overrides[N] threads through to build().
    const full = call.args.buildFrame({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    const stub = call.args.buildFrame({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 });
    expect(full.blocks.length).toBe(opened.blocks.length);
    expect(JSON.stringify(stub.bounds)).not.toBe(JSON.stringify(full.bounds));

    // (4) render paints a frame (setLiefTextReveal + lief fold-out) without throwing.
    expect(() => call.args.render(full, { textRevealFrac: 1 })).not.toThrow();
    expect(() => call.args.render(stub, { textRevealFrac: 0 })).not.toThrow();

    // (5) FURL back now ANIMATES in reverse: it schedules a NEW sweep with
    //     reverse:true and DEFERS the collapse to that sweep's done. The held
    //     plant stays OPEN synchronously; after the (mocked, immediate) sweep
    //     settles it collapses (descendants absent).
    const branchIdA2 = meristemBranchId(handle.getPlant(), nodeId)!;
    const beforeFurl = liveSweepCalls.length;
    handle.toggleFurl(branchIdA2); // FURL `a`
    expect(liveSweepCalls.length).toBe(beforeFurl + 1);
    expect(liveSweepCalls[liveSweepCalls.length - 1]!.args.reverse).toBe(true);
    expect(hasNode(handle.getPlant(), "l")).toBe(true); // unchanged synchronously
    await Promise.resolve(); // flush the deferred collapse
    expect(hasNode(handle.getPlant(), "l")).toBe(false);

    handle.destroy();
  });

  test("a genuine user input mid-sweep cancels the in-flight live sweep", () => {
    liveSweepCalls.length = 0;
    const { handle, container } = mountDeepUnfurl(1);
    const branchIdA = meristemBranchId(handle.getPlant(), "a")!;

    handle.toggleFurl(branchIdA); // UNFURL → sweep in flight
    const call = liveSweepCalls[liveSweepCalls.length - 1]!;
    expect(call.cancel).not.toHaveBeenCalled();

    // A real pointerdown steals the camera → cancels the in-flight sweep.
    const svg = container.querySelector("svg")!;
    svg.dispatchEvent(new Event("pointerdown"));
    expect(call.cancel).toHaveBeenCalled();

    handle.destroy();
  });
});

// ── Camera-then-growth sequencing (tune-camera-sequence) ───────────────────
// Grow-in-place choreography: on UNFURL the growth sweep starts IMMEDIATELY
// (startDelayMs 0 — no camera hold), so the coral grows in whatever view it is
// already in with no jumpy camera motion; the camera's single move (recentre on
// the branch) happens on the sweep's settle instead. `runLiveSweep` stays mocked
// (its own Phase-A/B timing is covered by unfurl-live-sweep.test.ts) — this suite
// proves the WIRING: the sweep starts unheld, and the camera is genuinely invoked
// and correctly targeted on settle (a REAL pan-zoom tween, awaited — no module
// mock stands in for it, since an earlier attempt at partially mocking
// pan-zoom.ts here left the mock leaking into LATER test files' real pan/zoom
// pipeline — see the note on that below).
describe("mountPlant grow-in-place, recentre-on-settle sequencing (tune-camera-sequence)", () => {
  test("unfurl starts the growth sweep immediately (in place), then recentres the camera on the branch after it settles", async () => {
    liveSweepCalls.length = 0;
    const { handle, container } = mountDeepUnfurl(1);

    // Force a real viewport size: happy-dom's clientWidth/Height default to 0,
    // which would make refitAnimated's viewportUsable check bail (retry loop,
    // never computing/settling) — same workaround as the "at reveal 0" test
    // below, applied to the <svg> instead of the <canvas>.
    const svg = container.querySelector("svg")!;
    Object.defineProperty(svg, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(svg, "clientHeight", { value: 600, configurable: true });

    const nodeId = "a";
    const branchIdA = meristemBranchId(handle.getPlant(), nodeId)!;
    const before = liveSweepCalls.length;

    handle.toggleFurl(branchIdA); // UNFURL `a` — camera move + (mocked) growth sweep

    // Grow-in-place: the sweep starts IMMEDIATELY (unheld) — the camera no longer
    // moves before growth; it recentres on settle (asserted below via the settled
    // transform).
    expect(liveSweepCalls.length).toBe(before + 1);
    const call = liveSweepCalls[liveSweepCalls.length - 1]!;
    expect(call.args.startDelayMs).toBe(0);

    // The stub/render closures threaded into the sweep are the SAME ones
    // toggleFurlByNode uses for its one-off stub paint (growthFactor 0 = a
    // fully-closed frame, distinct from the natural full-open target) — the
    // shape of the "camera-first, stub-not-flash" contract.
    const naturalFrame = call.args.buildFrame({ growthFactor: 1, foldFactor: 1, liefAngleFrac: 1 });
    const stubFrame = call.args.buildFrame({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 });
    expect(JSON.stringify(stubFrame.bounds)).not.toBe(JSON.stringify(naturalFrame.bounds));
    expect(() => call.args.render(stubFrame, { textRevealFrac: 0 })).not.toThrow();

    // Wait past the camera's real 750ms tween (CAMERA_MS), then compare the
    // settled <g> transform against an INDEPENDENTLY computed fit for the same
    // branch bounds/pad (frameNodeInternal's expandBounds(..., 1.5)) — proving
    // the camera was genuinely invoked AND correctly targeted, not just that a
    // number got threaded through.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const opened = handle.getPlant();
    const branchIdOpened = meristemBranchId(opened, nodeId)!;
    const FIT_PADDING = 0.12; // mirrors pan-zoom.ts's internal (unexported) constant
    // Label-inclusive framing bounds (frameNodeInternal → framedBoundsForBranch),
    // matching the mount's styling (mergeStylingConfig with the unfurl override).
    const camStyling = mergeStylingConfig({ unfurl: { enabled: true, initialDepth: 1 } });
    const expected = computeFitTransform(
      expandBounds(
        framedBoundsForBranch(opened, camStyling, buildProjectionConfigMap(opened, camStyling), branchIdOpened),
        1.5,
      ),
      { width: 800, height: 600 },
      labelInsets(camStyling.projection.meristemLiftEm),
      FIT_PADDING,
    );

    const g = container.querySelector("g")!;
    const m = g.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(expected.tx, 0);
    expect(Number(m![2])).toBeCloseTo(expected.ty, 0);
    expect(Number(m![3])).toBeCloseTo(expected.scale, 2);

    // End-state: the mount's held plant is already the natural target (9a
    // instant-state contract unchanged by the sequencing).
    expect(opened.blocks.length).toBe(naturalFrame.blocks.length);
    expect(hasNode(opened, "l")).toBe(true);
    expect(hasNode(opened, "b")).toBe(true);

    handle.destroy();
  }, 3000);

  test("FURL of an open node initiates a reverse sweep (no camera startDelayMs — the branch is already framed)", () => {
    liveSweepCalls.length = 0;
    const { handle } = mountDeepUnfurl(1);
    const branchIdA = meristemBranchId(handle.getPlant(), "a")!;
    handle.toggleFurl(branchIdA); // UNFURL first, so there's something to furl back

    const before = liveSweepCalls.length;
    const branchIdA2 = meristemBranchId(handle.getPlant(), "a")!;
    handle.toggleFurl(branchIdA2); // FURL `a` back — animated reverse sweep

    expect(liveSweepCalls.length).toBe(before + 1);
    const furlCall = liveSweepCalls[liveSweepCalls.length - 1]!;
    expect(furlCall.args.reverse).toBe(true);
    // Reverse furl needs no camera hold — the branch is already framed.
    expect(furlCall.args.startDelayMs ?? 0).toBe(0);

    handle.destroy();
  });
});

// ── Reverse-furl collapse (tune-reverse-furl) ──────────────────────────────
// Furling an OPEN node plays the unfurl IN REVERSE (fold up + shrink to a
// stub), then collapses the true furled hierarchy on the sweep's `done`. The
// furl-state must NOT change until done (the branch stays open so buildFrame
// renders the open geometry to animate from); after done the descendants are
// ABSENT and the PARENT branch is reframed. A mid-furl user input cancels it
// (and, being an abort, leaves the branch open — the guard skips the collapse).
describe("mountPlant reverse-furl collapse (tune-reverse-furl)", () => {
  test("furling an open node defers the collapse to the sweep's done, then removes descendants and reframes the parent", async () => {
    liveSweepCalls.length = 0;
    const { handle, container } = mountDeepUnfurl(1);

    // Real viewport so refitAnimated (the parent reframe) can compute/settle.
    const svg = container.querySelector("svg")!;
    Object.defineProperty(svg, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(svg, "clientHeight", { value: 600, configurable: true });

    // Open `a` first (its own sweep is mocked/immediate), then furl it.
    handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // UNFURL `a`
    await Promise.resolve();
    expect(hasNode(handle.getPlant(), "l")).toBe(true); // `a` is open

    const before = liveSweepCalls.length;
    handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // FURL `a`

    // A reverse sweep is scheduled; furl-state is UNCHANGED synchronously.
    expect(liveSweepCalls.length).toBe(before + 1);
    expect(liveSweepCalls[liveSweepCalls.length - 1]!.args.reverse).toBe(true);
    expect(hasNode(handle.getPlant(), "l")).toBe(true); // still open until done

    // After the (mocked, immediate) sweep settles: descendants collapse.
    await Promise.resolve();
    const collapsed = handle.getPlant();
    expect(hasNode(collapsed, "l")).toBe(false);
    expect(hasNode(collapsed, "b")).toBe(false);

    // Parent (root) is reframed — wait past the real refitAnimated tween and
    // compare the settled <g> transform to an independently computed root fit.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const rootBranchId = meristemBranchId(handle.getPlant(), "root")!;
    const FIT_PADDING = 0.12;
    const camStyling = mergeStylingConfig({ unfurl: { enabled: true, initialDepth: 1 } });
    const expected = computeFitTransform(
      expandBounds(
        framedBoundsForBranch(handle.getPlant(), camStyling, buildProjectionConfigMap(handle.getPlant(), camStyling), rootBranchId),
        1.5,
      ),
      { width: 800, height: 600 },
      labelInsets(camStyling.projection.meristemLiftEm),
      FIT_PADDING,
    );
    const g = container.querySelector("g")!;
    const m = g.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(expected.tx, 0);
    expect(Number(m![2])).toBeCloseTo(expected.ty, 0);
    expect(Number(m![3])).toBeCloseTo(expected.scale, 2);

    handle.destroy();
  }, 3000);

  test("a mid-furl user input cancels the reverse sweep and aborts the collapse (branch stays open)", async () => {
    liveSweepCalls.length = 0;
    const { handle, container } = mountDeepUnfurl(1);

    handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // UNFURL `a`
    await Promise.resolve();

    handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // FURL `a` → reverse sweep
    const furlCall = liveSweepCalls[liveSweepCalls.length - 1]!;
    expect(furlCall.args.reverse).toBe(true);
    expect(furlCall.cancel).not.toHaveBeenCalled();

    // A real pointerdown steals the camera → cancels the in-flight furl sweep.
    const svg = container.querySelector("svg")!;
    svg.dispatchEvent(new Event("pointerdown"));
    expect(furlCall.cancel).toHaveBeenCalled();

    // The collapse is aborted: the guard skips it, so the branch stays OPEN
    // even after the (mocked) done microtask flushes.
    await Promise.resolve();
    expect(hasNode(handle.getPlant(), "l")).toBe(true);

    handle.destroy();
  });

  // Regression for I1: cancelling a mid-flight REVERSE (furl) sweep must not
  // just abort the collapse (covered above) — it must also reconcile the
  // canvas's lief-text-reveal channel, which the driver's terminal render
  // (skipped from settling by the nulled `activeTransition` guard) would
  // otherwise leave wedged at the sweep's last painted (frac, scope) forever.
  // `runLiveSweep` is mocked in this file (its own `cancel()` is a no-op
  // spy — no real terminal-frame paint), so the "stuck" precondition is
  // reproduced explicitly by invoking the SAME buildFrame/render closures the
  // real driver would call on its terminal frame (established pattern —
  // see the Task 6 wiring test above), before triggering the cancel.
  test("a mid-furl user input cancels the reverse sweep AND resets the stuck lief-text-reveal channel (I1)", async () => {
    type Call = { text: string; alpha: number };
    const calls: Call[] = [];

    function makeStackfulContext() {
      const state = {
        globalAlpha: 1, fillStyle: "", font: "12px sans-serif",
        textAlign: "left", textBaseline: "top",
        strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      };
      const stack: Array<typeof state> = [];
      const ctx: any = {
        clearRect: () => {}, setTransform: () => {}, transform: () => {},
        canvas: { width: 0, height: 0 },
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        stroke: () => {}, fill: () => {},
        fillText: (text: string) => { calls.push({ text, alpha: ctx.globalAlpha }); },
        strokeText: () => {}, measureText: () => ({ width: 0 }),
        save: () => { stack.push({ ...state }); },
        restore: () => { const s = stack.pop(); if (s) Object.assign(state, s); },
        scale: () => {}, translate: () => {}, rotate: () => {},
        drawImage: () => {}, beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo() {},
        bezierCurveTo: () => {}, quadraticCurveTo: () => {}, arc: () => {}, arcTo: () => {}, ellipse: () => {},
        rect: () => {}, roundRect: () => {},
      };
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        Object.defineProperty(ctx, key, {
          get() { return state[key]; },
          set(v) { (state as any)[key] = v; },
        });
      }
      return ctx;
    }

    const stackfulCtx = makeStackfulContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (contextType: string) {
      return contextType === "2d" ? stackfulCtx : null;
    };

    try {
      liveSweepCalls.length = 0;
      const { handle, container } = mountDeepUnfurl(1);

      // Real viewport so redraw doesn't cull every label (happy-dom defaults
      // canvas client dimensions to 0).
      const canvas = container.querySelector("canvas")!;
      Object.defineProperty(canvas, "clientWidth", { value: 800, configurable: true });
      Object.defineProperty(canvas, "clientHeight", { value: 600, configurable: true });
      window.dispatchEvent(new Event("resize"));

      const aPos = () => (handle.getPlant().blocks as Array<{ kind: string; name?: string; position: { x: number; y: number } }>)
        .find((b) => b.kind === "meristem" && b.name === "a")!.position;
      const aFurled = aPos(); // `a`'s node in the landing (furled) layout

      handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // UNFURL `a`
      await Promise.resolve();

      // `a`'s label must stay on-screen BOTH in the open plant and in the
      // collapsed stub frame the reverse sweep paints (the plant rebuilds on
      // furl toggles and `a` moves ~200 units between the two states), so
      // centre the camera between the two captured positions. The previous
      // whole-plant bounds centre sat there by coincidence and started
      // riding the viewport-cull edge when engine spacing evolved (the
      // 13 July junction-line clearance).
      const scale = 1;
      const aOpen = aPos();
      const midX = (aFurled.x + aOpen.x) / 2;
      const midY = (aFurled.y + aOpen.y) / 2;
      const frame = () => handle.setCamera(400 - midX * scale, 300 - midY * scale, scale);
      frame();

      handle.toggleFurl(meristemBranchId(handle.getPlant(), "a")!); // FURL `a` → reverse sweep
      const furlCall = liveSweepCalls[liveSweepCalls.length - 1]!;
      expect(furlCall.args.reverse).toBe(true);

      // Reproduce the STUCK precondition: paint the reverse sweep's terminal
      // frame directly via the driver's own closures (growth/fold/lief-angle
      // all 0, textRevealFrac 0, scoped to `a`'s subtree) — exactly what the
      // real driver's `finish()` paints on cancel.
      const stubFrame = furlCall.args.buildFrame({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 });
      furlCall.args.render(stubFrame, { textRevealFrac: 0 });

      calls.length = 0;
      frame(); // redraw in place — reveal channel untouched by a plain redraw
      const stuckACalls = calls.filter((c) => c.text === "a");
      expect(stuckACalls.length).toBeGreaterThan(0);
      for (const c of stuckACalls) expect(c.alpha).toBe(0); // precondition: wedged at 0

      calls.length = 0;
      // A real pointerdown steals the camera → cancels the in-flight furl
      // sweep AND (the I1 fix) reconciles the canvas synchronously:
      // renderSnapshotInternal resets the reveal channel to (1, null),
      // repainting `a`'s meristem label at full alpha again.
      const svg = container.querySelector("svg")!;
      svg.dispatchEvent(new Event("pointerdown"));
      expect(furlCall.cancel).toHaveBeenCalled();

      const reconciledACalls = calls.filter((c) => c.text === "a");
      expect(reconciledACalls.length).toBeGreaterThan(0);
      for (const c of reconciledACalls) expect(c.alpha).toBeGreaterThan(0);

      // Aborted furl stays open (branch descendants still present in the
      // held `plant`) — reconciliation must not collapse it.
      await Promise.resolve();
      expect(hasNode(handle.getPlant(), "l")).toBe(true);

      handle.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});

// The keyframe-morph modules (plant-morph / unfurl-keyframes / unfurl-transition)
// are retired — the mount drives the unfurl entirely via the live sweep.
describe("mountPlant retires the keyframe-morph (Task 6)", () => {
  test("mount-plant.ts no longer imports plant-morph / unfurl-keyframes / unfurl-transition", () => {
    const src = readFileSync(new URL("../src/mount-plant.ts", import.meta.url), "utf8");
    expect(src).not.toContain("plant-morph");
    expect(src).not.toContain("unfurl-keyframes");
    expect(src).not.toContain("unfurl-transition");
  });
});

describe("PlantMountHandle.renderTransitionFrame", () => {
  test("mounts a fixture and renders a transition frame (lief angle override) without throwing, camera intact", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);
    handle.setCamera(10, 20, 2);

    const ids = liefIds(plant);
    const liefAngleById = new Map<string, number>([[ids[0]!, 0.5]]);

    expect(typeof handle.renderTransitionFrame).toBe("function");
    expect(() => handle.renderTransitionFrame(plant, { liefAngleById })).not.toThrow();

    // No refit / no camera move (same contract as renderSnapshot).
    const g = container.querySelector("g");
    expect(g?.getAttribute("transform")).toBe("translate(10.000 20.000) scale(2.000)");

    // Empty opts is a plain snapshot render — must also be safe.
    expect(() => handle.renderTransitionFrame(plant, {})).not.toThrow();

    handle.destroy();
  });
});

// ── Lief + meristem text hidden until unfold (unfurling-entry Task 5, broadened) ──
// A lief is basically its text, so during the unfurl animation the label text
// must be HIDDEN while the arc grows and fade IN as the lief opens. Task 5
// added the canvas capability (setLiefTextReveal) + the renderSnapshot reset
// scoped to lief labels only, deliberately leaving meristem labels always
// visible. The unfurling branch's meristem TITLE does the same
// zoom-adaptive-sizing jitter during growth that liefs hide, so this was
// broadened to scale meristem label text the same way — then SCOPED (Fix 2):
// the reveal dims ONLY the unfurling branch N's subtree titles/liefs (the
// `scopeBlockIds` set), leaving the rest of the coral's titles fully lit.
describe("lief-text-reveal gating decision (pure helpers)", () => {
  test("liefLabelRevealFactor scales BOTH lief and meristem labels by reveal; unknown labels are always full alpha", () => {
    expect(liefLabelRevealFactor("lief", 1)).toBe(1);
    expect(liefLabelRevealFactor("lief", 0)).toBe(0);
    expect(liefLabelRevealFactor("lief", 0.35)).toBeCloseTo(0.35);
    expect(liefLabelRevealFactor("meristem", 1)).toBe(1);
    expect(liefLabelRevealFactor("meristem", 0)).toBe(0);
    expect(liefLabelRevealFactor("meristem", 0.35)).toBeCloseTo(0.35);
    expect(liefLabelRevealFactor(undefined, 0)).toBe(1);
    expect(liefLabelRevealFactor(undefined, 1)).toBe(1);
  });

  test("clampUnitInterval clamps to [0,1]", () => {
    expect(clampUnitInterval(-0.5)).toBe(0);
    expect(clampUnitInterval(1.5)).toBe(1);
    expect(clampUnitInterval(0)).toBe(0);
    expect(clampUnitInterval(1)).toBe(1);
    expect(clampUnitInterval(0.42)).toBeCloseTo(0.42);
  });

  test("scopedLabelRevealFactor applies the reveal ONLY inside the scope; null scope + out-of-scope labels are full alpha (Fix 2)", () => {
    const scope = new Set(["in-1", "in-2"]);
    // In scope + lief/meristem → takes the reveal.
    expect(scopedLabelRevealFactor("in-1", "lief", 0, scope)).toBe(0);
    expect(scopedLabelRevealFactor("in-2", "meristem", 0.3, scope)).toBeCloseTo(0.3);
    // In scope but a non-label kind (bodies/rays pass undefined) → still full.
    expect(scopedLabelRevealFactor("in-1", undefined, 0, scope)).toBe(1);
    // Out of scope → full alpha regardless of reveal/kind.
    expect(scopedLabelRevealFactor("out", "lief", 0, scope)).toBe(1);
    expect(scopedLabelRevealFactor("out", "meristem", 0, scope)).toBe(1);
    // Null scope → inert everywhere (the safe reset default), even for a lief.
    expect(scopedLabelRevealFactor("in-1", "lief", 0, null)).toBe(1);
    expect(scopedLabelRevealFactor("anything", "meristem", 0, null)).toBe(1);
  });

  test("clampFontToPeak caps the drawn font at the kind's peak; a no-op at/below peak (Fix 1a)", () => {
    // Over-peak target (the ballooning case) is capped to the peak.
    expect(clampFontToPeak(500, 200)).toBe(200);
    expect(clampFontToPeak(120, 100)).toBe(100);
    // At/below peak → unchanged (just the existing round + floor-1) → byte-identical.
    expect(clampFontToPeak(180, 200)).toBe(180);
    expect(clampFontToPeak(37.4, 200)).toBe(37); // round
    expect(clampFontToPeak(0, 200)).toBe(1);     // floored at 1
  });
});

// ── Subtree label-id scope for the unfurl text-reveal (Fix 2) ───────────────
// The reveal must dim ONLY the unfurling branch N's subtree titles/liefs, not
// the whole coral. `subtreeLabelBlockIds` computes that scope: N's own branch
// (tip-meristem hierarchyId === nodeId) + every descendant branch, restricted
// to lief + meristem block ids — and it must EXCLUDE a sibling branch's blocks.
describe("subtreeLabelBlockIds (pure)", () => {
  // Two sibling BRANCHES under root: `a` (→ a1) and `s` (→ s1). Each parent has
  // a child so it becomes its own branch, giving a genuine sibling-branch split.
  const twoBranchTree: HierarchyInput = {
    root: {
      id: "root",
      name: "root",
      children: [
        { id: "a", name: "a", children: [{ id: "a1", name: "a1" }] },
        { id: "s", name: "s", children: [{ id: "s1", name: "s1" }] },
      ],
    },
  };

  test("returns N's subtree label block ids (meristem + liefs), excluding a sibling branch's blocks", () => {
    const plant = build(twoBranchTree, undefined, defaultEngineConfig) as unknown as Plant;
    const scope = subtreeLabelBlockIds(plant, "a");

    const idOf = (hid: string) =>
      plant.blocks.find((b) => (b as { hierarchyId?: string }).hierarchyId === hid)?.id;

    // N's own meristem + its lief child are IN scope.
    expect(scope.has(idOf("a")!)).toBe(true);
    expect(scope.has(idOf("a1")!)).toBe(true);
    // The sibling branch `s` and its lief `s1` are OUT of scope.
    expect(scope.has(idOf("s")!)).toBe(false);
    expect(scope.has(idOf("s1")!)).toBe(false);
    // The root meristem (ancestor, not a descendant) is OUT of scope.
    expect(scope.has(idOf("root")!)).toBe(false);
  });

  test("includes DESCENDANT branches (transitive), and is an empty no-op scope for an unknown node", () => {
    // root → a → b → c: unfurling `a` must sweep in b's and c's blocks too.
    const deep: HierarchyInput = {
      root: {
        id: "root", name: "root",
        children: [{ id: "a", name: "a", children: [
          { id: "b", name: "b", children: [{ id: "c", name: "c" }] },
        ] }],
      },
    };
    const plant = build(deep, undefined, defaultEngineConfig) as unknown as Plant;
    const scope = subtreeLabelBlockIds(plant, "a");
    const idOf = (hid: string) =>
      plant.blocks.find((b) => (b as { hierarchyId?: string }).hierarchyId === hid)?.id;
    expect(scope.has(idOf("a")!)).toBe(true);
    expect(scope.has(idOf("b")!)).toBe(true); // descendant branch meristem
    expect(scope.has(idOf("c")!)).toBe(true); // deeper descendant
    expect(scope.has(idOf("root")!)).toBe(false);

    // Unknown node → empty scope (the reveal is then a no-op: nothing dims).
    expect(subtreeLabelBlockIds(plant, "no-such-node").size).toBe(0);
  });
});

describe("PlantMountHandle.setLiefTextReveal", () => {
  test("exists, is a no-op-safe passthrough, and renderSnapshot resets it to full reveal", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);

    expect(typeof handle.setLiefTextReveal).toBe("function");
    expect(() => handle.setLiefTextReveal(0)).not.toThrow();
    expect(() => handle.setLiefTextReveal(1)).not.toThrow();
    expect(() => handle.setLiefTextReveal(-3)).not.toThrow(); // out-of-range clamps, no throw
    expect(() => handle.setLiefTextReveal(7)).not.toThrow();
    // Belt-and-suspenders reset: a normal snapshot redraw always shows full
    // lief text, even mid-fade.
    expect(() => handle.renderSnapshot(plant)).not.toThrow();

    handle.destroy();
  });

  // The shared `mockCanvasContext` used by every other test in this file has
  // NO-OP save()/restore() (fine for smoke tests that never inspect painted
  // alpha), so it can't distinguish "this label's alpha was reset by a
  // matching restore()" from "alpha leaked from the previous label" — under
  // that mock EVERY subsequent fillText call reads whatever globalAlpha the
  // last label left behind, which would make this assertion meaningless (it
  // was observed to make meristem labels spuriously read alpha 0 too, purely
  // as a mock artifact). So this one test swaps in a LOCAL context with a
  // real save/restore stack for the properties the draw pass actually
  // mutates, scoped to just this test (restored in `finally`).
  test("at reveal 0 SCOPED to node a's subtree, its lief AND meristem text paint at zero alpha, while out-of-scope labels (root, sibling b) stay full; at 1 all paint full", () => {
    type Call = { text: string; alpha: number };
    const calls: Call[] = [];

    function makeStackfulContext() {
      const state = {
        globalAlpha: 1, fillStyle: "", font: "12px sans-serif",
        textAlign: "left", textBaseline: "top",
        strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      };
      const stack: Array<typeof state> = [];
      const ctx: any = {
        clearRect: () => {}, setTransform: () => {}, transform: () => {},
        canvas: { width: 0, height: 0 },
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        stroke: () => {}, fill: () => {},
        fillText: (text: string) => { calls.push({ text, alpha: ctx.globalAlpha }); },
        strokeText: () => {}, measureText: () => ({ width: 0 }),
        save: () => { stack.push({ ...state }); },
        restore: () => { const s = stack.pop(); if (s) Object.assign(state, s); },
        scale: () => {}, translate: () => {}, rotate: () => {},
        drawImage: () => {}, beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo() {},
        bezierCurveTo: () => {}, quadraticCurveTo: () => {}, arc: () => {}, arcTo: () => {}, ellipse: () => {},
        rect: () => {}, roundRect: () => {},
      };
      for (const key of Object.keys(state) as (keyof typeof state)[]) {
        Object.defineProperty(ctx, key, {
          get() { return state[key]; },
          set(v) { (state as any)[key] = v; },
        });
      }
      return ctx;
    }

    const stackfulCtx = makeStackfulContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (contextType: string) {
      return contextType === "2d" ? stackfulCtx : null;
    };

    try {
      const plant = build(tree, undefined, defaultEngineConfig);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const handle = mountPlant(container, plant);

      // happy-dom has no real layout — canvas.clientWidth/Height default to 0,
      // so `resize()` bails and nothing is ever painted. Force a real size and
      // let the mount's own window-resize listener pick it up.
      const canvas = container.querySelector("canvas")!;
      Object.defineProperty(canvas, "clientWidth", { value: 800, configurable: true });
      Object.defineProperty(canvas, "clientHeight", { value: 600, configurable: true });
      window.dispatchEvent(new Event("resize"));

      // Frame the whole (tiny) fixture plant at scale 1 — comfortably above
      // liefFullAbovePx so lief labels land in the "full" text tier rather
      // than collapsing to dot-glyph/single-dot LOD.
      const bounds = handle.getBounds();
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cy = (bounds.min.y + bounds.max.y) / 2;
      const scale = 1;
      const tx = 400 - cx * scale;
      const ty = 300 - cy * scale;

      const liefNames = new Set(liefIds(plant).map((id) => {
        const b = plant.blocks.find((bl) => bl.id === id);
        return (b as { name?: string } | undefined)?.name;
      }));
      const meristemNames = new Set(
        plant.blocks.filter((b) => b.kind === "meristem").map((b) => (b as { name?: string }).name),
      );

      // Reveal defaults to 1 — force a redraw at the framing transform
      // (setCamera doesn't touch the reveal channel, unlike renderSnapshot).
      calls.length = 0;
      handle.setCamera(tx, ty, scale);
      const liefCallsAtFull = calls.filter((c) => liefNames.has(c.text));
      const meristemCallsAtFull = calls.filter((c) => meristemNames.has(c.text));
      expect(liefCallsAtFull.length).toBeGreaterThan(0);
      expect(meristemCallsAtFull.length).toBeGreaterThan(0);
      for (const c of liefCallsAtFull) expect(c.alpha).toBeGreaterThan(0);
      for (const c of meristemCallsAtFull) expect(c.alpha).toBeGreaterThan(0);

      // Now hide text SCOPED to node "a"'s subtree (Fix 2): the reveal must dim
      // ONLY "a"'s meristem + its liefs (a1, a2); the root meristem and the
      // sibling lief `b` (both OUTSIDE "a"'s subtree) stay fully lit.
      const scope = subtreeLabelBlockIds(plant, "a");
      expect(scope.size).toBeGreaterThan(0);
      const inScopeNames = new Set(
        plant.blocks
          .filter((b) => scope.has(b.id))
          .map((b) => (b as { name?: string }).name),
      );
      // Sanity: the scope spans BOTH a lief and the meristem, and excludes the
      // root meristem + the sibling lief `b` — so this exercises both kinds in
      // both directions.
      expect(inScopeNames.has("a")).toBe(true);   // "a"'s meristem is in scope
      expect(inScopeNames.has("a1")).toBe(true);  // a lief in scope
      expect(inScopeNames.has("root")).toBe(false);
      expect(inScopeNames.has("b")).toBe(false);

      handle.setLiefTextReveal(0, scope);
      calls.length = 0;
      handle.setCamera(tx, ty, scale); // redraw in place, reveal channel untouched

      // In-scope labels (lief AND meristem in "a"'s subtree) hide at alpha 0 —
      // still drawn (not culled), just invisible. Mirrors the old behaviour, now
      // scoped instead of global.
      const inScopeHidden = calls.filter((c) => inScopeNames.has(c.text));
      expect(inScopeHidden.length).toBeGreaterThan(0);
      expect(inScopeHidden.some((c) => c.text === "a")).toBe(true);   // meristem present
      expect(inScopeHidden.some((c) => c.text === "a1" || c.text === "a2")).toBe(true); // lief present
      for (const c of inScopeHidden) expect(c.alpha).toBe(0);

      // Out-of-scope labels (root meristem + sibling lief `b`) stay FULLY LIT —
      // an unfurl no longer dims the whole coral's titles.
      const outScopeCalls = calls.filter(
        (c) => (liefNames.has(c.text) || meristemNames.has(c.text)) && !inScopeNames.has(c.text),
      );
      expect(outScopeCalls.length).toBeGreaterThan(0);
      expect(outScopeCalls.some((c) => c.text === "root")).toBe(true); // out-of-scope meristem
      expect(outScopeCalls.some((c) => c.text === "b")).toBe(true);    // out-of-scope lief
      for (const c of outScopeCalls) expect(c.alpha).toBeGreaterThan(0);

      handle.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});

// ── Multi-select highlight (spec 2026-07-20) ────────────────────────────────
describe("highlightNodes (multi-select emphasis)", () => {
  test("resolves every live path (camera untouched), drops dead paths, clears on empty", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant);
    // Two real node paths straight off the built plant (blocks carry their
    // hierarchyId — the stable vault path / input node id).
    const paths = plant.blocks
      .map((b) => (b as { hierarchyId?: string }).hierarchyId)
      .filter((p): p is string => typeof p === "string")
      .slice(0, 2);
    expect(paths.length).toBe(2);
    const refs = handle.highlightNodes([...paths, "no/such/path"]);
    // Both live paths resolve to refs; the dead path drops out silently.
    expect(refs.map((r) => r.hierarchyId)).toEqual(paths);
    // Empty list clears the highlight and returns no refs.
    expect(handle.highlightNodes([])).toEqual([]);
    handle.destroy();
    container.remove();
  });
});
