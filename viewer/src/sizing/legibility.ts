import { labelSizeBasis } from "./composition.ts";

export interface LegibilityInput {
  block: { kind: "lief" | "meristem"; shortSide: number; labelSize?: number };
  titleSize: number;
  basalMag: number;
  /** Lief label-size inverse — MUST mirror the cascade's default (φ). */
  liefShortSideInverse: number;
  liefFullAbovePx: number;
  meristemFullAbovePx: number;
}

/** The smallest camera scale at which `block` still renders as TEXT rather than
 *  a glyph — the floor a frame must not zoom out past, or it hides what it framed.
 *
 *  Sound because every cascade term is monotone upward from the basal size:
 *
 *      targetPx >= labelBasis × titleSize × basalMag × scale
 *
 *  so requiring the right-hand side to clear `fullAbovePx` is CONSERVATIVE — the
 *  attention lift can only make the text larger than this guarantees, never
 *  smaller. (See legibility-floor.test.ts, which asserts that inequality against
 *  computeTargetScreenPx directly.)
 *
 *  The exact mirror of the frameMaxZoom cull-cliff ceiling in mount-plant.ts:
 *  peak → fullAbove, plant-max basis → this block's own basis, min → max.
 *
 *  Returns 0 (no constraint) rather than Infinity on degenerate input: a missing
 *  floor leaves today's behaviour, an infinite one would wedge the camera. */
export function minScaleForText(input: LegibilityInput): number {
  const { block, titleSize, basalMag, liefShortSideInverse } = input;
  if (!(titleSize > 0) || !(basalMag > 0)) return 0;
  const basis =
    labelSizeBasis(block) * (block.kind === "lief" ? liefShortSideInverse : 1);
  if (!(basis > 0)) return 0;
  const fullAbovePx =
    block.kind === "lief" ? input.liefFullAbovePx : input.meristemFullAbovePx;
  if (!(fullAbovePx > 0)) return 0;
  return fullAbovePx / (basis * titleSize * basalMag);
}
