// Stencil compound-path composer.
//
// Output is a single SVG `d` string that renders correctly with
// fill-rule="evenodd": outer leaf silhouette is opaque; glyphs inside it
// are holes through which light passes. When shaded/shadow-cast later,
// this is the shape that gets projected.
//
// Coord convention (plate-local):
//   u-axis: horizontal in the plate face, 0 at centerline
//   v-axis: from base (v=0) toward tip (v=length)
//
// Output uses SVG's (x=u, y=v) directly, no flipping.

import { stencilFont } from "./stencil-font.ts";

export interface StencilConfig {
  /** Leaf long-axis extent, plate units. */
  length: number;
  /** Leaf max width, plate units. */
  width: number;
  /** Nominal glyph em-size in plate units. Auto-shrinks if text overflows. */
  fontSize: number;
  /** Gap from base and tip to the glyph column, plate units. */
  textMargin: number;
  /** Extra spacing between glyphs, in em (0 = tight). */
  tracking?: number;
}

export function composeStencilPath(text: string, cfg: StencilConfig): string {
  const silhouette = leafSilhouettePath(cfg.length, cfg.width);
  const glyphs = glyphColumnPath(text, cfg);
  return glyphs ? `${silhouette} ${glyphs}` : silhouette;
}

export interface GlyphColumnOptions {
  /** Mirror the column for shadows that cast toward -v on screen. Both the
   * character order and each glyph's internal coord frame are flipped, so
   * on-screen the label still reads left-to-right with correctly-oriented
   * letters (not just reversed-order, which would leave every glyph
   * appearing horizontally flipped). */
  mirror?: boolean;
}

// Symmetric ovate lens. Two quadratics trace right side then left side.
// Base at (0,0) (branch attachment), tip at (0,L) (outward), widest at
// (±W/2, L/2). Exported separately so the shadow renderer can paint the
// "lit leaf" behind and the "dark plate with letter holes" in front.
export function leafSilhouettePath(L: number, W: number): string {
  const midV = L / 2;
  const hW = W / 2;
  return `M 0 0 Q ${hW} ${midV} 0 ${L} Q ${-hW} ${midV} 0 0 Z`;
}

export function glyphColumnPath(
  text: string,
  cfg: StencilConfig,
  opts: GlyphColumnOptions = {},
): string {
  const { fontSize, length, textMargin } = cfg;
  const { unitsPerEm, ascender, descender, glyphs } = stencilFont;

  const upper = [...text.toUpperCase()].filter((c) => glyphs[c] !== undefined);
  if (upper.length === 0) return "";
  const mirror = opts.mirror ?? false;
  const cleaned = mirror ? upper.reverse() : upper;

  const trackingEm = cfg.tracking ?? 0;
  const trackingUnits = trackingEm * unitsPerEm;

  // Total column advance in native font units — how much v the baked text
  // would consume at 1:1 scale.
  const totalAdvance =
    cleaned.reduce((s, c) => s + glyphs[c]!.advance + trackingUnits, 0)
    - trackingUnits;

  // Auto-shrink so the column fits between the two margins. Never enlarge:
  // short text keeps its natural fontSize.
  const available = Math.max(0, length - 2 * textMargin);
  const naturalScale = fontSize / unitsPerEm;
  const shrinkScale = available / Math.max(totalAdvance, 1);
  const scale = Math.min(naturalScale, shrinkScale);

  // Center the column along v. Natural length = totalAdvance * scale; any
  // leftover splits equally onto both margins.
  const columnPlate = totalAdvance * scale;
  let vCursor = textMargin + (available - columnPlate) / 2;

  // Center glyphs along u. After 90° CCW rotation (old_x along baseline →
  // new_y; old_y above baseline → new_x), a capital extends in new_x from
  // 0 (baseline) to +ascender*s (top); descenders reach -|descender|*s.
  // Midpoint of [descender*s, ascender*s] = (ascender+descender)/2 * s.
  const centerU = -((ascender + descender) / 2) * scale;

  const out: string[] = [];
  for (const ch of cleaned) {
    const g = glyphs[ch]!;
    // Matrix: rotate 90° CCW + scale + translate.
    // SVG matrix(a,b,c,d,e,f): (x,y) → (a*x+c*y+e, b*x+d*y+f)
    // Normal (b = +s): glyph gx (0..advance, baseline left→right) maps to
    // plate v (vCursor..vCursor+advance*s). Mirror (b = -s) flips each
    // glyph's horizontal axis, and f shifts so the glyph still fills the
    // same [vCursor, vCursor+advance*s] slot — just drawn backward within
    // it. Combined with the reversed character order above, on-screen
    // left-side shadows read forward with correctly-oriented letters.
    const advancePlate = g.advance * scale;
    const m: Affine = mirror
      ? { a: 0, b: -scale, c: -scale, d: 0, e: centerU, f: vCursor + advancePlate }
      : { a: 0, b:  scale, c: -scale, d: 0, e: centerU, f: vCursor };
    out.push(transformPath(g.path, m));
    vCursor += advancePlate + trackingUnits * scale;
  }
  return out.join(" ");
}

interface Affine { a: number; b: number; c: number; d: number; e: number; f: number; }

// Parse + transform an SVG path. Supports absolute M/L/Q/C/Z (the full set
// that opentype.js emits). Relative commands, arcs (A), and implicit
// repeats are unnecessary here — flag them loudly if they ever appear.
const CMD_ARGS: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

function transformPath(d: string, m: Affine): string {
  const tokens = d.match(/[A-Za-z]|-?\d+\.?\d*(?:e[+-]?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++]!;
    const n = CMD_ARGS[cmd];
    if (n === undefined) throw new Error(`Unsupported path command: ${cmd}`);
    out.push(cmd);
    for (let k = 0; k < n; k += 2) {
      const x = parseFloat(tokens[i++]!);
      const y = parseFloat(tokens[i++]!);
      const nx = m.a * x + m.c * y + m.e;
      const ny = m.b * x + m.d * y + m.f;
      out.push(nx.toFixed(2));
      out.push(ny.toFixed(2));
    }
  }
  return out.join(" ");
}
