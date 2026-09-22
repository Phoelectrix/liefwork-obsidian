import { meltemi, withPalette } from "../../viewer/src/palettes.ts";
import { pluginDefaultStyling } from "./plugin-default-styling.ts";

/** The coral's colour theme. "dark" = Meridian, the LOCKED default look;
 *  "light" = Meltemi, the Cycladic light mode. Explicit setting + toggle
 *  command for now; following Obsidian's own theme is deferred, not decided
 *  against. */
export type CoralTheme = "dark" | "light";

/** Persisted value → theme. Anything unrecognised (including absent — every
 *  existing data.json) is dark, so nothing moves for existing users. */
export function resolveTheme(raw: unknown): CoralTheme {
  return raw === "light" ? "light" : "dark";
}

export function toggleTheme(t: CoralTheme): CoralTheme {
  return t === "dark" ? "light" : "dark";
}

const lightStyling = withPalette(pluginDefaultStyling, meltemi);

/** The styling the plant mounts with for a theme. Dark is the shipped default
 *  object itself (same reference — the identity guarantee); light lays Meltemi
 *  over it, leaving every non-colour value shared. */
export function stylingForTheme(t: CoralTheme): typeof pluginDefaultStyling {
  return t === "light" ? lightStyling : pluginDefaultStyling;
}
