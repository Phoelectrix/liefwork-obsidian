// Pure transform: appends the two "click to expand" / "− furl" affordance
// liefs to every FURLABLE branch node in the input hierarchy, BEFORE the
// engine's build() runs — so the engine's structure/place passes give them
// real baked geometry (never synthesised in the viewer).
import type { HierarchyInput, HierarchyNode } from "../../src/types.ts";
import { UNFURL_EXPAND_STENCIL, UNFURL_FURL_STENCIL } from "../../viewer/src/unfurl-affordance.ts";

export interface AffordanceInjectConfig {
  expandLabel: string;
  furlLabel: string;
}

/** A node becomes a FURLABLE branch iff it has >=1 child — a sub-branch OR a
 *  lief. A leaf (no children at all) is NOT furlable — there is nothing to
 *  collapse. Determined purely from the input. */
export function isFurlableNode(node: HierarchyNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

// Tip-ward = large order + far-future createdAt (adjacent to the meristem).
// Base-ward = small order + ancient createdAt (the branch's base slot).
const EXPAND_ORDER = Number.MAX_SAFE_INTEGER;   // "click to expand" → tip (next to meristem)
const FURL_ORDER = Number.MIN_SAFE_INTEGER;     // "− furl" → BASE-most lief (founder: read tip→base, collapse control last)
const AFF_CREATED_TIP = "9999-12-31T00:00:00.000Z";
const AFF_CREATED_BASE = "0001-01-01T00:00:00.000Z";

function affordanceNodes(ownerId: string, cfg: AffordanceInjectConfig): HierarchyNode[] {
  return [
    {
      id: `${UNFURL_EXPAND_STENCIL}/${ownerId}`, name: cfg.expandLabel,
      order: EXPAND_ORDER, createdAt: AFF_CREATED_TIP, stencilId: UNFURL_EXPAND_STENCIL,
    },
    {
      id: `${UNFURL_FURL_STENCIL}/${ownerId}`, name: cfg.furlLabel,
      order: FURL_ORDER, createdAt: AFF_CREATED_BASE, stencilId: UNFURL_FURL_STENCIL,
    },
  ];
}

export function injectAffordanceLiefs(
  hierarchy: HierarchyInput, cfg: AffordanceInjectConfig,
): HierarchyInput {
  const walk = (node: HierarchyNode): HierarchyNode => {
    const furlable = isFurlableNode(node);
    const mapped = (node.children ?? []).map(walk);
    const children = furlable ? [...mapped, ...affordanceNodes(node.id, cfg)] : mapped;
    return children.length ? { ...node, children } : { ...node };
  };
  return { root: walk(hierarchy.root) };
}
