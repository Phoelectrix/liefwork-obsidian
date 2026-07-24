// Render-time dot-text path generator. Produces an SVG path string where each
// non-space character of a title is represented by a small filled circle. Dots
// wrap to multiple lines using the SAME greedy word-wrap algorithm as
// buildWrappedText in render.ts, so dot geometry aligns with the projection
// text that replaces it at higher zoom tiers.
//
// Coordinates are in WORLD UNITS (not unit-font space) — the path can be
// placed directly with a translate(…) transform; no font-size scale needed.

// Mirror of the three layout constants from render.ts. Must stay in sync with
// those values. (They are also exported from render.ts for cross-module access
// but we keep local copies here so this module has zero DOM / render.ts deps.)
export const LABEL_CHAR_WIDTH_EM  = 0.55;   // rough glyph advance
export const LABEL_LINE_HEIGHT    = 1.2;     // em
export const LABEL_MAX_WIDTH_FACTOR = 1.5;   // text column = 1.5 × block length

/** Greedy word-wrap: returns array of lines, matching the wrapText logic in
 *  render.ts exactly (same tie-break, same long-word hard-break). */
function wrapWords(input: string, maxChars: number): string[] {
  const words = input.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = ""; }
      for (let i = 0; i < word.length; i += maxChars) {
        const piece = word.slice(i, i + maxChars);
        if (i + maxChars >= word.length) current = piece;
        else lines.push(piece);
      }
      continue;
    }
    if (!current) current = word;
    else if ((current + " " + word).length <= maxChars) current += " " + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export interface BakeWrappedDotPathOpts {
  name: string;
  fontSize: number;
  boxLength: number;
}

/**
 * Bake a world-unit SVG path string for a title rendered as dot rows.
 * One tiny circle per non-space character, laid out using the same greedy
 * word-wrap as the projection text so dots align with where letters appear.
 *
 * @param name      Hierarchy node name.
 * @param fontSize  Projection font size in world units.
 * @param boxLength Block long-axis length in world units (times magnification).
 */
export function bakeWrappedDotPath(opts: BakeWrappedDotPathOpts): string {
  const { fontSize, boxLength } = opts;
  const name = opts.name.replace(/\s+/g, " ").trim();
  if (name.length === 0) return "";

  const charWidth = fontSize * LABEL_CHAR_WIDTH_EM;
  const maxWidth  = boxLength * LABEL_MAX_WIDTH_FACTOR;
  // Match buildWrappedText's Math.max(6, …) floor so degenerate small-box
  // cases behave identically.
  const maxCharsPerLine = Math.max(6, Math.floor(maxWidth / charWidth));

  const lines = wrapWords(name, maxCharsPerLine);
  const lineH  = fontSize * LABEL_LINE_HEIGHT;
  // Dot radius: 0.15 / 0.6 ≈ 25% of pitch — same ratio as the old unit-font
  // baker (DOT_RADIUS / DOT_PITCH), now expressed in world units.
  const r = fontSize * 0.15;
  const d  = (2 * r).toFixed(4);
  const dn = (-2 * r).toFixed(4);

  const parts: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const y = li * lineH;
    // Track character position within the current line (not the full name),
    // since each line starts at x=0 just like a tspan with x=rayLen reset.
    let charIdx = 0;
    for (let ci = 0; ci < line.length; ci++) {
      if (line[ci] === " ") { charIdx++; continue; }
      const cx = charIdx * charWidth;
      const left = (cx - r).toFixed(4);
      const yStr = y.toFixed(4);
      // Two-arc circle: M (cx-r) y  a r r 0 1 0 +2r 0  a r r 0 1 0 -2r 0  z
      const rStr = r.toFixed(4);
      parts.push(`M ${left} ${yStr} a ${rStr} ${rStr} 0 1 0 ${d} 0 a ${rStr} ${rStr} 0 1 0 ${dn} 0 z`);
      charIdx++;
    }
  }
  return parts.join(" ");
}
