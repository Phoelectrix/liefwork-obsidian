import { describe, test, expect } from "bun:test";
import { drawLiefBlock } from "../src/skeleton-canvas.ts";
import type { LiefBlockLayout } from "../src/lief-block.ts";

// Minimal ctx spy: records fillText(text, x, y) calls and wordSpacing
// assignments; font/fillStyle/textAlign/textBaseline are plain writable
// properties (no-op setters — just object property assignment), also
// recorded for hygiene checks. measureText returns text.length as a
// stand-in "width" (units don't matter — only relative widths do, and this
// keeps the justify-target math easy to hand-verify).
function makeCtxSpy() {
  const calls: Array<{ text: string; x: number; y: number }> = [];
  const wordSpacingCalls: string[] = [];
  let _wordSpacing = "0px";
  const ctx = {
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
    get wordSpacing() {
      return _wordSpacing;
    },
    set wordSpacing(v: string) {
      _wordSpacing = v;
      wordSpacingCalls.push(v);
    },
    measureText(text: string) {
      return { width: text.length } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ text, x, y });
    },
  };
  return { ctx, calls, wordSpacingCalls };
}

// Two-line layout. `advances`/`width` are still part of LiefBlockLayout's
// shape (computeLiefBlockLayout still produces them) but are no longer
// consumed by drawLiefBlock — the values here are irrelevant to the draw.
function makeLayout(): LiefBlockLayout {
  return {
    lines: [
      { words: ["Hello", "World"], advances: [0, 3], width: 5 },
      { words: ["Foo"], advances: [0], width: 3 },
    ],
  };
}

// Layout where the first (non-last) line is narrower than the widest
// natural line, so justify has visible spread to assert on.
// line0: "Hi Bob" -> natural = 6 (measureText stub returns length)
// line1 (last): "Hello World Extra" -> natural = 17
function makeJustifyLayout(): LiefBlockLayout {
  return {
    lines: [
      { words: ["Hi", "Bob"], advances: [0, 3], width: 6 },
      { words: ["Hello", "World", "Extra"], advances: [0, 6, 12], width: 17 },
    ],
  };
}

describe("drawLiefBlock", () => {
  test("draws one fillText call per line, whole line as one string", () => {
    const { ctx, calls } = makeCtxSpy();
    const layout = makeLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "left",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: false,
    });

    expect(calls).toEqual([
      { text: "Hello World", x: 50, y: 100 },
      { text: "Foo", x: 50, y: 112 },
    ]);
  });

  test("right anchor: each line flushes its own natural width to sx (unjustified)", () => {
    const { ctx, calls } = makeCtxSpy();
    const layout = makeLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "right",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: false,
    });

    // "Hello World" natural = 11 -> leftEdge = 50 - 11 = 39
    // "Foo" natural = 3 -> leftEdge = 50 - 3 = 47
    expect(calls).toEqual([
      { text: "Hello World", x: 39, y: 100 },
      { text: "Foo", x: 47, y: 112 },
    ]);
  });

  test("center anchor: each line centres its own natural width on sx (unjustified)", () => {
    const { ctx, calls } = makeCtxSpy();
    const layout = makeLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "center",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: false,
    });

    // "Hello World" natural = 11 -> leftEdge = 50 - 5.5 = 44.5
    // "Foo" natural = 3 -> leftEdge = 50 - 1.5 = 48.5
    expect(calls).toEqual([
      { text: "Hello World", x: 44.5, y: 100 },
      { text: "Foo", x: 48.5, y: 112 },
    ]);
  });

  test("justify=true: non-last multi-word line is spread via wordSpacing to the widest natural line", () => {
    const { ctx, calls, wordSpacingCalls } = makeCtxSpy();
    const layout = makeJustifyLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "left",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: true,
    });

    // target = max(6, 17) = 17. line0 ("Hi Bob"): 1 gap, spread = (17-6)/1 = 11px.
    // line1 is the LAST line -> never justified (wordSpacing "0px" for it),
    // then the trailing unconditional reset also sets "0px" again.
    expect(calls).toEqual([
      { text: "Hi Bob", x: 50, y: 100 },
      { text: "Hello World Extra", x: 50, y: 112 },
    ]);
    expect(wordSpacingCalls).toEqual(["11px", "0px", "0px"]);
  });

  test("justify=false: wordSpacing stays 0px for every line even with uneven natural widths", () => {
    const { ctx, wordSpacingCalls } = makeCtxSpy();
    const layout = makeJustifyLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "left",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: false,
    });

    // Two lines (both "0px") plus the trailing unconditional reset ("0px").
    expect(wordSpacingCalls).toEqual(["0px", "0px", "0px"]);
  });

  test("resets wordSpacing to 0px after the last line so later text isn't affected", () => {
    const { ctx, wordSpacingCalls } = makeCtxSpy();
    const layout = makeJustifyLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "left",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: true,
    });

    expect(wordSpacingCalls.at(-1)).toBe("0px");
    expect(ctx.wordSpacing).toBe("0px");
  });

  test("sets font, fillStyle, textAlign (left) and textBaseline (alphabetic)", () => {
    const { ctx } = makeCtxSpy();
    const layout = makeLayout();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, layout, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 12,
      blockLineH: 14.4,
      anchorH: "left",
      fill: "rgba(238,242,248,0.62)",
      weight: "400",
      justify: true,
    });

    expect(ctx.font).toBe("400 12px system-ui, sans-serif");
    expect(ctx.fillStyle).toBe("rgba(238,242,248,0.62)");
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("alphabetic");
  });

  test("no-op when layout has zero lines", () => {
    const { ctx, calls } = makeCtxSpy();
    drawLiefBlock(ctx as unknown as CanvasRenderingContext2D, { lines: [] }, {
      sx: 50,
      blockYStart: 100,
      blockFontPx: 10,
      blockLineH: 12,
      anchorH: "left",
      fill: "rgba(0,0,0,1)",
      weight: "400",
      justify: true,
    });
    expect(calls).toEqual([]);
    // Reset assignment still fires unconditionally.
    expect(ctx.wordSpacing).toBe("0px");
  });
});
