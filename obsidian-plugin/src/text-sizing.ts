/**
 * Adjustable coral text sizing — a FREE accessibility feature (decision closed
 * 7 July 2026: not Pro-gated; native-knob model decided 8 July 2026). Three
 * knobs, persisted in plugin data. They are the renderer's OWN adaptive
 * targets (viewer/src/sizing/composition.ts computeTargetScreenPx lifts every
 * label toward them), so adjusting them stays zoom-correct by construction:
 *   • optimalSize — the screen-px size meristem titles are lifted toward.
 *   • liefOptimalSize — the same target for lief labels.
 *   • attentionPropagationDecay — how much of a parent's attention its
 *     descendants inherit (0 = none: steep depth falloff; 1 = all: flat).
 *   • subtreeBoost — how much a branch's SIZE (its descendant count) lifts its
 *     title, independent of attention. Added as a user knob 21 July: the right
 *     value is genuinely data-dependent — a vault of evenly-sized folders wants
 *     little emphasis, one with a few huge trees and many small ones wants a
 *     lot. Meristems only; liefs get no subtree boost.
 * Defaults = the shipped liefwork styling, so defaults = today's look.
 */
import { pluginDefaultStyling } from "./plugin-default-styling.ts";

export interface TextSizingSettings {
  optimalSize: number;
  liefOptimalSize: number;
  attentionPropagationDecay: number;
  subtreeBoost: number;
}

export const DEFAULT_TEXT_SIZING: TextSizingSettings = {
  optimalSize: pluginDefaultStyling.optimalSize,
  liefOptimalSize: pluginDefaultStyling.liefOptimalSize,
  attentionPropagationDecay: pluginDefaultStyling.attentionPropagationDecay,
  subtreeBoost: pluginDefaultStyling.subtreeBoost,
};

/** Slider bounds for the settings tab + on-coral overlay — also the clamp
 *  range for persisted values, so a hand-edited data.json can't push the
 *  renderer into absurdity. */
export const MERISTEM_TEXT_RANGE = { min: 30, max: 120, step: 1 } as const;
export const LIEF_TEXT_RANGE = { min: 8, max: 48, step: 1 } as const;
export const DEPTH_FALLOFF_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const BRANCH_EMPHASIS_RANGE = { min: 0, max: 1, step: 0.05 } as const;

/** The lief crowding ceiling (`liefMaxLift`) that goes with a given "Lief text"
 *  slider value. The 21-July cap clamps a lief's rendered size to
 *  `basal × liefMaxLift`; since the slider raises `liefOptimalSize` (the target
 *  being clamped) and NOT the basal the cap is relative to, the cap otherwise
 *  swallows the slider. Coupling the ceiling to the slider — proportionally from
 *  the shipped anchor (default size → default ceiling) — gives the slider back
 *  its authority: the default look is preserved exactly (still overlap-free),
 *  and only a user who raises the slider gets bigger liefs AND the crowding that
 *  necessarily comes with drawing labels larger than their geometric spacing.
 *  Plugin-only: kept out of the engine so the site/Studio's liefMaxLift is
 *  unaffected. */
export function liefMaxLiftForOptimalSize(liefOptimalSize: number): number {
  const baseSize = DEFAULT_TEXT_SIZING.liefOptimalSize;
  const baseLift = pluginDefaultStyling.liefMaxLift;
  if (!(baseSize > 0)) return baseLift;
  return baseLift * (liefOptimalSize / baseSize);
}

function clampOr(v: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(range.max, Math.max(range.min, v));
}

/** Typed merge of the persisted (untrusted) blob over the defaults — absent or
 *  malformed values fall back to the default; out-of-range numbers clamp.
 *  Pre-release blobs carrying the retired textScale/textContrast keys simply
 *  fall through to the defaults (never shipped — no migration). */
export function mergeTextSizing(raw: unknown): TextSizingSettings {
  const r = (raw ?? {}) as Partial<Record<keyof TextSizingSettings, unknown>>;
  return {
    optimalSize: clampOr(r.optimalSize, MERISTEM_TEXT_RANGE, DEFAULT_TEXT_SIZING.optimalSize),
    liefOptimalSize: clampOr(r.liefOptimalSize, LIEF_TEXT_RANGE, DEFAULT_TEXT_SIZING.liefOptimalSize),
    attentionPropagationDecay: clampOr(
      r.attentionPropagationDecay,
      DEPTH_FALLOFF_RANGE,
      DEFAULT_TEXT_SIZING.attentionPropagationDecay,
    ),
    subtreeBoost: clampOr(r.subtreeBoost, BRANCH_EMPHASIS_RANGE, DEFAULT_TEXT_SIZING.subtreeBoost),
  };
}
