/**
 * The engine (layout) config a coral build runs with — extracted from
 * plant-view's buildPlant so it's a pure, testable function. Layers the
 * plugin's tuned engine defaults (from the Liefwork-coral bundle, see
 * plugin-default-styling.ts) over the library defaults.
 */

import { defaultEngineConfig, type EngineConfig } from "../../src/library/index.ts";
import type { EngineKnobs } from "../../viewer/src/mount-plant.ts";
import { pluginDefaultEngineConfig } from "./plugin-default-styling.ts";
import { ORGANIC_ANGLES, type CoralStyle } from "./style.ts";

/** The dev panel's engine knobs, read off a config (seeds the sliders). */
export function engineKnobsOf(cfg: EngineConfig): EngineKnobs {
  return {
    branchBuffer: cfg.clearance.branchBuffer,
    childScale: cfg.sizing.childScale,
    firstBranchAngle: cfg.angles.firstBranchAngle,
    angleDecay: cfg.angles.angleDecay,
    minBranchAngle: cfg.angles.minBranchAngle ?? 0,
    childAxisGrowthBlockFactor: cfg.clearance.childAxisGrowthBlockFactor,
    meristemInFactor: cfg.clearance.meristemInFactor,
    meristemOutFactor: cfg.clearance.meristemOutFactor,
  };
}

/** A COPY of `cfg` with a sparse knob override laid over it — the plugin's
 *  dev-panel engine group (10 Sept 2026): session-only, never persisted, the
 *  shipped tuning untouched. `{}` returns the config unchanged in value. */
export function applyEngineKnobs(cfg: EngineConfig, k: Partial<EngineKnobs>): EngineConfig {
  const out = structuredClone(cfg);
  if (k.branchBuffer !== undefined) out.clearance.branchBuffer = k.branchBuffer;
  if (k.childScale !== undefined) out.sizing.childScale = k.childScale;
  if (k.firstBranchAngle !== undefined) out.angles.firstBranchAngle = k.firstBranchAngle;
  if (k.angleDecay !== undefined) out.angles.angleDecay = k.angleDecay;
  if (k.minBranchAngle !== undefined) out.angles.minBranchAngle = k.minBranchAngle;
  if (k.childAxisGrowthBlockFactor !== undefined) out.clearance.childAxisGrowthBlockFactor = k.childAxisGrowthBlockFactor;
  if (k.meristemInFactor !== undefined) out.clearance.meristemInFactor = k.meristemInFactor;
  if (k.meristemOutFactor !== undefined) out.clearance.meristemOutFactor = k.meristemOutFactor;
  return out;
}

/** The engine config for a branching style (style.ts). Default is the shipped
 *  tuning exactly; organic lays ORGANIC_ANGLES over its `angles` block. */
export function coralEngineConfig(style: CoralStyle = "default"): EngineConfig {
  const cfg = structuredClone(defaultEngineConfig);
  // Layer the plugin's tuned engine defaults (from the Liefwork-coral bundle)
  // over the library defaults. Sort names are tip-relative: "newest-first" =
  // ascending createdAt = newest closest to the meristem TIP (folders, lacking
  // createdAt, tie stably near the base). The coral grows at its tips.
  const e = pluginDefaultEngineConfig;
  cfg.sizing = { ...cfg.sizing, ...e.sizing };
  cfg.angles = { ...cfg.angles, ...e.angles, ...(style === "organic" ? ORGANIC_ANGLES : {}) };
  cfg.clearance = { ...cfg.clearance, ...e.clearance };
  cfg.curve = {
    ...cfg.curve,
    ...e.curve,
    boughParams: { ...cfg.curve.boughParams, ...e.curve?.boughParams },
  };
  cfg.sort = { ...cfg.sort, ...e.sort };
  // The user's text-sizing knobs are deliberately NOT baked into the engine
  // here: the viewer's adaptive normalizer (computeTargetScreenPx) lifts
  // labels toward fixed screen-px targets, so a world-level (engine-baked)
  // multiplier is absorbed and never reaches the pixels. The plugin instead
  // delivers the user's sizing knobs as the RENDERER's own native adaptive
  // targets (mount.setSizingKnobs / the optimalSize / liefOptimalSize /
  // attentionPropagationDecay styling overrides — see text-sizing.ts). The
  // engine's own textScale/textContrast params stay at their identity default
  // (1/1) for other hosts/tests that use them.
  return cfg;
}
