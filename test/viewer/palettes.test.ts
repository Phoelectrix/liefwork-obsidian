import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { liefworkStylingDefaults } from "../../viewer/src/liefwork-defaults.ts";
import { meridian, meltemi, withPalette } from "../../viewer/src/palettes.ts";
import { mergeStylingConfig } from "../../viewer/src/styling.ts";
import { labelFont, LABEL_FAMILY } from "../../viewer/src/skeleton-canvas.ts";

// The load-bearing test of the light-mode work: extracting Meridian into a
// named palette must leave the LOCKED default look byte-identical. The
// snapshot was dumped from `main` (28 Aug 2026) BEFORE palettes.ts existed.
test("identity: liefworkStylingDefaults is unchanged by the palette extraction", () => {
  const frozen = JSON.parse(
    readFileSync(new URL("../fixtures/meridian-styling-defaults.snapshot.json", import.meta.url), "utf8"),
  );
  const now = JSON.parse(JSON.stringify(liefworkStylingDefaults));
  // Every value that existed on main is unchanged...
  for (const k of Object.keys(frozen)) {
    if (k === "v2Stem" || k === "projection") continue; // each gains one neutral key, checked below
    if (k === "subtreeBoostShape") continue; // 3.8 → 4.3, deliberately, 22 Sept 2026 (below)
    expect({ [k]: now[k] }).toEqual({ [k]: frozen[k] });
  }
  // The one retuned styling value in the Meridian un-lock: a steeper attention
  // curve for cleaner wide views — the founder's call, taken from the light
  // mode tuning and applied to both themes.
  expect(frozen.subtreeBoostShape).toBe(3.8);
  expect(now.subtreeBoostShape).toBe(4.3);
  expect(now.v2Stem).toEqual({ ...frozen.v2Stem, minScreenPx: 1.5 });
  // gain 0 = today's rays exactly (see meristem-lift.test.ts). meristemLiftEm
  // 0.4 is the Meridian UN-LOCK (founder's tuning, 22 Sept 2026): a screen-space
  // title lift only — the world geometry (rays, angles) is still byte-identical.
  expect(now.projection).toEqual({ ...frozen.projection, meristemDistanceWeightGain: 0, meristemLiftEm: 0.4 });
  // ...and the ONLY additions are the extracted canvas constants at their
  // previously hardcoded values.
  const added = Object.keys(now).filter((k) => !(k in frozen)).sort();
  expect(added).toEqual(["dotGlyphRadiusEm", "fileLiefColor", "labelStrokePx", "labelWeight", "liefBlockFill", "selectedLabelColor"]);
  // 0.25 (was the 0.15 canvas constant) — the second Meridian un-lock value, 22 Sept 2026
  expect(now.dotGlyphRadiusEm).toBe(0.25);
  // 0 = no stroke under the glyphs — the pre-0.2.0 draw exactly (text presence, 10 Sept 2026)
  expect(now.labelStrokePx).toBe(0);
  expect(now.projection.lightOpacity).toBe(0.95);
  expect(now.selectedLabelColor).toBe("#BE7355");
  expect(now.fileLiefColor).toBe("#5ECFBE");
  expect(now.liefBlockFill).toBe("rgba(238,242,248,0.62)");
  expect(now.labelWeight).toBe("400");
});

test("withPalette(defaults, meridian) is a no-op on the default look", () => {
  expect(withPalette(liefworkStylingDefaults, meridian)).toEqual(liefworkStylingDefaults);
});

test("withPalette(defaults, meltemi) swaps every colour role and keeps non-colour tuning", () => {
  const light = withPalette(liefworkStylingDefaults, meltemi);
  expect(light.background.color).toBe("#F6F3EB");
  expect(light.projection.meristemLight).toBe("#06192F");
  expect(light.projection.light).toBe("#313D49");
  expect(light.stem.color).toBe("#5A4A34");
  expect(light.projection.pathLight).toBe("#8A6A2E");
  expect(light.selectedLabelColor).toBe("#B01F7D");
  expect(light.fileLiefColor).toBe("#8E3A22"); // dark terracotta — a hue apart, not a shade of green
  // founder-tuned on the dev panel, 22 Sept 2026
  expect(light.dotGlyphRadiusEm).toBe(0.42);
  expect(light.projection.meristemDistanceWeightGain).toBe(2);
  expect(light.projection.meristemLiftEm).toBe(0.4);
  expect(light.panelTheme).toBe("light");
  // weight rides the palette — back to 400: the stroke carries the presence, not the weight
  expect(light.labelWeight).toBe("400");
  expect(light.v2Stem.minScreenPx).toBe(2);
  // text presence on whitewash: full opacity + a hairline same-colour stroke
  expect(light.projection.lightOpacity).toBe(1);
  expect(light.labelStrokePx).toBe(0.6);
  // two attention/tier values ride the palette too (they differ per theme)
  expect(light.subtreeBoostShape).toBe(4.3);
  expect(light.liefDotsAbovePx).toBe(0.5);
  expect(liefworkStylingDefaults.subtreeBoostShape).toBe(4.3); // shared since 22 Sept — the role stays for the day they differ again
  expect(liefworkStylingDefaults.liefDotsAbovePx).toBe(1);
  // non-colour tuning is untouched
  expect(light.optimalSize).toBe(liefworkStylingDefaults.optimalSize);
  expect(light.v2Stem.tipOpacity).toBe(liefworkStylingDefaults.v2Stem.tipOpacity);
  expect(light.projection.ray.opacity).toBe(liefworkStylingDefaults.projection.ray.opacity);
});

test("the three former canvas constants are styling keys defaulting to today's values", () => {
  const cfg = mergeStylingConfig({});
  expect(cfg.selectedLabelColor).toBe("#BE7355");
  expect(cfg.fileLiefColor).toBe("#5ECFBE");
  expect(cfg.liefBlockFill).toBe("rgba(238,242,248,0.62)");
  expect(cfg.labelWeight).toBe("400");
  expect(cfg.v2Stem.minScreenPx).toBe(1.5);
  expect(cfg.dotGlyphRadiusEm).toBe(0.15);
  expect(cfg.projection.meristemDistanceWeightGain).toBe(0);
  expect(cfg.projection.meristemLiftEm).toBe(0);
});

test("labelFont puts the palette weight in the font shorthand", () => {
  expect(labelFont("600", 20)).toBe(`600 20px ${LABEL_FAMILY}`);
});

// The hit-test trap: the draw pass and hitTest's measureText must build the
// font string from the SAME helper, or a weight change drifts every click box
// off its glyphs. Guard it at the source level — no bare `px ${LABEL_FAMILY}`
// template may survive outside labelFont itself.
test("every ctx.font site in skeleton-canvas goes through labelFont", () => {
  const src = readFileSync(new URL("../../viewer/src/skeleton-canvas.ts", import.meta.url), "utf8");
  const bare = src.match(/px \$\{(LABEL_FAMILY|family)\}/g) ?? [];
  expect(bare.length).toBe(1); // labelFont's own body
});

// The dot-glyph tier is a hairline-class mark (0.15 em): fine on the Void,
// eaten by whitewash. Its radius must come from styling, not a literal.
test("dot-glyph radius is read from styling, not hardcoded", () => {
  const src = readFileSync(new URL("../../viewer/src/skeleton-canvas.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/fontPx \* 0\.15/);
  expect(src).toMatch(/styling\.dotGlyphRadiusEm/);
});
