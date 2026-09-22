import type { EngineConfig } from "../types.ts";
import type { StructureOutput } from "./structure.ts";
import { PHI } from "../../constants.ts";

function shortSideForDepth(cfg: EngineConfig, depth: number): number {
  const { baseSize, childScale, phiOrder } = cfg.sizing;
  return baseSize * Math.pow(childScale, depth * phiOrder);
}

/** Baked label size for a labelled block (lief/meristem). Text sizing rides
 *  the block's shortSide curve, reshaped by two knobs:
 *  labelSize = textScale · S · (S / baseSize)^(textContrast − 1) — i.e. an
 *  exponent on the existing size curve around the `baseSize` pivot (sizes at
 *  the pivot are contrast-invariant; >1 widens the spread across depth, <1
 *  flattens it toward uniform). At the defaults (both 1) the exponent is 0 and
 *  Math.pow(x, 0) === 1, so the result is bit-for-bit S — today's label basis. */
function labelSizeFor(cfg: EngineConfig, shortSide: number): number {
  const { baseSize, textScale = 1, textContrast = 1 } = cfg.sizing;
  return textScale * shortSide * Math.pow(shortSide / baseSize, textContrast - 1);
}

export function sizePass(s: StructureOutput, cfg: EngineConfig): StructureOutput {
  const effFor = (branchId: string): EngineConfig =>
    s.effectiveConfig.get(branchId) ?? cfg;

  const blockById = new Map(s.blocks.map((b) => [b.id, b]));

  // Phase 1: assign shortSides.
  for (const br of s.branches) {
    const eff = effFor(br.id);
    const S = shortSideForDepth(eff, br.depth);
    br.shortSide = S;
    const spacerSize = S * eff.sizing.spacerRatio;
    const g = eff.sizing.growthFactor ?? 1;
    let liefIndex = 0;

    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      if (blk.kind === "spacer") {
        blk.shortSide = spacerSize * g;
      } else if (blk.kind === "lief") {
        const taper = Math.pow(PHI, eff.sizing.liefTaper * liefIndex);
        const liefG = liefIndex === 0 ? 1 : g; // first lief is the stub floor — never shrinks
        blk.shortSide = S * taper * liefG;
        blk.labelSize = labelSizeFor(eff, blk.shortSide);
        liefIndex++;
      } else if (blk.kind === "branchNode") {
        blk.shortSide = S * g;
      } else if (blk.kind === "meristem") {
        blk.shortSide = shortSideForDepth(eff, br.depth - 1);
        blk.labelSize = labelSizeFor(eff, blk.shortSide);
      } else if (blk.kind === "growthBlock") {
        switch (blk.subtype) {
          case "fwd-tangent":
          case "bwd-tangent":
            blk.shortSide = 0; // filled by growthBlockPass
            break;
          case "child-axis":
            blk.shortSide = S * eff.clearance.childAxisGrowthBlockFactor * g;
            break;
          case "meristem-in":
            blk.shortSide = S * eff.clearance.meristemInFactor * g;
            break;
          case "meristem-out":
            blk.shortSide = S * eff.clearance.meristemOutFactor * g;
            break;
        }
      }
    }
  }

  // Phase 2: arcLength = sum of shortSides; attach CurveSpec.
  for (const br of s.branches) {
    const eff = effFor(br.id);
    let arc = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (blk) arc += blk.shortSide;
    }
    br.arcLength = arc;
    br.curve = {
      type: eff.curve.curveType,
      arcLength: arc,
      originAngle: 0,
      ...(eff.curve.curveType === "bough" ? { bough: eff.curve.boughParams } : {}),
    };
  }

  return s;
}
