// Pure sizing composition. Two layers, applied in order:
//   1. Basal projection — fixed world-units floor (shortSide × titleSize × basalMag × zoom)
//   2. Lift toward optimalSize — combined attention (viewport-fill) + subtreeBoost (meristems
//      only). Both are independent reasons to grow toward optimal; their contributions add
//      as a single liftFraction, capped at 1 so neither can overshoot optimalSize.
//
// Cursor-light override (when isLit): if currentTarget < optimalSize, magnify
// toward optimalSize (capped). If currentTarget already ≥ optimalSize, no-op —
// shrinking already-large elements toward optimal would run counter to the
// "more attention → bigger" expectation.
//
// All inputs are simple scalars; no DOM, no state. Trivially unit-testable.

export interface SizingConfig {
  basalMag: number;
  optimalSize: number;
  liefOptimalSize: number;
  subtreeBoost: number;
  subtreeBoostShape: number;
  cursorMagnification: number;
  /** Crowding ceiling for lief labels, as a multiple of the block's own basal
   *  (geometric) size. 0 disables it. See the LIFT-RATIO note below. */
  liefMaxLift: number;
}

/** Label sizing basis for a lief/meristem block: the engine-baked `labelSize`
 *  (a world-level sizing mechanism — see src/library/passes/size.ts), falling
 *  back to `shortSide` for plants built by older engines that don't bake it.
 *  TEXT RENDERING ONLY — never use this for geometry (placement, ray
 *  endpoints, arcs), which legitimately stays on `shortSide`. */
export function labelSizeBasis(block: { shortSide: number; labelSize?: number }): number {
  return block.labelSize ?? block.shortSide;
}

export interface TargetInput {
  shortSide: number;
  titleSize: number;
  zoom: number;
  attention: number;     // [0, 1]
  subtreeNorm: number;   // [0, 1]; ignored for liefs
  kind: "lief" | "meristem";
  isLit: boolean;
  cfg: SizingConfig;
}

export function computeTargetScreenPx(input: TargetInput): number {
  const { shortSide, titleSize, zoom, attention, subtreeNorm, kind, isLit, cfg } = input;

  // Layer 1: basal — fixed world-units floor.
  const basalScreenPx = shortSide * titleSize * cfg.basalMag * zoom;

  // Layer 2: attention multiplier, capped so it never shrinks below basal.
  //   sizeMultiplier = 1 + attention × (optimalSize/basal − 1), clamped to ≥ 1.
  // Liefs use their own liefOptimalSize; meristems use optimalSize.
  const optimal = kind === "lief" ? cfg.liefOptimalSize : cfg.optimalSize;
  const optBasal = optimal / Math.max(basalScreenPx, 1e-9);

  // Combined lift fraction toward optimal. Both attention (viewport-fill)
  // and subtreeBoost (structural importance, meristems only) contribute to
  // the same lift mechanism — they're independent reasons to grow the text
  // toward optimal. Capped at 1 (= reach optimal); does not overshoot.
  let liftFraction = attention;
  if (kind === "meristem" && cfg.subtreeBoost > 0) {
    const sn = Math.max(0, Math.min(1, subtreeNorm));
    const snShaped = cfg.subtreeBoostShape === 1 ? sn : Math.pow(sn, cfg.subtreeBoostShape);
    liftFraction += cfg.subtreeBoost * snShaped;
  }
  liftFraction = Math.min(1, liftFraction);

  const sizeMultiplier = Math.max(1, 1 + liftFraction * (optBasal - 1));
  let currentTarget = basalScreenPx * sizeMultiplier;

  // Layer 3: CROWDING CEILING (liefs only) — the fix for "liefs on a big branch
  // render huge and overlap while their neighbours on small branches are
  // hidden".
  //
  // Neighbouring liefs are spaced in WORLD units, so their on-screen pitch is
  // `pitch_world × zoom`, while basal is `shortSide × titleSize × basalMag ×
  // zoom`. Zoom appears in both, so the ratio the geometry can accommodate,
  // `pitch / basal`, is CONSTANT — independent of zoom, and (since every block
  // on a branch shares a shortSide) near-constant across the coral. Overlap is
  // therefore exactly "target grew to more than N× basal", and capping that one
  // ratio prevents it at every zoom without shrinking liefs globally.
  //
  // What inflates the ratio is the attention lift: a branch filling the
  // viewport has attention ≈ 1, pinning its liefs at liefOptimalSize no matter
  // how far out you are, while their spacing is still tiny. The cap holds them
  // to their geometric footprint until the zoom has earned the room.
  //
  // NOT applied when lit — cursor-hover must always be able to reveal a label,
  // and the lit branch below has its own ceiling (the optimal size).
  if (!isLit && kind === "lief" && cfg.liefMaxLift > 0) {
    currentTarget = Math.min(currentTarget, basalScreenPx * cfg.liefMaxLift);
  }

  // Cursor-light override: magnify-and-cap. Applies to both kinds, each capped
  // at its own optimal. If the block is already at or above its optimal (e.g.
  // already focal under attention or naturally large at zoom-in), cursor light
  // is a no-op — shrinking it toward optimal would invert the "more attention →
  // bigger" expectation. Lief peak is handled entirely by cullDecision (cull
  // above peak), not by a clamp here — symmetric with meristem behaviour.
  if (isLit) {
    const cap = kind === "lief" ? cfg.liefOptimalSize : cfg.optimalSize;
    if (currentTarget >= cap) return currentTarget;
    return Math.min(currentTarget * cfg.cursorMagnification, cap);
  }

  return currentTarget;
}
