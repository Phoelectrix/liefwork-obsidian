// Shared marker constants for the injected "click to expand" / "− furl"
// affordance liefs. These are REAL liefs (see scripts/lib/inject-affordance-
// liefs.ts) injected into the hierarchy BEFORE the engine's build() runs, so
// they get real baked geometry from the engine's structure/place passes —
// the viewer NEVER synthesises affordance geometry.
//
// `stencilId` is the marker field: a childless HierarchyNode copies
// hierarchyId/name/summary/stencilId onto its resulting LiefBlock
// (src/library/passes/structure.ts), and stencilId is unused by the
// viewer's block render/collect/hit paths, so a reserved value here is
// inert for drawing yet trivially readable for gating/click routing.
import type { Block } from "../../src/types.ts";

export const UNFURL_EXPAND_STENCIL = "__unfurl:expand";
export const UNFURL_FURL_STENCIL = "__unfurl:furl";

const sid = (b: Block): string | undefined => (b as { stencilId?: string }).stencilId;

export const isExpandAffordance = (b: Block): boolean =>
  b.kind === "lief" && sid(b) === UNFURL_EXPAND_STENCIL;
export const isFurlAffordance = (b: Block): boolean =>
  b.kind === "lief" && sid(b) === UNFURL_FURL_STENCIL;
export const isAffordanceBlock = (b: Block): boolean =>
  isExpandAffordance(b) || isFurlAffordance(b);
