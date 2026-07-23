import type { StylingConfig } from "./styling.ts";
// The LIBRARY engine's config — the engine these defaults are actually layered
// onto (obsidian-plugin/src/engine-config.ts and Studio's init both start from
// src/library's defaultEngineConfig). This used to import src/types.ts, whose
// EngineConfig is the pre-coral engine's: same top-level shape, but a different
// `clearance` (lead-in spacers vs the library's growth-block factors). Nothing
// noticed while `clearance` was absent here — the first tuned clearance value
// wouldn't typecheck, which is how the mis-import surfaced.
import type { EngineConfig } from "../../src/library/types.ts";

/**
 * The canonical LiefWork shipped look + engine tuning — the SINGLE SOURCE for
 * both the Obsidian plugin (Alpha) and Studio, so Studio's defaults match what
 * Alpha ships. Lives in the viewer layer (not the plugin) because the plugin
 * imports the viewer; the reverse would be a dependency cycle.
 *
 *   • Alpha: `obsidian-plugin/src/plugin-default-styling.ts` re-exports these and
 *     mountPlant / the plant build layer them over the viewer/engine bases.
 *   • Studio: `viewer/src/main.ts` initialises its default styling + engine
 *     config from these (the public viewer keeps the bare `defaultStylingConfig`).
 *
 * PROVENANCE: layout + base styling transcribed 2026-06-15 from the LiefWork-coral
 * Studio bundle; PALETTE is "Meridian" (adopted 2026-06-16, superseding Canopy &
 * the 2026-06-05 Anselm values). Sizing/LOD + branch layout re-tuned 2026-06-30
 * from the `liefwork-coral-29-6-ii.liefwork.json` Studio bundle — branch angles
 * are FIXED at 68.76° with no decay (Pavlos's call). Reserved (unused): Iridescent Teal #5ECFBE +
 * Accent Coral #C44848 for future status/priority. THE PATHWAY for future palette/
 * layout upgrades: tune in Studio → save the .liefwork.json → transcribe here.
 */
// `satisfies` (not a `: Partial<…>` annotation) keeps the inferred type the
// literal object — consumers reading a key that IS present here (e.g. the
// plugin's text-sizing defaults reading optimalSize) see `number`, not
// `number | undefined`, while assignability to Partial<StylingConfig> is
// still checked.
export const liefworkStylingDefaults = {
  sun: {
    azimuth: 1.3089969389957472,
    elevation: 0.4363323129985824,
  },
  bud: {
    baseline: "follow-tangent",
    minimalSkinFontScale: 0.35,
  },
  cull: {
    cullBufferFactor: 1.5,
  },
  projection: {
    liefRelativeAngle: 1.5707963267948966,
    meristemRelativeAngle: 0,
    liefFanRange: 0.4363323129985824,
    cursorLight: true,
    cursorLightRay: "fixed",
    liefDistance: 1.8,
    meristemDistance: 3,
    titleSize: 0.24,
    light: "#EEF2F8", // Meridian: Star White (lief labels)
    meristemLight: "#E8B96A", // Meridian: Amber Window (folder/branch hierarchy — pale straw-gold)
    pathLight: "#A8B4BC", // Meridian: Silver Facade (path-to-root — neutral; teal reserved for status)
    pathIncludeRoot: false,
    pathOpacity: 0.94,
    // 5 (was 50, 21 July) — the 14-July value put a ~2000-unit empty stalk
    // above the root, which read as GIANT on a new/small coral. It also sat
    // inside wholeCoralBounds (LABEL-INCLUSIVE), so every fit / zoom-floor /
    // clamp was computed against mostly-empty space — which is why a fresh
    // coral framed badly ([[Bugs refinements needed]] #3). Founder-tuned live.
    rootMeristemDistance: 5,
    lightOpacity: 0.95,
    sourceOpacity: 0,
    ray: {
      stroke: "#8499B8", // Meridian: Dusty Periwinkle (subtle connector rays)
      opacity: 0.35,
      width: 1,
    },
    showBounds: false,
    liefDistanceCurveAmp: 0,
    liefDistanceCurvePeak: 0.618,
  },
  body: {
    fill: "#2A3540", // Meridian: Deep Slate mid-tone fill (currently off — baseOpacity 0)
    baseOpacity: 0,
    cursorBoost: 1.6,
    edgeSoftness: 0.5,
  },
  overrides: {},
  stem: {
    // Meridian: Dusty Periwinkle structural connectors (cool architectural line).
    color: "#8499B8",
  },
  background: {
    color: "#080A0C", // Meridian: Void
  },
  // Meridian palette: Void bg, Amber Window meristems, Star White liefs, Dusty
  // Periwinkle stems/rays, Silver Facade path, Peach Rose selection (the selected-
  // label colour lives in skeleton-canvas.ts). RESERVED (not used yet): Iridescent
  // Teal #5ECFBE + Accent Coral #C44848 for future status / priority signalling.
  atmosphere: {
    horizon: false,
    horizonStrength: 1,
    vignette: false,
    vignetteStrength: 0.55,
    glow: false,
    glowStrength: 0.7,
    haze: false,
    hazeStrength: 0.5,
    grain: false,
    grainStrength: 0.15,
    motes: 0,
  },
  v2Stem: {
    maxWidth: 5,
    minWidth: 1.5,
    tipOpacity: 0.35,
    subtreeExp: 2.75,
  },
  meristemLabelIncludeParent: false,
  wrapWithFilenameRoot: false,
  motionMode: "rest-only",
  settleStyle: "interpolated",
  initialLiefCull: false,
  basalMag: 1.4,
  // 14 July Studio tuning. optimalSize / liefOptimalSize / attentionPropagation-
  // Decay are ALSO the user-facing "Aa" knobs — these are the defaults behind the
  // reset button, not a live setting, so an existing data.json keeps overriding
  // them until the user resets.
  optimalSize: 70,
  // 10 (was 16, 21 July): with the crowding cap doing the anti-overlap work,
  // the optimal is now what a lief settles AT rather than what it inflates to.
  liefOptimalSize: 10,
  bubbleWidth: 0.5,
  subtreeBoost: 0.65,
  subtreeBoostShape: 3.8,
  cursorMagnification: 3,
  // 21 July LOD ruling (founder): meristems stay TEXT down to the edge of
  // legibility; the glyph tier is NOT a middle stage. dots(14) > full(5) makes
  // it structurally unreachable — visualTier tests `full` first — so a meristem
  // goes text → single dot → hidden. Wide-view calm comes from the cull floor
  // (3, was 1): far twigs leave the canvas instead of loitering as glyphs.
  // meristemCullMinPx 0: a branch title is NEVER hidden for being small — it
  // degrades to a single dot instead. The founder tried a 3 px floor and backed
  // it out: a missing branch reads as "nothing here", a dot reads as "something
  // here, keep zooming". Presence beats tidiness.
  meristemCullMinPx: 0,
  meristemDotsAbovePx: 14,
  meristemFullAbovePx: 3,
  // The cull CEILING, not a size: sizing/cull.ts hides a block whose target
  // exceeds it. Must clear the largest optimalSize the user can dial in (the Aa
  // slider's max, 120) — attention lifts a block toward its optimal, so a lower
  // ceiling hides the most-attended blocks, the root meristem first. The 14 July
  // tuning's 50 did exactly that; the previous 100 was latently wrong too, for
  // anyone who pushed the slider past 100. 200 = the library's own default.
  meristemPeakSize: 200,
  liefCullMinPx: 0,
  // 21 July: the 14-July values were INVERTED (dots 19 > full 8), which made
  // the lief glyph tier unreachable and sent liefs straight from a single dot
  // to full text. Now dots(1) < full(5.5): a lief shows letter-dots from 1 px
  // — the "detail beneath" cue — and text only once it is actually legible.
  liefDotsAbovePx: 1,
  liefFullAbovePx: 5.5,
  liefPeakSize: 100,
  // CROWDING CEILING (21 July) — a lief is drawn at most this multiple of its
  // own geometric (basal) size. The fix for "liefs on a viewport-filling branch
  // pin to liefOptimalSize and overlap while their neighbours on small branches
  // stay hidden": that is a lift ratio, and lief spacing is world-fixed, so
  // capping the ratio prevents overlap at EVERY zoom without shrinking liefs
  // globally. Bypassed for a cursor-lit lief so hover always reveals.
  liefMaxLift: 1.1,
  staggerBatchSize: 32,
  attentionPropagationDecay: 0.35,
  panelTheme: "dark",
  liefBlock: {
    mode: "label",
    justify: true,
    sizeRatio: 0.58,
    maxLines: 5,
  },
  // Camera framing: kept IDENTICAL to defaultStylingConfig's camera block —
  // Task 8 requires the plugin's framing not to drift from today's behaviour.
  camera: {
    fitPadding: 0.12,
    branchFramePad: 1.5,
    branchFitPad: 1.2,
  },
} satisfies Partial<StylingConfig>;

/** The default engine (layout) tuning, deep-merged over the library
 *  `defaultEngineConfig` by both the plugin build and Studio's init. */
export const liefworkEngineDefaults: Partial<EngineConfig> = {
  sizing: {
    baseSize: 40,
    // 1 = no taper: a child departs at its parent's size (was 0.62).
    childScale: 1,
    phiOrder: 1,
    spacerRatio: 2,
    liefTaper: 0,
  },
  angles: {
    angleMode: "phi-sequence",
    firstBranchAngle: 60,
    // BACK TO 1 (15 July) — the launch tuning's value, restored for safety.
    //
    // decay:1 means every same-side sibling departs at exactly firstBranchAngle
    // (Math.pow(1, k) === 1), so a dense fan CANNOT collapse toward 0°. The
    // 14 July tuning brought 0.97, which only mitigates: a 20-sibling fan reaches
    // ~0.54x its first angle, a 50-sibling fan ~0.22x. The richer fix — keep some
    // decay but clamp a MINIMUM branch angle — is still deferred post-launch.
    //
    // NB this pairs decay:1 with firstBranchAngle 60, a combination that has
    // never shipped (launch ran 68.76° — half the golden angle — with decay 1;
    // the 14 July tuning ran 60° with 0.97). Uniform 60° packs same-side siblings
    // tighter than uniform 68.76° did, so it was verified rather than assumed:
    // scripts/detect-crossings.ts over the whole LiefWork coral reports zero
    // crossings at this config with branchBuffer 1.1.
    angleDecay: 1,
    alternateBranches: true,
    alternateLiefs: true,
    nonAlternatingDepth: 0,
    rootOrientationAngle: 90,
    // OFF (vs the library default ON): the first child no longer flips to the
    // opposite side from its parent. Keeps the alternating fan but stops a
    // deeply-nested lineage curling back across its own trunk — the dominant
    // source of deep-nesting branch crossings. Plants also read more naturally.
    curlBack: false,
    mirrorCurl: true,
  },
  // Founder-tuned 14 July — the first tuning to carry a clearance block, and the
  // reason the file's EngineConfig mis-import surfaced (see the import above).
  // The note that stood here said this block was the pre-coral engine's schema
  // and that "Studio ignores it under engine:library", so it should be omitted.
  // Half right: the two schemas DO differ — but this five-key one is the
  // library's, all of it consumed by growth-block.ts / size.ts, and Studio does
  // apply it (viewer/src/main.ts merges e.clearance when present). The tuning is
  // real and was on screen.
  clearance: {
    // 1.1 (15 July). The 14 July tuning brought 1.3 — the value [[Tip Crossings]]
    // calibrated on the 5 July vault as "clears every crossing". That calibration
    // is now STALE: the junction-line work of 13–14 July solved the crossings
    // structurally, so the buffer no longer has to. `scripts/detect-crossings.ts`
    // on the whole LiefWork coral reports ZERO crossings at 1.1 — and at 1.0 —
    // so 1.3 was insurance against a bug that no longer exists, and it cost real
    // spread (~11% chain length per +0.1, which blew the bigger corals up).
    // Re-run the detector before trusting a lower value on a different corpus.
    branchBuffer: 1.1,
    expansionEpsilonRatio: 0.02,
    childAxisGrowthBlockFactor: 10,
    // 0 = no meristem clearance block at all (size.ts multiplies the block's
    // short side by these). Clearance is what bought the crossing-free geometry,
    // so childAxisGrowthBlockFactor:10 above is carrying that load instead —
    // watch for crossings near meristems.
    meristemInFactor: 0,
    meristemOutFactor: 0,
  },
  curve: {
    curveType: "straight",
    boughParams: {
      undulationAmp: 0.11,
      undulationFreq: 1.5,
      undulationPhase: 0,
      entryBow: 0.05,
      bowFalloff: 3,
      turnPoint: 1,
      turnSharpness: 6,
      spiralAngle: 2.6179938779914944,
    },
  },
  sort: {
    default: "newest-first",
    liefsLast: false,
  },
};
