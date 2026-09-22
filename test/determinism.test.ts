import { describe, expect, test } from "bun:test";
import { build } from "../src/index.ts";
import { defaultEngineConfig } from "../src/defaults.ts";
import {
  build as libraryBuild,
  defaultEngineConfig as libraryDefaultEngineConfig,
} from "../src/library/index.ts";
import { shakespeareMini } from "./fixtures/shakespeare-mini.ts";

describe("determinism", () => {
  test("same input → identical Plant across rebuilds", () => {
    const a = build(shakespeareMini, undefined, defaultEngineConfig);
    const b = build(shakespeareMini, undefined, defaultEngineConfig);

    const stripBuiltAt = (plant: any): any => {
      const { builtAt: _ignored, ...rest } = plant.metadata;
      return { ...plant, metadata: rest };
    };
    expect(stripBuiltAt(a)).toEqual(stripBuiltAt(b));
  });

  // Consolidated guard for the two default-off engine knobs (foldFactor,
  // growthFactor): a default build (no fold/growth fields anywhere, on the
  // library engine where these knobs actually live — see
  // test/library/passes/fold-factor.test.ts and growth-factor.test.ts for
  // per-knob coverage) must be unchanged (same plant.id across rebuilds) AND
  // defaultEngineConfig, serialized, must introduce neither key.
  test("default build (no foldFactor/growthFactor anywhere) is unchanged: identical plant.id, and defaultEngineConfig serializes with neither key", () => {
    const a = libraryBuild(shakespeareMini, undefined, libraryDefaultEngineConfig);
    const b = libraryBuild(shakespeareMini, undefined, libraryDefaultEngineConfig);

    expect(a.id).toBe(b.id);

    const serializedConfig = JSON.stringify(libraryDefaultEngineConfig);
    expect(serializedConfig).not.toContain("foldFactor");
    expect(serializedConfig).not.toContain("growthFactor");
  });
});
