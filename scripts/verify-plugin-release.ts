// scripts/verify-plugin-release.ts
//
// The Phase-4 release traps, turned into a command that FAILS (the
// verify-deploy-bundle.ts idiom). Every check here guards something no build,
// linter or reviewer can catch:
//   1. PRO_CHECKOUT_URL — a placeholder/test checkout is IDENTICAL IN SHAPE to
//      the live one (same domain, same /checkout/buy/<uuid>); shipping it would
//      simply take no money, silently. The only structural defence is a list of
//      UUIDs known NOT to be the live product — the gate fails while the
//      current URL carries one. Shape alone can never prove liveness: the only
//      final proof is a real purchase.
//   2. LICENSE effective date — both copies ship with the bracket placeholder
//      until first public release; releasing with it unfilled voids the date
//      the 4-year Apache-2.0 conversion runs from.
//   3. The ice-cream-man design spec — internal strategy material that must not
//      be in the public cut.
//   4. Version stamp coherence — root manifest, plugin manifest, plugin
//      package.json and BOTH versions.json copies must agree (the root copies exist only
//      for the directory's repo scan; a drifted pair ships a lie).
// Run before the public cut and again on the cut tree:
//   bun run scripts/verify-plugin-release.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** UUIDs known NOT to be the live product (test-mode / placeholder links).
 *  Add every non-live UUID that ever appears in pro.ts — the gate stays red
 *  while any of them is the shipping URL. */
export const KNOWN_NONLIVE_UUIDS = [
  // In pro.ts since 15 July 2026 — the LS store was still UNDER REVIEW when it
  // landed, so no live checkout existed; founder-confirmed placeholder (16 July).
  // Superseded 23 July 2026 by the founder-provided live product link (the live
  // uuid differs — this one stays listed so it can never ship by regression).
  "cf3cb637-e934-42a9-aade-e66b11cee6fb",
];

const CHECKOUT_SHAPE = /^https:\/\/liefwork\.lemonsqueezy\.com\/checkout\/buy\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface CheckResult {
  ok: boolean;
  detail: string;
}

/** Pure check of pro.ts source text: URL present, well-shaped, not a known non-live UUID. */
export function checkCheckoutUrl(proSource: string): CheckResult {
  const match = proSource.match(/PRO_CHECKOUT_URL\s*=\s*\n?\s*"([^"]*)"/);
  if (!match) return { ok: false, detail: "PRO_CHECKOUT_URL not found in pro.ts" };
  const url = match[1];
  if (url.includes("TODO")) return { ok: false, detail: `checkout URL is a TODO stub: ${url}` };
  const shape = url.match(CHECKOUT_SHAPE);
  if (!shape) return { ok: false, detail: `checkout URL does not match the LS shape: ${url}` };
  if (KNOWN_NONLIVE_UUIDS.includes(shape[1])) {
    return {
      ok: false,
      detail:
        `checkout URL carries a KNOWN NON-LIVE uuid (${shape[1]}). Swap in the live product ` +
        `link once the Lemon Squeezy store clears review — and remember shape can't prove ` +
        `liveness; the only final proof is a real purchase.`,
    };
  }
  return { ok: true, detail: `checkout URL is well-shaped and not a known non-live uuid` };
}

/** Pure check of a LICENSE text: the effective-date placeholder must be gone. */
export function checkLicenseDated(licenseText: string): CheckResult {
  if (licenseText.includes("[Effective date:")) {
    return { ok: false, detail: "LICENSE still carries the [Effective date: …] placeholder" };
  }
  return { ok: true, detail: "LICENSE effective date is filled" };
}

/** Pure check across the FIVE version stamps.
 *
 *  It was four until 5 Aug 2026, and the missing one was `obsidian-plugin/
 *  versions.json`: 0.1.5 shipped with it still reading 0.1.4 and this gate
 *  passed. Only `manifest-sync.test.ts` — which runs INSIDE the cut, after the
 *  gate — caught it. The thing whose whole job is to know about releases had a
 *  blind spot in the one place a release is recorded. */
export function checkVersions(
  rootManifest: { version?: string; minAppVersion?: string; id?: string },
  pluginManifest: { version?: string; minAppVersion?: string; id?: string },
  pluginPackage: { version?: string },
  versionsJson: Record<string, string>,
  pluginVersionsJson: Record<string, string> = versionsJson,
): CheckResult {
  const problems: string[] = [];
  if (rootManifest.version !== pluginManifest.version)
    problems.push(`root manifest ${rootManifest.version} != plugin manifest ${pluginManifest.version}`);
  if (rootManifest.minAppVersion !== pluginManifest.minAppVersion)
    problems.push(`minAppVersion drift: root ${rootManifest.minAppVersion} vs plugin ${pluginManifest.minAppVersion}`);
  if (rootManifest.id !== pluginManifest.id)
    problems.push(`id drift: root ${rootManifest.id} vs plugin ${pluginManifest.id}`);
  if (pluginPackage.version !== pluginManifest.version)
    problems.push(`plugin package.json ${pluginPackage.version} != manifest ${pluginManifest.version}`);
  const version = pluginManifest.version ?? "";
  if (!(version in versionsJson))
    problems.push(`versions.json has no entry for ${version}`);
  else if (versionsJson[version] !== pluginManifest.minAppVersion)
    problems.push(
      `versions.json[${version}] = ${versionsJson[version]} != minAppVersion ${pluginManifest.minAppVersion}`,
    );
  // The fifth stamp. The two versions.json copies must be identical, not merely
  // both present: the plugin's copy is what ships, the root's is what the dev
  // tree reads, and 0.1.5 proved they can drift silently.
  if (JSON.stringify(pluginVersionsJson) !== JSON.stringify(versionsJson))
    problems.push(
      `obsidian-plugin/versions.json differs from the root copy` +
        (version in pluginVersionsJson
          ? ` (plugin has ${version} → ${pluginVersionsJson[version]})`
          : ` (plugin has NO entry for ${version})`),
    );
  return problems.length
    ? { ok: false, detail: problems.join("; ") }
    : { ok: true, detail: `all stamps agree at ${version} / minApp ${pluginManifest.minAppVersion}` };
}

/** The internal spec that must not reach the public cut. */
export const ICE_CREAM_SPEC_PATH =
  "docs/superpowers/specs/2026-07-01-contribution-model-ice-cream-man-design.md";

// ── CLI entrypoint ──────────────────────────────────────────────────────────
if (import.meta.main) {
  const results: Array<[name: string, r: CheckResult]> = [];

  results.push([
    "checkout URL",
    checkCheckoutUrl(readFileSync(resolve(ROOT, "obsidian-plugin/src/pro.ts"), "utf-8")),
  ]);
  results.push([
    "LICENSE (root)",
    checkLicenseDated(readFileSync(resolve(ROOT, "LICENSE"), "utf-8")),
  ]);
  results.push([
    "LICENSE (plugin)",
    checkLicenseDated(readFileSync(resolve(ROOT, "obsidian-plugin/LICENSE"), "utf-8")),
  ]);
  results.push([
    "ice-cream-man spec absent",
    existsSync(resolve(ROOT, ICE_CREAM_SPEC_PATH))
      ? { ok: false, detail: `${ICE_CREAM_SPEC_PATH} is still in the tree — remove before the public cut` }
      : { ok: true, detail: "spec not in the tree" },
  ]);
  results.push([
    "version stamps",
    checkVersions(
      JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf-8")),
      JSON.parse(readFileSync(resolve(ROOT, "obsidian-plugin/manifest.json"), "utf-8")),
      JSON.parse(readFileSync(resolve(ROOT, "obsidian-plugin/package.json"), "utf-8")),
      JSON.parse(readFileSync(resolve(ROOT, "versions.json"), "utf-8")),
      JSON.parse(readFileSync(resolve(ROOT, "obsidian-plugin/versions.json"), "utf-8")),
    ),
  ]);

  let anyFail = false;
  for (const [name, r] of results) {
    console.log(`${r.ok ? "  OK " : "FAIL "} ${name} — ${r.detail}`);
    if (!r.ok) anyFail = true;
  }

  if (anyFail) {
    console.error(
      "\nRELEASE GATE RED. Every failure above is invisible to the build, the linter and " +
        "the reviewer — that is why this script exists. Fix and re-run.",
    );
    process.exit(1);
  }
  console.log("\nRelease gate green. Final manual step remains: prove the checkout with a real purchase.");
}
