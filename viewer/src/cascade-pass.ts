/**
 * cascade-pass.ts — Shared cascade-pass infrastructure.
 *
 * Extracted from main.ts so both Studio (main.ts) and the public viewer
 * (public.ts) run the identical render pipeline: branch mount/unmount,
 * attention propagation, per-block target_px, tier classification, and
 * adaptive-transform k-factors.
 *
 * Usage:
 *   const cascade = installCascadePass(deps);
 *   cascade.refreshMaps();         // after every plant change
 *   cascade.setView(tx, ty, scale); // mirror pan-zoom state
 *   cascade.runPass();             // on every settle (and after cursor-light)
 *   cascade.destroy();             // clean up rAF handles on teardown
 *
 * The handle also exposes `swapMeristemTier` so cursor-light can do its
 * immediate "lit meristem → full tier" promotion without importing a
 * separate module.
 */

import type { Plant, Branch, Block } from "../../src/types.ts";
import type { StylingConfig } from "./styling.ts";
import { attention, mountedBranch } from "./sizing/bubble.ts";
import { computeTargetScreenPx, labelSizeBasis } from "./sizing/composition.ts";
import { cullDecision, type CullConfig as V2CullConfig } from "./sizing/cull.ts";
import { visualTier, type TierConfig as V2TierConfig } from "./sizing/tier.ts";
import { buildRevealQueue, type BranchStateChange } from "./sizing/reveal-queue.ts";
import { stemWidthWorld } from "./sizing/stem-width.ts";
import { isHidden, setHidden } from "./dom-visibility.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** Tier vocabulary used by the lief/meristem element-swap pipeline. */
type LiefRenderTier = "full" | "dot-glyphs" | "single-dot";
type MeristemRenderTier = "full" | "dot-glyphs" | "single-dot";

interface TierSwapItem {
  g: SVGGElement;
  kind: "lief" | "meristem";
  next: LiefRenderTier;
}

interface AdaptiveEntry {
  el: SVGGElement;
  dx: number;
  dy: number;
  lastK: number;
  /** targetPx / (effectiveShortSide × titleSize) at the last settle — zoom-free.
   *  During motion the per-frame k = kBase / currentZoom holds the label at a
   *  FIXED screen size (so it only translates, never re-rasterises). -1 = unset. */
  kBase: number;
}

interface AdaptiveUpdateItem {
  entry: AdaptiveEntry;
  k: number;
  transformString: string;
}

// ── Deps injected by the host ────────────────────────────────────────────────

export interface CascadePassDeps {
  /** SVG root — used for viewport rect measurements. */
  svg: SVGSVGElement;
  /** World group — contains all branch/block DOM. */
  world: SVGGElement;
  /** Plant data. Must stay in sync with the host's current plant. */
  plant: () => Plant;
  /** Current styling config. May change between calls (Studio sliders). */
  stylingConfig: () => StylingConfig;
  /**
   * `liefShortSideInverse = Math.pow(childScale, -phiOrder)`.
   * Used to decouple lief size from the engine's depth scaling.
   * For the default library engine (childScale = INV_PHI, phiOrder = 1)
   * this equals PHI ≈ 1.618. The cascade pass reads this once per `runPass`.
   * Callers that don't have engineConfig available may omit this (defaults to PHI).
   */
  liefShortSideInverse?: () => number;
  /**
   * Getter for the set of currently lit block IDs (hover + scripted activations).
   * The cascade uses it to boost `targetPx` for any lit block.
   * Return an empty set when nothing is lit.
   */
  litBlockIds: () => Set<string>;
  /**
   * True while the initial-lief gate is active. When true and
   * `stylingConfig.initialLiefCull && motionMode === "rest-only"`,
   * all liefs are hidden on the first-paint pass.
   */
  initialLiefsHidden: () => boolean;
  /**
   * Optional: set of branch IDs whose meristems were tagged with the
   * `<=Start Here:` MD prefix (see start-here.ts). subtreeNormFor returns
   * Math.max(computed, 1) for these branches — they get the same size
   * boost as a max-subtree branch, so a small entry-point section reads
   * as visually prominent as the largest bough. No-op for branches not
   * in the set. Branches that already have max subtree depth stay where
   * they are (the max() is what enforces "if not already boosted").
   */
  startHereBranchIds?: () => Set<string>;
  /**
   * Optional (site unfurl only; default-off ⇒ plugin/Studio byte-identical):
   * per-branch TRUE (full-hierarchy) descendant counts, keyed by branch id.
   * A FURLED meristem is a one-lief stub, so its plant-computed descendant
   * count is ~0 and subtree boost never engages — every furled branch reads
   * uniformly tiny. Injecting each branch's real subtree size (the mount knows
   * it from the full hierarchy) sizes a furled stub by its structural
   * importance, and hands off seamlessly to subtree boost when it unfurls.
   * Overlaid with max() so an already-larger computed count is never reduced.
   */
  trueDescendantCounts?: () => Map<string, number> | null;
  /**
   * Optional: getter for the set of block ids currently hidden by the furl
   * render-gate (Task 5 — furl-tree.ts's `hiddenBlockIds`). When a block id
   * is in this set, `computeDecisions` forces `show = false`, so `hitTest`
   * (which skips `!show` blocks) stays consistent with what the canvas
   * actually paints. Omitted or returning an empty set is a no-op
   * (default-off before the unfurling mount wiring lands in Task 6).
   */
  hiddenBlockIds?: () => ReadonlySet<string>;
}

// ── Public handle ────────────────────────────────────────────────────────────

/** Per-block decision produced by `computeDecisions`. Pure data — no DOM. */
export interface BlockDecision {
  /** Target screen size in CSS pixels. */
  targetPx: number;
  /** LOD tier. */
  tier: "full" | "dot-glyphs" | "single-dot";
  /** Whether the block should be rendered (false = culled). */
  show: boolean;
  /** Zoom-free adaptive scale base: `targetPx / (effectiveShortSide × titleSize)`. */
  kBase: number;
  /** Effective short side used to compute targetPx. */
  effectiveShortSide: number;
}

export interface CascadePassHandle {
  /**
   * Rebuild the internal state maps after a plant change.
   * Call this once after every `renderPlant` call (or plant rebuild).
   * Also populates the `adaptiveByBlock` WeakMap from the current DOM.
   */
  refreshMaps(): void;

  /**
   * Mirror the current pan-zoom view. Call on every pan/zoom callback so
   * `runPass` uses the latest transform for viewport and attention calculations.
   */
  setView(tx: number, ty: number, scale: number): void;
  /** Cheap per-frame label resize during motion — holds each tiered label at a
   *  fixed screen size (counter-scale only, no re-tier) to avoid the
   *  scale-driven glyph re-rasterisation that makes zoom/pan lag. */
  applyAdaptiveScale(): void;

  /**
   * Execute the cascade pass. Computes branch visibility, attention
   * propagation, per-block target_px and tier classifications, and flushes
   * tier-swap + adaptive-transform rAF queues.
   */
  runPass(): void;

  /**
   * Pure (no DOM writes) version of the cascade math. Returns per-block
   * decisions (targetPx, tier, show, kBase, effectiveShortSide) for all
   * lief/meristem blocks in mounted branches.
   *
   * Requires `refreshMaps()` to have been called at least once.
   * Uses the supplied `view` + `viewport` so the canvas can pass its own
   * values without touching `svg.getBoundingClientRect()`.
   */
  computeDecisions(
    view: { tx: number; ty: number; scale: number },
    viewport: { width: number; height: number },
  ): Map<string, BlockDecision>;

  /**
   * Build a `stemWidthsForBranch` callback using the cascade's current
   * descendant-count data. Call after `refreshMaps()` to get a callback
   * valid for the current plant.
   *
   * @param v2Stem - The `stylingConfig.v2Stem` sub-config.
   * @returns A function (branchId: string) => number (screen pixels).
   */
  makeStemWidthsFn(v2Stem: {
    minWidth: number;
    maxWidth: number;
    subtreeExp: number;
    tipOpacity: number;
  }): (branchId: string) => number;

  /**
   * Promote a meristem wrapper element to "full" tier immediately (used by
   * cursor-light for on-hover tier promotion without waiting for the next pass).
   */
  swapMeristemTier(wrapper: SVGGElement, next: MeristemRenderTier): void;

  /**
   * Cancel all pending rAF callbacks and clear queues.
   * Call on teardown or before a full re-render that replaces the DOM.
   */
  destroy(): void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Golden ratio constant — default liefShortSideInverse when not supplied. */
const PHI = (1 + Math.sqrt(5)) / 2;

/** Skip adaptive-transform setAttribute when |newK - lastK| < epsilon.
 *  At 5 decimal places, changes < ~1e-4 don't affect the rendered output. */
const ADAPTIVE_K_EPSILON = 1e-4;

export function installCascadePass(deps: CascadePassDeps): CascadePassHandle {
  const { svg, world } = deps;
  // The window this cascade's SVG lives in (its own rAF), falling back to global.
  const win = svg.ownerDocument.defaultView ?? window;

  // ── Per-plant state (rebuilt by refreshMaps) ──────────────────────────────

  let blockById = new Map<string, Block>();
  let branchById = new Map<string, Branch>();
  const branchDescendantCount = new Map<string, number>();
  const subtreeNormByBranch = new Map<string, number>();
  let maxDescendantCount = 0;
  let logMaxDescendantCount = 0;

  // ── Per-render DOM state (rebuilt by refreshMaps after renderPlant) ───────

  let adaptiveByBlock = new WeakMap<SVGGElement, AdaptiveEntry>();
  // Iterable companion to adaptiveByBlock (WeakMaps can't be iterated) — used by
  // applyAdaptiveScale() to update every visible label's counter-scale per frame.
  let adaptiveEntries: AdaptiveEntry[] = [];

  // ── View state (updated by setView) ──────────────────────────────────────

  let currentTx = 0;
  let currentTy = 0;
  let currentZoom = 1;

  // ── rAF queues ────────────────────────────────────────────────────────────

  let revealQueue: BranchStateChange[] = [];
  let revealRafId: number | null = null;

  let tierSwapQueue: TierSwapItem[] = [];
  let tierSwapRafId: number | null = null;

  let adaptiveUpdateQueue: AdaptiveUpdateItem[] = [];
  let adaptiveUpdateRafId: number | null = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(n: number): string {
    return Math.abs(n) < 1e-4 ? "0" : n.toFixed(3);
  }

  // ── refreshMaps ───────────────────────────────────────────────────────────

  function refreshMaps(): void {
    const plant = deps.plant();
    blockById = new Map(plant.blocks.map((b) => [b.id, b]));
    branchById = new Map(plant.branches.map((b) => [b.id, b]));

    // Build descendant counts (bottom-up walk).
    const branchLiefCount = new Map<string, number>();
    const branchMeristemCount = new Map<string, number>();
    for (const branch of plant.branches) {
      let liefs = 0;
      let meristems = 0;
      for (const blockId of branch.blockIds) {
        const block = blockById.get(blockId);
        if (block?.kind === "lief") liefs++;
        else if (block?.kind === "meristem") meristems++;
      }
      branchLiefCount.set(branch.id, liefs);
      branchMeristemCount.set(branch.id, meristems);
    }

    const childrenOf = new Map<string | null, string[]>();
    for (const b of plant.branches) {
      const arr = childrenOf.get(b.parentBranchId) ?? [];
      arr.push(b.id);
      childrenOf.set(b.parentBranchId, arr);
    }

    // Refresh start-here boost set from the current plant. The host (public.ts)
    // populates this via deps.startHereBranchIds() — typically from
    // extractStartHereBranches(plant) at hydration time.
    startHereSet = deps.startHereBranchIds?.() ?? new Set();

    branchDescendantCount.clear();
    subtreeNormByBranch.clear();
    const sortedDeepFirst = [...plant.branches].sort((a, b) => b.depth - a.depth);
    for (const branch of sortedDeepFirst) {
      const ownCount =
        (branchLiefCount.get(branch.id) ?? 0) +
        (branchMeristemCount.get(branch.id) ?? 0);
      const childIds = childrenOf.get(branch.id) ?? [];
      let childSum = 0;
      for (const cid of childIds) childSum += branchDescendantCount.get(cid) ?? 0;
      branchDescendantCount.set(branch.id, ownCount + childSum);
    }
    // Site unfurl (default-off): overlay TRUE full-hierarchy subtree sizes so a
    // furled stub is sized by its real subtree, not its 1-lief count. max() so a
    // larger already-computed count (e.g. an unfurled branch) is never reduced.
    const trueCounts = deps.trueDescendantCounts?.();
    if (trueCounts) {
      for (const [branchId, count] of trueCounts) {
        const cur = branchDescendantCount.get(branchId) ?? 0;
        if (count > cur) branchDescendantCount.set(branchId, count);
      }
    }
    maxDescendantCount = 0;
    for (const v of branchDescendantCount.values()) {
      if (v > maxDescendantCount) maxDescendantCount = v;
    }
    logMaxDescendantCount = Math.log10(maxDescendantCount + 1);

    // Populate adaptiveByBlock from current DOM — one querySelector per tiered
    // wrapper, done once per plant render instead of once per block per settle.
    adaptiveByBlock = new WeakMap<SVGGElement, AdaptiveEntry>();
    adaptiveEntries = [];
    for (const bg of world.querySelectorAll<SVGGElement>("g[data-block-id]")) {
      if (
        !bg.classList.contains("lief-tiered") &&
        !bg.classList.contains("meristem-tiered")
      ) continue;
      const adaptive = bg.querySelector<SVGGElement>('[data-adaptive="1"]');
      if (!adaptive) continue;
      const dx = parseFloat(adaptive.dataset["dx"] ?? "0");
      const dy = parseFloat(adaptive.dataset["dy"] ?? "0");
      // lastK/kBase = -1 is sentinel "never set". Any real value is non-negative.
      const entry: AdaptiveEntry = { el: adaptive, dx, dy, lastK: -1, kBase: -1 };
      adaptiveByBlock.set(bg, entry);
      adaptiveEntries.push(entry);
    }
  }

  // ── subtreeNormFor ────────────────────────────────────────────────────────

  function subtreeNormFor(branch: Branch): number {
    if (logMaxDescendantCount <= 0) return 0;
    const cached = subtreeNormByBranch.get(branch.id);
    if (cached !== undefined) return cached;
    const desc = branchDescendantCount.get(branch.id) ?? 0;
    let v = Math.log10(desc + 1) / logMaxDescendantCount;
    // start-here boost: lift to the largest SIBLING's subtreeNorm — peer
    // equality, not root equality. Math.max keeps already-large branches
    // unaffected ("if not already boosted"). Sibling-based means an entry-
    // point bough matches its peer boughs, not the whole-plant root.
    if (isStartHere(branch.id)) {
      const siblingMax = maxSiblingNormFor(branch);
      if (v < siblingMax) v = siblingMax;
    }
    subtreeNormByBranch.set(branch.id, v);
    return v;
  }

  /** Largest raw subtreeNorm among sibling branches (same parentBranchId),
   *  excluding self. Walks plant.branches once per call — start-here is
   *  rare so this cost is negligible. */
  function maxSiblingNormFor(branch: Branch): number {
    const plant = deps.plant();
    const parent = branch.parentBranchId;
    let best = 0;
    for (const b of plant.branches) {
      if (b.id === branch.id) continue;
      if (b.parentBranchId !== parent) continue;
      const d = branchDescendantCount.get(b.id) ?? 0;
      const sn = Math.log10(d + 1) / logMaxDescendantCount;
      if (sn > best) best = sn;
    }
    return best;
  }

  // Indirection so subtreeNormFor doesn't re-call deps every block. Refreshed
  // on each refreshMaps so the set tracks the current plant.
  let startHereSet: Set<string> = new Set();
  const isStartHere = (branchId: string): boolean => startHereSet.has(branchId);

  // ── Reveal-queue ──────────────────────────────────────────────────────────

  function scheduleRevealQueue(changes: BranchStateChange[]): void {
    revealQueue = buildRevealQueue(changes);
    if (revealRafId !== null) {
      win.cancelAnimationFrame(revealRafId);
      revealRafId = null;
    }
    runRevealQueue();
  }

  function runRevealQueue(): void {
    const batchSize = deps.stylingConfig().staggerBatchSize;
    const batch = revealQueue.splice(0, batchSize);
    for (const change of batch) {
      const g = world.querySelector<SVGGElement>(
        `g.branch[data-branch-id="${change.id}"]`,
      );
      if (!g) continue;
      setHidden(g, change.action !== "mount");
    }
    if (revealQueue.length > 0) {
      revealRafId = win.requestAnimationFrame(() => {
        revealRafId = null;
        runRevealQueue();
      });
    }
  }

  // ── Tier-swap functions ───────────────────────────────────────────────────

  function swapLiefTier(wrapper: SVGGElement, next: LiefRenderTier): void {
    setHidden(wrapper, false);
    const label = wrapper.querySelector<SVGElement>(".projection-label");
    const dot = wrapper.querySelector<SVGElement>(".projection-dot-text");
    const stub = wrapper.querySelector<SVGElement>(".projection-stub");
    const sourceLabel = wrapper.querySelector<SVGElement>(".source-label");
    if (label) setHidden(label, next !== "full");
    if (dot) setHidden(dot, next !== "dot-glyphs");
    if (stub) setHidden(stub, next !== "single-dot");
    if (sourceLabel) setHidden(sourceLabel, next !== "full");
    wrapper.dataset["currentTier"] = next;
  }

  function swapMeristemTier(wrapper: SVGGElement, next: MeristemRenderTier): void {
    const label = wrapper.querySelector<SVGElement>(".projection-label");
    const dot = wrapper.querySelector<SVGElement>(".projection-dot-text");
    const stub = wrapper.querySelector<SVGElement>(".projection-stub");
    const sourceLabel = wrapper.querySelector<SVGElement>(".source-label");
    if (label) setHidden(label, next !== "full");
    if (dot) setHidden(dot, next !== "dot-glyphs");
    if (stub) setHidden(stub, next !== "single-dot");
    if (sourceLabel) setHidden(sourceLabel, next !== "full");
    wrapper.dataset["currentTier"] = next;
  }

  // ── Tier-swap queue ───────────────────────────────────────────────────────

  function scheduleTierSwapQueue(items: TierSwapItem[]): void {
    // Replace the queue — latest classification wins.
    tierSwapQueue = items;
    if (tierSwapRafId !== null) {
      win.cancelAnimationFrame(tierSwapRafId);
      tierSwapRafId = null;
    }
    if (tierSwapQueue.length > 0) {
      tierSwapRafId = win.requestAnimationFrame(runTierSwapQueue);
    }
  }

  function runTierSwapQueue(): void {
    tierSwapRafId = null;
    if (tierSwapQueue.length === 0) return;
    const base = deps.stylingConfig().staggerBatchSize;
    const batchSize =
      tierSwapQueue.length > base * 4
        ? Math.min(tierSwapQueue.length, base * 16)
        : base;
    const batch = tierSwapQueue.splice(0, batchSize);
    for (const item of batch) {
      if (item.kind === "lief") swapLiefTier(item.g, item.next);
      else swapMeristemTier(item.g, item.next);
    }
    if (tierSwapQueue.length > 0) {
      tierSwapRafId = win.requestAnimationFrame(runTierSwapQueue);
    }
  }

  // ── Adaptive-transform queue ──────────────────────────────────────────────

  function scheduleAdaptiveUpdateQueue(items: AdaptiveUpdateItem[]): void {
    // Replace — latest values win.
    adaptiveUpdateQueue = items;
    if (adaptiveUpdateRafId !== null) {
      win.cancelAnimationFrame(adaptiveUpdateRafId);
      adaptiveUpdateRafId = null;
    }
    if (adaptiveUpdateQueue.length > 0) {
      adaptiveUpdateRafId = win.requestAnimationFrame(runAdaptiveUpdateQueue);
    }
  }

  function runAdaptiveUpdateQueue(): void {
    adaptiveUpdateRafId = null;
    if (adaptiveUpdateQueue.length === 0) return;
    const base = deps.stylingConfig().staggerBatchSize;
    const batchSize =
      adaptiveUpdateQueue.length > base * 4
        ? Math.min(adaptiveUpdateQueue.length, base * 16)
        : base;
    const batch = adaptiveUpdateQueue.splice(0, batchSize);
    for (const item of batch) {
      item.entry.el.setAttribute("transform", item.transformString);
      item.entry.lastK = item.k;
    }
    if (adaptiveUpdateQueue.length > 0) {
      adaptiveUpdateRafId = win.requestAnimationFrame(runAdaptiveUpdateQueue);
    }
  }

  // ── runPass ───────────────────────────────────────────────────────────────

  function runPass(): void {
    const plant = deps.plant();
    const v2 = deps.stylingConfig();
    const titleSize = v2.projection.titleSize;
    const litBlockIds = deps.litBlockIds();
    const initialLiefsHidden = deps.initialLiefsHidden();
    const liefShortSideInverse = deps.liefShortSideInverse
      ? deps.liefShortSideInverse()
      : PHI;

    // Perf instrumentation — gated behind window.__LIEF_PERF so it's available
    // for tuning but silent by default (same flag/pattern as skeleton-canvas.ts).
    const log = (window as unknown as { __LIEF_PERF?: boolean }).__LIEF_PERF === true;
    const t0 = log ? performance.now() : 0;

    const panRect = svg.getBoundingClientRect();
    const viewport = { width: panRect.width, height: panRect.height };
    const view = { tx: currentTx, ty: currentTy, scale: currentZoom };

    // Build mounted set + per-branch attention.
    const mountedSet = new Set<string>();
    const attentionByBranch = new Map<string, number>();
    for (const branch of plant.branches) {
      if (mountedBranch(branch.bounds, view, viewport, v2.bubbleWidth)) {
        mountedSet.add(branch.id);
        // attention wants the LOCAL label box (viewport-fill of THIS branch's
        // own extent), not the subtree AABB. Fall back to bounds for bundles
        // predating localBounds.
        attentionByBranch.set(
          branch.id,
          attention(branch.localBounds ?? branch.bounds, view, viewport),
        );
      }
    }

    // Propagate attention from ancestors (depth-ascending order — plant.branches
    // is already preorder DFS so parents are visited before children).
    const decay = v2.attentionPropagationDecay;
    for (const branch of plant.branches) {
      if (!mountedSet.has(branch.id)) continue;
      const own = attentionByBranch.get(branch.id) ?? 0;
      const parentId = branch.parentBranchId;
      if (parentId !== null) {
        const parentEff = attentionByBranch.get(parentId) ?? 0;
        const effAtt = Math.max(own, parentEff * decay);
        attentionByBranch.set(branch.id, effAtt);
      }
    }

    const tBranchesEnd = log ? performance.now() : 0;

    // Build mount/unmount delta vs current DOM state.
    const branchGroups = world.querySelectorAll<SVGGElement>("g.branch[data-branch-id]");
    const pendingChanges: BranchStateChange[] = [];
    for (const g of branchGroups) {
      const id = g.dataset["branchId"];
      if (!id) continue;
      const currentlyVisible = !isHidden(g);
      const shouldBeVisible = mountedSet.has(id);
      if (currentlyVisible === shouldBeVisible) continue;
      const branch = branchById.get(id);
      if (!branch) continue;
      pendingChanges.push({
        id,
        action: shouldBeVisible ? "mount" : "unmount",
        depth: branch.depth,
        descendantCount: branchDescendantCount.get(id) ?? 0,
      });
    }
    if (pendingChanges.length > 0) scheduleRevealQueue(pendingChanges);

    const tBranchVisEnd = log ? performance.now() : 0;

    // Build id→element maps for O(1) lookups.
    const branchGroupMap = new Map<string, SVGGElement>();
    for (const g of branchGroups) {
      const id = g.dataset["branchId"];
      if (id) branchGroupMap.set(id, g);
    }

    const blockGroupMap = new Map<string, SVGGElement>();
    for (const bg of world.querySelectorAll<SVGGElement>("g[data-block-id]")) {
      const id = bg.dataset["blockId"];
      if (id && !blockGroupMap.has(id)) blockGroupMap.set(id, bg);
    }

    // Per-pass config structs — hoisted to avoid object allocations per block.
    const cullCfg: V2CullConfig = {
      meristemCullMinPx: v2.meristemCullMinPx,
      meristemPeakSize: v2.meristemPeakSize,
      liefCullMinPx: v2.liefCullMinPx,
      liefPeakSize: v2.liefPeakSize,
    };
    const meristemTierCfg: V2TierConfig = {
      dotsAbovePx: v2.meristemDotsAbovePx,
      fullAbovePx: v2.meristemFullAbovePx,
    };
    const liefTierCfg: V2TierConfig = {
      dotsAbovePx: v2.liefDotsAbovePx,
      fullAbovePx: v2.liefFullAbovePx,
    };

    // Walk visible blocks in mounted branches only.
    const pendingTierSwaps: TierSwapItem[] = [];
    const pendingAdaptiveUpdates: AdaptiveUpdateItem[] = [];
    let nVisited = 0;
    let nHidden = 0;
    for (const branch of plant.branches) {
      if (!mountedSet.has(branch.id)) continue;
      const branchAttention = attentionByBranch.get(branch.id) ?? 0;
      const subtreeNorm = subtreeNormFor(branch);
      for (const blockId of branch.blockIds) {
        const block = blockById.get(blockId);
        if (!block) continue;
        if (block.kind !== "lief" && block.kind !== "meristem") continue;
        nVisited++;
        const g = blockGroupMap.get(block.id);
        if (!g) continue;

        const isLit = litBlockIds.has(block.id);
        // Label sizing basis: engine-baked `labelSize` (a world-level sizing
        // mechanism — see src/library/passes/size.ts), `shortSide` fallback
        // for plants from older engines. Text only — geometry stays on
        // `shortSide` elsewhere.
        const effectiveShortSide = block.kind === "lief"
          ? labelSizeBasis(block) * liefShortSideInverse
          : labelSizeBasis(block);
        const targetPx = computeTargetScreenPx({
          shortSide: effectiveShortSide,
          titleSize,
          zoom: currentZoom,
          attention: branchAttention,
          subtreeNorm,
          kind: block.kind,
          isLit,
          cfg: v2,
        });

        // Initial-lief gate: hide liefs on first paint until first settle.
        if (
          block.kind === "lief" &&
          initialLiefsHidden &&
          v2.initialLiefCull &&
          v2.motionMode === "rest-only"
        ) {
          setHidden(g, true);
          nHidden++;
          continue;
        }

        const verdict = cullDecision(targetPx, block.kind, isLit, cullCfg);
        if (verdict === "hide") {
          setHidden(g, true);
          nHidden++;
          continue;
        }
        setHidden(g, false);
        g.style.removeProperty("opacity");

        // Tier swap — collected then applied in first-sync + rAF-defer batches.
        if (g.classList.contains("lief-tiered")) {
          const next = visualTier(targetPx, liefTierCfg);
          if (g.dataset["currentTier"] !== next) {
            pendingTierSwaps.push({ g, kind: "lief", next });
          }
        }
        if (g.classList.contains("meristem-tiered")) {
          const next = visualTier(targetPx, meristemTierCfg);
          if (g.dataset["currentTier"] !== next) {
            pendingTierSwaps.push({ g, kind: "meristem", next });
          }
        }

        // Per-block adaptive transform — collected then applied in batches.
        const entry = adaptiveByBlock.get(g);
        if (entry) {
          // Zoom-free base so motion-time applyAdaptiveScale can hold fixed size.
          entry.kBase = targetPx / (effectiveShortSide * titleSize);
          const k = targetPx / (effectiveShortSide * titleSize * currentZoom);
          if (Math.abs(k - entry.lastK) > ADAPTIVE_K_EPSILON) {
            const transformString = `translate(${fmt(entry.dx)} ${fmt(entry.dy)}) scale(${k.toFixed(5)}) translate(${fmt(-entry.dx)} ${fmt(-entry.dy)})`;
            pendingAdaptiveUpdates.push({ entry, k, transformString });
          }
        }
      }
    }

    // Apply first batch synchronously for immediate feedback on senior items.
    const batchSize = v2.staggerBatchSize;
    const firstBatch = pendingTierSwaps.splice(0, batchSize);
    for (const item of firstBatch) {
      if (item.kind === "lief") swapLiefTier(item.g, item.next);
      else swapMeristemTier(item.g, item.next);
    }
    if (pendingTierSwaps.length > 0) {
      scheduleTierSwapQueue(pendingTierSwaps);
    }

    const adaptiveFirstBatch = pendingAdaptiveUpdates.splice(0, batchSize);
    for (const item of adaptiveFirstBatch) {
      item.entry.el.setAttribute("transform", item.transformString);
      item.entry.lastK = item.k;
    }
    if (pendingAdaptiveUpdates.length > 0) {
      scheduleAdaptiveUpdateQueue(pendingAdaptiveUpdates);
    }

    if (log) {
      const t1 = performance.now();
      if (t1 - t0 > 30) {
        console.debug(`V2[walk] ${(t1 - t0).toFixed(1)}ms`, {
          branchPhase: +(tBranchesEnd - t0).toFixed(1),
          branchVis: +(tBranchVisEnd - tBranchesEnd).toFixed(1),
          blockWalk: +(t1 - tBranchVisEnd).toFixed(1),
          nMountedBranches: mountedSet.size,
          nVisited,
          nHidden,
        });
      }
    }
  }

  // ── computeDecisions ─────────────────────────────────────────────────────
  // Pure math mirror of runPass's block-walk. No DOM reads or writes —
  // uses the caller-supplied view + viewport rather than
  // svg.getBoundingClientRect(). Reads closed-over cascade state
  // (blockById, branchById, subtreeNormFor, …) that refreshMaps() has built.

  function computeDecisions(
    view: { tx: number; ty: number; scale: number },
    viewport: { width: number; height: number },
  ): Map<string, BlockDecision> {
    const plant = deps.plant();
    const v2 = deps.stylingConfig();
    const titleSize = v2.projection.titleSize;
    const litBlockIds = deps.litBlockIds();
    const liefShortSideInverse = deps.liefShortSideInverse
      ? deps.liefShortSideInverse()
      : PHI;

    // Build mounted set + per-branch attention (same logic as runPass,
    // but using the passed view/viewport rather than svg.getBoundingClientRect).
    const mountedSet = new Set<string>();
    const attentionByBranch = new Map<string, number>();
    for (const branch of plant.branches) {
      if (mountedBranch(branch.bounds, view, viewport, v2.bubbleWidth)) {
        mountedSet.add(branch.id);
        // attention wants the LOCAL label box, not the subtree AABB (fall back
        // to bounds for bundles predating localBounds).
        attentionByBranch.set(
          branch.id,
          attention(branch.localBounds ?? branch.bounds, view, viewport),
        );
      }
    }

    // Propagate attention from ancestors (same decay pass as runPass).
    const decay = v2.attentionPropagationDecay;
    for (const branch of plant.branches) {
      if (!mountedSet.has(branch.id)) continue;
      const own = attentionByBranch.get(branch.id) ?? 0;
      const parentId = branch.parentBranchId;
      if (parentId !== null) {
        const parentEff = attentionByBranch.get(parentId) ?? 0;
        const effAtt = Math.max(own, parentEff * decay);
        attentionByBranch.set(branch.id, effAtt);
      }
    }

    const cullCfg: V2CullConfig = {
      meristemCullMinPx: v2.meristemCullMinPx,
      meristemPeakSize: v2.meristemPeakSize,
      liefCullMinPx: v2.liefCullMinPx,
      liefPeakSize: v2.liefPeakSize,
    };
    const meristemTierCfg: V2TierConfig = {
      dotsAbovePx: v2.meristemDotsAbovePx,
      fullAbovePx: v2.meristemFullAbovePx,
    };
    const liefTierCfg: V2TierConfig = {
      dotsAbovePx: v2.liefDotsAbovePx,
      fullAbovePx: v2.liefFullAbovePx,
    };

    const decisions = new Map<string, BlockDecision>();

    for (const branch of plant.branches) {
      if (!mountedSet.has(branch.id)) continue;
      const branchAttention = attentionByBranch.get(branch.id) ?? 0;
      const subtreeNorm = subtreeNormFor(branch);

      for (const blockId of branch.blockIds) {
        const block = blockById.get(blockId);
        if (!block) continue;
        if (block.kind !== "lief" && block.kind !== "meristem") continue;

        const isLit = litBlockIds.has(block.id);
        // Same label basis as runPass — labelSize when baked, shortSide fallback.
        const effectiveShortSide = block.kind === "lief"
          ? labelSizeBasis(block) * liefShortSideInverse
          : labelSizeBasis(block);
        const targetPx = computeTargetScreenPx({
          shortSide: effectiveShortSide,
          titleSize,
          zoom: view.scale,
          attention: branchAttention,
          subtreeNorm,
          kind: block.kind,
          isLit,
          cfg: v2,
        });

        const verdict = cullDecision(targetPx, block.kind, isLit, cullCfg);
        let show = verdict === "render";
        show = show && !(deps.hiddenBlockIds?.().has(block.id) ?? false);
        const tierCfg = block.kind === "lief" ? liefTierCfg : meristemTierCfg;
        const tier = visualTier(targetPx, tierCfg);
        const kBase = targetPx / (effectiveShortSide * titleSize);

        decisions.set(block.id, { targetPx, tier, show, kBase, effectiveShortSide });
      }
    }

    return decisions;
  }

  // ── makeStemWidthsFn ──────────────────────────────────────────────────────

  function makeStemWidthsFn(v2Stem: {
    minWidth: number;
    maxWidth: number;
    subtreeExp: number;
    tipOpacity: number;
  }): (branchId: string) => number {
    const liefShortSideInverse = deps.liefShortSideInverse
      ? deps.liefShortSideInverse()
      : PHI;
    return (branchId: string): number => {
      const branch = branchById.get(branchId);
      if (!branch) return 0;
      const sn = subtreeNormFor(branch);
      // Depth-scaled so deep ribbons stay proportional to their shrunk geometry
      // instead of pinning the flat world-unit minWidth floor and overlapping.
      return stemWidthWorld(sn, branch.depth, v2Stem, liefShortSideInverse);
    };
  }

  // ── setView ───────────────────────────────────────────────────────────────

  function setView(tx: number, ty: number, scale: number): void {
    currentTx = tx;
    currentTy = ty;
    currentZoom = scale;
  }

  // ── applyAdaptiveScale ──────────────────────────────────────────────────────
  // Cheap per-frame label resize for use DURING motion. Recomputes each tiered
  // label's counter-scale k = kBase / currentZoom so it holds a FIXED screen
  // size as the world zooms — the label only translates, avoiding the costly
  // glyph re-rasterisation that scaling triggers. No re-tier, no DOM queries —
  // just a setAttribute on the cached scaler when k moves. Heavy re-tiering
  // stays on settle (runPass).
  function applyAdaptiveScale(): void {
    if (currentZoom <= 0) return;
    for (const entry of adaptiveEntries) {
      if (entry.kBase < 0) continue;
      const k = entry.kBase / currentZoom;
      if (Math.abs(k - entry.lastK) > ADAPTIVE_K_EPSILON) {
        entry.el.setAttribute(
          "transform",
          `translate(${fmt(entry.dx)} ${fmt(entry.dy)}) scale(${k.toFixed(5)}) translate(${fmt(-entry.dx)} ${fmt(-entry.dy)})`,
        );
        entry.lastK = k;
      }
    }
  }

  // ── destroy ───────────────────────────────────────────────────────────────

  function destroy(): void {
    if (revealRafId !== null) { win.cancelAnimationFrame(revealRafId); revealRafId = null; }
    if (tierSwapRafId !== null) { win.cancelAnimationFrame(tierSwapRafId); tierSwapRafId = null; }
    if (adaptiveUpdateRafId !== null) { win.cancelAnimationFrame(adaptiveUpdateRafId); adaptiveUpdateRafId = null; }
    revealQueue = [];
    tierSwapQueue = [];
    adaptiveUpdateQueue = [];
  }

  return {
    refreshMaps,
    setView,
    applyAdaptiveScale,
    runPass,
    computeDecisions,
    swapMeristemTier,
    makeStemWidthsFn,
    destroy,
  };
}

