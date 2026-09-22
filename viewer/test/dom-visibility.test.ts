import { describe, expect, test } from "bun:test";
import { HIDDEN_CLASS, isHidden, setHidden } from "../src/dom-visibility";

describe("dom-visibility", () => {
  test("setHidden toggles the shared hidden class, never inline style", () => {
    const el = document.createElement("div");
    setHidden(el, true);
    expect(el.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(el.getAttribute("style")).toBeNull();
    setHidden(el, false);
    expect(el.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  test("works on SVG elements (stencil groups are SVGGElement)", () => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    setHidden(g, true);
    expect(isHidden(g)).toBe(true);
    setHidden(g, false);
    expect(isHidden(g)).toBe(false);
  });

  test("setHidden is idempotent and preserves unrelated classes", () => {
    const el = document.createElement("div");
    el.classList.add("stencil-projected");
    setHidden(el, true);
    setHidden(el, true);
    expect(el.className).toBe(`stencil-projected ${HIDDEN_CLASS}`);
    setHidden(el, false);
    expect(el.className).toBe("stencil-projected");
  });

  test("the hidden class has a display:none rule in BOTH stylesheets", async () => {
    // The class only hides if the rule ships on every platform the viewer
    // mounts on: the viewer's own style.css (site/Studio) and the plugin's
    // scoped styles.css (Obsidian). Guard both so neither copy drifts.
    // (style.css is site-only and absent from the public cut — the plugin
    // check is the one that must hold everywhere.)
    const { existsSync, readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const rule = new RegExp(`\\.${HIDDEN_CLASS}\\s*\\{[^}]*display:\\s*none`);
    const pluginCss = readFileSync(
      new URL("../../obsidian-plugin/styles.css", import.meta.url),
      "utf8",
    );
    expect(pluginCss).toMatch(rule);
    const viewerCssPath = fileURLToPath(new URL("../src/style.css", import.meta.url));
    if (existsSync(viewerCssPath)) {
      expect(readFileSync(viewerCssPath, "utf8")).toMatch(rule);
    }
  });
});
