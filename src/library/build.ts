import type { EngineConfig, GrowthEvent, HierarchyInput, Plant, PlantMetadata } from "./types.ts";
import { LIBRARY_ENGINE_VERSION } from "./constants.ts";
import { SCHEMA_VERSION } from "../constants.ts";
import { validateHierarchy } from "./validation.ts";
import { structurePass } from "./passes/structure.ts";
import { anglePass } from "./passes/angle.ts";
import { sizePass } from "./passes/size.ts";
// spiralLayoutPass is shelved for v1 (archive feature tabled) — kept dormant.
import { growthBlockPass } from "./passes/growth-block.ts";
import { placePass } from "./passes/place.ts";
import { tagPass } from "./passes/tag.ts";

function stableStringify(x: unknown): string {
  return JSON.stringify(x, (_: string, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o: Record<string, unknown>, k) => {
          o[k] = (v as Record<string, unknown>)[k]; return o;
        }, {})
      : v,
  );
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function build(
  hierarchy: HierarchyInput,
  eventLog: GrowthEvent[] | undefined,
  config: EngineConfig,
): Plant {
  const validation = validateHierarchy(hierarchy);
  if (validation.errors.length) {
    throw new Error(
      "HierarchyInput validation failed:\n" +
        validation.errors.map((e) => `  - ${e.hierarchyId ?? "?"}: ${e.message}`).join("\n"),
    );
  }

  const s = structurePass(hierarchy, config);
  anglePass(s, config);
  const sized = sizePass(s, config);
  // spiralLayoutPass is SHELVED for the v1 launch (archive feature tabled) — not
  // applied, so no `kind: archive` folder renders as a spiral. The pass + its
  // tests are kept dormant for a future re-enable. See [[Archiving]].
  const g = growthBlockPass(sized, config, hierarchy, eventLog);
  const p = placePass(g, config);
  tagPass(p.blocks, undefined); // importance map plumbed in a future milestone

  const metadata: PlantMetadata = {
    builtAt: new Date().toISOString(),
    engineVersion: LIBRARY_ENGINE_VERSION,
    configHash: hash(stableStringify(config)),
    hierarchyHash: hash(stableStringify(hierarchy)),
    counts: {
      events: p.events.length,
      blocks: p.blocks.length,
      branches: p.branches.length,
    },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `plant_${metadata.hierarchyHash}_${metadata.configHash}`,
    metadata,
    config,
    events: p.events,
    anchor: p.anchor,
    stemBranchId: p.stemBranchId,
    branches: p.branches,
    blocks: p.blocks,
    bounds: p.bounds,
    // no rings field
  };
}
