/**
 * The engine (layout) config a coral build runs with — extracted from
 * plant-view's buildPlant so it's a pure, testable function. Layers the
 * plugin's tuned engine defaults (from the Liefwork-coral bundle, see
 * plugin-default-styling.ts) over the library defaults.
 */

import { defaultEngineConfig, type EngineConfig } from "../../src/library/index.ts";
import { pluginDefaultEngineConfig } from "./plugin-default-styling.ts";

export function coralEngineConfig(): EngineConfig {
  const cfg = structuredClone(defaultEngineConfig);
  // Layer the plugin's tuned engine defaults (from the Liefwork-coral bundle)
  // over the library defaults. Sort names are tip-relative: "newest-first" =
  // ascending createdAt = newest closest to the meristem TIP (folders, lacking
  // createdAt, tie stably near the base). The coral grows at its tips.
  const e = pluginDefaultEngineConfig;
  cfg.sizing = { ...cfg.sizing, ...e.sizing };
  cfg.angles = { ...cfg.angles, ...e.angles };
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
