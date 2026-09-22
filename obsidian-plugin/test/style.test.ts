import { describe, expect, test } from "bun:test";
import { resolveStyle, ORGANIC_ANGLES } from "../src/style.ts";
import { coralEngineConfig } from "../src/engine-config.ts";

// The coral's branching style (22 Sept 2026): "default" is the shipped uniform
// fan — LOCKED geometry, byte-for-byte; "organic" lays a wider first angle with
// capped decay over it. Two options, not three sliders.
describe("coral style", () => {
  test("resolveStyle defaults to the shipped fan so nothing moves for existing users", () => {
    expect(resolveStyle(undefined)).toBe("default");
    expect(resolveStyle("organic")).toBe("organic");
    expect(resolveStyle("default")).toBe("default");
    expect(resolveStyle("garbage")).toBe("default");
  });
  test("the organic delta is the founder's pair: 85° seed, 0.95 decay, 45° floor", () => {
    expect(ORGANIC_ANGLES).toEqual({ firstBranchAngle: 85, angleDecay: 0.95, minBranchAngle: 45 });
  });
  test("coralEngineConfig('organic') lays the delta over the shipped tuning and touches nothing else", () => {
    const base = coralEngineConfig();
    const organic = coralEngineConfig("organic");
    expect(organic.angles.firstBranchAngle).toBe(85);
    expect(organic.angles.angleDecay).toBe(0.95);
    expect(organic.angles.minBranchAngle).toBe(45);
    expect({ ...organic, angles: base.angles }).toEqual(base);
  });
  test("coralEngineConfig() and coralEngineConfig('default') are the shipped tuning exactly", () => {
    expect(coralEngineConfig("default")).toEqual(coralEngineConfig());
    expect(coralEngineConfig().angles.firstBranchAngle).toBe(60);
    expect(coralEngineConfig().angles.angleDecay).toBe(1);
    expect(coralEngineConfig().angles.minBranchAngle).toBeUndefined();
  });
});
