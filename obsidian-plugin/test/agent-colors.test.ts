import { test, expect } from "bun:test";
import {
  AGENT_COLORS,
  FREE_AGENT_COLORS,
  NAMED_AGENT_COLORS,
  canSelectColor,
  colorSwatches,
  nextAgentColor,
  spectralShiftActive,
} from "../src/agent-colors.ts";

test("AGENT_COLORS is the brand rotation in order (no neon yellow)", () => {
  expect(AGENT_COLORS).toEqual([
    "#5ECFBE", "#C44848", "#FF3399", "#D4927A", "#A8B4BC",
    "#9C6BFF", "#4DA3FF", "#7FE0A8",
  ]);
});

test("FREE_AGENT_COLORS is the five bare accents — the named deep-sea hues are not in it", () => {
  expect(FREE_AGENT_COLORS).toEqual([
    "#5ECFBE", "#C44848", "#FF3399", "#D4927A", "#A8B4BC",
  ]);
  for (const c of NAMED_AGENT_COLORS) {
    expect(FREE_AGENT_COLORS).not.toContain(c.hex);
  }
});

test("nextAgentColor: empty → first accent (teal)", () => {
  expect(nextAgentColor([])).toBe("#5ECFBE");
});

test("nextAgentColor: picks the next unused in rotation order", () => {
  expect(nextAgentColor(["#5ECFBE"])).toBe("#C44848");
  expect(nextAgentColor(["#5ECFBE", "#C44848"])).toBe("#FF3399");
  expect(nextAgentColor(["#5ECFBE", "#C44848", "#FF3399"])).toBe("#D4927A");
  expect(nextAgentColor(["#5ECFBE", "#C44848", "#FF3399", "#D4927A"])).toBe("#A8B4BC");
});

// With the full (Pro) palette, the named colors follow the accents, so eight
// agents get a distinct color before any repeats.
test("nextAgentColor: full palette — the named colors follow the accents", () => {
  const firstFive = ["#5ECFBE", "#C44848", "#FF3399", "#D4927A", "#A8B4BC"];
  expect(nextAgentColor(firstFive)).toBe("#9C6BFF");
  expect(nextAgentColor([...firstFive, "#9C6BFF"])).toBe("#4DA3FF");
  expect(nextAgentColor([...firstFive, "#9C6BFF", "#4DA3FF"])).toBe("#7FE0A8");
});

// A free user's rotation never auto-assigns a color they could not pick by
// hand: with the FREE palette the cycle repeats over the five accents.
test("nextAgentColor: FREE palette — cycles the five accents, never a named hue", () => {
  const firstFive = ["#5ECFBE", "#C44848", "#FF3399", "#D4927A", "#A8B4BC"];
  expect(nextAgentColor(firstFive, FREE_AGENT_COLORS)).toBe("#5ECFBE");
  expect(nextAgentColor([...firstFive, "#5ECFBE"], FREE_AGENT_COLORS)).toBe("#C44848");
});

test("nextAgentColor: all used → duplicates the least-used (earliest on tie)", () => {
  const all = [...AGENT_COLORS];
  // each used once → teal (earliest) reused
  expect(nextAgentColor(all)).toBe("#5ECFBE");
  // teal used twice, others once → coral is least-used among the rest
  expect(nextAgentColor(["#5ECFBE", ...all])).toBe("#C44848");
});

test("nextAgentColor: ignores non-palette (user-picked) colors", () => {
  expect(nextAgentColor(["#123456"])).toBe("#5ECFBE");
  // A Pro-picked named hue in use does not skew a free user's accent rotation.
  expect(nextAgentColor(["#9C6BFF"], FREE_AGENT_COLORS)).toBe("#5ECFBE");
});

// ── Swatches + gating ───────────────────────────────────────────────────────
// The Pro color perk (settled 23 July, refining the 14 July inversion):
// the five bare accents are free; the three NAMED deep-sea swatches and the
// arbitrary color WHEEL are Pro. Pro remains: colors · spectral pulse ·
// prompt silence.

test("colorSwatches: all eight swatches show, in rotation order", () => {
  const swatches = colorSwatches();
  expect(swatches.map((s) => s.hex)).toEqual([...AGENT_COLORS]);
});

test("colorSwatches: the named deep-sea hues are Pro; the accents are free", () => {
  for (const s of colorSwatches()) {
    expect(s.pro).toBe(NAMED_AGENT_COLORS.some((c) => c.hex === s.hex));
  }
});

test("colorSwatches: the three deep-sea hues keep their names; the accents stay bare", () => {
  const byHex = new Map(colorSwatches().map((s) => [s.hex, s.name]));
  expect(byHex.get("#9C6BFF")).toBe("Abyss violet");
  expect(byHex.get("#4DA3FF")).toBe("Reef azure");
  expect(byHex.get("#7FE0A8")).toBe("Sea glass");
  for (const hex of FREE_AGENT_COLORS) {
    expect(byHex.get(hex)).toBeNull();
  }
});

test("NAMED_AGENT_COLORS are all in the rotation (no orphan names)", () => {
  for (const c of NAMED_AGENT_COLORS) expect(AGENT_COLORS).toContain(c.hex);
});

test("canSelectColor: the five accents select without Pro", () => {
  for (const hex of FREE_AGENT_COLORS) {
    expect(canSelectColor(hex, false)).toBe(true);
    expect(canSelectColor(hex, true)).toBe(true);
  }
});

test("canSelectColor: the named deep-sea hues are Pro-gated", () => {
  for (const c of NAMED_AGENT_COLORS) {
    expect(canSelectColor(c.hex, false)).toBe(false);
    expect(canSelectColor(c.hex, true)).toBe(true);
  }
});

test("canSelectColor: an arbitrary wheel color is the Pro perk", () => {
  expect(canSelectColor("#123456", false)).toBe(false);
  expect(canSelectColor("#123456", true)).toBe(true);
});

// Obsidian's ColorComponent emits lowercase hex, but the palette is written
// uppercase. An exact compare would read a free user's own swatch click — which
// round-trips through the wheel via setValue — as an arbitrary Pro color and
// refuse it. Match case-insensitively.
test("canSelectColor: swatch hexes match case-insensitively (the wheel emits lowercase)", () => {
  for (const hex of FREE_AGENT_COLORS) {
    expect(canSelectColor(hex.toLowerCase(), false)).toBe(true);
  }
  for (const c of NAMED_AGENT_COLORS) {
    expect(canSelectColor(c.hex.toLowerCase(), true)).toBe(true);
    expect(canSelectColor(c.hex.toLowerCase(), false)).toBe(false);
  }
});

test("spectralShiftActive: runs only with entitlement AND the setting on", () => {
  expect(spectralShiftActive(true, true)).toBe(true);
  expect(spectralShiftActive(true, false)).toBe(false);
  expect(spectralShiftActive(false, true)).toBe(false); // key removed → perk silenced
  expect(spectralShiftActive(false, false)).toBe(false);
});
