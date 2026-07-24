import { test, expect } from "bun:test";
import { mergeStylingConfig } from "../src/styling.ts";

test("mergeStylingConfig({}) fills pulse defaults (default off)", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.pulse.enabled).toBe(false);
  expect(cfg.pulse.color).toBe("#FFE2A6");
  expect(cfg.pulse.travelMsRange).toEqual([2600, 3400]);
});

test("mergeStylingConfig({}) fills new atmosphere defaults (default off)", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.atmosphere.haze).toBe(false);
  expect(cfg.atmosphere.motes).toBe(0);
});

test("partial pulse override keeps sibling pulse defaults", () => {
  const cfg = mergeStylingConfig({ pulse: { enabled: true } as any });
  expect(cfg.pulse.enabled).toBe(true);
  expect(cfg.pulse.color).toBe("#FFE2A6");
  expect(cfg.pulse.sizePx).toBe(8);
  expect(cfg.pulse.restMsRange).toEqual([3000, 6000]);
  expect(cfg.pulse.arrivalBloom).toBe(true);
  expect(cfg.pulse.minLiefs).toBe(3);
});

test("partial atmosphere override keeps sibling atmosphere defaults", () => {
  const cfg = mergeStylingConfig({ atmosphere: { haze: true } as any });
  expect(cfg.atmosphere.haze).toBe(true);
  expect(cfg.atmosphere.horizon).toBe(false);
});
