import { test, expect } from "bun:test";
import { labelScreenBox } from "../../viewer/src/label-box.ts";

// Deterministic fake measurer: width = chars × 0.5 × fontPx (no canvas needed).
const measure = (t: string, fp: number) => t.length * 0.5 * fp;

const base = {
  label: "Hello",
  boxLength: 1000, // large → no wrap (single line)
  intrinsicFontSize: 10,
  fontPx: 20,
} as const;

test("left-anchored box extends rightward from the anchor", () => {
  const b = labelScreenBox({ ...base, anchorH: "left", anchorV: "middle" }, measure);
  expect(b.lines).toEqual(["Hello"]);
  expect(b.minX).toBe(0);
  expect(b.maxX).toBeCloseTo("Hello".length * 0.5 * 20, 5); // 50
});

test("right-anchored box extends leftward from the anchor", () => {
  const b = labelScreenBox({ ...base, anchorH: "right", anchorV: "middle" }, measure);
  expect(b.maxX).toBe(0);
  expect(b.minX).toBeCloseTo(-("Hello".length * 0.5 * 20), 5); // -50
});

test("single line, middle anchor: vertical box straddles the baseline by ascent/descent", () => {
  const b = labelScreenBox({ ...base, anchorH: "left", anchorV: "middle" }, measure);
  // one line → yStartRel 0; ascent 0.8*fontPx above, descent 0.2*fontPx below
  expect(b.minY).toBeCloseTo(-0.8 * 20, 5);
  expect(b.maxY).toBeCloseTo(0.2 * 20, 5);
});

test("top anchor starts at the anchor and grows downward over wrapped lines", () => {
  // Force two lines: tiny boxLength → small maxCharsPerLine (floored at 6).
  const b = labelScreenBox(
    {
      label: "one two three four five six seven",
      boxLength: 60,
      intrinsicFontSize: 10,
      fontPx: 20,
      anchorH: "left",
      anchorV: "top",
    },
    measure,
  );
  expect(b.lines.length).toBeGreaterThan(1);
  expect(b.minY).toBeCloseTo(-0.8 * 20, 5); // ascent above first baseline at rel 0
  expect(b.maxY).toBeGreaterThan(b.lineH); // extends past the first line
});
