import type { EngineConfig } from "./types.ts";
import { INV_PHI } from "./constants.ts";

export const defaultEngineConfig: EngineConfig = {
  sizing: {
    baseSize: 40,
    childScale: INV_PHI,
    phiOrder: 1,
    spacerRatio: INV_PHI,
    liefTaper: 0,
  },
  angles: {
    angleMode: "phi-sequence",
    firstBranchAngle: 50,
    angleDecay: 0.95,
    alternateBranches: true,
    alternateLiefs: true,
    nonAlternatingDepth: 0,
    rootOrientationAngle: 90,
  },
  clearance: {
    branchBuffer: 1.0,
    expansionEpsilonRatio: 0.02,
    branchNodeLeadIn: "auto",
    leadInMargin: 1.0,
    minBranchLeadInSpacers: 3,
    meristemLeadInSpacers: 1,
    meristemTrailingSpacers: 1,
  },
  curve: {
    curveType: "straight",
    boughParams: {
      undulationAmp: 0.15,
      undulationFreq: 1.5,
      undulationPhase: 0,
      entryBow: 0.05,
      bowFalloff: 3,
      turnPoint: 0.85,
      turnSharpness: 6,
      spiralAngle: (150 * Math.PI) / 180,
    },
  },
  sort: { default: "newest-first", liefsLast: false },
};
