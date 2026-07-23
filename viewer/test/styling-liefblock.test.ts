import { test, expect } from "bun:test";
import { mergeStylingConfig } from "../src/styling.ts";

test("mergeStylingConfig({}) fills liefBlock defaults (default off — label mode)", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.liefBlock.mode).toBe("label");
  expect(cfg.liefBlock.justify).toBe(true);
  expect(cfg.liefBlock.sizeRatio).toBeCloseTo(0.58);
  expect(cfg.liefBlock.maxLines).toBe(5);
});

test("partial liefBlock override keeps sibling liefBlock defaults", () => {
  const cfg = mergeStylingConfig({ liefBlock: { mode: "block" } as any });
  expect(cfg.liefBlock.mode).toBe("block");
  expect(cfg.liefBlock.justify).toBe(true);
  expect(cfg.liefBlock.sizeRatio).toBeCloseTo(0.58);
  expect(cfg.liefBlock.maxLines).toBe(5);
});

test("mergeStylingConfig({}) fills agentGlow default — orb on (plugin's current look)", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.agentGlow.orb).toBe(true);
});

test("partial agentGlow override merges over the default", () => {
  const cfg = mergeStylingConfig({ agentGlow: { orb: false } });
  expect(cfg.agentGlow.orb).toBe(false);
});
