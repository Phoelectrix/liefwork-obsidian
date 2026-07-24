import type { Plant, Branch, Bounds } from "../../src/types.ts";
import { sampleCurve } from "../../src/index.ts";
import type { StylingConfig } from "./styling.ts";
import { parseHexColor } from "./styling.ts";
import { paintBody, collectBodies, type BodyParams } from "./body.ts";
import { watchDevicePixelRatio } from "./dpr-watch.ts";
import {
  liefSunAzimuth,
  meristemSunAzimuth,
  rayEndpoint,
  projectionVerticalAnchor,
  type LiefGeom,
} from "./projection.ts";
import type { BlockDecision } from "./cascade-pass.ts";
import { wrapText, LABEL_CHAR_WIDTH_EM, LABEL_LINE_HEIGHT, LABEL_MAX_WIDTH_FACTOR } from "./render.ts";
import { labelScreenBox } from "./label-box.ts";
import { labelSizeBasis } from "./sizing/composition.ts";
import { displayNameForBoosted } from "./start-here.ts";
import type { ProjectionConfig } from "./styling.ts";
import { computeLiefBlockLayout, type LiefBlockLayout } from "./lief-block.ts";
import { revealProgress } from "./reveal.ts";
import { isExpandAffordance } from "./unfurl-affordance.ts";

// Canvas skeleton renderer: branch stems + leaf/bud silhouette fills +
// projection rays + canvas label text (with LOD tiers). Settle-only (no rAF
// loop) — redrawn on pan/zoom settle and resize via ctx.setTransform.
//
// Paint order mirrors the SVG skeleton (back to front):
//   1. Stems (with real per-branch widths + tip-opacity gradient)
//   2. Leaf/bud fills (paintBody — same shear/radial-gradient logic as body.ts)
//   3. Projection rays (block → label anchor)
//   4. LOD label tiers at ray endpoint:
//        "full"        → wrapped text lines
//        "dot-glyphs"  → one dot per non-space char, same layout
//        "single-dot"  → one dot at anchor

const CURVE_SAMPLES = 64;
const PHI = (1 + Math.sqrt(5)) / 2;
/** Canvas label font family — shared by the draw pass and hitTest's text-box
 *  measurement so the click region matches the painted glyphs. */
const LABEL_FAMILY = "system-ui, sans-serif";
/** Bounded overscan factor for the canvas bitmap: the canvas is drawn this many
 *  times the viewport size (centred), so a composited pan reveals already-painted
 *  periphery instead of black. 2.0 = a 50% margin on every side. mountPlant sizes
 *  the canvas element to match; the redraw offsets drawing into the margin. */
export const CANVAS_OVERSCAN = 2.0;

/** The selected node's label colour — Meridian "Peach Rose", the kit's single
 *  warm focal point ("the one warm human moment on screen"), here marking the
 *  selected node (replaces the old selection ring). Iridescent Teal + Accent
 *  Coral are deliberately NOT used for selection — they're reserved for future
 *  status / priority signalling. Darkened from the kit's #D4927A so it separates
 *  clearly from the straw-gold Amber meristems. */
const SELECTED_LABEL_COLOR = "#BE7355";
/** Label colour for a non-markdown file lief (all-files mode) — Meridian's
 *  reserved "Iridescent Teal", here signalling file TYPE: notes stay Star White,
 *  every other file reads teal. Producer-set via LiefBlock.nonMd, so only the
 *  plugin's file liefs ever pick it up (site/Studio corals are untouched). */
const FILE_LIEF_COLOR = "#5ECFBE";
/** Lief summary-block fill — a dim, desaturated white so the smaller block
 *  text reads as secondary to the title (which keeps the branch/agent
 *  colour). Deliberately low-contrast; the block is a glance-able summary,
 *  not a second headline. */
const LIEF_BLOCK_FILL = "rgba(238,242,248,0.62)";
// Minimum stem width in SCREEN px. Stem width is in world units (scales with
// zoom), so on a wide zoom thin branches shrink to nothing. This floor keeps
// them readable when zoomed out, while leaving the tapered look untouched on
// zoom-in (where w × scale already exceeds it).
const MIN_STEM_SCREEN_PX = 1.5;
const MIN_RAY_SCREEN_PX = 0.75;
/** Seed-badge ring alpha multiplier — "reduced alpha" (founder's design call):
 *  hollow + dimmer than the label it sits beside is what reads as a passive
 *  marker rather than another agent pip. Multiplies whatever globalAlpha is
 *  already active (pulse/reveal/fade), so the ring fades with its label. */
const SEED_BADGE_RING_ALPHA = 0.5;

// ── Stem geometry cache (built once per setPlant call) ───────────────────────
/** Per-branch cached geometry: a world-space Path2D polyline + gradient
 *  endpoints used to recreate the gradient at stroke time (cheap).
 *  The Path2D is transform-independent — ctx.setTransform handles zoom/pan.
 *  The gradient is stored as world-space endpoints; we recreate it once per
 *  setPlant so it lives outside the per-redraw hot path.  */
interface StemCache {
  branchId: string;
  path: Path2D;
  /** World-space gradient endpoints (identical to origin / tip coords). */
  gradX0: number;
  gradY0: number;
  gradX1: number;
  gradY1: number;
  /** Prebuilt gradient — valid until setPlant is called again (stem colors
   *  come from styling which is stable; if styling changes setPlant is called). */
  gradient: CanvasGradient;
  /** AABB for viewport culling (world coords). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Build the StemCache array from a plant. Called once per setPlant. */
function buildStemCache(
  plant: Plant,
  ctx: CanvasRenderingContext2D,
  stemColorBase: string,
  stemColorTip: string,
): StemCache[] {
  const blockById = new Map(plant.blocks.map((b) => [b.id, b]));
  const cache: StemCache[] = [];

  for (const branch of plant.branches) {
    const origin = branchOriginFor(branch, plant, blockById);

    // Sample the curve ONCE here (not in redraw).
    const path = new Path2D();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES;
      const { point } = sampleCurve(branch.curve, t);
      const x = origin.x + point.x;
      const y = origin.y + point.y;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Tip world coords (= last sampled point at t=1).
    const { point: tipPt } = sampleCurve(branch.curve, 1);
    const tipX = origin.x + tipPt.x;
    const tipY = origin.y + tipPt.y;

    // Build the gradient once in world space. Canvas gradients are evaluated
    // against the CTM at *paint* time, so a world-space gradient created here
    // renders correctly under any later transform applied via ctx.setTransform.
    // Reasoning: the gradient's coordinate space is the user-space at paint
    // time; since we call ctx.setTransform(world→screen) before stroking, the
    // gradient endpoints are interpreted in world coords exactly as intended.
    let gradient: CanvasGradient;
    try {
      gradient = ctx.createLinearGradient(origin.x, origin.y, tipX, tipY);
      gradient.addColorStop(0, stemColorBase);
      gradient.addColorStop(1, stemColorTip);
    } catch {
      // Degenerate branch (zero length) — fall back to solid.
      gradient = ctx.createLinearGradient(0, 0, 1, 0);
      gradient.addColorStop(0, stemColorBase);
      gradient.addColorStop(1, stemColorBase);
    }

    cache.push({
      branchId: branch.id,
      path,
      gradX0: origin.x,
      gradY0: origin.y,
      gradX1: tipX,
      gradY1: tipY,
      gradient,
      minX, maxX, minY, maxY,
    });
  }

  return cache;
}

/** Options for installSkeletonCanvas. All optional — defaults to safe behaviour
 *  when omitted (constant stem width, no rays). */
export interface SkeletonCanvasOptions {
  /** Per-branch stem width function (screen pixels), produced by
   *  `cascade.makeStemWidthsFn(styling.v2Stem)`. When omitted the renderer
   *  falls back to a hairline stroke. */
  stemWidthForBranch?: (branchId: string) => number;
}

/** Callback that returns per-block LOD decisions for the current view/viewport.
 *  Wired to `cascade.computeDecisions` in mount-plant. */
export type GetDecisionsFn = (
  view: { tx: number; ty: number; scale: number },
  viewport: { width: number; height: number },
) => Map<string, BlockDecision>;

/** Stable per-block label data, pre-computed in setPlant. */
interface LabelParams {
  blockId: string;
  /** World-space ray endpoint (= label anchor). */
  anchorX: number;
  anchorY: number;
  /** World-space node position (= block.position). Used as secondary hit target. */
  nodeX: number;
  nodeY: number;
  /** Sun azimuth in radians (from projection geometry). */
  sunAz: number;
  /** `labelBasis × titleSize` — world-unit "font size at k=1", where labelBasis
   *  is the engine-baked `labelSize` (fallback: `shortSide`). */
  baseWorldFontSize: number;
  /** Box length = labelBasis × PHI — word-wrap budget. */
  boxLength: number;
  /** Intrinsic font size = labelBasis × titleSize (zoom-independent, for wrap calc). */
  intrinsicFontSize: number;
  /** Label string (block.name, possibly with Start-Here prefix). */
  label: string;
  /** Horizontal anchor: "right" when cos(sunAz)<0, else "left". "center" is used
   *  only for the root title, which is centred directly over the root. */
  anchorH: "right" | "left" | "center";
  /** Vertical anchor — the edge nearest the branch, so the ray connects to the
   *  text's inner edge (for liefs AND meristems). */
  anchorV: "top" | "middle" | "bottom";
  /** kind — drives colour selection. */
  kind: "lief" | "meristem";
  /** Owning branch id — the render-gate (Task 5) branch cull key. */
  branchId: string;
  /** Per-block label colour (from ProjectionConfig.light / meristemLight). */
  color: string;
  /** Cached lief summary-block layout (Task 2's `computeLiefBlockLayout`) —
   *  only populated for `kind==="lief"` when `styling.liefBlock.mode==="block"`
   *  AND a summary is available for this block; null/undefined (inert) in
   *  "label" mode or when no summary map is set. */
  blockLayout?: LiefBlockLayout | null;
  /** Block font size as a fraction of `intrinsicFontSize` — cached alongside
   *  `blockLayout` so the draw pass doesn't need to re-read styling. */
  blockSizeRatio?: number;
}

/** Options for {@link drawLiefBlock}. All geometry is in SCREEN px. */
interface DrawLiefBlockOpts {
  /** Screen-space anchor x (same anchor the title uses). */
  sx: number;
  /** Screen-space y of the block's first line. */
  blockYStart: number;
  /** Block font size in screen px (fontPx * lp.blockSizeRatio). */
  blockFontPx: number;
  /** Line height in screen px (blockFontPx * LABEL_LINE_HEIGHT). */
  blockLineH: number;
  /** Horizontal anchor — same semantics as the title's anchorH. */
  anchorH: "right" | "left" | "center";
  fill: string;
  family: string;
  /** Whether non-last lines are spread to the widest natural line width
   *  (via `ctx.wordSpacing`) rather than left at their natural width. */
  justify: boolean;
}

/** Paint a lief's justified summary block. Each line is drawn as ONE
 *  `fillText` call on the joined `words` string so the browser's own text
 *  shaper (kerning, subpixel positioning) places every glyph — this is what
 *  keeps inter-word gaps from crushing to zero, which the old word-by-word
 *  `fillText` + precomputed `advances` approach was prone to (those advances
 *  were normalized/scaled numbers that drift from the actual shaped glyph
 *  run). Justification is done natively via `ctx.wordSpacing`, stretching
 *  the space characters to make the line's natural width match the widest
 *  natural line — never touched per-glyph. */
export function drawLiefBlock(
  ctx: CanvasRenderingContext2D,
  layout: LiefBlockLayout,
  opts: DrawLiefBlockOpts,
): void {
  const { sx, blockYStart, blockFontPx, blockLineH, anchorH, fill, family, justify } = opts;
  ctx.font = `${blockFontPx}px ${family}`;
  ctx.fillStyle = fill;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Pre-pass: join each line into a whole string and measure its TRUE drawn
  // width (ctx.font is already set above, so ctx.measureText is accurate —
  // no drift from a reference-font-scaled estimate). The justify target is
  // the widest natural line, mirroring the old `targetW` semantics.
  const texts: string[] = new Array<string>(layout.lines.length);
  const naturals: number[] = new Array<number>(layout.lines.length);
  let target = 0;
  for (let li = 0; li < layout.lines.length; li++) {
    const line = layout.lines[li]!;
    const text = line.words.join(" ");
    const natural = ctx.measureText(text).width;
    texts[li] = text;
    naturals[li] = natural;
    if (natural > target) target = natural;
  }

  for (let li = 0; li < layout.lines.length; li++) {
    const line = layout.lines[li]!;
    const text = texts[li]!;
    const natural = naturals[li]!;
    const isLast = li === layout.lines.length - 1;
    const gaps = line.words.length - 1;
    const doJustify = justify && !isLast && gaps > 0;
    const lineWidth = doJustify ? target : natural;

    const leftEdge = anchorH === "right"
      ? sx - lineWidth
      : anchorH === "center"
      ? sx - lineWidth / 2
      : sx;

    ctx.wordSpacing = doJustify ? `${(target - natural) / gaps}px` : "0px";

    const y = blockYStart + li * blockLineH;
    ctx.fillText(text, leftEdge, y);
  }

  // Reset so no later text (titles, dot-glyph labels, etc.) inherits a
  // stretched word spacing from this block's justification.
  ctx.wordSpacing = "0px";
}

/** Rotate an RGB color's hue by `deg` — the CSS `hue-rotate` matrix (Rec. 601
 *  luma weights), so no HSL round-trip per frame. Used by the spectral shift. */
function rotateHue(
  [r, g, b]: readonly [number, number, number],
  deg: number,
): readonly [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const m = [
    0.213 + cosA * 0.787 - sinA * 0.213, 0.715 - cosA * 0.715 - sinA * 0.715, 0.072 - cosA * 0.072 + sinA * 0.928,
    0.213 - cosA * 0.213 + sinA * 0.143, 0.715 + cosA * 0.285 + sinA * 0.140, 0.072 - cosA * 0.072 - sinA * 0.283,
    0.213 - cosA * 0.213 - sinA * 0.787, 0.715 - cosA * 0.715 + sinA * 0.715, 0.072 + cosA * 0.928 + sinA * 0.072,
  ] as const;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [
    clamp(r * m[0] + g * m[1] + b * m[2]),
    clamp(r * m[3] + g * m[4] + b * m[5]),
    clamp(r * m[6] + g * m[7] + b * m[8]),
  ];
}

export type SkeletonCanvasHandle = {
  redraw(tx: number, ty: number, scale: number): void;
  /** Redraw at the last known transform — for host-driven styling changes
   *  (e.g. the text-sizing knobs) that don't move the camera. */
  redrawLast(): void;
  setPlant(
    plant: Plant,
    opts?: SkeletonCanvasOptions,
    projectionConfigByBlockId?: Map<string, ProjectionConfig>,
    meristemLabelByBlockId?: Map<string, string> | null,
    boostedBranchIds?: Set<string>,
  ): void;
  /** Update the stem-width function without triggering a redraw.
   *  Call after cascade.makeStemWidthsFn (i.e. inside render()) so the next
   *  redraw (fired by panzoom.onCommit) uses the updated widths. */
  updateStemWidthFn(fn: (branchId: string) => number): void;
  /** Highlight the block with the given id (or clear selection with null).
   *  Triggers a redraw at the last known transform. */
  setSelected(blockId: string | null): void;
  /** Multi-select sibling of setSelected: emphasise EVERY block in the set
   *  (empty set clears). Single-select remains a set of one via setSelected. */
  setSelectedMany(blockIds: ReadonlySet<string>): void;
  /** Apply per-branch agent tint maps (meristem label by block id, stem by branch id).
   *  Triggers a redraw at the last known transform. */
  setAgentTints(meristemColors: Map<string, string[]>, stemColors: Map<string, string[]>): void;
  /** Mark the given meristem block ids as seeded-coral-root badges: a small
   *  hollow ring drawn past the label (styling.agentGlow.seedBadges-gated;
   *  see the draw pass for the geometry). Empty set (the default) is a
   *  no-op. Triggers a redraw at the last known transform. */
  setSeedBadges(blockIds: ReadonlySet<string>): void;
  /** When on, a single-agent tint drifts through neighbouring hues in time with
   *  the pulse (spectral shift — a Liefwork Pro perk, gated by the plugin).
   *  Off by default; multi-agent cross-fades are unaffected. */
  setSpectralShift(on: boolean): void;
  /** Apply a lief summary map (block name -> summary text), fetched from a
   *  metadata sidecar that arrives AFTER mount. Recomputes label params (so
   *  `styling.liefBlock.mode==="block"` liefs pick up their summary-block
   *  layout) and redraws at the last known transform. Inert (no-op cost) when
   *  `mode==="label"`. */
  setNodeMetadata(summaryByName: Map<string, string>): void;
  /** When on, meristem labels are forced to full-text regardless of the cull/tier
   *  verdict. Enable only for growth-render stills; reset to false after each
   *  renderSnapshot so interactive LOD rendering is unaffected. */
  setStableMeristems(on: boolean): void;
  /** Apply the current furl render-gate sets (Task 5/6): hidden branch ids
   *  (stem cull) + hidden block ids (body/ray/label cull). Empty sets are a
   *  no-op — the default-off state before unfurling wiring lands. Triggers a
   *  redraw at the last known transform. */
  setFurlState(hiddenBranchIds: ReadonlySet<string>, hiddenBlockIds: ReadonlySet<string>): void;
  /** Fade reveal (Task 8): start a `durationMs` reveal ramp for each
   *  branch id in `branchIds` (the just-unfurled parent's direct children).
   *  Drives a self-cancelling rAF loop — mirrors the pulse loop — that
   *  redraws every frame until every tracked branch reaches full opacity,
   *  then clears its state (zero cost once idle). A fresh call supersedes/
   *  extends any in-flight reveal (new branches added, existing ones
   *  restarted). No-op call shape when `branchIds` is empty. */
  beginReveal(branchIds: string[], durationMs: number): void;
  /** Per-block alpha channel (Task 7 transition frames): sets a map of blockId
   *  → alpha in [0,1] that the body / ray / label draw passes multiply into the
   *  block's existing alpha (blocks absent from the map draw at full 1). This is
   *  the SAME multiply used by the per-branch reveal ramp — the two compose
   *  (branch reveal × block alpha). `null` (or an empty map) clears the channel
   *  so those passes take their untouched path. Stores only; the caller drives
   *  the redraw (renderTransitionFrame does setPlant → redraw right after). */
  setBlockAlpha(alphaById: Map<string, number> | null): void;
  /** Lief-text reveal channel (unfurl entry animation): scales the TEXT fill
   *  alpha of every `kind === "lief"` OR `kind === "meristem"` label by
   *  `frac` (clamped to [0,1]) — a lief is basically its text, so this is
   *  what hides it while its arc grows (Phase A) and fades it in as it opens
   *  (Phase B); the unfurling branch's meristem TITLE does the same
   *  zoom-adaptive-sizing jitter during growth, so it mirrors the lief
   *  behaviour too (hidden during grow, fading in as the branch unfolds).
   *  SCOPED via the setter's `scopeBlockIds` — only the unfurling branch's
   *  subtree titles/liefs dim during a sweep; the rest of the coral stays
   *  fully lit (see `setLiefTextReveal`). Only label TEXT alpha is scaled; meristem
   *  glyph/dot and agent-tint rendering are untouched. `1` (the default) is
   *  a no-op: rendering is byte-identical to before this channel existed.
   *  Stores only; the caller drives the redraw.
   *
   *  `scopeBlockIds` restricts the reveal to labels whose `blockId` is in the
   *  set (the unfurling branch's SUBTREE) — every other label draws at full
   *  alpha, so an unfurl no longer dims the whole coral's titles. `null` (the
   *  default / reset) makes the channel inert everywhere regardless of `frac`. */
  setLiefTextReveal(frac: number, scopeBlockIds?: ReadonlySet<string> | null): void;
  /** Hit-test a world-space point against the rendered labels + node positions.
   *  Only considers blocks that are currently shown (decision.show === true).
   *  Returns the blockId of the nearest hit (to either label anchor OR node),
   *  or null if nothing is within threshold. */
  hitTest(worldX: number, worldY: number, scale: number): string | null;
  destroy(): void;
};

/** Pure gating decision for the lief-text-reveal channel: the alpha factor a
 *  label's TEXT paint should be multiplied by, given its `kind` and the
 *  current reveal fraction. Both `"lief"` and `"meristem"` labels are scaled
 *  by `reveal` — a meristem's TITLE does the same zoom-adaptive-sizing
 *  jitter during growth that liefs hide, so it mirrors the lief behaviour.
 *  Any call site that doesn't know/care about kind (i.e. `undefined`) is
 *  always full alpha. Exported so the decision is unit-testable without
 *  mounting a canvas. */
export function liefLabelRevealFactor(
  kind: "lief" | "meristem" | undefined,
  reveal: number,
): number {
  return kind === "lief" || kind === "meristem" ? reveal : 1;
}

/** Clamp a reveal fraction to the valid [0,1] range — the shape
 *  `setLiefTextReveal` enforces on its input. */
export function clampUnitInterval(frac: number): number {
  return Math.min(1, Math.max(0, frac));
}

/** Scoped variant of the lief-text-reveal gate. The reveal factor applies ONLY
 *  to labels whose `blockId` is in `scope` (the unfurling branch's subtree);
 *  every label outside the scope — and ALL labels when `scope` is `null` — draws
 *  at full alpha (factor 1). `null` scope is the safe default used by the
 *  snapshot reset: the channel is then inert regardless of `reveal`. Within the
 *  scope the kind-gate (`liefLabelRevealFactor`) still applies, so bodies/rays
 *  (which pass `kind === undefined`) are untouched even when in scope. Exported
 *  so the decision is unit-testable without mounting a canvas. */
export function scopedLabelRevealFactor(
  blockId: string,
  kind: "lief" | "meristem" | undefined,
  reveal: number,
  scope: ReadonlySet<string> | null,
): number {
  if (scope === null) return 1;
  if (!scope.has(blockId)) return 1;
  return liefLabelRevealFactor(kind, reveal);
}

/** Quantized draw font size (px), clamped to the kind's peak size. At rest a
 *  block's `targetPx` is already ≤ its peak (the cascade culls anything larger),
 *  so this is a no-op there — it only bites when a forced/over-peak title (the
 *  growth-film's `stableMeristems` path, or a tightly zoomed-in unfurl camera)
 *  would otherwise round an unbounded `targetPx` into a ballooning font. Exported
 *  for unit testing. */
export function clampFontToPeak(targetPx: number, peak: number): number {
  return Math.max(1, Math.round(Math.min(targetPx, peak)));
}

/** Screen-px display cap for a CHILD meristem title. `meristemPeakSize` is a
 *  cull threshold (~200px), far too high to bound the drawn size — so a forced
 *  or tightly-zoomed unfurl balloons a big-subtree meristem toward it. Cap the
 *  display at a readable size instead. The ROOT title (`anchorH === "center"`,
 *  the only centred title) is exempt: it's the hero wordmark and is meant to be
 *  large. Liefs keep their own peak. Exported for unit testing. */
export const MERISTEM_TITLE_MAX_PX = 48;
export function labelPeakPx(lp: LabelParams, styling: StylingConfig): number {
  if (lp.kind !== "meristem") return styling.liefPeakSize;
  if (lp.anchorH === "center") return styling.meristemPeakSize; // root wordmark exempt
  return Math.min(styling.meristemPeakSize, MERISTEM_TITLE_MAX_PX);
}

export function installSkeletonCanvas(
  canvas: HTMLCanvasElement,
  plant: Plant,
  styling: StylingConfig,
  opts: SkeletonCanvasOptions = {},
  getDecisions?: GetDecisionsFn,
  projectionConfigByBlockId?: Map<string, ProjectionConfig>,
  meristemLabelByBlockId?: Map<string, string> | null,
  boostedBranchIds?: Set<string>,
): SkeletonCanvasHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  // The pop-out window the canvas lives in (its own DPR / rAF / resize), falling
  // back to the global window for canvases in the main document.
  const win = canvas.ownerDocument.defaultView ?? window;

  // Sanity ceiling for a CSS-pixel viewport dimension. Real viewports (×2 overscan)
  // top out a few thousand px; anything larger is a corrupted/transform-scaled read.
  const MAX_CANVAS_CSS_PX = 20000;

  // Track the last known transform so resize can redraw correctly.
  let lastTx = 0;
  let lastTy = 0;
  let lastScale = 1;

  // The emphasised (selected) blocks — a SET: multi-select paints every member
  // in SELECTED_LABEL_COLOR; classic single-select is just a set of one.
  let selectedBlockIds: ReadonlySet<string> = new Set();

  // Furl render-gate (Task 5): sets of branch/block ids hidden by unfurling
  // state, populated via setFurlState (Task 6 wires them from mount state).
  // Empty by default — every cull guard below is then a no-op (default-off).
  let hiddenBranchIds: ReadonlySet<string> = new Set();
  let hiddenBlockIds: ReadonlySet<string> = new Set();
  // "click to expand" affordance liefs are never drawn — clicking the meristem
  // is the natural gesture, so the label is visual noise. Recomputed per setPlant
  // (ids are ephemeral per rebuild AND per growth-sweep frame, so this must track
  // the current plant, not a one-off set). The blocks stay in the plant, so their
  // geometry/layout is unchanged; they're just culled from body/ray/label draw.
  // Empty for any plant without injected affordances (plugin/Studio) — a no-op.
  let expandAffordanceBlockIds: Set<string> = new Set();
  const recomputeExpandAffordances = (p: Plant): void => {
    expandAffordanceBlockIds = new Set(
      p.blocks.filter((b) => isExpandAffordance(b)).map((b) => b.id),
    );
  };
  recomputeExpandAffordances(plant);

  // Agent tint maps — set by setAgentTints, applied in redraw. Each entry is the
  // LIST of agent colors on that branch (≥2 = several terminals; combined below).
  let meristemColorsByBlockId = new Map<string, string[]>();
  let stemColorsByBranchId = new Map<string, string[]>();

  // Seed-badge block ids — set by setSeedBadges, drawn as a hollow ring past
  // the meristem label (before any agent pips). Empty by default — a no-op,
  // and inert regardless while styling.agentGlow.seedBadges is off.
  let seedBadgeBlockIds: ReadonlySet<string> = new Set();

  // ── Muted pulse (gated rAF loop) ─────────────────────────────────────────
  // Runs ONLY while ≥1 tint is active; zero cost when no agent is bound.
  const PULSE_PERIOD_MS = 2200; // slow — alive, not distracting
  const PULSE_MIN_ALPHA = 0.62; // muted: never fully fades (trough deepened a tad for a clearer pulse)
  let pulseRaf: number | null = null;
  let pulsePhase = 0; // 0..1, advanced by elapsed rAF time (not wall-clock)

  // Spectral shift (setSpectralShift): a single-agent tint drifts ±DRIFT_DEG
  // around its hue in time with the pulse. Off by default — the site and
  // Studio never enable it; the plugin gates it behind Liefwork Pro. Rides the
  // existing pulse rAF loop, so it costs nothing while no tint is bound.
  const SPECTRAL_DRIFT_DEG = 18;
  let spectralShift = false;

  const pulseAlpha = (): number =>
    PULSE_MIN_ALPHA + (1 - PULSE_MIN_ALPHA) * 0.5 * (1 + Math.cos(pulsePhase * Math.PI * 2));

  /** The branch's current tint as RGB: a single color as-is (hue-drifted when
   *  the spectral shift is on), or — when several agents share a branch — a
   *  smooth cross-fade through their colors driven by the pulse phase (so the
   *  branch cycles teal→coral→teal). */
  const tintRgb = (colors: string[]): readonly [number, number, number] => {
    if (colors.length === 1) {
      const rgb = parseHexColor(colors[0]!);
      if (!spectralShift) return rgb;
      return rotateHue(rgb, SPECTRAL_DRIFT_DEG * Math.sin(pulsePhase * Math.PI * 2));
    }
    const seg = pulsePhase * colors.length; // 0..n
    const i = Math.floor(seg) % colors.length;
    const f = seg - Math.floor(seg);
    const [r0, g0, b0] = parseHexColor(colors[i]!);
    const [r1, g1, b1] = parseHexColor(colors[(i + 1) % colors.length]!);
    const m = (a: number, b: number) => Math.round(a + (b - a) * f);
    return [m(r0, r1), m(g0, g1), m(b0, b1)];
  };
  const tintColor = (colors: string[]): string => {
    const [r, g, b] = tintRgb(colors);
    return `rgb(${r},${g},${b})`;
  };

  let lastFrameTs: number | null = null;
  const pulseLoop = (ts: number): void => {
    if (lastFrameTs !== null) {
      pulsePhase = (pulsePhase + (ts - lastFrameTs) / PULSE_PERIOD_MS) % 1;
    }
    lastFrameTs = ts;
    redraw(lastTx, lastTy, lastScale);
    pulseRaf = win.requestAnimationFrame(pulseLoop);
  };
  const syncPulse = (): void => {
    // Runs while an agent tint is bound; with none, it stays stopped (inert default).
    const active = meristemColorsByBlockId.size + stemColorsByBranchId.size > 0;
    if (active && pulseRaf === null) {
      lastFrameTs = null;
      pulseRaf = win.requestAnimationFrame(pulseLoop);
    } else if (!active && pulseRaf !== null) {
      win.cancelAnimationFrame(pulseRaf);
      pulseRaf = null;
    }
  };

  // ── Fade reveal (Task 8, gated rAF loop) ───────────────────────────
  // Runs ONLY while ≥1 branch is mid-reveal; zero cost (no rAF, no per-item
  // alpha work) once the map empties — mirrors the pulse loop above exactly.
  const revealStartByBranch: Map<string, number> = new Map();
  // The duration passed to the most recent beginReveal call. In practice a
  // single stable config value (styling.unfurl.revealMs), so one shared
  // duration for every tracked branch is sufficient.
  let revealDurationMs = 0;
  let revealRaf: number | null = null;

  /** Reveal alpha for `branchId` at time `now` (rAF timestamp / performance.now()
   *  — same clock as the pulse loop). 1 (fully revealed, no-op) when the branch
   *  isn't tracked — i.e. every branch outside an in-flight reveal, and ALL
   *  branches whenever `unfurl` is off (beginReveal is only ever called from
   *  the expand click routes, which only fire when enabled). */
  const revealAlpha = (branchId: string, now: number): number =>
    revealStartByBranch.has(branchId)
      ? revealProgress(revealStartByBranch.get(branchId)!, now, revealDurationMs)
      : 1;

  const revealLoop = (ts: number): void => {
    redraw(lastTx, lastTy, lastScale);
    let allDone = true;
    for (const start of revealStartByBranch.values()) {
      if (revealProgress(start, ts, revealDurationMs) < 1) { allDone = false; break; }
    }
    if (allDone) {
      revealStartByBranch.clear();
      revealRaf = null;
      return;
    }
    revealRaf = win.requestAnimationFrame(revealLoop);
  };

  // Mutable options (stem width fn changes when setPlant is called).
  let currentOpts: SkeletonCanvasOptions = opts;

  // Mutable label callback + per-block config (update on setPlant).
  let currentGetDecisions: GetDecisionsFn | undefined = getDecisions;
  let currentProjConfigById: Map<string, ProjectionConfig> | undefined = projectionConfigByBlockId;
  let currentMeristemLabelById: Map<string, string> | null = meristemLabelByBlockId ?? null;
  let currentBoostedBranchIds: Set<string> = boostedBranchIds ?? new Set();
  // Per-block alpha channel (Task 7): blockId -> alpha in [0,1], multiplied into
  // the body/ray/label passes alongside the per-branch reveal ramp. null (the
  // default, and whenever no transition frame is in flight) means the passes
  // take their original per-branch-only path.
  let currentAlphaById: Map<string, number> | null = null;
  // Lief-text-reveal channel (unfurl entry animation): scales the TEXT fill
  // alpha of `kind === "lief"` AND `kind === "meristem"` labels (both mirror
  // the same hidden-during-grow / fade-in-during-unfold behaviour). SCOPED via
  // `liefTextRevealScope` — the reveal applies only to labels in that set (the
  // unfurling branch's subtree); every other label (and ALL labels when the
  // scope is null) draws at full alpha, so a sweep no longer dims the whole
  // coral's titles. Default 1 / null scope (the untouched-by-this-channel
  // state) — see `setLiefTextReveal` / `scopedLabelRevealFactor`.
  let liefTextReveal = 1;
  let liefTextRevealScope: ReadonlySet<string> | null = null;
  // Lief summary map (block name -> summary text) — arrives LATE via a metadata
  // sidecar fetched after mount, so it starts null (inert: no blockLayout is
  // ever computed until setNodeMetadata is called). See `setNodeMetadata`.
  let currentSummaryByName: Map<string, string> | null = null;

  // Cached from the last redraw — used by hitTest so it sees the same decisions
  // as were actually painted (including show/hide state and targetPx thresholds).
  let lastDecisions: Map<string, BlockDecision> = new Map();

  // Growth render mode: when on, meristem labels are forced to "full" tier
  // regardless of the cascade verdict. Enabled only from renderSnapshot (the
  // growth-only path) so interactive LOD rendering is unchanged.
  let stableMeristems = false;

  // Text measurer for lief summary-block layout (font-size units, i.e.
  // pixel-width ÷ MEASURE_REF), built once from `ctx` and reused by every
  // `collectLabelParams` call so per-call measurement cost stays flat.
  const MEASURE_REF = 100;
  const measureUnit = (t: string): number => {
    ctx.font = `${MEASURE_REF}px ${LABEL_FAMILY}`;
    return ctx.measureText(t).width / MEASURE_REF;
  };

  // Pre-computed per-plant draw params.
  let bodies: BodyParams[] = collectBodies(plant);
  let rayParams: RayParams[] = collectRayParams(plant, styling, currentProjConfigById);
  let labelParams: LabelParams[] = collectLabelParams(
    plant, styling, currentProjConfigById, currentMeristemLabelById, currentBoostedBranchIds,
    currentSummaryByName, measureUnit,
  );
  // blockId -> owning branchId, for the reveal pass: bodies/rays only carry a
  // blockId (unlike labelParams, which already has `branchId`), so this map
  // is how their draw loops find the right revealAlpha bucket.
  let blockBranchId: Map<string, string> = buildBlockBranchId(plant);

  // Static stem geometry cache — rebuilt in setPlant, used in redraw.
  const [_sr0, _sg0, _sb0] = parseHexColor(styling.stem.color);
  const _tipOpacity0 = styling.v2Stem.tipOpacity;
  const _stemColorBase0 = `rgba(${_sr0},${_sg0},${_sb0},1)`;
  const _stemColorTip0 = `rgba(${_sr0},${_sg0},${_sb0},${_tipOpacity0})`;
  let stemCache: StemCache[] = buildStemCache(plant, ctx, _stemColorBase0, _stemColorTip0);

  // DPR-aware resize. Size from the LAYOUT box (clientWidth/Height), NOT
  // getBoundingClientRect(): gBCR includes the composited motionLayer transform,
  // so a ResizeObserver firing mid-composite (seen in Obsidian pop-out windows)
  // reads a wildly transform-scaled size and corrupts the backing store. The
  // layout metrics are transform-independent, which also breaks the feedback
  // loop (stable size on every fire). The guard rejects degenerate (unlaid-out)
  // or absurd (corrupted) sizes outright.
  const resize = (): void => {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (
      !Number.isFinite(cssW) || !Number.isFinite(cssH) ||
      cssW <= 0 || cssH <= 0 || cssW > MAX_CANVAS_CSS_PX || cssH > MAX_CANVAS_CSS_PX
    ) {
      return;
    }
    const dpr = win.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    redraw(lastTx, lastTy, lastScale);
  };

  let __redrawCount = 0;
  const redraw = (tx: number, ty: number, scale: number): void => {
    const __t0 = performance.now();
    lastTx = tx;
    lastTy = ty;
    lastScale = scale;

    const dpr = win.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    // Bounded overscan: the canvas bitmap is CANVAS_OVERSCAN× the viewport and
    // centred (see mountPlant's canvas CSS), so a composited pan reveals
    // already-painted periphery instead of black. (OX,OY) = how far the canvas
    // extends beyond the viewport per side, in CSS px. We draw in CANVAS coords,
    // so the viewport-relative pan (tx,ty) shifts by (OX,OY) to the canvas origin.
    const OX = (cssWidth * (CANVAS_OVERSCAN - 1)) / (2 * CANVAS_OVERSCAN);
    const OY = (cssHeight * (CANVAS_OVERSCAN - 1)) / (2 * CANVAS_OVERSCAN);
    const txc = tx + OX;
    const tyc = ty + OY;

    // Reset to identity and clear the whole bitmap.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply the world→screen transform (canvas coords), DPR-scaled so 1 world
    // unit = 1 CSS px.
    const s = scale * dpr;
    ctx.setTransform(s, 0, 0, s, txc * dpr, tyc * dpr);

    // ── Canvas world-bounds (for culling) ─────────────────────────────────────
    // Screen point maps to world: wx = (sx - txc) / scale. These bounds cover the
    // FULL overscanned canvas — which already is the pan margin, so no extra
    // inflation is applied (the periphery is genuinely painted, not clipped).
    const vpLeft   = (0         - txc) / scale;
    const vpRight  = (cssWidth  - txc) / scale;
    const vpTop    = (0         - tyc) / scale;
    const vpBot    = (cssHeight - tyc) / scale;
    const cullLeft  = vpLeft;
    const cullRight = vpRight;
    const cullTop   = vpTop;
    const cullBot   = vpBot;

    // Fade reveal (Task 8): `now` is the same clock as __t0
    // (performance.now(), matching the pulse loop's rAF timestamp base).
    // `revealing` gates ALL per-item reveal-alpha work below — false (the
    // default, and always when unfurl is off) means every pass below takes
    // its original, untouched-by-this-task code path.
    const now = __t0;
    const revealing = revealStartByBranch.size > 0;
    // Per-block alpha channel (Task 7 transition frames). Active only while a
    // non-empty alpha map is set; `fading` gates the body/ray/label save/restore
    // paths so they run when EITHER the per-branch reveal OR the per-block alpha
    // is live.
    const perBlockAlpha = currentAlphaById !== null && currentAlphaById.size > 0;
    const fading = revealing || perBlockAlpha;
    // Combined fade alpha for a block: per-branch reveal ramp × per-block alpha
    // × (labels only) the lief-text-reveal factor. Each factor is 1 (a no-op)
    // when its channel is inactive, so with no per-block map and no `kind`
    // passed (the body/ray call sites below) this reduces EXACTLY to the
    // prior per-branch behaviour. `kind` is only ever passed at the label
    // call site — bodies/rays never pass it, so they are untouched by the
    // lief-text-reveal channel.
    const fadeAlpha = (
      blockId: string,
      branchId: string | undefined,
      kind?: "lief" | "meristem",
    ): number => {
      const branchA = revealing && branchId !== undefined ? revealAlpha(branchId, now) : 1;
      const blockA = perBlockAlpha ? (currentAlphaById!.get(blockId) ?? 1) : 1;
      const liefA = scopedLabelRevealFactor(blockId, kind, liefTextReveal, liefTextRevealScope);
      return branchA * blockA * liefA;
    };

    const stemWidthFn = currentOpts.stemWidthForBranch;
    // stemColorBase is only needed as fallback when stemWidth === 0 (hairline).
    const [sr, sg, sb] = parseHexColor(styling.stem.color);
    const stemColorBase = `rgba(${sr},${sg},${sb},1)`;

    // ── 1. Stems (uses prebuilt Path2D + gradient from stemCache) ────────────
    const __tStems0 = performance.now();
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const sc of stemCache) {
      // Furl cull: skip stems whose branch is hidden by unfurling state.
      if (hiddenBranchIds.has(sc.branchId)) continue;
      // Cull: skip if the AABB is entirely outside the inflated viewport.
      if (sc.maxX < cullLeft || sc.minX > cullRight ||
          sc.maxY < cullTop  || sc.minY > cullBot) continue;

      const screenWidth = stemWidthFn ? stemWidthFn(sc.branchId) : 0;
      const w = screenWidth > 0 ? screenWidth : 1;

      const agentStem = stemColorsByBranchId.get(sc.branchId);
      const multiStem = !!agentStem && agentStem.length > 1;
      ctx.strokeStyle = agentStem
        ? tintColor(agentStem)
        : (screenWidth > 0 ? sc.gradient : stemColorBase);
      // World-unit width, but floored to a minimum SCREEN width so stems still
      // read when zoomed out (the floor only bites at wide zoom).
      ctx.lineWidth = Math.max(w, MIN_STEM_SCREEN_PX / scale);
      if (agentStem) {
        ctx.save();
        // Single agent: muted alpha pulse. Several agents: the colour cross-fade
        // IS the motion, so draw at full alpha. A mid-reveal branch fades that
        // in further (Task 8) on top.
        ctx.globalAlpha = (multiStem ? 1 : pulseAlpha()) * (revealing ? revealAlpha(sc.branchId, now) : 1);
        ctx.stroke(sc.path);
        ctx.restore();
      } else if (revealing) {
        ctx.save();
        ctx.globalAlpha = revealAlpha(sc.branchId, now);
        ctx.stroke(sc.path);
        ctx.restore();
      } else {
        ctx.stroke(sc.path);
      }
    }
    const __tStems1 = performance.now();

    // ── 2. Leaf/bud fills ─────────────────────────────────────────────────────
    const __tBodies0 = performance.now();
    const [r, g, b] = parseHexColor(styling.body.fill);
    const baseOpacity = styling.body.baseOpacity;
    const softness = Math.max(0, Math.min(1, styling.body.edgeSoftness));

    for (const body of bodies) {
      // Furl cull: skip bodies whose block is hidden by unfurling state.
      if (hiddenBlockIds.has(body.blockId) || expandAffordanceBlockIds.has(body.blockId)) continue;
      if (baseOpacity < 0.005) continue;
      // Cull: body is centred at (body.x, body.y); conservative radius = longSide/2.
      const bodyR = body.longSide / 2;
      if (body.x + bodyR < cullLeft || body.x - bodyR > cullRight ||
          body.y + bodyR < cullTop  || body.y - bodyR > cullBot) continue;
      if (fading) {
        ctx.save();
        ctx.globalAlpha = fadeAlpha(body.blockId, blockBranchId.get(body.blockId));
        paintBody(ctx, body, r, g, b, baseOpacity, softness, styling.sun, "follow-tangent");
        ctx.restore();
      } else {
        paintBody(ctx, body, r, g, b, baseOpacity, softness, styling.sun, "follow-tangent");
      }
    }
    const __tBodies1 = performance.now();

    // ── 3. Projection rays ────────────────────────────────────────────────────
    const __tRays0 = performance.now();
    const ray = styling.projection.ray;
    const [rr, rg, rb] = parseHexColor(ray.stroke);
    ctx.strokeStyle = `rgba(${rr},${rg},${rb},${ray.opacity})`;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.globalAlpha = 1;

    for (const rp of rayParams) {
      // Furl cull: skip rays whose block is hidden by unfurling state.
      if (hiddenBlockIds.has(rp.blockId) || expandAffordanceBlockIds.has(rp.blockId)) continue;
      // Cull: skip rays whose AABB is entirely outside the inflated viewport.
      const rMinX = Math.min(rp.x0, rp.x1);
      const rMaxX = Math.max(rp.x0, rp.x1);
      const rMinY = Math.min(rp.y0, rp.y1);
      const rMaxY = Math.max(rp.y0, rp.y1);
      if (rMaxX < cullLeft || rMinX > cullRight || rMaxY < cullTop || rMinY > cullBot) continue;
      // Depth-scaled world width (rp.w), floored to a min SCREEN width so rays
      // still read when zoomed out (the floor only bites at wide zoom).
      ctx.lineWidth = Math.max(rp.w, MIN_RAY_SCREEN_PX / scale);
      if (fading) {
        ctx.save();
        ctx.globalAlpha = fadeAlpha(rp.blockId, blockBranchId.get(rp.blockId));
        ctx.beginPath();
        ctx.moveTo(rp.x0, rp.y0);
        ctx.lineTo(rp.x1, rp.y1);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(rp.x0, rp.y0);
        ctx.lineTo(rp.x1, rp.y1);
        ctx.stroke();
      }
    }
    const __tRays1 = performance.now();

    // ── 4. LOD labels at ray endpoints ────────────────────────────────────────
    // Drawn in SCREEN space (CSS px) to get integer quantized font sizes that
    // hit the browser's font-resolution cache across labels and redraws.
    // The geometry pass above (stems/bodies/rays) stays in world space.
    const __tLabels0 = performance.now();
    let __decisionsMs = 0;
    let __visibleLabels = 0;
    if (currentGetDecisions && labelParams.length > 0) {
      // Pass the FULL canvas extent (overscan) + the canvas-origin offset so the
      // cascade mounts peripheral branches too — otherwise the overscan would
      // still be unpainted (mountedBranch gates on the viewport).
      const viewport = { width: cssWidth, height: cssHeight };
      const view = { tx: txc, ty: tyc, scale };
      const __td0 = performance.now();
      const decisions = currentGetDecisions(view, viewport);
      __decisionsMs = performance.now() - __td0;
      // Cache for hitTest — reflects what was actually shown in this frame.
      lastDecisions = decisions;

      // ── Collect visible labels ─────────────────────────────────────────────
      // We need to sort by quantized font size before drawing, so build a
      // temporary array of visible entries first (avoids a second decisions lookup).
      interface VisibleLabel {
        lp: LabelParams;
        decision: import("./cascade-pass.ts").BlockDecision;
        /** Screen-space anchor in CSS px. */
        sx: number;
        sy: number;
        /** Quantized integer font size in CSS px (screen space). */
        fontPx: number;
      }
      const visibleLabels: VisibleLabel[] = [];

      for (const lp of labelParams) {
        // Furl cull: skip labels whose block is hidden by unfurling state.
        if (hiddenBlockIds.has(lp.blockId) || expandAffordanceBlockIds.has(lp.blockId)) continue;
        let decision = decisions.get(lp.blockId);
        const forceMeristem = stableMeristems && lp.kind === "meristem";
        if (forceMeristem) {
          // Growth render: EVERY meristem title (incl. the root) must show as
          // stable full-text — regardless of the per-frame label budget or the
          // cull/tier verdict (which flips as subtree size + zoom change and
          // would blink/drop text between frames). The cascade may return NO
          // decision for a meristem when it's dropped by the per-frame budget;
          // synthesise one in that case so the label is never skipped.
          if (decision) {
            decision = { ...decision, show: true, tier: "full" };
          } else {
            const effShort = lp.baseWorldFontSize / Math.max(styling.projection.titleSize, 1e-6);
            const forcedPx = Math.max(lp.baseWorldFontSize * scale, 12);
            decision = {
              targetPx: forcedPx,
              tier: "full",
              show: true,
              kBase: forcedPx,
              effectiveShortSide: effShort,
            };
          }
        }
        if (!decision || !decision.show) continue;

        // Cull: skip labels whose anchor point is outside the inflated viewport.
        // The label extends from the anchor outward, so also check the node
        // position (ray origin) — keep if either is inside the viewport.
        // Meristems in growth render are exempt: they must never be dropped.
        if (!forceMeristem) {
          const anchorIn = lp.anchorX >= cullLeft && lp.anchorX <= cullRight &&
                           lp.anchorY >= cullTop  && lp.anchorY <= cullBot;
          const nodeIn   = lp.nodeX >= cullLeft && lp.nodeX <= cullRight &&
                           lp.nodeY >= cullTop  && lp.nodeY <= cullBot;
          if (!anchorIn && !nodeIn) continue;
        }

        __visibleLabels++;

        // Project the world-space anchor into CSS px (canvas screen space).
        // World→canvas-screen: sx = anchorX * scale + txc (txc = tx + overscan
        // offset). The dpr transform set below handles device scaling.
        const sx = lp.anchorX * scale + txc;
        const sy = lp.anchorY * scale + tyc;

        // Quantized integer screen font size — bounded, repeats across labels
        // and redraws as zoom changes by sub-pixel amounts → font cache hits.
        // Clamped to the kind's peak so a forced/over-peak title (stableMeristems,
        // or a tight unfurl zoom) can't balloon unbounded — a no-op at rest,
        // where targetPx is already ≤ peak.
        const peak = labelPeakPx(lp, styling);
        const fontPx = clampFontToPeak(decision.targetPx, peak);

        visibleLabels.push({ lp, decision, sx, sy, fontPx });
      }

      // Sort by fontPx ascending so we can batch ctx.font writes.
      visibleLabels.sort((a, b) => a.fontPx - b.fontPx);

      // ── Switch to screen / device space for text ───────────────────────────
      // dpr-only transform: 1 unit = 1 CSS px, device scaling handled by dpr.
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ── Agent-branch beacons ───────────────────────────────────────────────
      // A min-size pulsing glow at each agent-bound meristem so the branch stays
      // findable when zoomed out (its stem + label shrink below visibility; the
      // glow's radius is floored to a screen minimum). The glow FADES IN as the
      // branch shrinks and OUT as you zoom in and the branch becomes legible, so
      // it never clutters up close. Uses the same pulse + the branch's colour(s).
      if (styling.agentGlow.orb && meristemColorsByBlockId.size > 0) {
        const GLOW_MIN_PX = 22;     // halo never shrinks below this
        const GLOW_FADE_FROM = 6;   // full glow when the meristem font ≤ 6px (far)
        const GLOW_FADE_TO = 16;    // glow gone when the meristem font ≥ 16px (near)
        for (const lp of labelParams) {
          if (lp.kind !== "meristem") continue;
          // Furl cull: skip the glow halo for a meristem hidden by unfurling
          // state — otherwise a furled tinted branch would still beacon even
          // though its stem/body/label are culled above.
          if (hiddenBlockIds.has(lp.blockId) || expandAffordanceBlockIds.has(lp.blockId)) continue;
          const colors = meristemColorsByBlockId.get(lp.blockId);
          if (!colors) continue;
          const bx = lp.nodeX * scale + txc;
          const by = lp.nodeY * scale + tyc;
          if (bx < -GLOW_MIN_PX || bx > cssWidth + GLOW_MIN_PX ||
              by < -GLOW_MIN_PX || by > cssHeight + GLOW_MIN_PX) continue;
          const screenFont = lp.intrinsicFontSize * scale;
          const fade = Math.max(0, Math.min(1, (GLOW_FADE_TO - screenFont) / (GLOW_FADE_TO - GLOW_FADE_FROM)));
          if (fade <= 0) continue;
          const r = Math.max(GLOW_MIN_PX, screenFont * 1.6);
          const [gr, gg, gb] = tintRgb(colors);
          const a = pulseAlpha() * fade * 0.85;
          const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
          grad.addColorStop(0, `rgba(${gr},${gg},${gb},${a})`);
          grad.addColorStop(0.45, `rgba(${gr},${gg},${gb},${a * 0.5})`);
          grad.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = styling.projection.lightOpacity;

      let lastFontPx = -1;

      for (const { lp, decision, sx, sy, fontPx } of visibleLabels) {
        const agentColors = lp.kind === "meristem" ? meristemColorsByBlockId.get(lp.blockId) : undefined;
        const multiLabel = !!agentColors && agentColors.length > 1;
        const agentLabel = agentColors ? tintColor(agentColors) : undefined;
        ctx.fillStyle = selectedBlockIds.has(lp.blockId) ? SELECTED_LABEL_COLOR : (agentLabel ?? lp.color);
        if (agentLabel) { ctx.save(); ctx.globalAlpha = multiLabel ? 1 : pulseAlpha(); }
        // Reveal fade (Task 8) + lief-text-reveal (unfurl entry animation):
        // multiplies whatever alpha is already active (lightOpacity, or the
        // agent-pulse value just set above) — wraps the WHOLE per-label draw
        // (every tier + the lief summary block + pips), closed by the
        // matching restore before the agentLabel restore below. `labelFading`
        // adds the lief/meristem reveal channel on top of the shared `fading`
        // gate (which stays body/ray-only otherwise) so a lief-text-reveal
        // < 1 doesn't touch bodies/rays. No-op (no save/restore at all) while
        // nothing is revealing/fading/lief-text-reveal-active for this label.
        const inRevealScope =
          liefTextRevealScope !== null && liefTextRevealScope.has(lp.blockId);
        const labelFading =
          fading ||
          ((lp.kind === "lief" || lp.kind === "meristem") && liefTextReveal < 1 && inRevealScope);
        if (labelFading) { ctx.save(); ctx.globalAlpha *= fadeAlpha(lp.blockId, lp.branchId, lp.kind); }

        if (decision.tier === "full") {
          // ── "full" tier: wrapped text lines ────────────────────────────────
          // Set ctx.font only when fontPx changes — cache-friendly.
          if (fontPx !== lastFontPx) {
            ctx.font = `${fontPx}px ${LABEL_FAMILY}`;
            lastFontPx = fontPx;
          }
          ctx.textAlign = lp.anchorH === "center" ? "center" : lp.anchorH === "right" ? "right" : "left";

          // Wrap calc uses intrinsic (zoom-independent) font size so wrapping
          // matches the SVG — same as before, unchanged.
          const maxCharsPerLine = Math.max(6, Math.floor((lp.boxLength * LABEL_MAX_WIDTH_FACTOR) / (lp.intrinsicFontSize * LABEL_CHAR_WIDTH_EM)));
          const lines = wrapText(lp.label, maxCharsPerLine);
          const lineH = fontPx * LABEL_LINE_HEIGHT; // screen px

          // Lief summary block (see draw call below): work out up front whether
          // one will be drawn and, if so, how many lines/how tall — needed here
          // so the "bottom" anchor (ray points up, lief above the branch) can
          // reserve room for the summary UNDER the title instead of overshooting
          // past the ray tip. Cheap to compute; the actual paragraph draw stays
          // where it was, using these same values.
          const hasBlock =
            styling.liefBlock.mode === "block" &&
            lp.kind === "lief" &&
            !!lp.blockLayout &&
            lp.blockLayout.lines.length > 0 &&
            !!lp.blockSizeRatio;
          const blockFontPx = hasBlock ? fontPx * lp.blockSizeRatio! : 0;
          const blockLineH = hasBlock ? blockFontPx * LABEL_LINE_HEIGHT : 0;
          const blockLineCount = hasBlock ? lp.blockLayout!.lines.length : 0;

          // Vertical offset in screen px — same anchor semantics as world-space version.
          let yStart: number;
          if (lp.anchorV === "top") {
            yStart = sy;
          } else if (lp.anchorV === "bottom") {
            // Lief above the branch: the ray tip (sy) is the corner nearest the
            // branch, so the LAST line of text — the summary block's last line
            // when one is drawn, otherwise the title's last line — must land at
            // sy. Reserve the block's height above the title's own reservation.
            yStart = sy - (lines.length - 1) * lineH - blockLineCount * blockLineH;
          } else {
            // "middle"
            yStart = sy - ((lines.length - 1) * lineH) / 2;
          }

          // fillStyle was set for THIS label at the top of the loop (selected /
          // agent-tint / lp.color); set it again explicitly here so the title
          // never inherits a stray fillStyle left behind by the lief block draw
          // below (which sets its own dim fill for the summary text).
          ctx.fillStyle = selectedBlockIds.has(lp.blockId) ? SELECTED_LABEL_COLOR : (agentLabel ?? lp.color);
          ctx.textBaseline = "alphabetic";
          for (let li = 0; li < lines.length; li++) {
            ctx.fillText(lines[li]!, sx, yStart + li * lineH);
          }

          // Seed-coral-root badge: a small hollow ring marking a root — its
          // OWN Growth Charter.md / legacy CLAUDE.md governs it (obsidian-
          // plugin/src/coral-lifecycle.ts's seededRootPaths computes the set;
          // sub-corals never match). Pip-like geometry so it reads as kin to
          // the agent pips below, but hollow + at reduced alpha so it's never
          // mistaken for one. Gated by agentGlow.seedBadges — default OFF (the
          // website/Studio have no such folders); the plugin opts in. Sits in
          // the FIRST past-label slot; the pips (below) start one slot further
          // out when a ring is drawn, so the two never overlap.
          let seedBadgeSteps = 0;
          const drawSeedBadge =
            styling.agentGlow.seedBadges && lp.kind === "meristem" && seedBadgeBlockIds.has(lp.blockId);
          const drawPips = Boolean(multiLabel && agentColors && styling.agentGlow.pips);
          // Distance from `sx` (the fillText anchor) out to the label's
          // RENDERED right edge — depends on ctx.textAlign, set above from
          // lp.anchorH (~1087). "left"/"right" anchor sx at one edge of the
          // text (right edge = sx + textW away from the anchor, in pdir's
          // direction), but "center" (the root/wordmark title, and the only
          // centred alignment) anchors sx on the MIDDLE of the text — its
          // right edge is only textW / 2 out, not textW. Using textW
          // unconditionally here used to overshoot centred labels by
          // textW / 2 (founder-observed: the root ring floating off by
          // about half the label's width). Shared by the ring and the pips,
          // measured once per label per frame.
          let textPastSx = 0;
          if (drawSeedBadge || drawPips) {
            const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
            textPastSx = lp.anchorH === "center" ? textW / 2 : textW;
          }
          if (drawSeedBadge) {
            const ringR = fontPx * 0.18; // same radius as a pip — "pip-like geometry"
            const gap = fontPx * 0.4;
            const pdir = lp.anchorH === "right" ? -1 : 1;
            const ringY = yStart - fontPx * 0.3; // roughly centred on the cap height
            ctx.save();
            ctx.globalAlpha *= SEED_BADGE_RING_ALPHA;
            ctx.strokeStyle = ctx.fillStyle; // the title's own colour (selected / agent-tint / lp.color)
            ctx.lineWidth = Math.max(1, fontPx * 0.09);
            ctx.beginPath();
            ctx.arc(sx + pdir * (textPastSx + gap + ringR), ringY, ringR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            seedBadgeSteps = 1; // pips (below) shift out by one pipStep to clear the ring
          }

          // Multi-agent: a row of colour pips past the label, one per terminal,
          // so you can count the agents and see each colour at a glance. Gated by
          // agentGlow.pips (off on the website, where a multi-colour tint is a
          // decorative glow cross-fade, not a terminal count — the pips would read
          // as stray agent dots on a section like Case Studies).
          if (drawPips && agentColors) {
            const pipR = fontPx * 0.18;
            const pipStep = fontPx * 0.5;
            const gap = fontPx * 0.4;
            const pdir = lp.anchorH === "right" ? -1 : 1;
            const pipY = yStart - fontPx * 0.3; // roughly centred on the cap height
            const startX = sx + pdir * (textPastSx + gap + pipR + seedBadgeSteps * pipStep);
            ctx.globalAlpha = 1;
            for (let k = 0; k < agentColors.length; k++) {
              ctx.fillStyle = agentColors[k]!;
              ctx.beginPath();
              ctx.arc(startX + pdir * k * pipStep, pipY, pipR, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Lief summary block: the smaller justified paragraph beneath the
          // title. Config-gated (mode "block") + only when Task 3's layout
          // pass actually produced lines for this lief (no summary, or
          // fan-slot too crowded -> blockLayout is null and this is a no-op).
          if (hasBlock) {
            const blockYStart = yStart + lines.length * lineH;
            drawLiefBlock(ctx, lp.blockLayout!, {
              sx,
              blockYStart,
              blockFontPx,
              blockLineH,
              anchorH: lp.anchorH,
              fill: LIEF_BLOCK_FILL,
              family: LABEL_FAMILY,
              justify: styling.liefBlock.justify,
            });
            // The block draw just changed ctx.font to the (smaller) block
            // size — invalidate the font cache so the NEXT title's font-size
            // check (`fontPx !== lastFontPx`) can't false-hit and leave
            // ctx.font stuck at the block's size.
            lastFontPx = -1;
          }
        } else if (decision.tier === "dot-glyphs") {
          // ── "dot-glyphs" tier: one filled circle per non-space char ────────
          // Wrap calc uses intrinsic (zoom-independent) font size — unchanged.
          const maxCharsPerLine = Math.max(6, Math.floor((lp.boxLength * LABEL_MAX_WIDTH_FACTOR) / (lp.intrinsicFontSize * LABEL_CHAR_WIDTH_EM)));
          const lines = wrapText(lp.label, maxCharsPerLine);
          const lineH = fontPx * LABEL_LINE_HEIGHT; // screen px
          const dotR = fontPx * 0.15;               // screen px
          const dotCharWidth = fontPx * LABEL_CHAR_WIDTH_EM; // screen px

          // Direction multiplier so dots extend away from branch.
          const dir = lp.anchorH === "right" ? -1 : 1;

          // Vertical baseline in screen px — same logic as full tier.
          let yStart: number;
          if (lp.anchorV === "top") {
            yStart = sy;
          } else if (lp.anchorV === "bottom") {
            yStart = sy - (lines.length - 1) * lineH;
          } else {
            yStart = sy - ((lines.length - 1) * lineH) / 2;
          }

          ctx.beginPath();
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li]!;
            const lineY = yStart + li * lineH;
            let charIdx = 0;
            for (let ci = 0; ci < line.length; ci++) {
              if (line[ci] === " ") { charIdx++; continue; }
              const cx = sx + dir * charIdx * dotCharWidth;
              ctx.moveTo(cx + dotR, lineY);
              ctx.arc(cx, lineY, dotR, 0, Math.PI * 2);
              charIdx++;
            }
          }
          ctx.fill();
        } else {
          // ── "single-dot" tier: one circle at the anchor ────────────────────
          const dotR = fontPx * 0.3; // screen px
          ctx.beginPath();
          ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
        if (labelFading) { ctx.restore(); }
        if (agentLabel) { ctx.restore(); }
      }

      // Restore world transform (geometry below draws in world space).
      ctx.restore();
      ctx.setTransform(s, 0, 0, s, tx * dpr, ty * dpr);
      ctx.globalAlpha = 1;
    }
    const __tLabels1 = performance.now();

    // ── 5. Selection ──────────────────────────────────────────────────────────
    // No ring: the selected block is shown by drawing its LABEL in a darker amber
    // (SELECTED_LABEL_COLOR, applied in the label loop above). Nothing to do here.
    // NOTE: the old placeholder dot loop (collectDotPositions / block.position)
    // has been removed — it was a Slice-1 stand-in. The real dot representation
    // is the "single-dot" tier rendered above at the ray endpoint.
    __redrawCount++;
    // Perf instrumentation — gated behind window.__LIEF_PERF so it's available
    // for tuning but silent by default. Set window.__LIEF_PERF = true to log.
    if ((window as unknown as { __LIEF_PERF?: boolean }).__LIEF_PERF) {
    const __total = performance.now() - __t0;
    const __stemsMs = __tStems1 - __tStems0;
    const __bodiesMs = __tBodies1 - __tBodies0;
    const __raysMs = __tRays1 - __tRays0;
    const __labelsMs = __tLabels1 - __tLabels0;
    console.debug(
      `[skeleton] redraw#${__redrawCount} total=${__total.toFixed(1)}ms` +
      ` · decisions=${__decisionsMs.toFixed(1)}ms stems=${__stemsMs.toFixed(1)}ms` +
      ` bodies=${__bodiesMs.toFixed(1)}ms rays=${__raysMs.toFixed(1)}ms` +
      ` labels=${__labelsMs.toFixed(1)}ms` +
      ` · ${__visibleLabels}/${labelParams.length} visible/total labels`,
    );
    }
  };

  const onWinResize = (): void => resize();
  resize();
  win.addEventListener("resize", onWinResize);
  // DPR can change without a resize event (pop-out dragged to a different-DPR
  // monitor at the same CSS size). resize() re-reads win.devicePixelRatio.
  const stopDprWatch = watchDevicePixelRatio(win, resize);
  // The Obsidian side panel / HUD opening (and other CSS layout changes) resize
  // the canvas WITHOUT firing window.resize. Observe the element directly so the
  // backing store + redraw track the new CSS size — otherwise the bitmap is
  // stretched/compressed and hit targets drift off the painted text.
  //
  // Construct from the CANVAS'S OWN window (`win`, resolved above), never the
  // global: in an Obsidian pop-out the canvas lives in another document, and
  // observations are gathered per-document — a main-window observer never fires
  // for it. Until this used `win`, the paragraph above described exactly what
  // popped-out corals did on a pane split.
  const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  let ro: ResizeObserver | null = null;
  if (typeof RO !== "undefined") {
    ro = new RO(() => resize());
    ro.observe(canvas);
  }

  return {
    redraw,
    redrawLast() {
      redraw(lastTx, lastTy, lastScale);
    },
    setPlant(
      nextPlant: Plant,
      nextOpts?: SkeletonCanvasOptions,
      nextProjConfigById?: Map<string, ProjectionConfig>,
      nextMeristemLabelById?: Map<string, string> | null,
      nextBoostedBranchIds?: Set<string>,
    ) {
      plant = nextPlant;
      recomputeExpandAffordances(nextPlant);
      if (nextOpts !== undefined) currentOpts = nextOpts;
      if (nextProjConfigById !== undefined) currentProjConfigById = nextProjConfigById;
      if (nextMeristemLabelById !== undefined) currentMeristemLabelById = nextMeristemLabelById;
      if (nextBoostedBranchIds !== undefined) currentBoostedBranchIds = nextBoostedBranchIds;
      bodies = collectBodies(nextPlant);
      rayParams = collectRayParams(nextPlant, styling, currentProjConfigById);
      labelParams = collectLabelParams(
        nextPlant, styling, currentProjConfigById, currentMeristemLabelById, currentBoostedBranchIds,
        currentSummaryByName, measureUnit,
      );
      blockBranchId = buildBlockBranchId(nextPlant);
      // Rebuild the static stem geometry cache for the new plant.
      const [_sr, _sg, _sb] = parseHexColor(styling.stem.color);
      const _tOp = styling.v2Stem.tipOpacity;
      stemCache = buildStemCache(
        nextPlant, ctx,
        `rgba(${_sr},${_sg},${_sb},1)`,
        `rgba(${_sr},${_sg},${_sb},${_tOp})`,
      );
      redraw(lastTx, lastTy, lastScale);
    },
    updateStemWidthFn(fn: (branchId: string) => number) {
      currentOpts = { ...currentOpts, stemWidthForBranch: fn };
    },
    setSelected(blockId: string | null) {
      selectedBlockIds = blockId === null ? new Set() : new Set([blockId]);
      redraw(lastTx, lastTy, lastScale);
    },
    setSelectedMany(blockIds: ReadonlySet<string>) {
      selectedBlockIds = new Set(blockIds);
      redraw(lastTx, lastTy, lastScale);
    },
    setAgentTints(meristemColors: Map<string, string[]>, stemColors: Map<string, string[]>) {
      meristemColorsByBlockId = meristemColors;
      stemColorsByBranchId = stemColors;
      syncPulse();
      redraw(lastTx, lastTy, lastScale);
    },
    setSeedBadges(blockIds: ReadonlySet<string>) {
      seedBadgeBlockIds = blockIds;
      redraw(lastTx, lastTy, lastScale);
    },
    setSpectralShift(on: boolean) {
      spectralShift = on;
      redraw(lastTx, lastTy, lastScale);
    },
    setNodeMetadata(summaryByName: Map<string, string>) {
      currentSummaryByName = summaryByName;
      labelParams = collectLabelParams(
        plant, styling, currentProjConfigById, currentMeristemLabelById, currentBoostedBranchIds,
        currentSummaryByName, measureUnit,
      );
      redraw(lastTx, lastTy, lastScale);
    },
    setStableMeristems(on: boolean): void {
      stableMeristems = on;
    },
    setFurlState(nextHiddenBranchIds: ReadonlySet<string>, nextHiddenBlockIds: ReadonlySet<string>): void {
      hiddenBranchIds = nextHiddenBranchIds;
      hiddenBlockIds = nextHiddenBlockIds;
      redraw(lastTx, lastTy, lastScale);
    },
    setBlockAlpha(alphaById: Map<string, number> | null): void {
      // Store only — the transition-frame caller drives setPlant → redraw right
      // after, so a redraw here would paint against the stale plant.
      currentAlphaById = alphaById;
    },
    setLiefTextReveal(frac: number, scopeBlockIds: ReadonlySet<string> | null = null): void {
      // Store only — mirrors setBlockAlpha: the caller drives the redraw.
      liefTextReveal = clampUnitInterval(frac);
      liefTextRevealScope = scopeBlockIds;
    },
    beginReveal(branchIds: string[], durationMs: number): void {
      if (branchIds.length === 0) return;
      // A fresh call supersedes/extends any in-flight reveal: restart the
      // start time for every listed branch (including ones already tracked)
      // and adopt the new duration for the whole map.
      // WIN's clock, not the ambient one: the reveal loop runs on
      // win.requestAnimationFrame, and a pop-out window's performance
      // timeline has its own origin — mixing clocks breaks the ramp there.
      const now = win.performance.now();
      revealDurationMs = durationMs;
      for (const branchId of branchIds) revealStartByBranch.set(branchId, now);
      if (revealRaf === null) {
        revealRaf = win.requestAnimationFrame(revealLoop);
      }
    },
    hitTest(worldX: number, worldY: number, scale: number): string | null {
      // Click target = the label's TEXT box (built by the same geometry as the
      // draw pass, in label-box.ts, so it can't drift from the painted glyphs),
      // PLUS the collapsed single-dot at the anchor when text is hidden. Meristems
      // are ALSO hittable on their node dot; a bare lief block on a stem (the node
      // position) is not a target — only its painted label/dot is.
      const s = scale;
      const PAD = 4; // px of slack around the glyph box
      let bestId: string | null = null;
      let bestDist = Infinity;

      for (const lp of labelParams) {
        const decision = lastDecisions.get(lp.blockId);
        // Only hit-test blocks that were shown in the last frame.
        if (!decision || !decision.show) continue;

        // Click position relative to the label anchor, in screen px.
        const relX = (worldX - lp.anchorX) * s;
        const relY = (worldY - lp.anchorY) * s;

        // Text box — only where text is actually painted (full / dot-glyphs tiers).
        let textHit = false;
        // Lief summary-block box — the wrapped paragraph drawn under/over the
        // title at the "full" tier (drawLiefBlock, above). Computed here from
        // the SAME geometry the draw pass uses (skeleton-canvas.ts ~748-844)
        // so the click region can't drift from the painted glyphs. Union'd
        // with the title box below: a click on either hits the lief.
        let blockHit = false;
        if (decision.tier === "full" || decision.tier === "dot-glyphs") {
          const peak = labelPeakPx(lp, styling);
          const fontPx = clampFontToPeak(decision.targetPx, peak);
          const box = labelScreenBox(
            {
              label: lp.label,
              boxLength: lp.boxLength,
              intrinsicFontSize: lp.intrinsicFontSize,
              fontPx,
              anchorH: lp.anchorH,
              anchorV: lp.anchorV,
            },
            (t, fp) => {
              ctx.font = `${fp}px ${LABEL_FAMILY}`;
              return ctx.measureText(t).width;
            },
          );
          textHit =
            relX >= box.minX - PAD && relX <= box.maxX + PAD &&
            relY >= box.minY - PAD && relY <= box.maxY + PAD;

          // The summary block only ever draws at the "full" tier (dot-glyphs
          // never shows it — mirrors the `decision.tier === "full"` gate at
          // skeleton-canvas.ts:748).
          if (decision.tier === "full") {
            const hasBlock =
              styling.liefBlock.mode === "block" &&
              lp.kind === "lief" &&
              !!lp.blockLayout &&
              lp.blockLayout.lines.length > 0 &&
              !!lp.blockSizeRatio;
            if (hasBlock) {
              const titleLines = box.lines;
              const lineH = box.lineH;
              const blockFontPx = fontPx * lp.blockSizeRatio!;
              const blockLineH = blockFontPx * LABEL_LINE_HEIGHT;
              const blockLineCount = lp.blockLayout!.lines.length;

              // Same yStart branching as the draw pass (skeleton-canvas.ts
              // ~780-792), with the `sy` term dropped since relX/relY are
              // already anchor-relative.
              let yStart: number;
              if (lp.anchorV === "top") {
                yStart = 0;
              } else if (lp.anchorV === "bottom") {
                yStart = -(titleLines.length - 1) * lineH - blockLineCount * blockLineH;
              } else {
                yStart = -((titleLines.length - 1) * lineH) / 2;
              }
              // Mirrors skeleton-canvas.ts:828 (`blockYStart = yStart + lines.length * lineH`).
              const blockYStart = yStart + titleLines.length * lineH;

              // Native measurement, matching drawLiefBlock's own re-measure
              // (skeleton-canvas.ts:250-264) rather than the layout's cached
              // (font-size-normalized) `width`, which can drift from the
              // actual shaped glyph run. Localized to this click handler —
              // the next redraw resets ctx.font regardless.
              ctx.font = `${blockFontPx}px ${LABEL_FAMILY}`;
              let blockWidth = 0;
              for (const line of lp.blockLayout!.lines) {
                const w = ctx.measureText(line.words.join(" ")).width;
                if (w > blockWidth) blockWidth = w;
              }

              const blockMinX = lp.anchorH === "right" ? -blockWidth : lp.anchorH === "center" ? -blockWidth / 2 : 0;
              const blockMaxX = lp.anchorH === "right" ? 0 : lp.anchorH === "center" ? blockWidth / 2 : blockWidth;
              // Alphabetic baseline: ascent above the first line's baseline,
              // descent below the last line's — same convention as labelScreenBox.
              const blockMinY = blockYStart - blockFontPx;
              const blockMaxY = blockYStart + (blockLineCount - 1) * blockLineH + blockFontPx * 0.25;

              blockHit =
                relX >= blockMinX - PAD && relX <= blockMaxX + PAD &&
                relY >= blockMinY - PAD && relY <= blockMaxY + PAD;
            }
          }
        }

        // Collapsed tier: the label is a single dot drawn at the anchor — make
        // that dot clickable so a node shown only as a dot can still be selected.
        let anchorDotHit = false;
        let anchorScreenDist = Infinity;
        if (decision.tier === "single-dot") {
          const adx = lp.anchorX - worldX;
          const ady = lp.anchorY - worldY;
          anchorScreenDist = Math.sqrt(adx * adx + ady * ady) * s;
          const peak = labelPeakPx(lp, styling);
          const fontPx = clampFontToPeak(decision.targetPx, peak);
          anchorDotHit = anchorScreenDist <= Math.max(fontPx * 0.3, 10) + PAD;
        }

        // Node dot — meristems only (a bare lief block on the stem isn't a target).
        let dotHit = false;
        let nodeScreenDist = Infinity;
        if (lp.kind === "meristem") {
          const dnx = lp.nodeX - worldX;
          const dny = lp.nodeY - worldY;
          nodeScreenDist = Math.sqrt(dnx * dnx + dny * dny) * s;
          dotHit = nodeScreenDist <= Math.max(decision.targetPx * 0.5, 14);
        }

        if (!textHit && !blockHit && !anchorDotHit && !dotHit) continue;
        // Prefer text/block hits (dist 0); then the collapsed dot / node dot, nearest wins.
        const dist = (textHit || blockHit) ? 0 : Math.min(anchorScreenDist, nodeScreenDist);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = lp.blockId;
        }
      }

      return bestId;
    },
    destroy() {
      if (pulseRaf !== null) {
        win.cancelAnimationFrame(pulseRaf);
        pulseRaf = null;
      }
      if (revealRaf !== null) {
        win.cancelAnimationFrame(revealRaf);
        revealRaf = null;
      }
      win.removeEventListener("resize", onWinResize);
      stopDprWatch();
      ro?.disconnect();
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** blockId -> owning branchId for every block. Bodies/rays are collected as
 *  BodyParams/RayParams (blockId only, no branchId) — this is how their draw
 *  loops resolve the reveal-alpha bucket (keyed by branchId) for a given
 *  item. Rebuilt alongside bodies/rayParams/labelParams in setPlant. */
function buildBlockBranchId(plant: Plant): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of plant.blocks) map.set(block.id, block.branchId);
  return map;
}

type RayParams = { x0: number; y0: number; x1: number; y1: number; w: number; blockId: string };

/** Pre-compute ray segment endpoints for all lief/meristem blocks.
 *  Mirrors stencilProjectedInner's <line class="light-ray"> geometry:
 *  the ray starts at block.position and extends in the sunAzimuth direction
 *  by shortSide * distance world units. */
function collectRayParams(
  plant: Plant,
  styling: StylingConfig,
  projectionConfigByBlockId?: Map<string, ProjectionConfig>,
): RayParams[] {
  const rays: RayParams[] = [];
  const proj = styling.projection;
  // Depth-scale the ray width like the stem width: `ray.width` is the depth-0
  // world width, scaled by the block's relative size (shortSide / baseSize =
  // childScale^(depth·phiOrder)). Without this, deep rays kept the flat
  // world-unit width and rendered chunky when zoomed in (the same floor bug the
  // stems had). baseSize = the depth-0 (stem) block size.
  const baseSize = plant.branches.find((b) => b.depth === 0)?.shortSide ?? 40;

  for (const block of plant.blocks) {
    if (block.kind !== "lief" && block.kind !== "meristem") continue;

    // Use per-block config when available (respects fan offsets + distance ramp).
    const blockCfg = projectionConfigByBlockId?.get(block.id);

    let sunAz: number;
    let distance: number;

    if (block.kind === "lief") {
      const liefRelativeAngle = blockCfg?.liefRelativeAngle ?? proj.liefRelativeAngle;
      const geom: LiefGeom = { tangent: block.tangent, side: block.side };
      sunAz = liefSunAzimuth(geom, liefRelativeAngle);
      distance = blockCfg?.liefDistance ?? proj.liefDistance;
    } else {
      // meristem
      const meristemRelativeAngle = blockCfg?.meristemRelativeAngle ?? proj.meristemRelativeAngle;
      sunAz = meristemSunAzimuth({ tangent: block.tangent }, meristemRelativeAngle);
      // Root meristem uses rootMeristemDistance (mirrors buildProjectionConfigMap).
      const rootBranch = plant.branches[0];
      const isRoot = rootBranch
        ? plant.blocks.find((b) => b.kind === "meristem" && b.branchId === rootBranch.id)?.id === block.id
        : false;
      distance = isRoot
        ? (blockCfg?.meristemDistance ?? proj.rootMeristemDistance)
        : (blockCfg?.meristemDistance ?? proj.meristemDistance);
    }

    const origin = { x: block.position.x, y: block.position.y };
    const endpoint = rayEndpoint(origin, sunAz, block.shortSide, distance);
    const w = proj.ray.width * (block.shortSide / baseSize);
    rays.push({ x0: origin.x, y0: origin.y, x1: endpoint.x, y1: endpoint.y, w, blockId: block.id });
  }

  return rays;
}

/** Plant bounds expanded to include every projected label-ray endpoint.
 *
 *  `plant.bounds` is the node footprint only (block positions ± shortSide); the
 *  meristem/lief labels are projected OUTWARD along their rays by
 *  `shortSide * distance` world units — most dramatically the root title, which
 *  uses `rootMeristemDistance`. On a large plant those rays are a rounding error,
 *  but on a brand-new coral they dwarf the branch, so fitting bare `plant.bounds`
 *  leaves the root/meristem titles offscreen. Fitting THIS bounds keeps every
 *  label in frame at any plant size. Pure — reuses the renderer's exact ray
 *  geometry (collectRayParams), so it can't drift from what's drawn. */
/** World-space AABB of a label's WRAPPED title text — anchored by its
 *  anchorH/anchorV exactly as the draw pass positions it (same maxCharsPerLine
 *  wrap + line height), using the intrinsic (zoom-independent) world font size.
 *  So a fit that unions these keeps every title FULLY on-screen — not just its
 *  ray anchor, whose text can still spill past the frame (notably the big,
 *  far-flung root title crowding the side panel). */
function labelTextBoxWorld(lp: LabelParams): Bounds {
  const maxChars = Math.max(
    6,
    Math.floor((lp.boxLength * LABEL_MAX_WIDTH_FACTOR) / (lp.intrinsicFontSize * LABEL_CHAR_WIDTH_EM)),
  );
  const lines = wrapText(lp.label, maxChars);
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = maxLen * lp.intrinsicFontSize * LABEL_CHAR_WIDTH_EM;
  const h = Math.max(1, lines.length) * lp.intrinsicFontSize * LABEL_LINE_HEIGHT;
  const ax = lp.anchorX;
  const ay = lp.anchorY;
  // anchorH: "right" → text sits to the LEFT of the anchor; "left" → to the
  // right; "center" → straddles. anchorV: "bottom" → text ABOVE; "top" → below.
  const minX = lp.anchorH === "right" ? ax - w : lp.anchorH === "center" ? ax - w / 2 : ax;
  const maxX = lp.anchorH === "right" ? ax : lp.anchorH === "center" ? ax + w / 2 : ax + w;
  const minY = lp.anchorV === "bottom" ? ay - h : lp.anchorV === "middle" ? ay - h / 2 : ay;
  const maxY = lp.anchorV === "bottom" ? ay : lp.anchorV === "middle" ? ay + h / 2 : ay + h;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** TEXT-AWARE whole-plant fit bounds: plant geometry unioned with every title's
 *  wrapped world text box (labelTextBoxWorld), so "fit to window" never clips a
 *  title — including the root's long, right-anchored title. Reuses the exact
 *  label geometry + wrap the renderer draws (collectLabelParams), so it can't
 *  drift from what's painted. */
export function projectedContentBounds(
  plant: Plant,
  styling: StylingConfig,
  projectionConfigByBlockId?: Map<string, ProjectionConfig>,
): Bounds {
  const out: Bounds = {
    min: { x: plant.bounds.min.x, y: plant.bounds.min.y },
    max: { x: plant.bounds.max.x, y: plant.bounds.max.y },
  };
  for (const lp of collectLabelParams(plant, styling, projectionConfigByBlockId)) {
    const b = labelTextBoxWorld(lp);
    if (b.min.x < out.min.x) out.min.x = b.min.x;
    if (b.min.y < out.min.y) out.min.y = b.min.y;
    if (b.max.x > out.max.x) out.max.x = b.max.x;
    if (b.max.y > out.max.y) out.max.y = b.max.y;
  }
  return out;
}

/** TEXT-AWARE bounds for a SUBSET of blocks (by id): the AABB of those blocks'
 *  node positions AND their wrapped world title text boxes. Framing a branch on
 *  raw geometry (`branch.bounds`) excludes the meristem/root label rays AND the
 *  title text, so the camera over-zooms and clips titles. Fitting THIS keeps the
 *  framed subtree's titles fully in view. Returns null when `blockIds` matches
 *  nothing (caller falls back to raw bounds). */
export function projectedSubtreeBounds(
  plant: Plant,
  styling: StylingConfig,
  projectionConfigByBlockId: Map<string, ProjectionConfig> | undefined,
  blockIds: ReadonlySet<string>,
): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const b of plant.blocks) {
    if (blockIds.has(b.id)) ext(b.position.x, b.position.y);
  }
  for (const lp of collectLabelParams(plant, styling, projectionConfigByBlockId)) {
    if (!blockIds.has(lp.blockId)) continue;
    const b = labelTextBoxWorld(lp);
    ext(b.min.x, b.min.y);
    ext(b.max.x, b.max.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Pre-compute stable label parameters for all lief/meristem blocks.
 *  Uses per-block ProjectionConfig (fan offsets, distance ramp) when available.
 *  Called once per setPlant. */
function collectLabelParams(
  plant: Plant,
  styling: StylingConfig,
  projectionConfigByBlockId?: Map<string, ProjectionConfig>,
  meristemLabelByBlockId?: Map<string, string> | null,
  boostedBranchIds?: Set<string>,
  summaryByName?: Map<string, string> | null,
  measureUnit?: ((t: string) => number) | null,
): LabelParams[] {
  const params: LabelParams[] = [];
  const proj = styling.projection;

  // Root meristem identification (mirrors buildProjectionConfigMap in mount-plant).
  const rootBranch = plant.branches[0];
  const rootMeristemBlockId = rootBranch
    ? plant.blocks.find((b) => b.kind === "meristem" && b.branchId === rootBranch.id)?.id
    : undefined;

  // Lief typography ("block" mode) only. Skipped entirely in "label" mode
  // (default) — zero added cost for Studio/plugin call sites that never opt
  // into block mode.
  const liefBlockMode = styling.liefBlock.mode === "block";

  for (const block of plant.blocks) {
    if (block.kind !== "lief" && block.kind !== "meristem") continue;
    const blockName = (block as { name?: string }).name;
    if (!blockName) continue;

    const blockCfg = projectionConfigByBlockId?.get(block.id);

    let sunAz: number;
    let distance: number;

    if (block.kind === "lief") {
      const liefRelativeAngle = blockCfg?.liefRelativeAngle ?? proj.liefRelativeAngle;
      const geom: LiefGeom = { tangent: block.tangent, side: block.side };
      sunAz = liefSunAzimuth(geom, liefRelativeAngle);
      distance = blockCfg?.liefDistance ?? proj.liefDistance;
    } else {
      const meristemRelativeAngle = blockCfg?.meristemRelativeAngle ?? proj.meristemRelativeAngle;
      sunAz = meristemSunAzimuth({ tangent: block.tangent }, meristemRelativeAngle);
      const isRoot = block.id === rootMeristemBlockId;
      distance = isRoot
        ? (blockCfg?.meristemDistance ?? proj.rootMeristemDistance)
        : (blockCfg?.meristemDistance ?? proj.meristemDistance);
    }

    const origin = { x: block.position.x, y: block.position.y };
    const endpoint = rayEndpoint(origin, sunAz, block.shortSide, distance);

    // Root meristem: no position override — it uses the same tangent-derived
    // `endpoint` as every other meristem (its `distance` is already root-aware
    // via `proj.rootMeristemDistance` above). This matches the SVG renderer
    // (render.ts), which never special-cases the root's position, only its
    // distance. Only the horizontal anchor gets a root-specific rule below,
    // to preserve the centred look for the common vertical-root case.
    const isRootMeristem = block.kind === "meristem" && block.id === rootMeristemBlockId;

    // Label string: meristems may have an override; boosted branches get prefix.
    let label = blockName;
    if (block.kind === "meristem") {
      label = meristemLabelByBlockId?.get(block.id) ?? blockName;
      if (boostedBranchIds?.has(block.branchId)) {
        label = displayNameForBoosted(label);
      }
    }

    // Root horizontal anchor: near-vertical root tangents (the common case —
    // |cos sunAz| small) keep the centred look; a horizontal-ish root tangent
    // falls through to the generic edge-nearest-branch rule below. Threshold
    // mirrors the deadzone shape of `projectionVerticalAnchor` (projection.ts),
    // just mirrored onto cos instead of sin.
    const ROOT_ANCHOR_H_DEADZONE = 0.3;
    const anchorH: "right" | "left" | "center" = isRootMeristem && Math.abs(Math.cos(sunAz)) < ROOT_ANCHOR_H_DEADZONE
      ? "center"
      : Math.cos(sunAz) < 0 ? "right" : "left";
    // Anchor every projected label at the edge nearest its branch, so the ray
    // connects to the text's INNER edge rather than its centre (e.g. the vertical
    // root title attaches at its bottom edge). Meristems used to force "middle";
    // now they follow the ray direction like liefs.
    const anchorV: "top" | "middle" | "bottom" = projectionVerticalAnchor(sunAz);

    // Label sizing basis: the engine-baked `labelSize` (a world-level sizing
    // mechanism — see src/library/passes/size.ts), falling back to `shortSide`
    // for plants built by older engines. Text rendering only — geometry (the
    // rayEndpoint above, placement, hit node) stays on `shortSide`.
    const labelBasis = labelSizeBasis(block);
    // Base world font size at k=1: labelBasis × titleSize.
    const titleSize = blockCfg?.titleSize ?? proj.titleSize;
    const baseWorldFontSize = labelBasis * titleSize;
    // Intrinsic font size (zoom-independent) — used for wrap calc so wrapping
    // matches the SVG (which wraps using the intrinsic size, not worldFontSize).
    const intrinsicFontSize = labelBasis * titleSize;

    // Box length for word-wrap budget: labelBasis × PHI (same basis as the
    // font, so the per-line character budget is invariant under the knobs).
    const boxLength = labelBasis * PHI;

    // Per-block colour: from per-block config (which inherits per-branch overrides
    // from resolveProjectionConfig). Fall back to global styling defaults.
    const color = block.kind === "meristem"
      ? (blockCfg?.meristemLight ?? proj.meristemLight)
      : (block as { nonMd?: boolean }).nonMd === true
        ? FILE_LIEF_COLOR                         // colour by file type: non-md files read teal
        : (blockCfg?.light ?? proj.light);        // notes stay Star White

    // Lief summary-block layout (Task 2's computeLiefBlockLayout), cached here
    // since the summary text arrives late (a metadata sidecar fetched after
    // mount — see `setNodeMetadata`) but the layout itself is stable per plant.
    // Stays null (inert) in "label" mode or when no summary is available.
    let blockLayout: LiefBlockLayout | null = null;
    let blockSizeRatio: number | undefined;
    if (block.kind === "lief" && liefBlockMode && measureUnit) {
      const summary = summaryByName?.get(blockName);
      if (summary) {
        blockLayout = computeLiefBlockLayout(
          {
            summary,
            title: blockName,
            boxLength,
            intrinsicFontSize,
            sizeRatio: styling.liefBlock.sizeRatio,
            maxLines: styling.liefBlock.maxLines,
            justify: styling.liefBlock.justify,
          },
          measureUnit,
        );
        blockSizeRatio = styling.liefBlock.sizeRatio;
      }
    }

    params.push({
      blockId: block.id,
      anchorX: endpoint.x,
      anchorY: endpoint.y,
      nodeX: origin.x,
      nodeY: origin.y,
      sunAz,
      baseWorldFontSize,
      boxLength,
      intrinsicFontSize,
      label,
      anchorH,
      anchorV,
      kind: block.kind,
      branchId: block.branchId,
      color,
      blockLayout,
      ...(blockSizeRatio !== undefined ? { blockSizeRatio } : {}),
    });
  }
  return params;
}

/** Test-only export: `collectLabelParams` is module-private (called from
 *  `installSkeletonCanvas`'s closure), but Task 3's TDD needs to exercise it
 *  directly with a `Plant` fixture + fake `measureUnit`. */
export const __collectLabelParamsForTest = collectLabelParams;

/** Mirrors render.ts's `branchOrigin()` — resolves the world-space starting
 *  point of a branch curve. The branch origin is where sampleCurve's relative
 *  `point` vectors are added to obtain world coordinates. Exported for reuse
 *  by other callers needing the same origin lookup as the stems drawn here. */
export function branchOriginFor(
  branch: Branch,
  plant: Plant,
  blockById: Map<string, { position: { x: number; y: number } }>,
): { x: number; y: number } {
  if (branch.parentBranchId === null) return plant.anchor.position;
  if (!branch.parentBranchNodeId) return plant.anchor.position;
  const parent = blockById.get(branch.parentBranchNodeId);
  return parent ? parent.position : plant.anchor.position;
}
