import { describe, test, expect } from "bun:test";
import {
  computeLiefBlockLayout,
  type LiefBlockInput,
} from "../src/lief-block.ts";

// Fake measurer: width in font-size units == character count (space width == 1).
const measure = (t: string) => t.length;

function baseInput(overrides: Partial<LiefBlockInput> = {}): LiefBlockInput {
  return {
    summary: "word1 word2",
    title: "Title",
    boxLength: 100,
    intrinsicFontSize: 10,
    sizeRatio: 0.5,
    maxLines: 5,
    justify: true,
    ...overrides,
  };
}

describe("computeLiefBlockLayout", () => {
  test("empty summary -> null", () => {
    expect(computeLiefBlockLayout(baseInput({ summary: "" }), measure)).toBeNull();
    expect(computeLiefBlockLayout(baseInput({ summary: "   " }), measure)).toBeNull();
  });

  test("short summary (fits within maxLines) -> all its lines, natural advances", () => {
    const layout = computeLiefBlockLayout(baseInput(), measure);
    expect(layout).not.toBeNull();
    expect(layout!.lines.length).toBe(1);
    const line = layout!.lines[0]!;
    expect(line.words).toEqual(["word1", "word2"]);
    // natural: measure("word1") + spaceW + measure("word2") = 5 + 1 + 5 = 11
    expect(line.width).toBe(11);
    // advances[k] = left edge of word k; word1 at 0, word2 at 5(word1)+1(space)
    expect(line.advances).toEqual([0, 6]);
  });

  test("long summary -> exactly maxLines lines, last one ellipsized", () => {
    // boxLength=20, intrinsicFontSize=10, sizeRatio=1 -> blockFont=10,
    // blockMaxChars = max(6, floor(20*LABEL_MAX_WIDTH_FACTOR/(10*LABEL_CHAR_WIDTH_EM))).
    // Tuned (mirroring the old fan-input geometry) so blockMaxChars=6, wrapping
    // "aa bb cc dd ee ff gg hh" into 4 lines of 5-6 chars each; maxLines=2 caps it.
    const layout = computeLiefBlockLayout(
      baseInput({
        summary: "aa bb cc dd ee ff gg hh",
        boxLength: 20,
        intrinsicFontSize: 10,
        sizeRatio: 1,
        maxLines: 2,
      }),
      measure,
    );
    expect(layout).not.toBeNull();
    expect(layout!.lines.length).toBe(2);

    const lastLine = layout!.lines[layout!.lines.length - 1]!;
    const lastWord = lastLine.words[lastLine.words.length - 1]!;
    expect(lastWord.endsWith("…")).toBe(true);
    expect(layout!.lines[0]!.words).toEqual(["aa", "bb"]);
  });

  test("justify spreads a non-last multi-word line to the widest natural line width", () => {
    // Wraps to exactly 2 lines at blockMaxChars=6: ["ab cd", "efghij"].
    // line0 natural = 2+2+1 = 5; line1 (last) natural = 6. target = 6.
    const layout = computeLiefBlockLayout(
      baseInput({
        summary: "ab cd efghij",
        boxLength: 20,
        intrinsicFontSize: 10,
        sizeRatio: 1,
        maxLines: 5,
        justify: true,
      }),
      measure,
    );
    expect(layout).not.toBeNull();
    expect(layout!.lines.length).toBe(2);

    const line0 = layout!.lines[0]!;
    const line1 = layout!.lines[1]!;
    expect(line0.words).toEqual(["ab", "cd"]);
    expect(line0.width).toBe(6); // spread to targetW, not its own natural (5)
    // natural advance for word "cd" would be 2(ab)+1(space)=3; justified spreads
    // the single gap by (6-5)/1=1, pushing "cd" to 4.
    expect(line0.advances).toEqual([0, 4]);

    expect(line1.words).toEqual(["efghij"]);
    expect(line1.width).toBe(6); // last line is always natural (and happens to be widest)
    expect(line1.advances).toEqual([0]);
  });

  test("ragged (justify=false) leaves every line at its natural width", () => {
    const layout = computeLiefBlockLayout(
      baseInput({
        summary: "ab cd efghij",
        boxLength: 20,
        intrinsicFontSize: 10,
        sizeRatio: 1,
        maxLines: 5,
        justify: false,
      }),
      measure,
    );
    expect(layout).not.toBeNull();
    expect(layout!.lines.length).toBe(2);

    const [line0, line1] = layout!.lines;
    expect(line0!.words).toEqual(["ab", "cd"]);
    expect(line0!.width).toBe(5); // natural, no spread
    expect(line0!.advances).toEqual([0, 3]); // natural advance: 2(ab) + 1(space)

    expect(line1!.words).toEqual(["efghij"]);
    expect(line1!.width).toBe(6);
    expect(line1!.advances).toEqual([0]);
  });
});
