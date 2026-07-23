// Pure transform: reduces the affordance-injected hierarchy to the subset
// implied by the current furl-state. A furled node collapses to a short
// branch — meristem + its single "click to expand" lief, dropping its real
// children AND the "− furl" affordance. An unfurled node keeps its real
// children and the "− furl" affordance, drops the "click to expand"
// affordance (it is only meaningful on a furled node), and recurses.
import type { HierarchyInput, HierarchyNode } from "../../src/types.ts";
import { UNFURL_EXPAND_STENCIL } from "./unfurl-affordance.ts";
import { isFurlableNode } from "../../scripts/lib/inject-affordance-liefs.ts";

// Invariant (not enforced): `furled` is expected to contain only furlable
// node ids (per `isFurlableNode` — those carrying an injected expand
// affordance); passing a non-furlable id yields an empty-children node.
export function hierarchyForFurlState(full: HierarchyInput, furled: ReadonlySet<string>): HierarchyInput {
  const visit = (n: HierarchyNode): HierarchyNode => {
    const kids = n.children ?? [];
    if (kids.length === 0) return n;
    if (furled.has(n.id)) {
      const expand = kids.find((c) => c.stencilId === UNFURL_EXPAND_STENCIL);
      return { ...n, children: expand ? [expand] : [] };
    }
    return { ...n, children: kids.filter((c) => c.stencilId !== UNFURL_EXPAND_STENCIL).map(visit) };
  };
  return { root: visit(full.root) };
}

export function furlableNodeIds(full: HierarchyInput): Set<string> {
  const out = new Set<string>();
  const walk = (n: HierarchyNode): void => {
    if (isFurlableNode(n)) out.add(n.id);
    (n.children ?? []).forEach(walk);
  };
  walk(full.root);
  return out;
}

export function seedFurledNodeIds(full: HierarchyInput, initialDepth: number): Set<string> {
  const out = new Set<string>();
  const walk = (n: HierarchyNode, depth: number): void => {
    if (depth >= initialDepth && isFurlableNode(n)) out.add(n.id);
    (n.children ?? []).forEach((c) => walk(c, depth + 1));
  };
  walk(full.root, 0);
  return out;
}
