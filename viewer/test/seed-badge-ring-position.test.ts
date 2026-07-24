import { describe, test, expect } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).

// ── Seed-badge ring POSITION on a centred (root) label ──────────────────────
// seed-badge-ring.test.ts only checks that a ring is drawn (stroke count);
// this file checks WHERE. The root/wordmark title draws with
// ctx.textAlign = "center" (skeleton-canvas.ts ~1087), so a fillText(text, sx, y)
// call there paints text centred ON sx — spanning [sx - textW/2, sx + textW/2].
// The ring math (~1157) assumes sx is the text's LEFT edge (left-aligned
// convention: right edge = sx + textW) and places the ring at
// sx + textW + gap + ringR regardless of alignment. For a centred label that
// overshoots the true right edge (sx + textW/2) by textW/2 — exactly the
// founder-observed "floats off by about half the label's width".

// Mock Path2D (happy-dom has no canvas backend) — same pattern as the other
// mount-level tests (mount-plant.test.ts, mount-furl.test.ts, seed-badge-ring.test.ts).
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

// Records every fillText (to find the drawn label's anchor x + text + the
// textAlign active at the time) and every arc (to find the ring's centre x +
// the textAlign active at the time it was stroked).
type FillTextCall = { x: number; text: string; textAlign: string };
type ArcCall = { x: number; textAlign: string; font: string };
let fillTextCalls: FillTextCall[] = [];
// Only arcs that were STROKED (the ring — dot-glyphs/single-dot tiers and the
// agent-glow orb all use fill() instead, per the file's paint-order comment
// that stems + the seed-badge ring are the only stroke() consumers).
let strokedArcCalls: ArcCall[] = [];
let lastArc: ArcCall | null = null;

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
  stroke() {
    if (lastArc) strokedArcCalls.push(lastArc);
    lastArc = null;
  },
  fill() {
    lastArc = null;
  },
  fillText(text: string, x: number) {
    fillTextCalls.push({ x, text, textAlign: this.textAlign });
  },
  strokeText: () => {},
  // Deterministic width model: 6px/char (matches seed-badge-ring.test.ts's mock).
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
  arc(x: number) {
    lastArc = { x, textAlign: this.textAlign, font: this.font };
  },
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

// Root + one child: with the default engine config the root's tangent is
// near-vertical, so skeleton-canvas.ts's ROOT_ANCHOR_H_DEADZONE check gives
// it anchorH "center" (mirrors label-size.test.ts's "root title (anchorH
// 'center')" fixture) — the exact tier this bug hits.
const tree: HierarchyInput = {
  root: { id: "root", name: "LiefWork", children: [{ id: "a", name: "a", children: [{ id: "a1", name: "a1" }] }] },
};

describe("seed-badge ring position — centred (root) label", () => {
  test("ring sits past the label's RIGHT EDGE, not past anchor+textW, on a centred title", () => {
    const plant = build(tree, undefined, defaultEngineConfig);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountPlant(container, plant, { agentGlow: { seedBadges: true } });

    handle.setSeedBadges(new Set(["root"])); // this tree's root hierarchyId (the `id` on its root node)
    fillTextCalls = [];
    strokedArcCalls = [];
    lastArc = null;
    handle.renderSnapshot(plant); // forces stableMeristems: every meristem is "full" tier

    // Find the root title's own fillText call (textAlign "center") and the
    // one ring stroked while textAlign was "center" — the seed badge on root.
    const rootFillText = fillTextCalls.find((c) => c.textAlign === "center" && c.text === "LiefWork");
    expect(rootFillText).toBeDefined();
    const sx = rootFillText!.x;
    const textW = rootFillText!.text.length * 6; // matches the measureText mock

    const centredArcs = strokedArcCalls.filter((c) => c.textAlign === "center");
    expect(centredArcs.length).toBeGreaterThan(0);
    // renderSnapshot repaints the frame more than once (a settle/measure pass
    // + the real paint) — every repaint draws the same ring at the same x,
    // so just confirm they agree and use that shared value.
    for (const c of centredArcs) expect(c.x).toBeCloseTo(centredArcs[0]!.x, 6);
    const ringX = centredArcs[0]!.x;

    // gap + ringR: the SAME pip-like-geometry constants the ring math itself
    // uses (fontPx * 0.4 and fontPx * 0.18 — skeleton-canvas.ts ~1148-1149),
    // derived from the font size active when the ring was stroked. This test
    // isn't re-asserting that formula (it's a fixture, not what's under
    // test) — it's the fixed offset every tier/alignment shares, so both
    // candidate positions below get it added identically.
    const fontPxMatch = /(\d+(?:\.\d+)?)px/.exec(centredArcs[0]!.font);
    expect(fontPxMatch).not.toBeNull();
    const fontPx = Number(fontPxMatch![1]);
    const gapPlusRingR = fontPx * 0.4 + fontPx * 0.18;

    const trueRightEdge = sx + textW / 2; // ctx.textAlign "center" semantics
    const buggyRightEdge = sx + textW;    // left-aligned assumption baked into the ring math (the bug)

    const expectedFixedRingX = trueRightEdge + gapPlusRingR;
    const expectedBuggyRingX = buggyRightEdge + gapPlusRingR; // today's actual behaviour

    // Correct: the ring sits just past the label's RENDERED right edge —
    // not textW/2 further out at the left-aligned-assumption position.
    expect(ringX).toBeCloseTo(expectedFixedRingX, 1);
    expect(Math.abs(ringX - expectedBuggyRingX)).toBeGreaterThan(textW / 4);

    handle.destroy();
  });
});
