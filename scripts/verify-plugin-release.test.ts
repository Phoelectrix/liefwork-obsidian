// scripts/verify-plugin-release.test.ts
//
// The release gate's pure checks, plus source-guards pinning the gate to the
// real tree: the UUID list must contain whatever pro.ts currently ships (a new
// placeholder landing without joining KNOWN_NONLIVE_UUIDS would silently green
// the gate), and the spec path must point at a file that actually exists on
// the dev tree (else the "absent" check passes vacuously forever).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkCheckoutUrl,
  checkLicenseDated,
  checkVersions,
  KNOWN_NONLIVE_UUIDS,
} from "./verify-plugin-release.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("checkCheckoutUrl", () => {
  const src = (url: string) => `export const PRO_CHECKOUT_URL =\n  "${url}";\n`;

  test("fails on a TODO stub", () => {
    expect(checkCheckoutUrl(src("https://liefwork.lemonsqueezy.com/checkout/buy/TODO")).ok).toBe(false);
  });

  test("fails on a known non-live uuid", () => {
    const r = checkCheckoutUrl(src(`https://liefwork.lemonsqueezy.com/checkout/buy/${KNOWN_NONLIVE_UUIDS[0]}`));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("NON-LIVE");
  });

  test("fails on a mis-shaped url", () => {
    expect(checkCheckoutUrl(src("https://example.com/buy/cf3cb637-e934-42a9-aade-e66b11cee6fb")).ok).toBe(false);
  });

  test("fails when the constant is missing entirely", () => {
    expect(checkCheckoutUrl("export const OTHER = 1;").ok).toBe(false);
  });

  test("passes on a well-shaped unknown uuid", () => {
    expect(checkCheckoutUrl(src("https://liefwork.lemonsqueezy.com/checkout/buy/01234567-89ab-cdef-0123-456789abcdef")).ok).toBe(true);
  });
});

describe("checkLicenseDated", () => {
  test("fails while the placeholder stands", () => {
    expect(checkLicenseDated("Version 1.0 — [Effective date: set at first public release]").ok).toBe(false);
  });
  test("passes once dated", () => {
    expect(checkLicenseDated("Version 1.0 — Effective 20 July 2026").ok).toBe(true);
  });
});

describe("checkVersions", () => {
  const root = { version: "0.1.0", minAppVersion: "1.8.7", id: "liefwork" };
  const plugin = { version: "0.1.0", minAppVersion: "1.8.7", id: "liefwork" };
  const pkg = { version: "0.1.0" };
  const versions = { "0.1.0": "1.8.7" };

  test("passes when all five stamps agree", () => {
    expect(checkVersions(root, plugin, pkg, versions, versions).ok).toBe(true);
  });
  test("fails on manifest drift", () => {
    expect(checkVersions({ ...root, version: "0.1.1" }, plugin, pkg, versions).ok).toBe(false);
  });
  test("fails when versions.json misses the release", () => {
    expect(checkVersions(root, plugin, pkg, {}).ok).toBe(false);
  });
  test("fails when versions.json disagrees on minAppVersion", () => {
    expect(checkVersions(root, plugin, pkg, { "0.1.0": "1.5.0" }).ok).toBe(false);
  });

  // ── the fifth stamp (5 Aug 2026) ──────────────────────────────────────────
  // 0.1.5 shipped with obsidian-plugin/versions.json still reading 0.1.4 and
  // THIS GATE PASSED — only manifest-sync.test.ts, which runs inside the cut
  // after the gate, caught it. The stamp the gate could not see was the one in
  // the file that records releases.
  test("fails when the plugin's versions.json lags behind the root copy", () => {
    const lagging = { "0.1.0": "1.8.7" };
    const current = { "0.1.0": "1.8.7", "0.1.1": "1.8.7" };
    const at011 = { version: "0.1.1", minAppVersion: "1.8.7", id: "liefwork" };
    const r = checkVersions(at011, at011, { version: "0.1.1" }, current, lagging);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("obsidian-plugin/versions.json");
  });

  test("fails on ANY divergence between the two copies, not just a missing release", () => {
    // Same keys, different minAppVersion: both files answer "which Obsidian
    // does 0.1.0 need?" and they must not answer differently.
    const r = checkVersions(root, plugin, pkg, versions, { "0.1.0": "1.9.0" });
    expect(r.ok).toBe(false);
  });

  test("omitting the fifth argument keeps the four-stamp behaviour", () => {
    // Back-compat for callers that pass only four — the default aliases the
    // root copy, so the new check is a no-op rather than a false failure.
    expect(checkVersions(root, plugin, pkg, versions).ok).toBe(true);
  });
});

describe("source guards — the gate is pinned to the real tree", () => {
  test("pro.ts's current uuid is either live-confirmed or in KNOWN_NONLIVE_UUIDS", () => {
    // While the LS store is under review the shipping uuid MUST be listed as
    // non-live. When the live URL finally lands, this test flips its meaning:
    // it fails if the live uuid was accidentally added to the non-live list.
    const pro = readFileSync(resolve(ROOT, "obsidian-plugin/src/pro.ts"), "utf-8");
    const r = checkCheckoutUrl(pro);
    // Exactly one of: red because known-non-live (pre-release state), or green
    // (live URL landed and is not on the list). Never red for shape/absence.
    if (!r.ok) expect(r.detail).toContain("NON-LIVE");
  });

  // (The dev tree additionally pins that ICE_CREAM_SPEC_PATH exists, so the
  // absent-check can never pass vacuously; that pin is deleted at the public
  // cut, where the spec's absence is the point.)
});
