import { describe, expect, test } from "bun:test";
import {
  composeStencilPath,
  glyphColumnPath,
  type StencilConfig,
} from "../../viewer/src/stencil.ts";

const baseCfg: StencilConfig = {
  length: 200,
  width: 100,
  fontSize: 30,
  textMargin: 15,
};

const countCommand = (d: string, cmd: string): number =>
  (d.match(new RegExp(cmd, "g")) ?? []).length;

const coords = (d: string): number[] =>
  (d.match(/-?\d+\.?\d*(?:e[+-]?\d+)?/g) ?? []).map(parseFloat);

describe("composeStencilPath", () => {
  test("empty text returns just the leaf silhouette (non-empty path ending Z)", () => {
    const d = composeStencilPath("", baseCfg);
    expect(d.length).toBeGreaterThan(0);
    expect(d.trim().startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  test("text adds glyph subpaths (more M commands than silhouette alone)", () => {
    const empty = composeStencilPath("", baseCfg);
    const withText = composeStencilPath("AB", baseCfg);
    expect(countCommand(withText, "M")).toBeGreaterThan(countCommand(empty, "M"));
  });

  test("all coords are finite — no NaN from malformed transforms", () => {
    const d = composeStencilPath("HELLO", baseCfg);
    for (const n of coords(d)) expect(Number.isFinite(n)).toBe(true);
  });

  test("unsupported characters are dropped silently, not thrown", () => {
    expect(() => composeStencilPath("A@B#", baseCfg)).not.toThrow();
    const d = composeStencilPath("A@B#", baseCfg);
    expect(d.length).toBeGreaterThan(0);
  });

  test("longer text does not exceed the leaf length (auto-shrink)", () => {
    const short = composeStencilPath("A", baseCfg);
    const long = composeStencilPath("SUPERCALIFRAGILISTIC", baseCfg);
    const yMax = (d: string) => Math.max(...coords(d));
    expect(yMax(long)).toBeLessThanOrEqual(baseCfg.length + 1e-6);
    expect(yMax(short)).toBeLessThanOrEqual(baseCfg.length + 1e-6);
  });

  test("silhouette extends the full length axis", () => {
    const d = composeStencilPath("", baseCfg);
    const ys = coords(d).filter((_, i) => i % 2 === 1); // y is every other number
    expect(Math.max(...ys)).toBeCloseTo(baseCfg.length, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
  });

  test("lowercase is accepted (maps to uppercase glyphs in font)", () => {
    const up = composeStencilPath("ABC", baseCfg);
    const low = composeStencilPath("abc", baseCfg);
    expect(countCommand(low, "M")).toBe(countCommand(up, "M"));
  });
});

describe("glyphColumnPath", () => {
  test("returns just the glyphs, no silhouette (no trailing Z after glyph strip)", () => {
    // Silhouette alone ends in "Z". Glyph column alone shouldn't start with the
    // leaf silhouette's first move (M 0 0 Q ...).
    const columnOnly = glyphColumnPath("AB", baseCfg);
    const withSilhouette = composeStencilPath("AB", baseCfg);
    // withSilhouette contains everything the column has, plus more.
    expect(withSilhouette.length).toBeGreaterThan(columnOnly.length);
    // Empty text → empty column (no silhouette either).
    expect(glyphColumnPath("", baseCfg)).toBe("");
  });

  test("mirror flag differs from non-mirror for non-palindrome text", () => {
    const forward = glyphColumnPath("AB", baseCfg);
    const mirrored = glyphColumnPath("AB", baseCfg, { mirror: true });
    expect(mirrored).not.toBe("");
    expect(mirrored).not.toBe(forward);
  });

  test("mirror preserves subpath count (same number of glyphs drawn)", () => {
    const forward = glyphColumnPath("MACBETH", baseCfg);
    const mirrored = glyphColumnPath("MACBETH", baseCfg, { mirror: true });
    expect(countCommand(mirrored, "M")).toBe(countCommand(forward, "M"));
  });

  test("mirror keeps glyphs within the leaf length (same column extent)", () => {
    const mirrored = glyphColumnPath("MACBETH", baseCfg, { mirror: true });
    const ys = coords(mirrored).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(baseCfg.length + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-6);
  });
});
