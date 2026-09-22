import { test, expect } from "bun:test";
import { revealProgress } from "../src/reveal.ts";

test("clamps to 0 at start and 1 at/after duration", () => {
  expect(revealProgress(1000, 1000, 400)).toBe(0);
  expect(revealProgress(1000, 1400, 400)).toBe(1);
  expect(revealProgress(1000, 2000, 400)).toBe(1);
});

test("eases monotonically between 0 and 1", () => {
  const a = revealProgress(0, 100, 400), b = revealProgress(0, 300, 400);
  expect(a).toBeGreaterThan(0); expect(a).toBeLessThan(b); expect(b).toBeLessThan(1);
});
