/**
 * The plugin's shipped default look + engine tuning. The canonical literals now
 * live in the shared viewer module `viewer/src/liefwork-defaults.ts` (single
 * source of truth) so Studio starts from the same defaults as Alpha without a
 * plugin→viewer dependency cycle. Re-exported here under the plugin's historical
 * names — mountPlant layers the styling, the plant build deep-merges the engine
 * config. Palette = "Meridian" (see the shared module for provenance + reserved
 * accents).
 */
export {
  liefworkStylingDefaults as pluginDefaultStyling,
  liefworkEngineDefaults as pluginDefaultEngineConfig,
} from "../../viewer/src/liefwork-defaults.ts";
