import { test, expect } from "bun:test";
import { resolveTheme, toggleTheme, stylingForTheme } from "../src/theme.ts";
import { pluginDefaultStyling } from "../src/plugin-default-styling.ts";

test("resolveTheme defaults to dark so nothing moves for existing users", () => {
  expect(resolveTheme(undefined)).toBe("dark");
  expect(resolveTheme("light")).toBe("light");
  expect(resolveTheme("dark")).toBe("dark");
  expect(resolveTheme("garbage")).toBe("dark");
});

test("toggleTheme flips", () => {
  expect(toggleTheme("dark")).toBe("light");
  expect(toggleTheme("light")).toBe("dark");
});

test("stylingForTheme: dark is the LOCKED default look, light is Meltemi", () => {
  expect(stylingForTheme("dark")).toEqual(pluginDefaultStyling);
  const light = stylingForTheme("light");
  expect(light.background.color).toBe("#F6F3EB");
  expect(light.panelTheme).toBe("light");
  expect(light.optimalSize).toBe(pluginDefaultStyling.optimalSize);
});
