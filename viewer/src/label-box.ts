import { wrapText, LABEL_CHAR_WIDTH_EM, LABEL_LINE_HEIGHT, LABEL_MAX_WIDTH_FACTOR } from "./render.ts";

export interface LabelBoxInput {
  label: string;
  /** Word-wrap budget (= labelBasis × PHI, labelBasis = labelSize ?? shortSide),
   *  from LabelParams.boxLength. */
  boxLength: number;
  /** Zoom-independent font size used for the wrap calc, from LabelParams.intrinsicFontSize. */
  intrinsicFontSize: number;
  /** Quantized screen font size in CSS px (= round(decision.targetPx)). */
  fontPx: number;
  anchorH: "right" | "left" | "center";
  anchorV: "top" | "middle" | "bottom";
}

export interface LabelBox {
  /** Screen-space box RELATIVE to the anchor (sx,sy), CSS px. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  lines: string[];
  lineH: number;
  /** Baseline of the first line relative to the anchor's sy. */
  yStartRel: number;
}

/** Reproduce the draw pass's wrap + alignment to get the rendered text's box,
 *  relative to the label anchor. `measureLine(text, fontPx)` returns rendered
 *  width in px (inject ctx.measureText in the renderer; a fake in tests).
 *
 *  Used by skeleton-canvas `hitTest` (runs on click, not per frame) so the click
 *  region matches the painted glyphs. It MIRRORS the draw pass's wrap/alignment
 *  formulas in skeleton-canvas.ts (same constants) rather than being called from
 *  it — the draw path is the ~1ms hot redraw and must not pay a per-label
 *  measureText. Keep the two in lockstep if either changes. */
export function labelScreenBox(
  inp: LabelBoxInput,
  measureLine: (text: string, fontPx: number) => number,
): LabelBox {
  const maxCharsPerLine = Math.max(
    6,
    Math.floor((inp.boxLength * LABEL_MAX_WIDTH_FACTOR) / (inp.intrinsicFontSize * LABEL_CHAR_WIDTH_EM)),
  );
  const lines = wrapText(inp.label, maxCharsPerLine);
  const lineH = inp.fontPx * LABEL_LINE_HEIGHT;

  let width = 0;
  for (const ln of lines) width = Math.max(width, measureLine(ln, inp.fontPx));

  // "center" straddles the anchor (matches the draw pass's textAlign="center"
  // for centred root titles); "right" flushes left of it; "left" flushes right.
  const minX = inp.anchorH === "right" ? -width : inp.anchorH === "center" ? -width / 2 : 0;
  const maxX = inp.anchorH === "right" ? 0 : inp.anchorH === "center" ? width / 2 : width;

  let yStartRel: number;
  if (inp.anchorV === "top") yStartRel = 0;
  else if (inp.anchorV === "bottom") yStartRel = -(lines.length - 1) * lineH;
  else yStartRel = -((lines.length - 1) * lineH) / 2;

  // Alphabetic baseline: ~0.8·fontPx ascent above, ~0.2·fontPx descent below.
  const ascent = inp.fontPx * 0.8;
  const descent = inp.fontPx * 0.2;
  const minY = yStartRel - ascent;
  const maxY = yStartRel + (lines.length - 1) * lineH + descent;

  return { minX, maxX, minY, maxY, lines, lineH, yStartRel };
}
