import { test, expect } from "bun:test";
import {
  BRANCH_EMPHASIS_RANGE,
  DEFAULT_TEXT_SIZING,
  DEPTH_FALLOFF_RANGE,
  LIEF_TEXT_RANGE,
  MERISTEM_TEXT_RANGE,
  liefMaxLiftForOptimalSize,
  mergeTextSizing,
} from "../src/text-sizing.ts";
import { pluginDefaultStyling } from "../src/plugin-default-styling.ts";
import { coralEngineConfig } from "../src/engine-config.ts";

// ── mergeTextSizing: defaults + typed merge of the persisted blob ──────────

test("defaults equal the shipped styling — no visual change out of the box", () => {
  expect(DEFAULT_TEXT_SIZING).toEqual({
    optimalSize: pluginDefaultStyling.optimalSize,
    liefOptimalSize: pluginDefaultStyling.liefOptimalSize,
    attentionPropagationDecay: pluginDefaultStyling.attentionPropagationDecay,
    subtreeBoost: pluginDefaultStyling.subtreeBoost,
  });
  expect(mergeTextSizing(undefined)).toEqual(DEFAULT_TEXT_SIZING);
  expect(mergeTextSizing(null)).toEqual(DEFAULT_TEXT_SIZING);
  expect(mergeTextSizing({})).toEqual(DEFAULT_TEXT_SIZING);
});

test("defaults sit inside their slider ranges", () => {
  expect(DEFAULT_TEXT_SIZING.optimalSize).toBeGreaterThanOrEqual(MERISTEM_TEXT_RANGE.min);
  expect(DEFAULT_TEXT_SIZING.optimalSize).toBeLessThanOrEqual(MERISTEM_TEXT_RANGE.max);
  expect(DEFAULT_TEXT_SIZING.liefOptimalSize).toBeGreaterThanOrEqual(LIEF_TEXT_RANGE.min);
  expect(DEFAULT_TEXT_SIZING.liefOptimalSize).toBeLessThanOrEqual(LIEF_TEXT_RANGE.max);
  expect(DEFAULT_TEXT_SIZING.attentionPropagationDecay).toBeGreaterThanOrEqual(DEPTH_FALLOFF_RANGE.min);
  expect(DEFAULT_TEXT_SIZING.attentionPropagationDecay).toBeLessThanOrEqual(DEPTH_FALLOFF_RANGE.max);
  expect(DEFAULT_TEXT_SIZING.subtreeBoost).toBeGreaterThanOrEqual(BRANCH_EMPHASIS_RANGE.min);
  expect(DEFAULT_TEXT_SIZING.subtreeBoost).toBeLessThanOrEqual(BRANCH_EMPHASIS_RANGE.max);
});

test("partial blob: present keys merge, absent ones stay default", () => {
  expect(mergeTextSizing({ optimalSize: 90 })).toEqual({ ...DEFAULT_TEXT_SIZING, optimalSize: 90 });
  expect(mergeTextSizing({ attentionPropagationDecay: 0.6 }))
    .toEqual({ ...DEFAULT_TEXT_SIZING, attentionPropagationDecay: 0.6 });
});

test("branch emphasis: merges, clamps out of range, falls back when malformed", () => {
  expect(mergeTextSizing({ subtreeBoost: 0.4 })).toEqual({ ...DEFAULT_TEXT_SIZING, subtreeBoost: 0.4 });
  // A hand-edited data.json can't push the renderer past the slider's range.
  expect(mergeTextSizing({ subtreeBoost: 9 }).subtreeBoost).toBe(BRANCH_EMPHASIS_RANGE.max);
  expect(mergeTextSizing({ subtreeBoost: -3 }).subtreeBoost).toBe(BRANCH_EMPHASIS_RANGE.min);
  expect(mergeTextSizing({ subtreeBoost: "lots" }).subtreeBoost).toBe(DEFAULT_TEXT_SIZING.subtreeBoost);
});

test("malformed values fall back to the default", () => {
  expect(mergeTextSizing({ optimalSize: "big", liefOptimalSize: NaN, attentionPropagationDecay: Infinity }))
    .toEqual(DEFAULT_TEXT_SIZING);
  expect(mergeTextSizing("nonsense")).toEqual(DEFAULT_TEXT_SIZING);
});

test("out-of-range numbers clamp to the slider bounds", () => {
  expect(mergeTextSizing({ optimalSize: 500 }).optimalSize).toBe(MERISTEM_TEXT_RANGE.max);
  expect(mergeTextSizing({ liefOptimalSize: 1 }).liefOptimalSize).toBe(LIEF_TEXT_RANGE.min);
  expect(mergeTextSizing({ attentionPropagationDecay: -2 }).attentionPropagationDecay).toBe(DEPTH_FALLOFF_RANGE.min);
});

test("a pre-release persisted blob (textScale/textContrast) degrades to the defaults", () => {
  expect(mergeTextSizing({ textScale: 1.3, textContrast: 0.7 })).toEqual(DEFAULT_TEXT_SIZING);
});

// ── coralEngineConfig: the plugin's engine tuning is independent of sizing ──
// The user's knobs are the RENDERER's adaptive targets (optimalSize /
// liefOptimalSize / attentionPropagationDecay — see engine-config.ts); the
// engine config's own tuned defaults must keep layering over the library
// regardless of what the sizing settings do.

test("the plugin's tuned engine defaults still layer over the library", () => {
  const cfg = coralEngineConfig();
  expect(cfg.sizing.baseSize).toBe(40);
  expect(cfg.sizing.childScale).toBe(1);
  expect(cfg.angles.firstBranchAngle).toBe(60);
  expect(cfg.sort.default).toBe("newest-first");
});

// The 14 July tuning was the first to carry a `clearance` block. It layers like
// every other group — but nothing proved that until now, and the block silently
// failed to typecheck against the wrong engine's schema on the way in (see
// liefwork-defaults.ts). Pin it: a clearance that stops reaching the library
// would revert branch spacing to 1.0 with nothing on screen to say so.
// ── The cull ceiling must sit above every settable text target ──────────────
// sizing/cull.ts hides a block when its target exceeds its peak, and attention
// lifts a block TOWARD its optimal — so a peak at or below the optimal culls the
// most-attended blocks. It bites the root and the biggest meristems FIRST (with
// childScale:1 every meristem block is the same size, so attention — viewport
// fill — is the only thing that separates them, and the root has the most).
//
// The 14 July Studio tuning shipped meristemPeakSize 50 against optimalSize 70,
// and the root meristem vanished. The user can raise optimalSize to the slider's
// max, so the ceiling must clear THAT, not merely today's default — which is why
// the library ships 200 against a 120 max. The previous value (100) was already
// latently wrong for anyone who pushed the slider past 100.
test("the size-cull ceiling stays above every settable text target", () => {
  expect(pluginDefaultStyling.meristemPeakSize).toBeGreaterThan(MERISTEM_TEXT_RANGE.max);
  expect(pluginDefaultStyling.liefPeakSize).toBeGreaterThan(LIEF_TEXT_RANGE.max);
});

test("the tuned clearance layers over the library too", () => {
  const cfg = coralEngineConfig();
  expect(cfg.clearance.branchBuffer).toBe(1.1);
  expect(cfg.clearance.childAxisGrowthBlockFactor).toBe(10);
  expect(cfg.clearance.meristemInFactor).toBe(0);
  expect(cfg.clearance.meristemOutFactor).toBe(0);
  // Untouched by the tuning — still the library's own value.
  expect(cfg.clearance.expansionEpsilonRatio).toBe(0.02);
});

// The "Lief text" slider drives liefOptimalSize, but the 21-July liefMaxLift
// crowding cap (target ≤ basal × liefMaxLift) clamps rendered lief size to
// ~1.1× basal — so without coupling the ceiling to the slider, dragging it does
// next to nothing. liefMaxLiftForOptimalSize scales the ceiling in lockstep so
// the slider regains authority; the default is preserved exactly (no overlap
// unless a user opts in by raising the slider).
test("liefMaxLiftForOptimalSize: the default lief size preserves the locked ceiling", () => {
  expect(liefMaxLiftForOptimalSize(DEFAULT_TEXT_SIZING.liefOptimalSize)).toBeCloseTo(
    pluginDefaultStyling.liefMaxLift,
    9,
  );
});

test("liefMaxLiftForOptimalSize: the ceiling scales proportionally with the slider", () => {
  const base = DEFAULT_TEXT_SIZING.liefOptimalSize; // 10
  const baseLift = pluginDefaultStyling.liefMaxLift; // 1.1
  expect(liefMaxLiftForOptimalSize(2 * base)).toBeCloseTo(2 * baseLift, 9);
  expect(liefMaxLiftForOptimalSize(LIEF_TEXT_RANGE.max)).toBeCloseTo(
    baseLift * (LIEF_TEXT_RANGE.max / base),
    9,
  );
});

test("liefMaxLiftForOptimalSize: monotonic increasing across the slider range", () => {
  let prev = -Infinity;
  for (let s = LIEF_TEXT_RANGE.min; s <= LIEF_TEXT_RANGE.max; s += LIEF_TEXT_RANGE.step) {
    const lift = liefMaxLiftForOptimalSize(s);
    expect(lift).toBeGreaterThan(prev);
    prev = lift;
  }
});

test("liefMaxLiftForOptimalSize: an out-of-range slider value stays finite", () => {
  // The value is range-clamped upstream (8–48), but the helper must never
  // produce NaN/Infinity for an edge input on its own.
  expect(Number.isFinite(liefMaxLiftForOptimalSize(0))).toBe(true);
  expect(liefMaxLiftForOptimalSize(0)).toBe(0);
});
