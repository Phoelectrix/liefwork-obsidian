// Visual tier classifier — three states, two thresholds.
// (Cull decision is separate; see cull.ts. A block deemed "render" by cull
// then gets one of "full", "dot-glyphs", or "single-dot" visual treatment here.)

export interface TierConfig {
  dotsAbovePx: number;
  fullAbovePx: number;
}

export type Tier = "full" | "dot-glyphs" | "single-dot";

export function visualTier(targetPx: number, cfg: TierConfig): Tier {
  if (targetPx >= cfg.fullAbovePx) return "full";
  if (targetPx >= cfg.dotsAbovePx) return "dot-glyphs";
  return "single-dot";
}
