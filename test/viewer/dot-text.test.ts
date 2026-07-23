import { describe, it, expect } from "bun:test";
import { bakeWrappedDotPath } from "../../viewer/src/dot-text.ts";

describe("bakeWrappedDotPath", () => {
  it("returns empty string for empty name", () => {
    expect(bakeWrappedDotPath({ name: "", fontSize: 10, boxLength: 100 })).toBe("");
  });

  it("emits one subpath per non-space character", () => {
    const path = bakeWrappedDotPath({ name: "ab cd", fontSize: 10, boxLength: 1000 });
    const moveCount = (path.match(/M /g) ?? []).length;
    expect(moveCount).toBe(4); // 4 non-space chars
  });

  it("wraps long titles to multiple lines", () => {
    // narrow box → forces wrap. With small fontSize relative to box, every word goes on its own line.
    const path = bakeWrappedDotPath({
      name: "Romeo and Juliet by William Shakespeare",
      fontSize: 10,
      boxLength: 50,  // very small box → many lines
    });
    // Should have more than one distinct y coordinate.
    const ys = new Set<string>();
    const re = /M\s+\S+\s+(\S+)/g;
    let m;
    while ((m = re.exec(path)) !== null) ys.add(m[1]!);
    expect(ys.size).toBeGreaterThan(1);
  });

  it("does not wrap when boxLength is generous", () => {
    const path = bakeWrappedDotPath({
      name: "Hello world",
      fontSize: 10,
      boxLength: 10000,
    });
    const ys = new Set<string>();
    const re = /M\s+\S+\s+(\S+)/g;
    let m;
    while ((m = re.exec(path)) !== null) ys.add(m[1]!);
    expect(ys.size).toBe(1);
  });
});
