import { describe, expect, test } from "bun:test";
import { engineKnobsToConfigFragment } from "../../viewer/src/dev-panel.ts";

// "copy engine JSON" emits an EngineConfig fragment (angles / clearance /
// sizing nested) ready to paste into liefwork-defaults.ts's engine block.
describe("engineKnobsToConfigFragment", () => {
  test("nests every knob under its EngineConfig section", () => {
    expect(
      engineKnobsToConfigFragment({
        branchBuffer: 1.1, childScale: 1, firstBranchAngle: 85, angleDecay: 0.95, minBranchAngle: 35,
        childAxisGrowthBlockFactor: 10, meristemInFactor: 2, meristemOutFactor: 0,
      }),
    ).toEqual({
      sizing: { childScale: 1 },
      angles: { firstBranchAngle: 85, angleDecay: 0.95, minBranchAngle: 35 },
      clearance: { branchBuffer: 1.1, childAxisGrowthBlockFactor: 10, meristemInFactor: 2, meristemOutFactor: 0 },
    });
  });
});
