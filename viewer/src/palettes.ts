import type { StemConfig, StylingConfig } from "./styling.ts";

/**
 * Named palettes — every COLOUR role of the shipped look, plus the weight that
 * rides with it (stem widths, label weight), so a theme is one object and the
 * geometry/LOD tuning is shared untouched.
 *
 *   • Meridian — the LOCKED dark default ([[Default Look]]). Its values here
 *     are the same literals `liefwork-defaults.ts` has always carried; the
 *     identity test in test/viewer/palettes.test.ts pins that.
 *   • Meltemi — the Cycladic light mode (28 Aug 2026, draft v2, being tuned
 *     on screen). Named for the Aegean summer wind. Provenance and reasoning
 *     in the coral: Builds/Alpha/Light Mode.
 */
export interface Palette {
  name: string;
  /** Field / page background. */
  background: string;
  /** Branch stems. */
  stem: string;
  /** Lief (note) labels. */
  liefLabel: string;
  /** Meristem (branch) labels. */
  meristemLabel: string;
  /** Path-to-root highlight. */
  pathLabel: string;
  /** Connector rays (opacity stays with the base styling). */
  ray: string;
  /** Body mid-tone fill (off by default via body.baseOpacity 0). */
  bodyFill: string;
  selectedLabel: string;
  fileLief: string;
  liefBlockFill: string;
  panelTheme: "light" | "dark";
  labelWeight: string;
  dotGlyphRadiusEm: number;
  /** projection.lightOpacity — label alpha. Meridian's 0.95 softens light-on-
   *  dark; on whitewash the same alpha lightens dark text into grey. */
  lightOpacity: number;
  /** Same-colour stroke under full-tier text, screen px (see styling.ts). */
  labelStrokePx: number;
  /** projection.meristemDistanceWeightGain — the weight-proportional title lift. */
  meristemDistanceWeightGain: number;
  /** projection.meristemLiftEm — the screen-space title lift. */
  meristemLiftEm: number;
  /** subtreeBoostShape — the attention curve's shape; tuned per theme (founder, 22 Sept 2026). */
  subtreeBoostShape: number;
  /** liefDotsAbovePx — the lief dot-tier threshold; tuned per theme. */
  liefDotsAbovePx: number;
  v2Stem: StemConfig;
}

export const meridian: Palette = {
  name: "Meridian",
  background: "#080A0C", // Void
  stem: "#8499B8", // Dusty Periwinkle
  liefLabel: "#EEF2F8", // Star White
  meristemLabel: "#E8B96A", // Amber Window
  pathLabel: "#A8B4BC", // Silver Facade
  ray: "#8499B8",
  bodyFill: "#2A3540", // Deep Slate
  selectedLabel: "#BE7355", // Peach Rose (darkened from the kit's #D4927A)
  fileLief: "#5ECFBE", // Iridescent Teal
  liefBlockFill: "rgba(238,242,248,0.62)",
  panelTheme: "dark",
  labelWeight: "400",
  dotGlyphRadiusEm: 0.25, // 0.15 → 0.25 (founder's tuning, 22 Sept 2026 — the Meridian un-lock)
  lightOpacity: 0.95,
  labelStrokePx: 0,
  meristemDistanceWeightGain: 0, // fixed rays — the LOCKED geometry
  meristemLiftEm: 0.4, // 0 → 0.4 (22 Sept 2026): a screen-space title lift only; the rays are untouched
  subtreeBoostShape: 4.3, // 3.8 → 4.3 (founder, 22 Sept 2026): steeper attention curve, cleaner wide views — same as Meltemi
  liefDotsAbovePx: 1,
  v2Stem: { maxWidth: 5, minWidth: 1.5, tipOpacity: 0.35, subtreeExp: 2.75, minScreenPx: 1.5 },
};

export const meltemi: Palette = {
  name: "Meltemi",
  background: "#F6F3EB", // sunlit whitewash, warm bone (L* 96)
  stem: "#5A4A34", // hillside ochre × bougainvillea trunk (L* 33) — width carries the trunk, colour the earth
  liefLabel: "#313D49", // whitewash under an archway (L* 25)
  meristemLabel: "#06192F", // the sea at the cliff base — crushed-shadow Aegean (L* 10)
  pathLabel: "#8A6A2E", // sunlit stone — the one lit thing (L* 47)
  ray: "#313D49",
  bodyFill: "#313D49",
  selectedLabel: "#B01F7D", // the blossom
  fileLief: "#8E3A22", // dark terracotta — pots, roof tiles (L* 34); a hue apart from every other mark (the foliage green was a value-neighbour of the slate, retired 28 Aug)
  liefBlockFill: "rgba(49,61,73,0.62)",
  panelTheme: "light",
  labelWeight: "400", // 600 → 400 (founder's tuning, 22 Sept 2026): the stroke carries the presence, not the weight
  dotGlyphRadiusEm: 0.42, // 0.15 em dots vanished on whitewash (28 Aug); 0.24 → 0.42 tuned 22 Sept
  lightOpacity: 1, // no alpha on a bright field — 0.95 read as grey on small text (founder, 10 Sept)
  labelStrokePx: 0.6, // hairline under the glyphs: the weight anti-aliasing eats at 8–12 px (0.5 → 0.6, 22 Sept)
  meristemDistanceWeightGain: 2, // world-unit lift — helps zoomed in
  meristemLiftEm: 0.4, // screen-space lift — the one that holds on zoom-out (1.5 → 0.4, 22 Sept)
  subtreeBoostShape: 4.3, // a steeper attention curve — tuned here first, then adopted by Meridian too (22 Sept)
  liefDotsAbovePx: 0.5, // 1 in Meridian — liefs hold their dot a little longer on the light field (22 Sept)
  v2Stem: { maxWidth: 6, minWidth: 2, tipOpacity: 0.35, subtreeExp: 2.75, minScreenPx: 2 },
};

/** Lay a palette over a styling object (the shipped defaults or any partial
 *  carrying the same sub-objects). Returns a new object; the base is untouched.
 *  Applying `meridian` to `liefworkStylingDefaults` is a no-op by construction. */
export function withPalette<T extends Partial<StylingConfig>>(base: T, p: Palette): T {
  const proj = base.projection ?? ({} as NonNullable<T["projection"]>);
  return {
    ...base,
    background: { ...(base.background ?? {}), color: p.background },
    stem: { ...(base.stem ?? {}), color: p.stem },
    body: { ...(base.body ?? {}), fill: p.bodyFill },
    projection: {
      ...proj,
      light: p.liefLabel,
      meristemLight: p.meristemLabel,
      pathLight: p.pathLabel,
      meristemDistanceWeightGain: p.meristemDistanceWeightGain,
      meristemLiftEm: p.meristemLiftEm,
      lightOpacity: p.lightOpacity,
      ray: { ...(proj.ray ?? {}), stroke: p.ray },
    },
    v2Stem: { ...(base.v2Stem ?? {}), ...p.v2Stem },
    selectedLabelColor: p.selectedLabel,
    fileLiefColor: p.fileLief,
    liefBlockFill: p.liefBlockFill,
    labelWeight: p.labelWeight,
    dotGlyphRadiusEm: p.dotGlyphRadiusEm,
    labelStrokePx: p.labelStrokePx,
    subtreeBoostShape: p.subtreeBoostShape,
    liefDotsAbovePx: p.liefDotsAbovePx,
    panelTheme: p.panelTheme,
  } as T;
}
