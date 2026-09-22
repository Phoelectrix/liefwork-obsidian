import { describe, expect, test } from "bun:test";
import { coralEngineConfig, applyEngineKnobs, engineKnobsOf } from "../src/engine-config.ts";

// Live engine knobs in the plugin's dev panel (10 Sept 2026). The plugin mount
// has no live engine config (it builds per refresh), so the panel's engine
// group is served by the VIEW: a sparse override map applied over the shipped
// tuning at build time, and read back so the sliders seed from the truth.
describe("engine knobs over coralEngineConfig", () => {
  test("engineKnobsOf reads the shipped tuning", () => {
    const k = engineKnobsOf(coralEngineConfig());
    expect(k.branchBuffer).toBe(1.1);
    expect(k.childScale).toBe(1);
    expect(k.firstBranchAngle).toBe(60);
    expect(k.angleDecay).toBe(1);
    expect(k.minBranchAngle).toBe(0);
    expect(k.childAxisGrowthBlockFactor).toBe(10);
    expect(k.meristemInFactor).toBe(0);
    expect(k.meristemOutFactor).toBe(0);
  });
  test("applyEngineKnobs maps each knob to its config path, leaving the rest", () => {
    const base = coralEngineConfig();
    const cfg = applyEngineKnobs(base, { angleDecay: 0.95, minBranchAngle: 35, meristemInFactor: 2 });
    expect(cfg.angles.angleDecay).toBe(0.95);
    expect(applyEngineKnobs(base, { firstBranchAngle: 80 }).angles.firstBranchAngle).toBe(80);
    expect(cfg.angles.minBranchAngle).toBe(35);
    expect(cfg.clearance.meristemInFactor).toBe(2);
    expect(cfg.clearance.meristemOutFactor).toBe(0);
    expect(cfg.angles.firstBranchAngle).toBe(base.angles.firstBranchAngle);
    // pure: the input is untouched
    expect(base.angles.angleDecay).toBe(1);
    expect(base.angles.minBranchAngle).toBeUndefined();
  });
  test("an empty override is the shipped config exactly", () => {
    expect(applyEngineKnobs(coralEngineConfig(), {})).toEqual(coralEngineConfig());
  });
});
