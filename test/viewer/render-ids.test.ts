import { describe, it, expect } from "bun:test";
import { stemGradientId } from "../../viewer/src/render-ids.ts";

describe("stemGradientId", () => {
  it("namespaces by instance so two plants don't collide on the same branch id", () => {
    // branch.id resets to br_0 every build, so two mounted plants both have br_0;
    // the instance token is what keeps their gradient ids distinct.
    expect(stemGradientId("br_0", "m0")).not.toBe(stemGradientId("br_0", "m1"));
  });

  it("includes both the instance token and the branch id", () => {
    expect(stemGradientId("br_3", "m2")).toBe("stem-grad-m2-br_3");
  });

  it("falls back to the un-namespaced id when no instance is given (back-compat)", () => {
    expect(stemGradientId("br_0")).toBe("stem-grad-br_0");
  });
});
