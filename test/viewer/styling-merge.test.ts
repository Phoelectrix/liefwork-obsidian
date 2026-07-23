import { describe, expect, test } from "bun:test";
import { mergeStylingConfig, type StylingConfig } from "../../viewer/src/styling.ts";

// mergeStylingConfig accepts partial projection objects (the freeze pipeline
// and hand-edited bundles only carry the keys the author cared about), so the
// inputs below are cast through `unknown` — matching the existing viewer-test
// pattern for partial mocks.
describe("mergeStylingConfig — projection.cursorLightRay", () => {
  test("defaults to 'follow' when projection is omitted entirely", () => {
    expect(mergeStylingConfig({}).projection.cursorLightRay).toBe("follow");
  });

  test("defaults to 'follow' when projection is present but partial", () => {
    const partial = { projection: { cursorLight: true } } as unknown as Partial<StylingConfig>;
    expect(mergeStylingConfig(partial).projection.cursorLightRay).toBe("follow");
  });

  test("preserves an explicit 'fixed'", () => {
    const partial = { projection: { cursorLightRay: "fixed" } } as unknown as Partial<StylingConfig>;
    expect(mergeStylingConfig(partial).projection.cursorLightRay).toBe("fixed");
  });

  test("a partial projection still keeps the default ray sub-object", () => {
    const partial = { projection: { cursorLightRay: "fixed" } } as unknown as Partial<StylingConfig>;
    expect(mergeStylingConfig(partial).projection.ray.stroke).toBe("#ffd890");
  });
});
