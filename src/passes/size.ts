import type { EngineConfig } from "../types.ts";
import type { RingOutput } from "./ring.ts";
import { PHI } from "../constants.ts";

function shortSideForDepth(cfg: EngineConfig, depth: number): number {
  const { baseSize, childScale, phiOrder } = cfg.sizing;
  return baseSize * Math.pow(childScale, depth * phiOrder);
}

// Lead-in spacer count for a BranchNode. Floored by `minBranchLeadInSpacers`
// so every new branch is visibly offset from its parent chain; extra spacers
// are added on top when the child's departure angle is sharp.
function leadInCount(
  cfg: EngineConfig, S_child: number, alpha: number,
): number {
  const floor = Math.max(1, Math.floor(cfg.clearance.minBranchLeadInSpacers));
  const override = cfg.clearance.branchNodeLeadIn;
  if (typeof override === "number") return Math.max(floor, Math.floor(override));
  const clearance = S_child * Math.abs(Math.sin(alpha)) * cfg.clearance.leadInMargin;
  const spacer = S_child * cfg.sizing.spacerRatio;
  return Math.max(floor, Math.ceil(clearance / Math.max(spacer, 1e-9)));
}

export function sizePass(r: RingOutput, cfg: EngineConfig): RingOutput {
  const effFor = (branchId: string): EngineConfig =>
    r.effectiveConfig.get(branchId) ?? cfg;

  const branchById = new Map(r.branches.map((b) => [b.id, b]));
  // blockById is built before Phase 1 and rebuilt after Phase 2 to include
  // injected lead-in spacers (which are pushed into r.blocks during Phase 2).
  let blockById = new Map(r.blocks.map((b) => [b.id, b]));

  // Phase 1: assign branch and block shortSides.
  for (const br of r.branches) {
    const eff = effFor(br.id);
    const S = shortSideForDepth(eff, br.depth);
    br.shortSide = S;
    const spacerSize = S * eff.sizing.spacerRatio;
    let liefIndex = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      if (blk.kind === "spacer") {
        blk.shortSide = spacerSize;
      } else if (blk.kind === "lief") {
        const taper = Math.pow(PHI, eff.sizing.liefTaper * liefIndex);
        blk.shortSide = S * taper;
        liefIndex++;
      } else if (blk.kind === "branchNode") {
        blk.shortSide = S;
      } else if (blk.kind === "meristem") {
        // Meristems size at the parent branch's depth, matching what this
        // node was as a lief before promotion. The root meristem has no
        // parent, so depth -1 extrapolates to one step larger than baseSize,
        // making it the largest identity block in the plant.
        blk.shortSide = shortSideForDepth(eff, br.depth - 1);
      }
    }
  }

  // Phase 2: inject lead-in spacers into child chains. Must run after all
  // branch shortSides are set (needs S_child) and before arc computation.
  for (const br of r.branches) {
    for (const blockId of [...br.blockIds]) {
      const blk = blockById.get(blockId);
      if (!blk || blk.kind !== "branchNode") continue;
      const child = branchById.get(blk.childBranchId);
      if (!child) continue;
      const childEff = effFor(child.id);
      const S_child = child.shortSide;
      const count = leadInCount(childEff, S_child, child.departureAngle);
      const extras = count - 1;
      for (let i = 0; i < extras; i++) {
        const injectedId = `${blk.id}_leadIn_${i}`;
        r.blocks.push({
          id: injectedId, branchId: child.id, index: -1,
          shortSide: S_child * childEff.sizing.spacerRatio,
          arcPosition: 0, position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
          kind: "spacer", role: "leadIn",
        });
        child.blockIds.unshift(injectedId);
      }
    }
  }

  // Rebuild blockById after Phase 2 to include injected lead-in spacers.
  blockById = new Map(r.blocks.map((b) => [b.id, b]));

  // Ring-arc contribution per BranchNode (accumulates on parent chain).
  const ringArcByBn = new Map<string, number>();
  for (const rs of r.rings) {
    const f = rs.forward.reduce((a, rg) => a + rg.width, 0);
    const b = rs.backward.reduce((a, rg) => a + rg.width, 0);
    ringArcByBn.set(rs.blockId, f + b);
  }

  // Phase 3: compute per-branch arcLength and attach CurveSpec.
  for (const br of r.branches) {
    const eff = effFor(br.id);
    let arc = 0;
    for (const blockId of br.blockIds) {
      const blk = blockById.get(blockId);
      if (!blk) continue;
      arc += blk.shortSide;
      if (blk.kind === "branchNode") arc += ringArcByBn.get(blk.id) ?? 0;
    }
    br.arcLength = arc;
    br.curve = {
      type: eff.curve.curveType,
      arcLength: arc,
      originAngle: 0,
      ...(eff.curve.curveType === "bough" ? { bough: eff.curve.boughParams } : {}),
    };
  }

  return r;
}
