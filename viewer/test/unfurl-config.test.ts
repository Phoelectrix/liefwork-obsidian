import { test, expect } from "bun:test";
import { mergeStylingConfig, defaultStylingConfig } from "../src/styling.ts";

test("mergeStylingConfig({}) fills unfurl defaults (default off)", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.unfurl.enabled).toBe(false);
  expect(cfg.unfurl.initialDepth).toBe(1);
  expect(cfg.unfurl.revealMs).toBe(420);
  expect(cfg.unfurl.expandLabel).toBe("click to expand");
  expect(cfg.unfurl.furlLabel).toBe("− furl");
});
test("defaultStylingConfig.unfurl is default-off", () => {
  expect(defaultStylingConfig.unfurl.enabled).toBe(false);
});
test("partial unfurl override keeps sibling unfurl defaults", () => {
  const cfg = mergeStylingConfig({ unfurl: { enabled: true } as any });
  expect(cfg.unfurl.enabled).toBe(true);
  expect(cfg.unfurl.initialDepth).toBe(1);
  expect(cfg.unfurl.expandLabel).toBe("click to expand");
});
// Pins the merge contract site.ts's `!plain` stylingOverrides relies on: a
// bundle's own `unfurl` fields (spread first in site.ts, ahead of the site's
// `enabled: true` default) win over whatever site.ts/defaultStylingConfig
// would otherwise supply — the "bundle wins on tunables" invariant.
test("bundle unfurl fields win over site defaults when merged", () => {
  const merged = mergeStylingConfig({
    unfurl: { enabled: true, initialDepth: 2, revealMs: 300 } as any,
  });
  expect(merged.unfurl.enabled).toBe(true);
  expect(merged.unfurl.initialDepth).toBe(2);
  expect(merged.unfurl.revealMs).toBe(300);
});
