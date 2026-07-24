// Styling config: the non-structural half of a demo. Parallel to EngineConfig
// in scope and lifecycle — hash-persistable, slider-driven, re-applied on
// change without rebuilding the plant. Defaults are deliberately neutral so
// every styling session starts from a blank slate, not a theme.

export interface StemConfig {
  maxWidth: number;
  minWidth: number;
  tipOpacity: number;
  subtreeExp: number;
}

export interface ProjectionConfig {
  /** Ray angle for liefs relative to their branch tangent (radians). */
  liefRelativeAngle: number;
  /** Ray angle for meristems relative to their branch tangent (radians). */
  meristemRelativeAngle: number;
  /** Per-side angular fan (radians) spread across each branch's lief-chain. */
  liefFanRange: number;
  /** Cursor-as-light-source mode. */
  cursorLight: boolean;
  /** Cursor-light ray behaviour. "follow" (default): the lit block's ray
   *  rotates to point at the cursor (the broad sweep). "fixed": the block
   *  lights but its ray stays at its rendered default orientation. */
  cursorLightRay: "follow" | "fixed";
  /** Lief ray length in shortSide units (block-relative). */
  liefDistance: number;
  /** Meristem ray length in shortSide units. Independent from `liefDistance`
   *  so meristem labels can be pushed further from the branch tip without
   *  affecting liefs. */
  meristemDistance: number;
  /** Source font-size as a fraction of the block's shortSide. */
  titleSize: number;
  /** Projection text fill colour for **lief** labels. */
  light: string;
  /** Projection text fill colour for **meristem** labels. */
  meristemLight: string;
  /** Projection text fill colour for the cursor-light ancestor-path overlay.
   *  Reads as "context, not headline" — typically a desaturated tone. */
  pathLight: string;
  /** When true, the cursor-light ancestor-path overlay includes the root
   *  meristem's name as its first segment. When false (default), the root
   *  is dropped — useful when the root title is already prominent and
   *  prepending it to every cursor-lit path adds visual noise. */
  pathIncludeRoot: boolean;
  /** Fill-opacity of the cursor-light path overlay (0–1). At 0 the path is
   *  effectively deactivated (invisible even when cursor-light is active). */
  pathOpacity: number;
  /** Projection ray length for the **root meristem only** (shortSide units,
   *  like `meristemDistance`). The root sits at the top of the plant; a
   *  larger value lifts its title clear of the plant content. Defaults
   *  large enough to clear typical plants — tune per plant in Studio. */
  rootMeristemDistance: number;
  /** Projection text fill-opacity. */
  lightOpacity: number;
  /** In-stencil source <text> opacity. */
  sourceOpacity: number;
  /** Light-ray <line> style. */
  ray: { stroke: string; opacity: number; width: number };
  /** Debug: render a dashed bbox around each projection label. */
  showBounds: boolean;
  /** Amplitude of lief-distance variation along the branch.
   *  0 = uniform (every lief at the same distance — current behaviour).
   *  0.5 = at the peak, distance is 50% greater than the base value.
   *  Recommended range: 0 to 1.0. */
  liefDistanceCurveAmp: number;
  /** Position along the branch where the curve peaks (max lief distance).
   *  0 = base, 1 = tip. Default 0.618 (golden mean — slightly forward of centre).
   *  Range: 0 to 1. */
  liefDistanceCurvePeak: number;
  /** @internal — injected by main.ts at render time. */
  _depth?: number;
}

export interface CullConfig {
  /** Cull-frustum overscan factor. The viewport rect used by branch and
   *  block visibility checks is inflated by this factor (centered), so
   *  peripheral content is already mounted when small motions reveal it.
   *  1.0 = no buffer (strict viewport cull); 1.5 = 50% margin per side
   *  (default); 2.0 = full screen of margin. Trades DOM weight for smoother
   *  zoom-out under rest-only mode. */
  cullBufferFactor: number;
}

/** Lief typography block: renders a lief's title plus a smaller justified
 *  summary block. Config-gated, default-off ("label" mode preserves current
 *  title-only rendering) — nothing changes until a site explicitly opts into
 *  "block" mode. */
export interface LiefBlockConfig {
  /** "label" (default): current title-only rendering. "block": title plus
   *  a smaller summary block beneath it. */
  mode: "label" | "block";
  /** Whether the summary block text is justified. */
  justify: boolean;
  /** Summary block font-size as a fraction of the title's font-size. */
  sizeRatio: number;
  /** Maximum number of summary lines before truncation. */
  maxLines: number;
}

/** Fused-effects pulse: a slow-travelling light bead that walks each branch
 *  between liefs. Config-gated, default-off — nothing renders until a site
 *  (e.g. site.ts) explicitly enables it. */
export interface PulseConfig {
  enabled: boolean;
  /** Bead fill colour. */
  color: string;
  /** Bead diameter in CSS px. */
  sizePx: number;
  /** Travel duration range (ms) for a single lief-to-lief hop; a value is
   *  sampled per hop within this range for organic pacing. */
  travelMsRange: [number, number];
  /** Rest duration range (ms) the bead pauses at a lief before its next hop. */
  restMsRange: [number, number];
  /** Whether the bead's arrival at a lief triggers a brief bloom/glow pulse. */
  arrivalBloom: boolean;
  /** Minimum liefs a branch must have before it's eligible for a pulse bead. */
  minLiefs: number;
}

/** Progressive-disclosure unfurling: branches collapse to furled state by depth,
 *  with injected expand/furl affordances. Config-gated, default-off — nothing
 *  renders until a site explicitly enables it. */
export interface UnfurlConfig {
  /** Master gate. Default false → the whole feature is inert (plugin/OSS viewer
   *  unaffected; no injection at build, no gating/affordances at runtime). */
  enabled: boolean;
  /** Deepest branch depth that stays UNFURLED at landing; FURLABLE branches with
   *  depth >= initialDepth start furled. Default 1. */
  initialDepth: number;
  /** Fade reveal duration (ms) for a newly-unfurled subtree. Default 420. */
  revealMs: number;
  /** Visible label on the injected "click to expand" affordance lief. */
  expandLabel: string;
  /** Visible label on the injected "− furl" affordance lief. */
  furlLabel: string;
}

/** Agent-branch beacon glow: the pulsing halo/orb drawn behind an agent-bound
 *  meristem's label (stem tint + label-text tint always pulse regardless of
 *  this flag — only the radial-gradient orb is gated). Config-gated so the
 *  plugin's existing terminal-glow look (orb on) is unaffected by default;
 *  the website opts into the orb-less variant via site.ts. */
export interface AgentGlowConfig {
  /** Whether the radial-gradient halo behind agent-bound meristem labels
   *  renders. true (default) preserves the plugin's current look. */
  orb: boolean;
  /** Whether the row of colour pips past a multi-tint meristem label renders —
   *  the plugin's per-terminal count marker (one dot per colour). true (default)
   *  preserves the plugin's look. The website opts out (site.ts): it reuses the
   *  tint list to CROSS-FADE a section's glow between colours, where the pips
   *  would read as stray agent dots. */
  pips: boolean;
  /** Whether a seeded-coral-root badge (a small hollow ring past the meristem
   *  label, drawn before any agent pips) renders. false (default) — the
   *  OPPOSITE default of orb/pips, because a marker meaningful only inside the
   *  Obsidian vault (a folder's own Growth Charter/CLAUDE.md) would misread as
   *  UI noise on the website/Studio, which have no such folders. The plugin
   *  opts IN at its mountPlant call (obsidian-plugin/src/plant-view.ts) and
   *  supplies the badge set via the mount's setSeedBadges. */
  seedBadges: boolean;
}

/** Camera framing: how much of the window a fitted/framed branch fills.
 *  Config-gated house-style knobs over three previously-hardcoded constants.
 *  See viewer/src/fit.ts (computeFitTransform) and mount-plant.ts's
 *  frameNodeInternal / frameNodeByNodeId for the consumers. */
export interface CameraConfig {
  /** Symmetric padding as a fraction of the available viewport when fitting
   *  bounds. 0.12 → the fit box fills 76% of the unobstructed area. */
  fitPadding: number;
  /** Multiplier applied to a branch's label-inclusive bounds before fitting,
   *  when framing a clicked meristem. 1.0 = no expansion (branch fills the fit
   *  box); 1.5 = 50% breathing room around it. */
  branchFramePad: number;
  /** As branchFramePad, for the double-click / internal branch fit. */
  branchFitPad: number;
}

export interface StylingConfig {
  sun: { azimuth: number; elevation: number };
  bud: {
    baseline: "follow-tangent" | "screen-horizontal";
    /** @deprecated minimal-skin only. Renamed to communicate scope. */
    minimalSkinFontScale: number;
  };
  cull: CullConfig;
  projection: ProjectionConfig;
  body: {
    fill: string;
    baseOpacity: number;
    cursorBoost: number;
    edgeSoftness: number;
  };
  /** Sparse per-branch-path overrides for ProjectionConfig. */
  overrides: Record<string, Partial<ProjectionConfig>>;
  /** When true, every meristem's projection-label renders as
   *  "{parent.name} / {block.name}" (the root meristem is exempt). */
  meristemLabelIncludeParent: boolean;
  /** When true, the MD loader always wraps the parsed hierarchy under a
   *  synthetic root named after the file stem — even when the MD has a
   *  single top-level heading that would otherwise become the root directly.
   *  Adds one extra depth level. Default false (single top-level heading IS
   *  the root). */
  wrapWithFilenameRoot: boolean;
  /** Branch stem color — drives the `--curve` CSS variable.
   *  Widths are controlled by `v2Stem` via subtreeNorm. */
  stem: {
    color: string;
  };
  /** Page / SVG background colour. Drives the `--bg` CSS variable. Combined
   *  with `stem.color` and the various projection colours, this is enough
   *  to switch the whole UI between light and dark modes. */
  background: {
    color: string;
  };
  /** Atmospheric depth toggles + strength knobs. Independent CSS-only effects;
   *  zero DOM cost. (A particle-field variant was prototyped here and removed
   *  for being a runtime hazard.) */
  atmosphere: {
    /** Sky→ground vertical gradient overlay. Reads as a horizon. */
    horizon: boolean;
    /** 0–1 multiplier on horizon overlay opacity. 0 = invisible, 1 = full
     *  effect at the gradient stops baked into style.css. */
    horizonStrength: number;
    /** Radial darkening at the screen edges; concentrates attention. */
    vignette: boolean;
    /** 0–1 alpha at the vignette's outer stop. 0 = invisible, 1 = strong
     *  dark edges. The transition curve itself is fixed in style.css. */
    vignetteStrength: number;
    /** Holographic glow — applies a drop-shadow filter to projection text so
     *  the labels look like they're emitting light. Per-block colours travel
     *  via the inline `--proj-light` / `--proj-meristem-light` CSS variables,
     *  so per-bough meristems glow in their spectrum hue. */
    glow: boolean;
    /** 0–1 multiplier on glow radius (in CSS px). At 0 the shadow is too
     *  small to see; at 1 it bleeds noticeably around each label. */
    glowStrength: number;
    /** Soft haze overlay — a low-frequency, slowly-drifting fog layer. */
    haze: boolean;
    /** 0–1 multiplier on haze opacity. */
    hazeStrength: number;
    /** Film-grain overlay — a subtle animated noise texture. */
    grain: boolean;
    /** 0–1 multiplier on grain opacity. */
    grainStrength: number;
    /** Ambient floating-particle ("motes") count. 0 = off. */
    motes: number;
    /** Optional sky colour for the horizon gradient's upper stop. When unset,
     *  the horizon effect falls back to its style.css-baked default. */
    skyColor?: string;
    /** Optional ground colour for the horizon gradient's lower stop. When
     *  unset, falls back to the style.css-baked default. */
    groundColor?: string;
  };
  /** Fused-effects: slow travelling light bead between liefs on a branch.
   *  Config-gated, default-off. See `PulseConfig`. */
  pulse: PulseConfig;
  /** Progressive-disclosure unfurling: branches collapse to furled state by depth.
   *  Config-gated, default-off. See `UnfurlConfig`. */
  unfurl: UnfurlConfig;
  /** Lief typography: title + smaller justified summary block.
   *  Config-gated, default-off ("label" mode). See `LiefBlockConfig`. */
  liefBlock: LiefBlockConfig;
  /** Agent-branch beacon glow (orb behind agent-bound meristem labels).
   *  Default `{ orb: true }` preserves the plugin's terminal-glow look;
   *  the website opts out via site.ts. See `AgentGlowConfig`. */
  agentGlow: AgentGlowConfig;
  /** Motion-time architecture mode.
   *  - "continuous": block-level work runs on every pan/zoom event (higher CPU).
   *  - "rest-only" (default): suspend block-level work during pan/zoom;
   *    recompute on settle. Drops motion-time cost on dense plants. */
  motionMode: "continuous" | "rest-only";
  /** Settle-transition style. Only consulted when motionMode = "rest-only".
   *  - "interpolated" (default): 150 ms ease-out CSS transition on the per-block
   *    scale snap from motion-time to settle-time sizing.
   *  - "instant": no transition — scale snaps in on the first post-settle frame.
   *    Useful for isolating bugs in the interpolated path. */
  settleStyle: "interpolated" | "instant";
  /** When true (default) AND motionMode is "rest-only": all liefs are
   *  initially hidden on plant load. They become eligible for normal
   *  attention-based sizing on the first user-driven `onRestEntered` call
   *  (i.e., after the first zoom or pan settles). This makes initial
   *  paint cheap on dense plants — only the structural skeleton renders
   *  until the user demonstrates interest by moving the camera. */
  initialLiefCull: boolean;

  // ── Sizing pipeline fields ───────────────────────────────────────────────────
  basalMag: number;
  optimalSize: number;
  /** Size liefs lift toward under attention/boost. Separate from meristem
   *  `optimalSize` so liefs can be tuned independently. Default 24. */
  liefOptimalSize: number;
  bubbleWidth: number;
  subtreeBoost: number;
  subtreeBoostShape: number;
  cursorMagnification: number;
  /** Meristem cull minimum (px). Below this, meristems are hidden. Default 1. */
  meristemCullMinPx: number;
  /** Meristem dot-glyphs tier threshold (px). Above this, show dot-glyphs; below, single-dot. Default 4. */
  meristemDotsAbovePx: number;
  /** Meristem full-text tier threshold (px). Above this, show full text label. Default 20. */
  meristemFullAbovePx: number;
  /** Meristem peak size (px). Above this, meristems are culled (hidden). Default 200. */
  meristemPeakSize: number;
  /** Lief cull minimum (px). Below this, liefs are hidden. Default 1. */
  liefCullMinPx: number;
  /** Lief dot-glyphs tier threshold (px). Above this, show dot-glyphs; below, single-dot. Default 3. */
  liefDotsAbovePx: number;
  /** Lief full-text tier threshold (px). Above this, show full text label. Default 14. */
  liefFullAbovePx: number;
  /** Lief peak size (px). Above this, liefs are culled (hidden). Symmetric with meristems. Default 100. */
  liefPeakSize: number;
  /** CROWDING CEILING for lief labels: the most a lief may be drawn at, as a
   *  multiple of its own basal (geometric) size. 0 = off. Because lief spacing
   *  and basal both scale with zoom, `target / basal` is the zoom-invariant
   *  measure of crowding — see sizing/composition.ts. Not applied to a
   *  cursor-lit lief, so hover always reveals. Default 0 (off) here; the
   *  shipped LiefWork default sets it — see liefwork-defaults.ts. */
  liefMaxLift: number;
  staggerBatchSize: number;
  v2Stem: StemConfig;
  /** How much of a parent branch's effective attention propagates to children.
   *  When you focus on a branch, its descendants inherit attention scaled by
   *  this factor recursively. 0 = no propagation (descendants get only their
   *  own viewport-fill attention). 1 = full propagation (descendants are as
   *  attentive as ancestors). Default 0.8 — a 5-level descent attenuates to
   *  ~0.33, still legible at optimalSize ≈ 60 px. */
  attentionPropagationDecay: number;
  /** Side-panel visual theme. "dark" is the public-viewer default; per-plant
   *  override stored here is consulted by both Studio's preview and the public
   *  viewer's bootstrap. */
  panelTheme: "light" | "dark";
  /** Camera framing: fit padding + branch-frame pads. See `CameraConfig`. */
  camera: CameraConfig;
}

export const defaultStylingConfig: StylingConfig = {
  sun: { azimuth: (75 * Math.PI) / 180, elevation: (25 * Math.PI) / 180 },
  bud: { baseline: "follow-tangent", minimalSkinFontScale: 0.35 },
  cull: {
    cullBufferFactor: 1.5,
  },
  projection: {
    liefRelativeAngle: Math.PI / 2,
    meristemRelativeAngle: 0,
    liefFanRange: (25 * Math.PI) / 180,
    cursorLight: false,
    cursorLightRay: "follow",
    liefDistance: 0.8,
    meristemDistance: 0.8,
    titleSize: 0.35,
    light: "#ffd890",
    meristemLight: "#ffd890",
    pathLight: "#c8a86c",
    pathIncludeRoot: false,
    pathOpacity: 0.85,
    rootMeristemDistance: 8.0,
    lightOpacity: 0.95,
    sourceOpacity: 0.25,
    ray: { stroke: "#ffd890", opacity: 0.35, width: 1 },
    showBounds: false,
    liefDistanceCurveAmp: 0,
    liefDistanceCurvePeak: 0.618,
  },
  body: { fill: "#ffb347", baseOpacity: 0.15, cursorBoost: 1.6, edgeSoftness: 0.5 },
  overrides: {},
  meristemLabelIncludeParent: false,
  wrapWithFilenameRoot: false,
  stem: { color: "#5a5a60" },
  background: { color: "#0c0c0e" },
  motionMode: "rest-only",
  settleStyle: "interpolated",
  initialLiefCull: true,
  basalMag: 1.4,
  optimalSize: 60,
  liefOptimalSize: 24,
  bubbleWidth: 0.5,
  subtreeBoost: 0,
  subtreeBoostShape: 3,
  cursorMagnification: 3.0,
  meristemCullMinPx: 1,
  meristemDotsAbovePx: 4,
  meristemFullAbovePx: 20,
  meristemPeakSize: 200,
  liefCullMinPx: 1,
  liefDotsAbovePx: 3,
  liefFullAbovePx: 14,
  liefPeakSize: 100,
  liefMaxLift: 0,
  staggerBatchSize: 32,
  v2Stem: {
    maxWidth: 8,
    minWidth: 1,
    tipOpacity: 0.3,
    subtreeExp: 0.5,
  },
  attentionPropagationDecay: 0.8,
  panelTheme: "dark",
  atmosphere: {
    horizon: false,
    horizonStrength: 0.5,
    vignette: false,
    vignetteStrength: 0.55,
    glow: false,
    glowStrength: 0.6,
    haze: false,
    hazeStrength: 0.5,
    grain: false,
    grainStrength: 0.15,
    motes: 0,
  },
  pulse: {
    enabled: false,
    color: "#FFE2A6",
    sizePx: 8,
    travelMsRange: [2600, 3400],
    restMsRange: [3000, 6000],
    arrivalBloom: true,
    minLiefs: 3,
  },
  unfurl: {
    enabled: false,
    initialDepth: 1,
    revealMs: 420,
    expandLabel: "click to expand",
    furlLabel: "− furl",
  },
  liefBlock: {
    mode: "label",
    justify: true,
    sizeRatio: 0.58,
    maxLines: 5,
  },
  agentGlow: {
    orb: true,
    pips: true,
    seedBadges: false,
  },
  camera: {
    fitPadding: 0.12,
    branchFramePad: 1.5,
    branchFitPad: 1.2,
  },
};

/**
 * Deep-merge a Partial<StylingConfig> over the defaults so every nested
 * sub-object (projection, projection.ray, v2Stem, etc.) is fully populated
 * even when the partial only specifies a few fields.
 *
 * Used by both the URL-hash restore path and the bundle-load path. Bundles
 * from the freeze pipeline or hand-edited fixtures may carry only the keys
 * the author cared about — without this, the spread `{...defaults, ...partial}`
 * silently replaces entire sub-objects (e.g. partial.projection without
 * `ray` drops the default `ray` and later code accessing
 * `cfg.projection.ray.stroke` crashes).
 */
export function mergeStylingConfig(partial: Partial<StylingConfig>): StylingConfig {
  const p: Partial<ProjectionConfig> = partial.projection ?? {};
  return {
    sun: { ...defaultStylingConfig.sun, ...(partial.sun ?? {}) },
    bud: { ...defaultStylingConfig.bud, ...(partial.bud ?? {}) },
    cull: { ...defaultStylingConfig.cull, ...(partial.cull ?? {}) },
    projection: {
      ...defaultStylingConfig.projection,
      ...p,
      // Deep-merge the inner `ray` sub-object too.
      ray: { ...defaultStylingConfig.projection.ray, ...(p.ray ?? {}) },
    },
    body: { ...defaultStylingConfig.body, ...(partial.body ?? {}) },
    overrides: { ...defaultStylingConfig.overrides, ...(partial.overrides ?? {}) },
    stem: { ...defaultStylingConfig.stem, ...(partial.stem ?? {}) },
    background: { ...defaultStylingConfig.background, ...(partial.background ?? {}) },
    atmosphere: { ...defaultStylingConfig.atmosphere, ...(partial.atmosphere ?? {}) },
    pulse: { ...defaultStylingConfig.pulse, ...(partial.pulse ?? {}) },
    unfurl: { ...defaultStylingConfig.unfurl, ...(partial.unfurl ?? {}) },
    liefBlock: { ...defaultStylingConfig.liefBlock, ...(partial.liefBlock ?? {}) },
    agentGlow: { ...defaultStylingConfig.agentGlow, ...(partial.agentGlow ?? {}) },
    camera: { ...defaultStylingConfig.camera, ...(partial.camera ?? {}) },
    v2Stem: { ...defaultStylingConfig.v2Stem, ...(partial.v2Stem ?? {}) },
    meristemLabelIncludeParent: partial.meristemLabelIncludeParent ?? defaultStylingConfig.meristemLabelIncludeParent,
    wrapWithFilenameRoot: partial.wrapWithFilenameRoot ?? defaultStylingConfig.wrapWithFilenameRoot,
    motionMode: partial.motionMode ?? defaultStylingConfig.motionMode,
    settleStyle: partial.settleStyle ?? defaultStylingConfig.settleStyle,
    initialLiefCull: partial.initialLiefCull ?? defaultStylingConfig.initialLiefCull,
    basalMag: partial.basalMag ?? defaultStylingConfig.basalMag,
    optimalSize: partial.optimalSize ?? defaultStylingConfig.optimalSize,
    liefOptimalSize: partial.liefOptimalSize ?? defaultStylingConfig.liefOptimalSize,
    bubbleWidth: partial.bubbleWidth ?? defaultStylingConfig.bubbleWidth,
    subtreeBoost: partial.subtreeBoost ?? defaultStylingConfig.subtreeBoost,
    subtreeBoostShape: partial.subtreeBoostShape ?? defaultStylingConfig.subtreeBoostShape,
    cursorMagnification: partial.cursorMagnification ?? defaultStylingConfig.cursorMagnification,
    meristemCullMinPx: partial.meristemCullMinPx ?? defaultStylingConfig.meristemCullMinPx,
    meristemDotsAbovePx: partial.meristemDotsAbovePx ?? defaultStylingConfig.meristemDotsAbovePx,
    meristemFullAbovePx: partial.meristemFullAbovePx ?? defaultStylingConfig.meristemFullAbovePx,
    meristemPeakSize: partial.meristemPeakSize ?? defaultStylingConfig.meristemPeakSize,
    liefCullMinPx: partial.liefCullMinPx ?? defaultStylingConfig.liefCullMinPx,
    liefDotsAbovePx: partial.liefDotsAbovePx ?? defaultStylingConfig.liefDotsAbovePx,
    liefFullAbovePx: partial.liefFullAbovePx ?? defaultStylingConfig.liefFullAbovePx,
    liefPeakSize: partial.liefPeakSize ?? defaultStylingConfig.liefPeakSize,
    liefMaxLift: partial.liefMaxLift ?? defaultStylingConfig.liefMaxLift,
    staggerBatchSize: partial.staggerBatchSize ?? defaultStylingConfig.staggerBatchSize,
    attentionPropagationDecay: partial.attentionPropagationDecay ?? defaultStylingConfig.attentionPropagationDecay,
    panelTheme: partial.panelTheme ?? defaultStylingConfig.panelTheme,
  };
}

/** Parse a "#rrggbb" hex into [0..255, 0..255, 0..255]. */
export function parseHexColor(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r || 0, g || 0, b || 0];
}
