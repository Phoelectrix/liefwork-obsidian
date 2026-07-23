// Pure layout for a lief's small justified summary block. No DOM, no canvas —
// measurement is injected via `measure(text)` (width in FONT-SIZE UNITS, i.e.
// pixel-width ÷ font-size) so this module is fully unit-testable and reusable
// between a cached "measure once" pass and a zoom-independent canvas draw.
//
// All geometry here is intrinsic (world) units, decided once regardless of
// zoom: the block shows uniformly for every lief that has a summary — no
// per-lief omission based on fan crowding — capped at a fixed `maxLines`
// and truncated with "reduce, then omit" when the summary overflows that
// cap (drop trailing whole words from the last kept line until it plus an
// ellipsis fits).
import {
  wrapText,
  LABEL_CHAR_WIDTH_EM,
  LABEL_MAX_WIDTH_FACTOR,
} from "./render.ts";

export interface LiefBlockLine {
  /** The words on this line, in order (last word may carry a trailing "…"
   *  if this line was truncated). */
  words: string[];
  /** Left edge of each word, normalized to the block font size (i.e.
   *  divide by font-size units, same units `measure` returns). */
  advances: number[];
  /** Full line width, normalized to the block font size. Equals the
   *  justified target width when justified, else the line's natural
   *  (unspread) width. */
  width: number;
}

export interface LiefBlockLayout {
  lines: LiefBlockLine[];
}

export interface LiefBlockInput {
  summary: string;
  title: string;
  /** Longest local-frame axis of the lief block; the column-width budget
   *  (title and block text) is a factor of this. */
  boxLength: number;
  /** Intrinsic (unscaled) title font size. */
  intrinsicFontSize: number;
  /** Block font size as a fraction of `intrinsicFontSize`. */
  sizeRatio: number;
  /** Hard cap on lines, uniform for every lief. */
  maxLines: number;
  /** Whether non-last lines should be spread to the widest natural line
   *  width (justified) or left at their natural width (ragged). */
  justify: boolean;
}

/**
 * Compute the layout of a lief's summary block: the (possibly truncated)
 * wrapped text capped at `maxLines`, and per-line justified word advances
 * ready for canvas drawing.
 *
 * Returns `null` only when there is no summary to show (all-or-nothing:
 * every lief with a summary gets a block, uniformly).
 */
export function computeLiefBlockLayout(
  input: LiefBlockInput,
  measure: (text: string) => number,
): LiefBlockLayout | null {
  const { summary, boxLength, intrinsicFontSize, sizeRatio, maxLines, justify } = input;

  if (!summary || !summary.trim()) return null;

  // 1. Block font derived from the title's intrinsic size.
  const blockFont = intrinsicFontSize * sizeRatio;

  // 2. Wrap the summary at the block column width, then truncate to
  //    `maxLines` with "reduce, then omit": if it still overflows, keep the
  //    first `maxLines` lines and ellipsize the last kept line by dropping
  //    trailing whole words until `line + "…"` fits.
  const blockMaxChars = Math.max(
    6,
    Math.floor((boxLength * LABEL_MAX_WIDTH_FACTOR) / (blockFont * LABEL_CHAR_WIDTH_EM)),
  );
  let lines = wrapText(summary, blockMaxChars);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIdx = lines.length - 1;
    lines[lastIdx] = ellipsize(lines[lastIdx]!, blockMaxChars);
  }

  // 3. Per-line word advances: natural width first, then spread non-last
  //    lines to the widest natural line width when justified.
  const spaceW = measure(" ");
  const wordsPerLine = lines.map((line) => line.split(" "));
  const naturalWidths = wordsPerLine.map(
    (words) => words.reduce((sum, w) => sum + measure(w), 0) + (words.length - 1) * spaceW,
  );
  const targetW = naturalWidths.reduce((m, w) => Math.max(m, w), 0);

  const resultLines: LiefBlockLine[] = wordsPerLine.map((words, i) => {
    const natural = naturalWidths[i]!;
    const isLast = i === wordsPerLine.length - 1;
    const gaps = words.length - 1;
    const spread = justify && !isLast && gaps > 0 ? (targetW - natural) / gaps : 0;
    const gapW = spaceW + spread;

    const advances: number[] = [];
    let x = 0;
    for (let w = 0; w < words.length; w++) {
      advances.push(x);
      x += measure(words[w]!) + gapW;
    }

    const width = justify && !isLast && gaps > 0 ? targetW : natural;
    return { words, advances, width };
  });

  return { lines: resultLines };
}

/** Drop trailing whole words from `line` until `line + "…"` fits within
 *  `maxChars`, then append the ellipsis. Guaranteed to terminate: an empty
 *  string plus "…" always has length 1. */
function ellipsize(line: string, maxChars: number): string {
  let candidate = line;
  while (candidate.length > 0 && (candidate + "…").length > maxChars) {
    const spaceIdx = candidate.lastIndexOf(" ");
    if (spaceIdx < 0) {
      candidate = "";
      break;
    }
    candidate = candidate.slice(0, spaceIdx);
  }
  return candidate + "…";
}
