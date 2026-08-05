import { describe, expect, test } from "bun:test";
import { build } from "../src/index.ts";
import { defaultEngineConfig } from "../src/defaults.ts";
import { shakespeareMini } from "./fixtures/shakespeare-mini.ts";

describe("reorder semantics", () => {
  test("cross-branch sort change produces different ring values but preserves event identity", () => {
    const newest = build(shakespeareMini, undefined, defaultEngineConfig);
    const alpha = build(
      shakespeareMini,
      undefined,
      { ...defaultEngineConfig, sort: { default: "alphabetical", liefsLast: false } },
    );

    // Event log (liefIds + eventIds) is identical — derivation walks input
    // order, not sort order.
    expect(newest.events.map((e) => e.liefId).sort()).toEqual(
      alpha.events.map((e) => e.liefId).sort(),
    );
    expect(newest.events.length).toBe(alpha.events.length);

    // Ring widths differ somewhere: cross-branch reorder changes compound
    // angles at some ancestor.
    const flatten = (plant: any): number[] =>
      plant.rings.flatMap((rs: any) =>
        [...rs.forward, ...rs.backward].map((r: any) => r.width),
      );
    const widthsA = flatten(newest);
    const widthsB = flatten(alpha);
    const someDifference = widthsA.some((w, i) => Math.abs(w - (widthsB[i] ?? 0)) > 1e-6);
    expect(someDifference).toBe(true);
  });
});
