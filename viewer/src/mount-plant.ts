import type { Plant, Block, Bounds, HierarchyInput, HierarchyNode } from "../../src/types.ts";
import type { EngineConfig } from "../../src/library/types.ts";
import { build } from "../../src/library/build.ts";
import {
  hierarchyForFurlState,
  seedFurledNodeIds,
  furlableNodeIds,
} from "./hierarchy-furl.ts";
import { isExpandAffordance, isFurlAffordance, UNFURL_EXPAND_STENCIL, UNFURL_FURL_STENCIL } from "./unfurl-affordance.ts";
import { runLiveSweep, SWEEP_MS, type LiveSweepHandle, type FrameOverrides } from "./unfurl-live-sweep.ts";
import { installPanZoom, type PanZoomHandle } from "./pan-zoom.ts";
import { installCascadePass, type CascadePassHandle } from "./cascade-pass.ts";
import { createMotionStateMachine, type MotionStateMachine } from "./motion-state.ts";
import { mergeStylingConfig, type StylingConfig, type ProjectionConfig } from "./styling.ts";
import { labelSizeBasis } from "./sizing/composition.ts";
import { minScaleForText } from "./sizing/legibility.ts";
import { expandBounds } from "./frame.ts";
import {
  buildBranchPathMaps,
  branchPathForWithMaps,
  fanOffsetForLief,
  resolveProjectionConfig,
} from "./projection.ts";
import {
  installSkeletonCanvas,
  projectedContentBounds,
  projectedSubtreeBounds,
  type SkeletonCanvasHandle,
  CANVAS_OVERSCAN,
} from "./skeleton-canvas.ts";
import { resolveAgentTints } from "./agent-tint.ts";
import { resolveSeedBadges } from "./seed-badge.ts";
import {
  seedFurledByDepth,
  hiddenBranchIds,
  hiddenBlockIds,
  furlableBranchIds,
  unfurlOneLevel,
  furlBranch,
  clickIntentFor,
  directChildBranchIds,
} from "./furl-tree.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Camera-move duration, in ms, for framing a node's branch (`frameNodeInternal`
 *  / `frameNodeByNodeId`). The tween is eased (easeInOutCubic → slow-rapid-slow),
 *  so a longer duration reads as a gradual settle. */
const CAMERA_MS = 750;

/** Lief label-size inverse used by the cull-cliff frame ceiling. MUST mirror
 *  the cascade pass's default (this mount path never supplies
 *  `liefShortSideInverse`, so the cascade culls with PHI — see
 *  cascade-pass.ts). */
const LIEF_SHORT_SIDE_INV = (1 + Math.sqrt(5)) / 2;

/** Frames land just UNDER the cull cliff, not exactly on it — cullDecision
 *  hides on `targetPx > peak`, so equality renders, but the target is a chain
 *  of float multiplications and a frame that lands a hair over blanks the
 *  branch it framed. */
const FRAME_CLIFF_MARGIN = 0.98;

/** A clickable node (lief or meristem), identified by its stable hierarchy path. */
export interface NodeRef {
  hierarchyId: string;
  kind: "lief" | "meristem";
  name: string;
  branchId: string;
}

/** Host callbacks for node interaction (the plugin opens the HUD / the MD). */
export interface MountHandlers {
  onNodeClick?(node: NodeRef): void;
  /** Cmd/ctrl-click on a node — the additive multi-select channel. OPT-IN:
   *  hosts that don't provide it (the site, Studio) keep plain-click behaviour
   *  for modified clicks, bit-for-bit. The renderer only reports the click —
   *  the host owns the selection rules and calls back highlightNodes. */
  onNodeAdditiveClick?(node: NodeRef): void;
  onNodeDoubleClick?(node: NodeRef): void;
  /** Right-click on a node — the host raises a context menu (the plugin shows
   *  Obsidian's file-menu for the node's file/folder). */
  onNodeContextMenu?(node: NodeRef, event: MouseEvent): void;
  /** Called on every pan/zoom input event with the new transform. Used by the
   *  Film tab to keep its live-capture reference up to date. */
  onTransformChange?(tx: number, ty: number, scale: number): void;
  /** Called after the coral's unfurl/furl state settles — an interactive
   *  toggle finishing its sweep, or a programmatic reveal/restore. Hosts use
   *  this to persist `getUnfurlState()` (e.g. to sessionStorage). */
  onUnfurlChange?(): void;
}

/** Map a clicked block to a NodeRef, or null for structural/unnamed blocks. */
export function nodeRefFor(block: Block): NodeRef | null {
  if (block.kind !== "lief" && block.kind !== "meristem") return null;
  const hierarchyId = (block as { hierarchyId?: string }).hierarchyId;
  const name = (block as { name?: string }).name;
  if (!hierarchyId || !name) return null;
  return { hierarchyId, kind: block.kind, name, branchId: block.branchId };
}

/** Find the NodeRef for a block by its hierarchyId (stable vault path), or null.
 *  Used to re-select a node across a rebuild — e.g. the lief just grown via the
 *  HUD, whose engine block id is new but whose path is unchanged. */
export function nodeRefByHierarchyId(plant: Plant, hierarchyId: string): NodeRef | null {
  for (const b of plant.blocks) {
    if ((b as { hierarchyId?: string }).hierarchyId === hierarchyId) {
      const ref = nodeRefFor(b);
      if (ref) return ref;
    }
  }
  return null;
}

/** Text/sizing knobs the dev panel tunes live. The scalar fields are cascade
 *  (decision) knobs — mutating them + redrawing is enough; the last three are
 *  structural (they change label geometry, so the projection map + label params
 *  are rebuilt). */
export interface DevKnobs {
  titleSize: number;
  basalMag: number;
  optimalSize: number;
  liefOptimalSize: number;
  subtreeBoost: number;
  subtreeBoostShape: number;
  attentionPropagationDecay: number;
  meristemPeakSize: number;
  liefPeakSize: number;
  /** LOD gates (sizing/tier.ts visualTier). MUST satisfy dots < full for each
   *  kind: visualTier tests `fullAbove` first, so dots ≥ full makes the
   *  dot-glyph tier unreachable (the 14-July lief inversion). */
  meristemDotsAbovePx: number;
  meristemFullAbovePx: number;
  liefDotsAbovePx: number;
  liefFullAbovePx: number;
  /** Cull floors (sizing/cull.ts) — a block below its floor is not drawn at
   *  all. The alternative to a wide dot-glyph band for wide-view calm. */
  meristemCullMinPx: number;
  liefCullMinPx: number;
  /** liefMaxLift — the lief crowding ceiling (multiple of basal). 0 = off. */
  liefMaxLift: number;
  meristemDistance: number;
  rootMeristemDistance: number;
  /** camera.fitPadding — symmetric viewport padding when fitting bounds. */
  fitPadding: number;
  /** camera.branchFramePad — bounds multiplier when framing a clicked meristem. */
  branchFramePad: number;
  /** camera.branchFitPad — bounds multiplier for the double-click branch fit. */
  branchFitPad: number;
}

/** Live engine-geometry knobs (site `?dev` panel). Unlike DevKnobs (styling —
 *  just repaint), these change the layout the engine produces, so setting them
 *  re-runs `build()`. Only meaningful for a client-built (hierarchy-source)
 *  coral; a no-op for frozen bundles. */
export interface EngineKnobs {
  /** `clearance.branchBuffer` — angular breathing room between sibling branches. */
  branchBuffer: number;
  /** `sizing.childScale` — each child branch's scale relative to its parent. */
  childScale: number;
}

export interface PlantMountHandle {
  /** Re-render with a freshly built plant (e.g. after a file change). */
  update(plant: Plant): void;
  /** Animate the camera to frame a branch (its bounds + 20% margin). */
  frameNode(branchId: string): void;
  /** Mark whether the coral fits into the "coral panel" (window minus the site's
   *  glass side-panel). Reframes the current view when the state changes so the
   *  coral makes room on open / reclaims the full window on close. */
  setPanelInset(active: boolean): void;
  /** Reset the camera to the default wide view — the whole plant fitted, exactly
   *  as on first mount (HUD/chrome-inset aware). Powers a "Full View" button. */
  fullView(): void;
  /** Animate the camera to frame the WHOLE (label-inclusive) coral — same bounds
   *  expression as the initial mount fit, but animated rather than instant.
   *  Powers the site's "Fit whole coral" button (e.g. after Unfurl/Furl all). */
  fitAll(): void;
  /** Select a node by its stable path: highlight it AND frame its parent branch
   *  (animates the camera). Deliberately does NOT notify the host (no onNodeClick
   *  — a programmatic reveal shouldn't open the note or toggle the HUD); hosts
   *  that need their own selection state / HUD updated do it themselves with the
   *  returned ref. Returns the selected node's NodeRef, or null if no block has
   *  that path in the current plant. For user-initiated reveals (Reveal-in-coral,
   *  Next-item) where moving the camera is the intent. */
  selectNode(hierarchyId: string): NodeRef | null;
  /** Highlight a node by its stable path WITHOUT moving the camera — same
   *  selection emphasis as `selectNode` but with no framing/pan-zoom. For
   *  background re-selection (e.g. re-applying the highlight after a rebuild
   *  driven by a vault change): selection must never yank the camera. Returns the
   *  resolved NodeRef, or null if no block has that path in the current plant. */
  highlightNode(hierarchyId: string): NodeRef | null;
  /** Multi mirror of highlightNode: apply the selection emphasis to EVERY
   *  resolved path (camera untouched — selection never moves the view).
   *  Unresolvable paths (deleted mid-flight) drop out silently; an empty list
   *  clears the highlight. Returns the refs that resolved, in input order. */
  highlightNodes(hierarchyIds: readonly string[]): NodeRef[];
  /** Snap the canvas camera to an arbitrary transform (sharp redraw). Used by
   *  the film camera in Studio canvas mode. */
  setCamera(tx: number, ty: number, scale: number): void;
  /** Render a plant snapshot at the CURRENT camera transform, without refitting
   *  or changing selection. For the growth time-lapse (one still per prefix).
   *  Rebuilds canvas geometry via setPlant then redraws in place. */
  renderSnapshot(plant: Plant): void;
  /** Render ONE frame of an unfurl transition at the CURRENT camera. Like
   *  `renderSnapshot` (rebuild geometry via setPlant, redraw in place, no refit
   *  / no selection change), but additionally `opts.liefAngleById` overrides
   *  each listed lief's `liefRelativeAngle` (radians) on the projection map,
   *  which sweeps that lief's ray azimuth (the fold-out) — the override rides
   *  through `collectRayParams`. The map is optional; passing none is a plain
   *  snapshot render. (Lief text reveal is a separate channel — see
   *  `setLiefTextReveal`; the live-sweep driver drives both per frame.) */
  renderTransitionFrame(
    plant: Plant,
    opts: { liefAngleById?: Map<string, number> },
  ): void;
  /** Lief-text-reveal passthrough (unfurl entry animation): scales the TEXT
   *  alpha of lief labels only, clamped to [0,1] — see
   *  `SkeletonCanvasHandle.setLiefTextReveal`. `1` (the default) is a no-op.
   *  Stores only; the caller (the live-sweep driver) drives the redraw.
   *  `renderSnapshot` always resets this to `1` / null scope first.
   *  `scopeBlockIds` (optional) restricts the reveal to the unfurling branch's
   *  subtree label ids; `null`/absent = inert everywhere (the safe default). */
  setLiefTextReveal(frac: number, scopeBlockIds?: ReadonlySet<string> | null): void;
  /** The current plant's world-coordinate bounds. */
  getBounds(): import("../../src/types.ts").Bounds;
  /** The plant currently held/rendered by the mount. In build-per-state unfurl
   *  mode this is the freshly-built plant for the current furl-state (hidden
   *  branches are ABSENT, not merely hidden); otherwise the mounted plant.
   *  Read accessor (parallels getBounds) — used by tests + host introspection. */
  getPlant(): Plant;
  /** The mount's event-surface size in CSS pixels. */
  viewport(): { width: number; height: number };
  /** Apply per-branch agent tints (branch folder path → its agent colors). */
  setAgentTints(colorsByPath: Map<string, string[]>): void;
  /** Mark the given folder paths as seeded-coral-root badges (a hollow ring
   *  past the meristem label — styling.agentGlow.seedBadges-gated, off by
   *  default; the plugin turns it on). Mirrors setAgentTints's path→block-id
   *  resolution. Empty set (the default) is a no-op. */
  setSeedBadges(paths: ReadonlySet<string>): void;
  /** Toggle the spectral shift — single-agent tints drift through neighbouring
   *  hues with the pulse (a Liefwork Pro perk; the plugin owns the gate). */
  setSpectralShift(on: boolean): void;
  /** Light the selected blocks — the engine's cursor emphasis (magnification,
   *  crowding-cap and peak-ceiling exemption) applied to selection. */
  setSelectionLight(on: boolean): void;
  /** Read-only: the block ids currently lit (test/debug seam — the litBlockIds
   *  getter itself is internal, handed only to the cascade at install time). */
  debugLitBlockIds(): ReadonlySet<string>;
  /** Apply lief summaries (name → summary text), recomputing label params and
   *  redrawing. When `styling.liefBlock.mode==="block"` and a layout is
   *  cached, liefs with an entry pick up their summary block. Safe to call
   *  before or after `update()` — `setPlant` reuses the last summary map. */
  setNodeMetadata(summaryByName: Map<string, string>): void;
  /** Update the user sizing knobs — the adaptive targets themselves
   *  (optimalSize / liefOptimalSize / attentionPropagationDecay) — and redraw
   *  in place: no plant rebuild, no camera move. The cascade re-reads the
   *  live styling config on every decisions pass, so all three track slider
   *  drags. Initial values arrive via `stylingOverrides`. */
  setSizingKnobs(knobs: {
    optimalSize: number;
    liefOptimalSize: number;
    attentionPropagationDecay: number;
    subtreeBoost: number;
    // The lief crowding ceiling, coupled to liefOptimalSize by the host so the
    // "Lief text" slider isn't swallowed by the cap. Optional: absent leaves the
    // ceiling untouched (site/Studio, which never send it).
    liefMaxLift?: number;
  }): void;
  /** Dev-panel live tuning: apply any SUBSET of the text/sizing knobs and refresh
   *  in place. Cascade-decision knobs (optimalSize, subtreeBoost, basalMag, …)
   *  just redraw; structural knobs (titleSize, meristem/root distance) rebuild
   *  the projection map + label params first. No plant rebuild, no camera move. */
  setDevKnobs(knobs: Partial<DevKnobs>): void;
  /** Set live engine-geometry knobs (branchBuffer / childScale). Mutates the
   *  live engineConfig and rebuilds the plant for the current furl state
   *  (rAF-coalesced so slider drags stay smooth). No-op without a live engine. */
  setEngineKnobs(knobs: Partial<EngineKnobs>): void;
  getEngineKnobs(): EngineKnobs;
  /** Read the CURRENT resolved values of the dev knobs — for the panel to seed
   *  its sliders and export a tuned stylingConfig fragment. */
  getDevKnobs(): DevKnobs;
  /** Furl or unfurl a branch. Unfurl reveals its DIRECT children (themselves
   *  furled → grandchildren stay hidden); furl hides its own liefs + child
   *  branches. Re-gates canvas + redraws. No rebuild; camera handled by
   *  callers. No-op when `unfurl.enabled` is false. */
  toggleFurl(branchId: string): void;
  /** Clear all furl state — the whole coral opens. No-op when disabled. */
  unfurlAll(): void;
  /** Re-seed furl state to `unfurl.initialDepth`. No-op when disabled. */
  furlAll(): void;
  /** Whether `branchId` is currently furled (collapsed). */
  isFurled(branchId: string): boolean;
  /** Whether `branchId` has a direct child branch (i.e. can be furled at all). */
  isFurlable(branchId: string): boolean;
  /** The node-ids currently UNFURLED (the reveal state) — furlable nodes NOT in
   *  the furled set. Order-independent (a set, returned as an array), stable
   *  across rebuilds since it's keyed by NODE id, not branch id. For persisting
   *  / restoring the coral's explored state (open-as-page: Stage A). Always
   *  `[]` when unfurl is inactive (furlableNodes is empty). */
  getUnfurlState(): string[];
  /** Set the furl-state to exactly `openIds` unfurled — furled = (all furlable
   *  nodes) minus `openIds` — then rebuild the plant for that state and
   *  settle-render at the current camera. No animation, no camera move.
   *  No-op when unfurl is inactive. */
  restoreUnfurlState(openIds: string[]): void;
  /** Unfurl every furlable ancestor of `hierarchyId` (so the node itself is
   *  revealed), rebuild, settle-render, then frame the node's branch — used by
   *  a cold-load "open as page" reveal. When unfurl is inactive, or the id
   *  isn't a furlable (meristem) node itself, falls back to framing the
   *  resolved node's branch directly (no furl-state change). */
  revealNode(hierarchyId: string): void;
  /** Tear down listeners + DOM. */
  destroy(): void;
}

/** Extra mount options. `unfurl` enables build-per-state progressive disclosure
 *  (Task 9a): the mount owns the coral hierarchy + engineConfig and rebuilds the
 *  Plant for the current furl-state on demand, instead of visibility-gating a
 *  single full plant. Only active when this is present AND `styling.unfurl.enabled`. */
export interface MountOptions {
  unfurl?: { hierarchy: HierarchyInput; engineConfig: EngineConfig };
  /** Debug/tuning toggle (site `?nocam`): skip the camera move on unfurl so the
   *  growth animation can be watched in isolation. Growth then starts
   *  immediately (no `startDelayMs` hold). Default false. */
  noUnfurlCamera?: boolean;
}

/**
 * Mount a built Plant into `container` with pan/zoom + adaptive cascade sizing.
 * Creates its own <svg><g> programmatically — no fixed-id HTML shell required.
 * CSS variables are set on the container (not document.documentElement) so the
 * generic `--bg` / `--curve` names don't clobber a host app's global theme.
 */
export function mountPlant(
  container: HTMLElement,
  initialPlant: Plant,
  stylingOverrides: Partial<StylingConfig> = {},
  handlers: MountHandlers = {},
  options: MountOptions = {},
): PlantMountHandle {
  const styling: StylingConfig = mergeStylingConfig(stylingOverrides);
  // No hover on the canvas path (see the TODO below); the projection
  // cursor-light flag stays off. Selection lighting is host-gated via
  // setSelectionLight.
  styling.projection.cursorLight = false;

  applyCssVars(container, styling);

  // ── Build-per-state unfurl (Task 9a) ──────────────────────────────────────
  // When the caller passes the coral hierarchy + engineConfig AND unfurl is
  // enabled, the mount OWNS furl-state as a set of NODE ids (a branch's tip
  // meristem `hierarchyId`) and rebuilds the Plant per furl-state on demand —
  // hidden branches are ABSENT from the built plant, not visibility-gated. When
  // absent or disabled, everything below falls through to the legacy path
  // (frozen / ?plain / non-unfurl) byte-identically.
  const unfurlActive = !!options.unfurl && styling.unfurl.enabled;
  const fullHierarchy = options.unfurl?.hierarchy;
  const engineConfig = options.unfurl?.engineConfig;

  // Hierarchy-derived, constant across builds (the hierarchy never changes):
  // the furlable node ids, plus node-adjacency (direct children / parent) so
  // unfurl-one-level and parent-recenter can resolve purely by NODE id.
  const furlableNodes = unfurlActive ? furlableNodeIds(fullHierarchy!) : new Set<string>();
  const directChildNodeIds = new Map<string, string[]>();
  const parentNodeIdByNode = new Map<string, string>();
  // Per-node TRUE subtree size (non-affordance descendant nodes, incl. self) from
  // the FULL hierarchy — feeds the cascade so a furled stub is sized by its real
  // subtree (see trueDescendantCounts below / cascade-pass trueDescendantCounts).
  const trueNodeSubtreeCount = new Map<string, number>();
  if (unfurlActive) {
    const walkH = (n: HierarchyNode): void => {
      const kids = n.children ?? [];
      directChildNodeIds.set(n.id, kids.map((k) => k.id));
      for (const k of kids) parentNodeIdByNode.set(k.id, n.id);
      kids.forEach(walkH);
    };
    walkH(fullHierarchy!.root);
    const isAff = (n: HierarchyNode): boolean =>
      n.stencilId === UNFURL_EXPAND_STENCIL || n.stencilId === UNFURL_FURL_STENCIL;
    const countSubtree = (n: HierarchyNode): number => {
      if (isAff(n)) return 0;
      let c = 1;
      for (const k of n.children ?? []) c += countSubtree(k);
      trueNodeSubtreeCount.set(n.id, c);
      return c;
    };
    countSubtree(fullHierarchy!.root);
  }

  // Furl-state seed + landing plant. Active mode: NODE ids, and the furled
  // landing plant is built HERE, before any skeleton/panzoom setup touches
  // `initialPlant`, so there is no full-then-furled flash. Legacy mode: BRANCH
  // ids seeded by depth (or empty when unfurl is disabled) — behaviour unchanged.
  let furled: Set<string>;
  if (unfurlActive) {
    furled = seedFurledNodeIds(fullHierarchy!, styling.unfurl.initialDepth);
    initialPlant = build(
      hierarchyForFurlState(fullHierarchy!, furled),
      undefined,
      engineConfig!,
    ) as unknown as Plant;
  } else {
    furled = styling.unfurl.enabled
      ? seedFurledByDepth(initialPlant, styling.unfurl.initialDepth)
      : new Set<string>();
  }

  // Create DOM in the container's own document (pop-out windows are a separate
  // document); derive its window for window-bound timers.
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;

  // The SVG is now an empty event surface — all visuals are on the canvas.
  // pointer-events:all so pan/zoom and clicks land here even with no painted content.
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.classList.add("lw-plant-svg");
  const world = doc.createElementNS(SVG_NS, "g");
  svg.appendChild(world);
  // Composited motion layer: pan/zoom rides this wrapper as a GPU CSS transform
  // during motion (SVG frozen, no per-frame reflow); the SVG <g> snaps sharp on
  // settle. transform-origin 0 0 makes the screen-projection delta math exact.
  const motionLayer = doc.createElement("div");
  motionLayer.classList.add("lw-motion-layer");

  // Canvas skeleton layer: sits UNDER the SVG (inserted first), CSS-scaled by
  // the same motionLayer wrapper during motion, redrawn via ctx on settle only.
  // Sized to CANVAS_OVERSCAN× the viewport and centred (negative offset) so a
  // composited pan reveals already-painted periphery instead of black; the
  // plant-area's overflow:hidden clips the excess. The redraw paints the margin.
  const skeletonCanvas = doc.createElement("canvas");
  const overscanPct = CANVAS_OVERSCAN * 100;
  const overscanOffPct = -((CANVAS_OVERSCAN - 1) / 2) * 100;
  skeletonCanvas.style.cssText =
    `position:absolute; top:${overscanOffPct}%; left:${overscanOffPct}%; ` +
    `width:${overscanPct}%; height:${overscanPct}%; pointer-events:none;`;
  motionLayer.appendChild(skeletonCanvas);
  motionLayer.appendChild(svg);
  container.appendChild(motionLayer);

  // Build the initial per-block projection config map (needed for label geometry).
  // Rebuilt per render() call to pick up any plant changes.
  let currentProjConfigMap = buildProjectionConfigMap(initialPlant, styling);

  // The FULL (unfurled) coral's content bounds, computed once. Framing the
  // whole-coral view to THIS — rather than the current furl-state's tiny bounds —
  // keeps the overview at a stable, non-over-zoomed scale: a fully-furled root
  // (just "click to expand") shows at overview size with room, and unfurling
  // reveals children IN-VIEW instead of off-screen. Falls back to the live plant's
  // bounds when the full build is unavailable (legacy/frozen path).
  let fullContentBounds: Bounds | null = null;
  if (unfurlActive && fullHierarchy && engineConfig) {
    try {
      const fp = build(fullHierarchy, undefined, engineConfig) as unknown as Plant;
      fullContentBounds = projectedContentBounds(fp, styling, buildProjectionConfigMap(fp, styling));
    } catch {
      fullContentBounds = null;
    }
  }
  // Balance the whole-coral fit: framing the FULL (tall) extent leaves a
  // mostly-furled coral a thin sliver (too zoomed out); framing the bare stub
  // over-zooms. Floor the current content to WHOLE_CORAL_FRACTION of the full
  // extent, centred on the current content — the furled root reads well with room
  // for branches to grow into, and a fully-unfurled coral (current ≈ full) frames
  // as itself.
  const WHOLE_CORAL_FRACTION = 0.5;
  const wholeCoralBounds = (): Bounds => {
    const cur = projectedContentBounds(plant, styling, currentProjConfigMap);
    if (!fullContentBounds) return cur;
    const f = fullContentBounds;
    const ccx = (cur.min.x + cur.max.x) / 2;
    const ccy = (cur.min.y + cur.max.y) / 2;
    const halfW = Math.max((cur.max.x - cur.min.x) / 2, ((f.max.x - f.min.x) * WHOLE_CORAL_FRACTION) / 2);
    const halfH = Math.max((cur.max.y - cur.min.y) / 2, ((f.max.y - f.min.y) * WHOLE_CORAL_FRACTION) / 2);
    return { min: { x: ccx - halfW, y: ccy - halfH }, max: { x: ccx + halfW, y: ccy + halfH } };
  };

  // getDecisions callback: wired to cascade.computeDecisions so the canvas
  // labels use the identical cascade math as the SVG labels.
  const getDecisions = (
    view: { tx: number; ty: number; scale: number },
    viewport: { width: number; height: number },
  ) => cascade.computeDecisions(view, viewport);

  // Cascade must exist BEFORE the canvas skeleton: installSkeletonCanvas runs an
  // initial redraw which calls getDecisions → cascade.computeDecisions. Declaring
  // cascade after the canvas install would hit the temporal dead zone (crash on
  // mount). refreshMaps() primes the subtree-norm maps the decisions read.
  let plant = initialPlant;
  const litBlockIds = new Set<string>();
  const initialLiefsHidden = false; // M1: show liefs immediately; no first-paint gate.
  // Furl render-gate (Task 5): block ids hidden by unfurling state. Stays
  // empty until enabled/applyFurl below populates it — default-off, so
  // no behaviour change when styling.unfurl.enabled is false.
  let furlBlockHidden = new Set<string>();

  // Furl state: the mount OWNS this — seeded above (NODE ids in build-per-state
  // mode, BRANCH ids in the legacy mode). Every furl method below no-ops when
  // unfurl is disabled (legacy `furled` stays empty).
  //
  // Furlable branch ids (legacy visibility-gating path only) — memoised per
  // plant; recomputed on update() since a rebuild can change branch ids. In
  // build-per-state mode `furlableNodes` (node ids, above) is authoritative.
  let furlableIds: Set<string> = furlableBranchIds(plant);

  // branchId ↔ nodeId reconciliation (build-per-state mode). A branch's node id
  // is its tip meristem block's `hierarchyId`. Branch ids are NOT stable across
  // rebuilds, so this is rebuilt after every build; persistent identity is
  // always keyed by NODE id, never branch id.
  let nodeIdByBranchId = new Map<string, string>();
  let branchIdByNodeId = new Map<string, string>();
  // Last colorsByPath passed to the setAgentTints handle method (Fix 9a-review
  // #1). build()-per-state gives every rebuilt plant fresh, ephemeral block +
  // branch ids, so the tint maps resolved at the time of the ORIGINAL call go
  // stale the instant rebuildForFurl() runs — resolveAgentTints must be
  // re-run against the NEW plant. Cached here (path-keyed, so it survives id
  // churn) and re-applied at the end of every rebuildForFurl(). Default empty
  // so a plant that never had tints set pays no extra work.
  let cachedTintColorsByPath: Map<string, string[]> = new Map();
  const applyAgentTintsInternal = (colorsByPath: Map<string, string[]>): void => {
    const { meristemColorsByBlockId, stemColorsByBranchId } = resolveAgentTints(plant, colorsByPath);
    skeleton.setAgentTints(meristemColorsByBlockId, stemColorsByBranchId);
  };
  // Last paths passed to setSeedBadges — same staleness problem + fix as
  // cachedTintColorsByPath above (rebuildForFurl's fresh plant gets fresh
  // ephemeral block ids, so the SET of block ids resolveSeedBadges produced
  // for the OLD plant is stale the instant it rebuilds). Path-keyed, so it
  // survives id churn; empty by default, so an un-badged mount pays nothing.
  let cachedSeedBadgePaths: ReadonlySet<string> = new Set();
  const applySeedBadgesInternal = (paths: ReadonlySet<string>): void => {
    skeleton.setSeedBadges(resolveSeedBadges(plant, paths));
  };
  const rebuildNodeMaps = (): void => {
    nodeIdByBranchId = new Map();
    branchIdByNodeId = new Map();
    for (const b of plant.blocks) {
      if (b.kind !== "meristem") continue;
      const hid = (b as { hierarchyId?: string }).hierarchyId;
      if (hid !== undefined) {
        nodeIdByBranchId.set(b.branchId, hid);
        branchIdByNodeId.set(hid, b.branchId);
      }
    }
  };
  if (unfurlActive) rebuildNodeMaps();

  // Current pan/zoom transform — updated by onTransformChange so blockAtClientPoint
  // can invert it to world coordinates for hit-testing.
  let currentTx = 0;
  let currentTy = 0;
  let currentScale = 1;

  // Map the CURRENT plant's branches → their node's TRUE subtree size, so the
  // cascade sizes a furled meristem by its real subtree (not its 1-lief stub)
  // and hands off to subtree boost seamlessly on unfurl. Rebuilt each call from
  // the live `nodeIdByBranchId` (which is re-derived per furl rebuild). Site
  // unfurl only — undefined otherwise ⇒ cascade behaviour byte-identical.
  const trueDescendantCounts = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const [branchId, nodeId] of nodeIdByBranchId) {
      const c = trueNodeSubtreeCount.get(nodeId);
      if (c !== undefined) m.set(branchId, c);
    }
    return m;
  };

  const cascade: CascadePassHandle = installCascadePass({
    svg,
    world,
    plant: () => plant,
    stylingConfig: () => styling,
    litBlockIds: () => litBlockIds,
    initialLiefsHidden: () => initialLiefsHidden,
    hiddenBlockIds: () => furlBlockHidden,
    trueDescendantCounts: () => (unfurlActive ? trueDescendantCounts() : null),
  });
  cascade.refreshMaps();

  // Install the canvas skeleton renderer (stems + rays + LOD labels, settle-only).
  // meristemLabelByBlockId: mount-plant.ts does NOT build a parent-aware label
  // map (the plugin calls renderPlant with meristemLabelIncludeParent handled
  // inside render.ts). Pass null here; block.name is the canonical label.
  // boostedBranchIds: not tracked in this path (no extractStartHereBranches call
  // in mount-plant). Pass empty set — start-here prefix is not applied here.
  const skeleton: SkeletonCanvasHandle = installSkeletonCanvas(
    skeletonCanvas,
    initialPlant,
    styling,
    {},
    getDecisions,
    currentProjConfigMap,
    null,
    new Set(),
  );

  // LEGACY visibility-gating channel (Task 5/6). Only used when build-per-state
  // is NOT active: it pushes the `furled` (BRANCH id) state to the cascade/
  // hit-test channel (`furlBlockHidden`) + the skeleton draw channel
  // (`skeleton.setFurlState`). In build-per-state mode hidden branches are
  // simply ABSENT from the built plant, so this culling must NOT run (it would
  // double-hide) — see rebuildForFurl below, which never calls applyFurl.
  const applyFurl = (): void => {
    const state = { enabled: styling.unfurl.enabled, furled };
    const brHidden = hiddenBranchIds(plant, furled);
    furlBlockHidden = hiddenBlockIds(plant, state);
    skeleton.setFurlState(brHidden, furlBlockHidden);
    cascade.refreshMaps();
  };
  if (!unfurlActive) applyFurl();

  // Private furl mutator shared by the legacy `toggleFurl` handle method and
  // the legacy click-routing intents ("furl"/"expand-only"/"expand-and-open") —
  // one place owns the furled-set transition + re-gate, so the two callers
  // (user API, click routing) can never desync. No-op when unfurl is disabled.
  const toggleFurlInternal = (branchId: string): void => {
    if (!styling.unfurl.enabled) return;
    furled = furled.has(branchId)
      ? unfurlOneLevel(plant, furled, branchId)
      : furlBranch(furled, branchId);
    applyFurl();
  };

  const render = (): void => {
    cascade.refreshMaps();
    const stemWidths = cascade.makeStemWidthsFn(styling.v2Stem);
    // Rebuild the projection config map for the current plant (canvas uses it).
    currentProjConfigMap = buildProjectionConfigMap(plant, styling);
    // Keep canvas skeleton stem widths + projection config in sync.
    // updateStemWidthFn does not redraw — panzoom.onCommit fires redraw atomically.
    skeleton.updateStemWidthFn(stemWidths);
    // The SVG world <g> is intentionally left empty — all visuals are on canvas.
    // cascade.runPass() is not called here (no SVG DOM to re-tier).
  };

  const motion: MotionStateMachine = createMotionStateMachine({
    debounceMs: 250,
    // No SVG to re-tier. The canvas redraws via installPanZoom's onCommit on
    // settle, atomically with the wrapper-transform clear.
    onRestEntered: () => { /* canvas redraws via onCommit */ },
  });

  render();

  const panzoom: PanZoomHandle = installPanZoom(
    svg,
    world,
    // Fit to the LABEL-inclusive bounds, not the bare node footprint — otherwise
    // a brand-new coral opens zoomed past its root/meristem titles (they project
    // out by rootMeristemDistance). See projectedContentBounds.
    wholeCoralBounds(),
    undefined,
    (tx, ty, scale) => {
      currentTx = tx;
      currentTy = ty;
      currentScale = scale;
      cascade.setView(tx, ty, scale);
      motion.markActive();
      handlers.onTransformChange?.(tx, ty, scale);
    },
    motionLayer,
    // onCommit: redraw the canvas skeleton at the settled transform in the same
    // tick the wrapper transform is cleared + the <g> committed. Fires on every
    // commit — settle, initial fit, and programmatic refit — so the canvas is
    // always painted correctly (incl. first load).
    (tx, ty, scale) => skeleton.redraw(tx, ty, scale),
    {
      // Canvas mode has no [data-block-id] DOM, so pan-zoom's dblclick
      // camera-reset needs this hit-test to tell a node from empty space:
      // double-clicking a node opens the note (onDblClick below) and must NOT
      // also snap the camera to the whole-plant fit. Only identity-bearing
      // blocks count — a hit on a structural block behaves as empty space,
      // matching onDblClick (which wouldn't notify the host for it either).
      isNodeAt: (clientX, clientY) => {
        const block = blockAtClientPoint(clientX, clientY);
        return block !== null && nodeRefFor(block) !== null;
      },
      fitPadding: styling.camera.fitPadding,
      // Frame/fit zoom ceiling at the size-cull cliff — a frame must never
      // hide what it framed. Above `peak / (shortSide × titleSize × basalMag)`
      // the cull hides a block, and framing a brand-new one-lief branch
      // (near-zero bounds) otherwise fits at 20–30× — past the cliff, blank
      // space until Full View. Computed live over the CURRENT plant + styling
      // so rebuilds and dev-knob changes need no re-plumbing. The max
      // label-size basis per kind gives the lowest cliff — the block that
      // culls first.
      frameMaxZoom: () => {
        const titleSize = styling.projection.titleSize;
        const basalMag = styling.basalMag;
        if (!(titleSize > 0) || !(basalMag > 0)) return Infinity;
        let maxMeristem = 0;
        let maxLief = 0;
        for (const b of plant.blocks) {
          if (b.kind === "meristem") maxMeristem = Math.max(maxMeristem, labelSizeBasis(b));
          else if (b.kind === "lief") maxLief = Math.max(maxLief, labelSizeBasis(b) * LIEF_SHORT_SIDE_INV);
        }
        let cap = Infinity;
        if (maxMeristem > 0) cap = Math.min(cap, styling.meristemPeakSize / (maxMeristem * titleSize * basalMag));
        if (maxLief > 0) cap = Math.min(cap, styling.liefPeakSize / (maxLief * titleSize * basalMag));
        return cap * FRAME_CLIFF_MARGIN;
      },
    },
  );

  // ── Interaction: single-click frames the node's branch + notifies the host;
  // double-click notifies (the host opens the MD). The single-click dispatch is
  // deferred 250 ms so a following dblclick can cancel it — browsers always
  // fire click → dblclick, and we don't want the HUD to open mid-double-click.

  // Coordinate hit-testing: find the nearest lief/meristem block to a client point.
  // Delegates to skeleton.hitTest which considers BOTH the node position AND the
  // label anchor (ray endpoint), so clicking a meristem's far-away label selects it.
  const blockAtClientPoint = (clientX: number, clientY: number): Block | null => {
    // Invert to world coordinates via pan-zoom, NOT a raw gBCR + live-state
    // inverse: during the 250ms settle window and the 400ms frame tween the
    // motion layer carries a live CSS transform, so the svg's rect is shifted
    // by the composite delta and the naive inverse resolves clicks against
    // where nodes were BEFORE the motion. clientToWorld inverts through the
    // painted wrapper against the settled transform (untransformed origin).
    const w = panzoom.clientToWorld(clientX, clientY);
    const id = skeleton.hitTest(w.x, w.y, currentScale);
    return id ? (plant.blocks.find((b) => b.id === id) ?? null) : null;
  };

  // Rail-cam focus, tracked by STABLE node id (survives the per-furl rebuilds
  // that mint fresh branch ids). null → the next frame is a plain animated fit.
  let currentFocusNodeId: string | null = null;

  // Centre of a branch's label-inclusive framing bounds — the point the camera
  // sits over when that branch is framed. The rail-cam threads these together.
  const branchFocalPoint = (branchId: string): { x: number; y: number } => {
    const b = frameBoundsForBranch(plant, styling, currentProjConfigMap, branchId);
    return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
  };
  // Node-id ancestry chain [node, parent, …, root] over the STABLE full-hierarchy
  // tree (parentNodeIdByNode), so it doesn't break across furl rebuilds.
  const nodeAncestorChain = (nodeId: string): string[] => {
    const chain: string[] = [];
    let id: string | undefined = nodeId;
    while (id !== undefined) { chain.push(id); id = parentNodeIdByNode.get(id); }
    return chain;
  };
  // A branch's ATTACHMENT point — where its stem meets its parent (the block it
  // hangs off). On the spine for a top-level branch, on the parent stem deeper
  // down. Routing the rail through these (rather than each branch's off-to-one-
  // side centre) makes it travel ALONG the stems instead of zig-zagging out to
  // every branch. null for the root (no parent) and unresolved cases.
  const branchAttachmentPoint = (branchId: string): { x: number; y: number } | null => {
    const attId = plant.branches.find((b) => b.id === branchId)?.parentBranchNodeId;
    if (!attId) return null;
    const blk = plant.blocks.find((b) => b.id === attId);
    return blk ? { x: blk.position.x, y: blk.position.y } : null;
  };
  // ONE geometry-tied control point for the camera arc between two nodes: the
  // attachment of their common ancestor — the structural junction where the two
  // branches' paths diverge. Falls back to the midpoint of the two branches' own
  // attachments (a bow along the spine) when the common ancestor is the root, and
  // to null (→ a straight focal glide) when neither resolves. A single control
  // point means the rail is one smooth bow through the structure, not a
  // multi-waypoint weave — simpler motion, still tied to the geometry.
  const railControlPoint = (from: string, to: string): { x: number; y: number } | null => {
    const fromSet = new Set(nodeAncestorChain(from));
    const common = nodeAncestorChain(to).find((id) => fromSet.has(id)) ?? null;
    if (common !== null && common !== from && common !== to) {
      const cbid = branchIdByNodeId.get(common);
      const cap = cbid ? branchAttachmentPoint(cbid) : null;
      if (cap) return cap;
    }
    const fa = (() => { const b = branchIdByNodeId.get(from); return b ? branchAttachmentPoint(b) : null; })();
    const ta = (() => { const b = branchIdByNodeId.get(to); return b ? branchAttachmentPoint(b) : null; })();
    if (fa && ta) return { x: (fa.x + ta.x) / 2, y: (fa.y + ta.y) / 2 };
    return ta ?? fa;
  };


  /** Same extent, new centre. A frame that keeps the CURSOR at the viewport
   *  centre rather than the branch's centre: on a large branch the fit is
   *  floored for legibility, so the branch no longer fits and "centred on the
   *  branch" would put the cursor off-screen. */
  const recentredOn = (b: Bounds, x: number, y: number): Bounds => {
    const hw = (b.max.x - b.min.x) / 2;
    const hh = (b.max.y - b.min.y) / 2;
    return { min: { x: x - hw, y: y - hh }, max: { x: x + hw, y: y + hh } };
  };

  const frameNodeInternal = (
    branchId: string,
    pad = styling.camera.branchFitPad,
    focus?: { kind: string; shortSide: number; labelSize?: number; position: { x: number; y: number } },
  ): void => {
    if (!plant.branches.some((b) => b.id === branchId)) return;
    // Frame the branch's label-inclusive bounds, floored to its parent's extent
    // so a tiny deep stub shows its SIBLINGS instead of over-zooming (see
    // framedBoundsForBranch).
    let bounds = expandBounds(framedBoundsForBranch(plant, styling, currentProjConfigMap, branchId), pad);
    // With a focus block the frame becomes cursor-centred and legibility-floored:
    // fitting a LARGE branch otherwise zooms out until the focus renders as a
    // glyph and the user loses it. Which branch is framed never changes.
    let minScale = 0;
    if (focus && (focus.kind === "lief" || focus.kind === "meristem")) {
      minScale = minScaleForText({
        block: {
          kind: focus.kind,
          shortSide: focus.shortSide,
          ...(focus.labelSize !== undefined && { labelSize: focus.labelSize }),
        },
        titleSize: styling.projection.titleSize,
        basalMag: styling.basalMag,
        liefShortSideInverse: LIEF_SHORT_SIDE_INV,
        liefFullAbovePx: styling.liefFullAbovePx,
        meristemFullAbovePx: styling.meristemFullAbovePx,
      });
      bounds = recentredOn(bounds, focus.position.x, focus.position.y);
    }
    const targetNodeId = unfurlActive ? nodeIdByBranchId.get(branchId) : undefined;
    if (targetNodeId !== undefined) {
      // Rail-cam: one smooth geometry-tied bow. A single control point (the
      // common-ancestor junction) between the current focal (flyAlongPath
      // prepends it) and the target's centre — centripetal Catmull-Rom smooths
      // the three into a single graceful arc through the structure, with none of
      // the multi-waypoint zig-zag.
      const pts: { x: number; y: number }[] = [];
      const ctrl = currentFocusNodeId ? railControlPoint(currentFocusNodeId, targetNodeId) : null;
      if (ctrl) pts.push(ctrl);
      pts.push(branchFocalPoint(branchId)); // rise into the target at the end
      panzoom.flyAlongPath(pts, bounds, CAMERA_MS);
      currentFocusNodeId = targetNodeId;
    } else {
      panzoom.refitAnimated(bounds, CAMERA_MS, minScale);
    }
  };

  // Fade+scale reveal (Task 8): the just-expanded branch's direct children
  // are the newly-revealed layer (the branch itself was already visible —
  // only its children were furled). Opacity/scale only, no geometry
  // recompute; the camera move (frameNodeInternal) is Task 7's job.
  const beginRevealForChildren = (branchId: string): void => {
    skeleton.beginReveal(directChildBranchIds(plant, branchId), styling.unfurl.revealMs);
  };

  // Selection highlight — a SET of emphasised blocks (multi-select); classic
  // single-select is a set of one. The host owns multi-selection RULES
  // (homogeneous kinds, independent subtrees — plugin multi-select.ts); the
  // renderer only paints whatever set it is handed.
  let selectedBlockIds: ReadonlySet<string> = new Set();
  // Selection can also LIGHT the chosen blocks (host-gated). Lighting is the
  // engine's existing emphasis — cursorMagnification, plus exemption from the
  // lief crowding cap and the peak ceiling — and it is what makes the keyboard
  // cursor findable. Folded in BEFORE setSelectedMany, which already redraws,
  // so this costs zero extra redraws.
  let selectionLight = false;
  const syncSelectionLight = (): void => {
    litBlockIds.clear();
    if (selectionLight) for (const id of selectedBlockIds) litBlockIds.add(id);
  };
  const selectGroupMany = (blockIds: ReadonlySet<string>): void => {
    selectedBlockIds = blockIds;
    syncSelectionLight();
    skeleton.setSelectedMany(blockIds);
  };
  const selectGroup = (blockId: string | null): void => {
    if (blockId !== null && selectedBlockIds.size === 1 && selectedBlockIds.has(blockId)) return;
    selectGroupMany(blockId === null ? new Set() : new Set([blockId]));
  };

  // Animate the camera to the whole (label-inclusive) coral — same bounds
  // expression as the initial mount fit, recomputed against the CURRENT plant.
  const fitAllInternal = (): void => {
    // Whole-coral fit resets the rail focus — the next branch-frame flies fresh
    // from the overview rather than along a stale (pre-fit) rail.
    currentFocusNodeId = null;
    panzoom.refitAnimated(wholeCoralBounds(), 500);
  };

  // ── Transition render internals (shared by the handle methods + the unfurl
  // driver, Task 9b) ─────────────────────────────────────────────────────────
  // renderSnapshotInternal: paint `snapshot` at the CURRENT camera, clearing any
  // per-block alpha left by a transition frame (setBlockAlpha does NOT self-clear
  // — a stale alpha would multiply into every later redraw). This is the guaranteed
  // clean-frame render the unfurl driver ends on.
  // `stableMeristems` is ONLY set true by the growth-FILM's public
  // `renderSnapshot` handle method (its captured follow-up redraw needs every
  // meristem title forced full-text). The interactive unfurl's settle reuses
  // this same internal but passes false, so the film-only flag can never leak
  // into — and stick after — an interactive settle (Fix 1b).
  const renderSnapshotInternal = (snapshot: Plant, stableMeristems: boolean): void => {
    skeleton.setBlockAlpha(null);
    // Belt-and-suspenders (mirrors the setBlockAlpha(null) reset just above):
    // a normal snapshot redraw always shows full lief text (frac 1) with NO
    // reveal scope, even if a prior transition left the reveal channel mid-fade.
    skeleton.setLiefTextReveal(1, null);
    const projConfig = buildProjectionConfigMap(snapshot, styling);
    skeleton.setStableMeristems(stableMeristems);
    skeleton.setPlant(snapshot, undefined, projConfig, null, new Set());
    skeleton.redraw(currentTx, currentTy, currentScale);
  };

  // renderTransitionFrameInternal: paint ONE transition frame — override the
  // swept liefs' relative angle (fold-out) on a fresh projection map, redraw in
  // place. The lief-text fade is a separate channel (skeleton.setLiefTextReveal,
  // driven per frame by the live-sweep driver's `render`); the retired keyframe
  // per-block-alpha fade is gone.
  const renderTransitionFrameInternal = (
    frame: Plant,
    opts: { liefAngleById?: Map<string, number> },
  ): void => {
    // Interactive sweep frames must NEVER force-show meristems: reset the
    // film-only flag so a stale `true` (e.g. from an earlier renderSnapshot)
    // can't leak in and balloon the swept titles (Fix 1b).
    skeleton.setStableMeristems(false);
    const projConfig = applyLiefAngleOverrides(
      buildProjectionConfigMap(frame, styling),
      opts.liefAngleById,
    );
    skeleton.setPlant(frame, undefined, projConfig, null, new Set());
    skeleton.redraw(currentTx, currentTy, currentScale);
  };

  // The mount holds AT MOST ONE in-flight unfurl transition. cancelActiveTransition
  // snaps it to the clean final frame (renderFinal → renderSnapshot, clearing block
  // alpha) and drops the reference. Idempotent: the driver no-ops a second cancel,
  // and a settled transition already nulled itself via `done`.
  //
  // Fix I1: the driver's `handle.cancel()` paints a TERMINAL frame via the
  // sweep's own `render` closure — for a REVERSE (furl) sweep that's the
  // shrunk/folded stub with `setLiefTextReveal(0, N-subtree scope)`. Because
  // `activeTransition` is nulled BEFORE `cancel()` runs, the sweep's deferred
  // `done.then(...)` reconciliation (which would collapse furl-state / reset
  // the reveal channel) is skipped by its `activeTransition === handle` guard
  // — so an aborted furl left the canvas stuck showing a text-less, dimmed
  // stub for a branch that's still logically OPEN, with the lief-text-reveal
  // channel wedged at (frac 0, N-subtree scope) forever (nothing else resets
  // it). Reconcile here instead: whenever a transition was actually in
  // flight, follow its cancel with a `renderSnapshotInternal(plant, false)` —
  // the mount's committed geometry (for an aborted FURL, `plant` is still the
  // OPEN branch — "aborted → stay open"; for an aborted UNFURL, `plant` is
  // already the natural target, set synchronously before the sweep starts).
  // `renderSnapshotInternal` resets the reveal channel to (1, null), resets
  // block-alpha, and re-keys the canvas to `plant`'s ids — exactly what the
  // driver's terminal render bypasses. Guarded on the captured handle (not
  // the now-null `activeTransition`) so a no-op cancel (nothing in flight)
  // does nothing extra.
  let activeTransition: LiveSweepHandle | null = null;
  // Mount-scoped capture of the current frame's lief fold-out fraction. The
  // live-sweep `buildFrame` sets it (liefRelativeAngle is a VIEWER-side
  // projection knob, not engine geometry, so it can't go through build()); the
  // paired `render` reads it back the same frame to fold the unfurling node's
  // liefs. buildFrame/render fire back-to-back per frame, so the capture is
  // reliable. Default 1 (fully open) so any stray render outside a sweep is natural.
  let currentLiefAngleFrac = 1;
  // A note-open deferred to the current unfurl transition's settle (the unfurl
  // branch of toggleFurlByNode stashes its `onUnfurlSettle` here when it arms
  // the sweep). It fires exactly once — either at the natural settle, or, when
  // the sweep is cancelled by a USER INPUT STEAL (pan/zoom), carried through the
  // cancel so the note the user asked for still opens. A cancel by a SUPERSEDING
  // toggle / vault rebuild drops it (the new action owns the next open).
  let pendingDeferredOpen: (() => void) | null = null;
  const cancelActiveTransition = (runPendingOpen = false): void => {
    const t = activeTransition;
    activeTransition = null;
    if (t === null) return;
    t.cancel();
    // Reconcile the canvas to committed state (see the Fix I1 note above) —
    // ONLY when a transition was actually in flight.
    renderSnapshotInternal(plant, false);
    // Settle the pending deferred note-open (if any). A pan/zoom steal
    // (runPendingOpen) still owes the user the open they clicked for, so run it
    // AFTER the reconcile (plant is settled). A superseding toggle / rebuild
    // (runPendingOpen false) drops it. Capture+null first so it fires exactly
    // once and the transition's own `done.then` settle can't double-run it.
    const pending = pendingDeferredOpen;
    pendingDeferredOpen = null;
    if (runPendingOpen && pending) pending();
  };

  // ── Build-per-state furl routines (Task 9a, active mode only) ──────────────
  // Rebuild the plant for the current `furled` (NODE id) state and re-render
  // via the existing snapshot path — INSTANT (no rAF/animation; that's 9b).
  // Hidden branches are ABSENT from the built plant, so this path NEVER calls
  // applyFurl / skeleton.setFurlState (no visibility-gating — no double-hide).
  const rebuildForFurl = (): void => {
    plant = build(
      hierarchyForFurlState(fullHierarchy!, furled),
      undefined,
      engineConfig!,
    ) as unknown as Plant;
    // Selection block ids don't survive a rebuild — clear the (now-stale) ring.
    selectedBlockIds = new Set();
    syncSelectionLight();
    skeleton.setSelected(null);
    currentProjConfigMap = buildProjectionConfigMap(plant, styling);
    skeleton.setPlant(plant, undefined, currentProjConfigMap, null, new Set());
    rebuildNodeMaps();
    // Re-apply the cached agent tints (Fix 9a-review #1): the maps setAgentTints
    // stored are keyed by the OLD plant's ephemeral block/branch ids, which this
    // rebuild just replaced wholesale — re-resolve the path-keyed cache against
    // the new plant so the glow doesn't vanish. No-op when tints were never set.
    if (cachedTintColorsByPath.size > 0) applyAgentTintsInternal(cachedTintColorsByPath);
    // Re-apply cached seed badges too — same staleness fix, same guard.
    if (cachedSeedBadgePaths.size > 0) applySeedBadgesInternal(cachedSeedBadgePaths);
    render();
    // Re-clamp to the new plant's bounds, keeping the camera where it is (a
    // separate camera anchor follows in the click/API caller). Guarded like
    // update(): a 0×0 (hidden) pane produces a NaN transform.
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      panzoom.setPlantBounds(wholeCoralBounds(), {
        preserveView: true,
      });
    }
  };

  // Engine-knob rebuild (site `?dev` panel): a slider drag fires many `input`s,
  // and each engine-knob change needs a full `build()`. Coalesce to one rebuild
  // per animation frame so scrubbing stays smooth. No-op outside the live-engine
  // (unfurl) path — frozen bundles have nothing to rebuild.
  let engineRebuildScheduled = false;
  const scheduleEngineRebuild = (): void => {
    if (engineRebuildScheduled || !unfurlActive) return;
    engineRebuildScheduled = true;
    win.requestAnimationFrame(() => {
      engineRebuildScheduled = false;
      rebuildForFurl();
    });
  };

  // Return a COPY of `engineConfig` with a SPARSE per-node override that folds/
  // grows just node `nodeId`'s branch — only `growthFactor`/`foldFactor`, never
  // mutating the shared config. Used per live-sweep frame to rebuild the plant
  // with the unfurling node partly grown-in / folded.
  const withOverride = (
    cfg: EngineConfig,
    nodeId: string,
    o: { growthFactor: number; foldFactor: number },
  ): EngineConfig => ({
    ...cfg,
    overrides: {
      ...(cfg.overrides ?? {}),
      [nodeId]: { growthFactor: o.growthFactor, foldFactor: o.foldFactor },
    },
  });

  // Build the per-lief fold-out angle map for the unfurling node's branch (the
  // branch in `frame` whose tip meristem `hierarchyId === nodeId`): each lief on
  // that branch takes `frac * (π/2)` — its natural liefRelativeAngle scaled by
  // the sweep's liefAngleFrac. liefRelativeAngle is a viewer-side projection
  // knob, so it rides the projection map (renderTransitionFrameInternal), not build().
  const liefAnglesForNode = (
    frame: Plant,
    nodeId: string,
    frac: number,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    const branchId = frame.blocks.find(
      (b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === nodeId,
    )?.branchId;
    if (branchId === undefined) return m;
    const angle = frac * (Math.PI / 2);
    for (const b of frame.blocks) {
      if (b.kind === "lief" && b.branchId === branchId) m.set(b.id, angle);
    }
    return m;
  };

  // Toggle furl for a NODE id. Furled → UNFURL one level: drop this node, then
  // add its DIRECT children that are themselves furlable (so they land as
  // furled stubs — progressive disclosure). Unfurled → FURL: add this node.
  const toggleFurlByNode = (nodeId: string, onUnfurlSettle?: () => void): void => {
    // At most one in-flight sweep: any new toggle cancels the previous one
    // (snapping it to its final full-open frame) before we start.
    cancelActiveTransition();

    if (furled.has(nodeId)) {
      // ── UNFURL: animate via a live per-frame rebuild (Task 6 live-sweep) ────
      // 1. The SAME instant state update 9a does: unfurl one level (drop this
      //    node, re-furl its furlable direct children as stubs), then rebuild
      //    the plant to the natural target, rebuild node maps + re-apply tints.
      //    Mount state (`plant`) is fully consistent immediately, exactly as 9a
      //    — only the VISIBLE frames are deferred to the sweep below, which
      //    paints its own temporary per-frame builds without touching `plant`.
      furled.delete(nodeId);
      for (const childId of directChildNodeIds.get(nodeId) ?? []) {
        if (furlableNodes.has(childId)) furled.add(childId);
      }
      rebuildForFurl();
      // 2. Build the sweep's buildFrame/render closures up front (tune-camera-
      //    sequence) — they're used BOTH for the one-off stub render below AND
      //    as the live sweep's own per-frame callbacks. Each frame rebuilds the
      //    target-furled hierarchy with a sparse growthFactor/foldFactor
      //    override on the unfurling node, captures the frame's liefAngleFrac,
      //    and paints it (canvas geometry + lief fold-out + lief-text reveal).
      const buildFrame = (p: FrameOverrides): Plant => {
        currentLiefAngleFrac = p.liefAngleFrac;
        return build(
          hierarchyForFurlState(fullHierarchy!, furled),
          undefined,
          withOverride(engineConfig!, nodeId, {
            growthFactor: p.growthFactor,
            foldFactor: p.foldFactor,
          }),
        ) as unknown as Plant;
      };
      const render = (frame: Plant, opts: { textRevealFrac: number }): void => {
        // Scope the text-reveal to the unfurling branch N's SUBTREE in THIS
        // frame (lief + meristem block ids), recomputed per frame since growth
        // adds/removes blocks — so only N's subtree titles+liefs hide during
        // grow; the rest of the coral stays fully lit (Fix 2).
        skeleton.setLiefTextReveal(
          opts.textRevealFrac,
          subtreeLabelBlockIds(frame, nodeId),
        );
        renderTransitionFrameInternal(frame, {
          liefAngleById: liefAnglesForNode(frame, nodeId, currentLiefAngleFrac),
        });
      };
      // 3. Paint the branch as a fully-closed STUB before the camera moves.
      //    rebuildForFurl (above) already committed the NATURAL (full-grown)
      //    target to the canvas — its setPlant + setPlantBounds(preserveView)
      //    redraw synchronously — so without this, the fully-open plant would
      //    flash on screen while the camera is still panning toward it. This
      //    one-off render (same closures the sweep uses) overwrites that paint
      //    synchronously, in the same tick, before anything is observable.
      render(buildFrame({ growthFactor: 0, foldFactor: 0, liefAngleFrac: 0 }), { textRevealFrac: 0 });
      // 4. Grow the unfurl IN PLACE — in whatever view the coral is already in,
      //    with NO camera move first (startDelayMs 0 → growth begins immediately).
      //    Moving the camera during/around growth is what made the coral feel
      //    jumpy; keeping it still means the branches simply sprout where they
      //    are. The single camera move — opening the panel and recentring the
      //    now-grown coral into the coral-panel — happens ONCE, on settle (below).
      const handle = runLiveSweep({
        nodeId,
        buildFrame,
        render,
        durationMs: SWEEP_MS,
        startDelayMs: 0,
      });
      activeTransition = handle;
      // Stash the note-open for this transition so a pan/zoom steal mid-sweep can
      // still run it (cancelActiveTransition(true)); a superseding toggle drops it.
      if (onUnfurlSettle) pendingDeferredOpen = onUnfurlSettle;
      // On settle, drop the reference AND run a clean snapshot of the held
      // `plant` (natural target) so setLiefTextReveal/block-alpha reset and the
      // canvas ends keyed to the mount's real plant ids. Guarded so a cancel
      // (which nulls activeTransition first) doesn't double-render.
      void handle.done.then(() => {
        if (activeTransition === handle) {
          activeTransition = null;
          // Interactive settle: stableMeristems FALSE so the film-only flag
          // never sticks after the unfurl (Fix 1b).
          renderSnapshotInternal(plant, false);
          handlers.onUnfurlChange?.();
          // Growth is done and settled — NOW open the note and recentre in ONE
          // clean camera move (Pavlos: grow in place, then the panel opens and the
          // coral recentres). Add panel-inset FIRST so the panel-open's own
          // setPanelInset(true) is a no-op (no double move); then frame the node
          // into the coral-panel — the single, post-growth camera move. Fires on
          // NATURAL completion only (guarded by activeTransition === handle): a
          // superseding click cancels this transition and skips the stale open.
          // Run via the pending slot so a steal-cancel that already fired the
          // open (cancelActiveTransition(true)) doesn't double-fire it here.
          const open = pendingDeferredOpen;
          if (open) {
            pendingDeferredOpen = null;
            document.body.classList.add("panel-inset");
            open();
          }
          // Recentre the now-grown coral into the coral-panel — the single,
          // post-growth camera move. The panel inset is derived from the panel's
          // own width (readInsets), not the transform-tainted svg rect, and the
          // fly eases the focal's on-screen anchor toward its inset position (see
          // flyAlongPath), so this lands in the coral-panel as ONE fluid move.
          if (!options.noUnfurlCamera) frameNodeByNodeId(nodeId);
        }
      });
    } else {
      // ── FURL of an OPEN node: play the unfurl IN REVERSE (fold up + shrink to
      // a stub), THEN collapse to the real furled hierarchy on settle (Task
      // tune-reverse-furl). Do NOT mutate furl-state yet — the branch must stay
      // UNFURLED so buildFrame renders the OPEN geometry we animate FROM; the
      // collapse is deferred to the sweep's `done` so the reverse playback ends
      // on the stub exactly as the true furled stub takes its place.
      //
      // Same buildFrame/render closures the unfurl path uses (sparse growth/
      // fold override on N; scoped text-reveal + lief fold-out per frame). Here
      // `furled` still has N OPEN, so each frame rebuilds the open branch partly
      // shrunk/folded — the reverse sweep drives growth/fold 1→0.
      const buildFrame = (p: FrameOverrides): Plant => {
        currentLiefAngleFrac = p.liefAngleFrac;
        return build(
          hierarchyForFurlState(fullHierarchy!, furled),
          undefined,
          withOverride(engineConfig!, nodeId, {
            growthFactor: p.growthFactor,
            foldFactor: p.foldFactor,
          }),
        ) as unknown as Plant;
      };
      const render = (frame: Plant, opts: { textRevealFrac: number }): void => {
        skeleton.setLiefTextReveal(
          opts.textRevealFrac,
          subtreeLabelBlockIds(frame, nodeId),
        );
        renderTransitionFrameInternal(frame, {
          liefAngleById: liefAnglesForNode(frame, nodeId, currentLiefAngleFrac),
        });
      };
      // No camera `startDelayMs` — the branch is already framed (the user
      // clicked furl on it); the parent recenter happens on settle below.
      const handle = runLiveSweep({
        nodeId,
        buildFrame,
        render,
        durationMs: SWEEP_MS,
        reverse: true,
      });
      activeTransition = handle;
      // On settle, NOW collapse: the existing instant-furl state update (add N
      // to `furled`), rebuild to the TRUE furled hierarchy (swaps the animated
      // open-branch stub for the real furled stub — visually continuous), then
      // recenter the PARENT branch (the existing furl camera behaviour). Guarded
      // so an external cancel (which nulls activeTransition first) doesn't
      // collapse a furl the user aborted.
      void handle.done.then(() => {
        if (activeTransition === handle) {
          activeTransition = null;
          furled.add(nodeId);
          rebuildForFurl();
          renderSnapshotInternal(plant, false); // reset reveal(1,null)+alpha+stableMeristems (Fix item 2)
          handlers.onUnfurlChange?.();
          const parentNodeId = parentNodeIdByNode.get(nodeId);
          if (parentNodeId !== undefined && branchIdByNodeId.has(parentNodeId)) {
            frameNodeByNodeId(parentNodeId);
          } else {
            panzoom.refit();
          }
        }
      });
    }
  };

  // Camera anchor keyed by NODE id across the rebuild: resolve the branch in the
  // NEW plant whose meristem hierarchyId === nodeId, then frame it.
  // Framing pad for the unfurl/recenter camera: the branch fills ~1/pad of the
  // frame. Looser than a tight fit so lower-level branches aren't over-zoomed and
  // the attention shift into them is gentler (Pavlos: more padding = smoother).
  const frameNodeByNodeId = (nodeId: string, pad = styling.camera.branchFramePad): void => {
    const branchId = branchIdByNodeId.get(nodeId);
    if (branchId) frameNodeInternal(branchId, pad);
  };

  let pendingClick: number | null = null;
  const onClick = (e: MouseEvent): void => {
    const block = blockAtClientPoint(e.clientX, e.clientY);
    const ref = block ? nodeRefFor(block) : null;
    if (!ref) return;
    // Cmd/ctrl-click → the additive multi-select channel (opt-in, see
    // MountHandlers). Fires IMMEDIATELY: an additive click never opens a note,
    // so the 250ms dblclick-cancel window doesn't apply — and it never moves
    // the camera and never routes furl intents. The host computes the new set
    // (its rules) and calls back highlightNodes; the renderer paints nothing here.
    if ((e.metaKey || e.ctrlKey) && handlers.onNodeAdditiveClick) {
      if (pendingClick !== null) {
        win.clearTimeout(pendingClick);
        pendingClick = null;
      }
      handlers.onNodeAdditiveClick(ref);
      return;
    }
    if (pendingClick !== null) win.clearTimeout(pendingClick);
    pendingClick = win.setTimeout(() => {
      pendingClick = null;
      selectGroup(block!.id);
      // Own the camera BEFORE the host opens its HUD: opening the HUD resizes the
      // plant pane (and pop-out panes transit through 0×0), and without ownership
      // the resize-driven auto-fit would jump the view to whole-plant before the
      // host's frameNode lands — the "view resets after a spell" flicker.
      panzoom.ownCamera();

      // ── Build-per-state click routing (Task 9a) ────────────────────────────
      // Node identity is the meristem hierarchyId; resolve the clicked block's
      // branch → nodeId and route the furl intent, rebuilding per state.
      if (unfurlActive) {
        const nodeId = nodeIdByBranchId.get(ref.branchId);
        const meristemFurled =
          block!.kind === "meristem" && nodeId !== undefined && furled.has(nodeId);
        if (isExpandAffordance(block!) || meristemFurled) {
          // Unfurl one level — toggleFurlByNode itself now owns the camera
          // move (stub-render → frame the node's branch → live sweep held
          // for CAMERA_MS, tune-camera-sequence) so it isn't kicked twice.
          // Clicking the furled meristem OR its "click to expand" affordance both
          // open the owner note (Pavlos: clicking either is "like clicking the
          // meristem"). The affordance lief has no note of its own, so resolve the
          // OWNER meristem's ref (nodeId is its hierarchyId). Deferred to settle so
          // the note swaps after all movement.
          if (nodeId !== undefined) {
            const openRef = meristemFurled ? ref : nodeRefByHierarchyId(plant, nodeId);
            toggleFurlByNode(nodeId, openRef ? () => handlers.onNodeClick?.(openRef) : undefined);
          }
          return;
        }
        if (isFurlAffordance(block!)) {
          // Furl this node — toggleFurlByNode now owns the whole collapse: it
          // plays the unfurl in reverse (fold up + shrink), then on settle
          // collapses the state AND recenters on the PARENT (what the user is
          // left looking at; root → whole-coral refit). So — unlike the old
          // instant furl — we do NOT recenter synchronously here (that would
          // yank the camera mid-animation). Consumes the click: furling never
          // opens a note.
          if (nodeId !== undefined) toggleFurlByNode(nodeId);
          return;
        }
        // else: an unfurled meristem or a real-lief click → normal below.
      } else {
        // LEGACY visibility-gating click routing (default-off): when disabled,
        // clickIntentFor always returns "normal" and this falls straight
        // through to the pre-existing behaviour below — bit-for-bit unchanged.
        const intent = clickIntentFor(block!, { enabled: styling.unfurl.enabled, furled });
        const bid = ref.branchId;
        if (intent === "furl") {
          // The furl-affordance lief lives ON its owner branch — `bid` IS the
          // branch to collapse. Centre on its PARENT (the branch the user is
          // left looking at); no parent (root) → whole-coral refit. Consumes
          // the click: furling never opens a note.
          toggleFurlInternal(bid);
          const parent = plant.branches.find((b) => b.id === bid)?.parentBranchId;
          if (parent) frameNodeInternal(parent, 1.5);
          else panzoom.refit();
          return;
        }
        if (intent === "expand-only") {
          // Reveal this branch's direct children (one level) and centre on it
          // generously (pad 1.5) so the newly-revealed children are in frame.
          // Consumes the click: expanding never opens a note. beginReveal runs
          // BEFORE toggleFurlInternal so the reveal-alpha map is already
          // populated when setFurlState's synchronous redraw first paints the
          // newly-unhidden children — otherwise that one frame would render
          // them at full opacity ahead of the fade-in (a one-frame pop).
          beginRevealForChildren(bid);
          toggleFurlInternal(bid);
          frameNodeInternal(bid, 1.5);
          return;
        }
        if (intent === "expand-and-open") {
          // A furled meristem: unfurl + frame exactly like "expand-only", but
          // ALSO notify the host — the user clicked the node itself, not an
          // affordance, so the note opens too.
          beginRevealForChildren(bid);
          toggleFurlInternal(bid);
          frameNodeInternal(bid, 1.5);
          handlers.onNodeClick?.(ref);
          return;
        }
      }

      // "normal" / "none": pre-existing behaviour, unchanged. When a host owns
      // the click (the plugin's HUD), let *it* frame the node — opening the
      // HUD shrinks the plant area, and the 120% framing must be computed
      // against that smaller viewport. The host calls `frameNode` after its
      // layout settles. Standalone (no handler) frames immediately.
      if (handlers.onNodeClick) handlers.onNodeClick(ref);
      else frameNodeInternal(ref.branchId);
    }, 250);
  };
  const onDblClick = (e: MouseEvent): void => {
    // A modified double-click is two additive clicks, not a fit gesture —
    // additive selection never moves the camera.
    if ((e.metaKey || e.ctrlKey) && handlers.onNodeAdditiveClick) return;
    if (pendingClick !== null) {
      win.clearTimeout(pendingClick);
      pendingClick = null;
    }
    const block = blockAtClientPoint(e.clientX, e.clientY);
    const ref = block ? nodeRefFor(block) : null;
    if (ref) handlers.onNodeDoubleClick?.(ref);
  };
  // Right-click a node → hand the node to the host (the plugin shows Obsidian's
  // file-menu). Only when a block is hit; over empty canvas the browser/host
  // default is left alone.
  const onContextMenu = (e: MouseEvent): void => {
    const block = blockAtClientPoint(e.clientX, e.clientY);
    const ref = block ? nodeRefFor(block) : null;
    if (!ref) return;
    e.preventDefault();
    handlers.onNodeContextMenu?.(ref, e);
  };
  svg.addEventListener("click", onClick);
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("contextmenu", onContextMenu);

  // Cancel-on-input (Task 9b): genuine user pan/zoom/pointer input steals the
  // camera, so it must snap any in-flight unfurl morph to its final frame. These
  // fire ONLY on real DOM events — the concurrent, programmatic anchor-framing
  // (frameNodeByNodeId → refitAnimated) dispatches no pointer/wheel events, so it
  // never self-cancels the transition it runs alongside.
  // A genuine pan/zoom steal must still HONOUR a note-open the user asked for
  // (deferred to the sweep's settle) — pass runPendingOpen=true so the open
  // survives the cancel. All OTHER cancel sites (superseding toggle / rebuild /
  // teardown) pass no arg → drop the stale open.
  const onUserInputSteal = (): void => cancelActiveTransition(true);
  svg.addEventListener("pointerdown", onUserInputSteal);
  svg.addEventListener("wheel", onUserInputSteal, { passive: true });

  // TODO: canvas hover — defer to next slice

  return {
    update(next: Plant) {
      // A vault-driven rebuild replaces the plant wholesale — snap any in-flight
      // unfurl morph to its final frame first so it can't paint stale ids over it.
      cancelActiveTransition();
      plant = next;
      selectedBlockIds = new Set();
      syncSelectionLight();
      skeleton.setSelected(null);
      // Rebuild projection config for the new plant before setPlant so the
      // canvas label renderer has the correct config from the first redraw.
      currentProjConfigMap = buildProjectionConfigMap(next, styling);
      skeleton.setPlant(next, undefined, currentProjConfigMap, null, new Set());
      // Branch ids can change across a rebuild — recompute the furlable set
      // and re-push the (unchanged) `furled` state's derived sets against the
      // NEW plant so the cascade + skeleton draw channel stay in sync with it.
      // Skipped in build-per-state mode: `furled` there is NODE ids (not branch
      // ids) and hidden branches are absent from the plant, so the legacy
      // visibility-gating would mis-key. (Build-per-state hosts drive furl
      // changes through toggleFurl/unfurlAll/furlAll, not update().)
      if (!unfurlActive) {
        furlableIds = furlableBranchIds(plant);
        applyFurl();
      } else {
        rebuildNodeMaps();
      }
      render();
      // Guard: refitting against a hidden pane's 0×0 viewport produces a
      // NaN/zero transform (permanently blank plant). Callers should defer
      // updates while hidden; this is the belt-and-braces.
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Same-plant rebuild (folder changes go through a fresh mount), so keep
        // the camera where the user left it instead of snapping to full view.
        // Label-inclusive bounds (see projectedContentBounds) so min-zoom/clamp
        // and any later full-view fit keep the root/meristem titles in frame.
        panzoom.setPlantBounds(
          wholeCoralBounds(),
          { preserveView: true },
        );
      }
    },
    frameNode(branchId: string) {
      frameNodeInternal(branchId);
    },
    // The site's glass panel opens/closes: mark whether the coral fits into the
    // "coral panel" (window minus the panel) and reframe when that CHANGES, so the
    // coral makes room for the panel on open and reclaims it on close. Opens
    // driven through toggleFurlByNode already set the class before framing (single
    // move), so calling this true again is a no-op; the real work here is the
    // close reframe back to full width.
    setPanelInset(active: boolean) {
      const was = document.body.classList.contains("panel-inset");
      document.body.classList.toggle("panel-inset", active);
      if (was === active) return;
      // Panel OPENING: leave the camera exactly where the reader put it. The
      // old open-reframe surfaced as a surprise whole-coral zoom-out on the
      // FIRST click after manual pan/zoom (no focus node yet → fitAll); growth
      // clicks already frame via toggleFurlByNode before this runs (Pavlos,
      // 18 July: single click never moves the view — double-click fits).
      if (active) return;
      if (currentFocusNodeId !== null && branchIdByNodeId.has(currentFocusNodeId)) {
        frameNodeByNodeId(currentFocusNodeId);
      } else {
        fitAllInternal();
      }
    },
    fullView() {
      // refit() with no focus resets activeBounds → full plant and fits, the
      // same path as the initial mount view.
      panzoom.refit();
    },
    fitAll() {
      // Same label-inclusive bounds expression as the initial mount fit (see
      // the panzoom install above) — animated so it reads as a deliberate
      // camera move rather than a snap. Recomputed against the CURRENT plant/
      // furl state, not the initial one.
      fitAllInternal();
    },
    selectNode(hierarchyId: string): NodeRef | null {
      const block = plant.blocks.find(
        (b) => (b as { hierarchyId?: string }).hierarchyId === hierarchyId,
      );
      const ref = block ? nodeRefFor(block) : null;
      if (!block || !ref) return null;
      selectGroup(block.id);
      panzoom.ownCamera();
      // Programmatic select (Reveal-in-coral, grown-lief re-focus): zoom-to-fit
      // the node's parent branch so the user SEES where it sits. Deliberately
      // NOT routed through onNodeClick — a reveal shouldn't open the note in the
      // editor or toggle the HUD (that's a user-click concern), and with no HUD
      // resize the framing is computed against the current viewport directly.
      // Hosts wanting selection-state/HUD updates use the returned ref.
      // Frame the same branch as ever — but floored for legibility and centred
      // on the node itself, so a step onto a large branch can't leave the cursor
      // as an unreadable dot.
      frameNodeInternal(ref.branchId, undefined, block);
      return ref;
    },
    highlightNode(hierarchyId: string): NodeRef | null {
      // Highlight-only sibling of selectNode: applies the same selection emphasis
      // (selectGroup → skeleton.setSelected) but NEVER frames — no ownCamera, no
      // refitAnimated. A background reselect (vault change → rebuild) must leave
      // the camera exactly where the user put it (selection never moves the view).
      const block = plant.blocks.find(
        (b) => (b as { hierarchyId?: string }).hierarchyId === hierarchyId,
      );
      const ref = block ? nodeRefFor(block) : null;
      if (!block || !ref) return null;
      selectGroup(block.id);
      return ref;
    },
    highlightNodes(hierarchyIds: readonly string[]): NodeRef[] {
      const blockIds = new Set<string>();
      const refs: NodeRef[] = [];
      for (const h of hierarchyIds) {
        const block = plant.blocks.find(
          (b) => (b as { hierarchyId?: string }).hierarchyId === h,
        );
        const ref = block ? nodeRefFor(block) : null;
        if (!block || !ref) continue;
        blockIds.add(block.id);
        refs.push(ref);
      }
      selectGroupMany(blockIds);
      return refs;
    },
    setCamera(tx: number, ty: number, scale: number) {
      panzoom.setTransform(tx, ty, scale);
    },
    renderSnapshot(snapshot: Plant) {
      // Delegates to the shared internal (see renderSnapshotInternal): the growth
      // film camera fires this then a setCamera → onCommit → skeleton.redraw that
      // gets CAPTURED; stableMeristems stays ON so that captured redraw keeps its
      // meristem labels. The interactive plugin never calls this.
      renderSnapshotInternal(snapshot, true);
    },
    renderTransitionFrame(frame: Plant, opts) {
      renderTransitionFrameInternal(frame, opts);
    },
    setLiefTextReveal(frac: number, scopeBlockIds?: ReadonlySet<string> | null) {
      skeleton.setLiefTextReveal(frac, scopeBlockIds ?? null);
    },
    getBounds() {
      return plant.bounds;
    },
    getPlant() {
      return plant;
    },
    viewport() {
      return { width: svg.clientWidth, height: svg.clientHeight };
    },
    setAgentTints(colorsByPath: Map<string, string[]>) {
      cachedTintColorsByPath = colorsByPath;
      applyAgentTintsInternal(colorsByPath);
    },
    setSeedBadges(paths: ReadonlySet<string>) {
      cachedSeedBadgePaths = paths;
      applySeedBadgesInternal(paths);
    },
    setSpectralShift(on: boolean) {
      skeleton.setSpectralShift(on);
    },
    setSelectionLight(on: boolean) {
      if (selectionLight === on) return;
      selectionLight = on;
      syncSelectionLight();
      skeleton.redrawLast();
    },
    debugLitBlockIds() {
      // Read-only seam: return a copy so a caller holding the reference can't
      // observe later mutations of the live litBlockIds set.
      return new Set(litBlockIds);
    },
    setNodeMetadata(summaryByName: Map<string, string>) {
      skeleton.setNodeMetadata(summaryByName);
    },
    setSizingKnobs(knobs) {
      // `styling` is the single mutable config object every layer reads live —
      // the cascade via its stylingConfig() getter, the skeleton via its
      // captured reference — so mutating it here re-parameterises the next
      // decisions pass without any rebuild.
      styling.optimalSize = knobs.optimalSize;
      styling.liefOptimalSize = knobs.liefOptimalSize;
      styling.attentionPropagationDecay = knobs.attentionPropagationDecay;
      styling.subtreeBoost = knobs.subtreeBoost;
      // Only when the host couples it (the plugin's lief slider); left alone for
      // callers that don't send it, so the cap stays at its shipped value.
      if (knobs.liefMaxLift !== undefined) styling.liefMaxLift = knobs.liefMaxLift;
      skeleton.redrawLast();
    },
    setDevKnobs(k) {
      let structural = false;
      // Cascade (decision) knobs — mutating + redrawing is enough. Tracked so a
      // camera-only call (below) can skip the redraw: camera knobs change
      // nothing until the next fit.
      let needsRedraw = false;
      if (k.optimalSize !== undefined) { styling.optimalSize = k.optimalSize; needsRedraw = true; }
      if (k.liefOptimalSize !== undefined) { styling.liefOptimalSize = k.liefOptimalSize; needsRedraw = true; }
      if (k.subtreeBoost !== undefined) { styling.subtreeBoost = k.subtreeBoost; needsRedraw = true; }
      if (k.subtreeBoostShape !== undefined) { styling.subtreeBoostShape = k.subtreeBoostShape; needsRedraw = true; }
      if (k.basalMag !== undefined) { styling.basalMag = k.basalMag; needsRedraw = true; }
      if (k.attentionPropagationDecay !== undefined) { styling.attentionPropagationDecay = k.attentionPropagationDecay; needsRedraw = true; }
      if (k.meristemPeakSize !== undefined) { styling.meristemPeakSize = k.meristemPeakSize; needsRedraw = true; }
      if (k.liefPeakSize !== undefined) { styling.liefPeakSize = k.liefPeakSize; needsRedraw = true; }
      // LOD gates — the cascade rebuilds its tier configs from stylingConfig()
      // every pass, so mutating + redrawing is enough.
      if (k.meristemDotsAbovePx !== undefined) { styling.meristemDotsAbovePx = k.meristemDotsAbovePx; needsRedraw = true; }
      if (k.meristemFullAbovePx !== undefined) { styling.meristemFullAbovePx = k.meristemFullAbovePx; needsRedraw = true; }
      if (k.liefDotsAbovePx !== undefined) { styling.liefDotsAbovePx = k.liefDotsAbovePx; needsRedraw = true; }
      if (k.liefFullAbovePx !== undefined) { styling.liefFullAbovePx = k.liefFullAbovePx; needsRedraw = true; }
      if (k.meristemCullMinPx !== undefined) { styling.meristemCullMinPx = k.meristemCullMinPx; needsRedraw = true; }
      if (k.liefCullMinPx !== undefined) { styling.liefCullMinPx = k.liefCullMinPx; needsRedraw = true; }
      if (k.liefMaxLift !== undefined) { styling.liefMaxLift = k.liefMaxLift; needsRedraw = true; }
      // Structural knobs change label geometry (world font / ray distance), so the
      // projection map + label params must be rebuilt before redraw.
      if (k.titleSize !== undefined) { styling.projection.titleSize = k.titleSize; structural = true; }
      if (k.meristemDistance !== undefined) { styling.projection.meristemDistance = k.meristemDistance; structural = true; }
      if (k.rootMeristemDistance !== undefined) { styling.projection.rootMeristemDistance = k.rootMeristemDistance; structural = true; }
      if (structural) {
        currentProjConfigMap = buildProjectionConfigMap(plant, styling);
        skeleton.setPlant(plant, undefined, currentProjConfigMap, null, new Set());
        if (cachedTintColorsByPath.size > 0) applyAgentTintsInternal(cachedTintColorsByPath);
      }
      // Camera framing — these don't repaint; they take effect on the NEXT fit
      // (click a meristem to see it). frameNodeInternal/frameNodeByNodeId read
      // styling.camera.* as their default parameter at call time, so mutating it
      // is enough — no redraw here. Only fitPadding needs pushing into panzoom,
      // which captured it at install.
      if (k.branchFramePad !== undefined) styling.camera.branchFramePad = k.branchFramePad;
      if (k.branchFitPad !== undefined) styling.camera.branchFitPad = k.branchFitPad;
      if (k.fitPadding !== undefined) {
        styling.camera.fitPadding = k.fitPadding;
        panzoom.setFitPadding(k.fitPadding);
      }
      if (needsRedraw || structural) skeleton.redrawLast();
    },
    getDevKnobs() {
      return {
        titleSize: styling.projection.titleSize,
        basalMag: styling.basalMag,
        optimalSize: styling.optimalSize,
        liefOptimalSize: styling.liefOptimalSize,
        subtreeBoost: styling.subtreeBoost,
        subtreeBoostShape: styling.subtreeBoostShape,
        attentionPropagationDecay: styling.attentionPropagationDecay,
        meristemPeakSize: styling.meristemPeakSize,
        liefPeakSize: styling.liefPeakSize,
        meristemDotsAbovePx: styling.meristemDotsAbovePx,
        meristemFullAbovePx: styling.meristemFullAbovePx,
        liefDotsAbovePx: styling.liefDotsAbovePx,
        liefFullAbovePx: styling.liefFullAbovePx,
        meristemCullMinPx: styling.meristemCullMinPx,
        liefCullMinPx: styling.liefCullMinPx,
        liefMaxLift: styling.liefMaxLift,
        meristemDistance: styling.projection.meristemDistance,
        rootMeristemDistance: styling.projection.rootMeristemDistance,
        fitPadding: styling.camera.fitPadding,
        branchFramePad: styling.camera.branchFramePad,
        branchFitPad: styling.camera.branchFitPad,
      };
    },
    setEngineKnobs(k) {
      if (!engineConfig) return; // no live engine (frozen bundle) → nothing to rebuild
      if (k.branchBuffer !== undefined) engineConfig.clearance.branchBuffer = k.branchBuffer;
      if (k.childScale !== undefined) engineConfig.sizing.childScale = k.childScale;
      scheduleEngineRebuild();
    },
    getEngineKnobs() {
      return {
        branchBuffer: engineConfig?.clearance.branchBuffer ?? 1,
        childScale: engineConfig?.sizing.childScale ?? 0.618,
      };
    },
    toggleFurl(branchId: string) {
      if (unfurlActive) {
        const nodeId = nodeIdByBranchId.get(branchId);
        if (nodeId !== undefined) toggleFurlByNode(nodeId);
      } else {
        toggleFurlInternal(branchId);
      }
    },
    unfurlAll() {
      if (!styling.unfurl.enabled) return;
      // A bulk furl-state change supersedes any in-flight single-node morph.
      cancelActiveTransition();
      if (unfurlActive) {
        furled = new Set();
        rebuildForFurl();
        fitAllInternal();
      } else {
        furled = new Set();
        applyFurl();
      }
    },
    furlAll() {
      if (!styling.unfurl.enabled) return;
      cancelActiveTransition();
      if (unfurlActive) {
        furled = seedFurledNodeIds(fullHierarchy!, styling.unfurl.initialDepth);
        rebuildForFurl();
        fitAllInternal();
      } else {
        furled = seedFurledByDepth(plant, styling.unfurl.initialDepth);
        applyFurl();
      }
    },
    isFurled(branchId: string) {
      if (unfurlActive) {
        const nodeId = nodeIdByBranchId.get(branchId);
        return nodeId !== undefined && furled.has(nodeId);
      }
      return furled.has(branchId);
    },
    isFurlable(branchId: string) {
      if (unfurlActive) {
        const nodeId = nodeIdByBranchId.get(branchId);
        return nodeId !== undefined && furlableNodes.has(nodeId);
      }
      return furlableIds.has(branchId);
    },
    getUnfurlState() {
      // furlable nodes that are NOT currently furled = the revealed set.
      // furlableNodes is the empty set when unfurl is inactive, so this is
      // naturally `[]` there — no separate guard needed.
      const open: string[] = [];
      for (const nodeId of furlableNodes) if (!furled.has(nodeId)) open.push(nodeId);
      return open;
    },
    restoreUnfurlState(openIds: string[]) {
      if (!unfurlActive) return;
      // A bulk furl-state change supersedes any in-flight single-node morph
      // (mirrors unfurlAll/furlAll).
      cancelActiveTransition();
      const openSet = new Set(openIds);
      furled = new Set([...furlableNodes].filter((id) => !openSet.has(id)));
      rebuildForFurl();
      renderSnapshotInternal(plant, false);
      handlers.onUnfurlChange?.();
    },
    revealNode(hierarchyId: string) {
      if (!unfurlActive) {
        const ref = nodeRefByHierarchyId(plant, hierarchyId);
        if (ref) frameNodeInternal(ref.branchId);
        return;
      }
      cancelActiveTransition();
      // Unfurl every furlable ancestor of the target (a no-op delete for ids
      // that were never in `furled`), then rebuild + settle to that state.
      const chain = nodeAncestorChain(hierarchyId);
      for (const nid of chain) furled.delete(nid);
      rebuildForFurl();
      renderSnapshotInternal(plant, false);
      handlers.onUnfurlChange?.();
      // Frame the target: when hierarchyId IS itself a furlable (meristem)
      // node, frame its own branch via the stable node-id map; otherwise
      // (a lief leaf) resolve its owning branch directly.
      if (branchIdByNodeId.has(hierarchyId)) {
        frameNodeByNodeId(hierarchyId);
      } else {
        const ref = nodeRefByHierarchyId(plant, hierarchyId);
        if (ref) frameNodeInternal(ref.branchId);
      }
    },
    destroy() {
      // Stop any in-flight morph so its rAF loop can't fire after teardown.
      cancelActiveTransition();
      svg.removeEventListener("click", onClick);
      svg.removeEventListener("dblclick", onDblClick);
      svg.removeEventListener("contextmenu", onContextMenu);
      svg.removeEventListener("pointerdown", onUserInputSteal);
      svg.removeEventListener("wheel", onUserInputSteal);
      if (pendingClick !== null) win.clearTimeout(pendingClick);
      panzoom.destroy();
      skeleton.destroy();
      cascade.destroy();
      while (container.firstChild) container.removeChild(container.firstChild);
    },
  };
}

/**
 * Per-block resolved ProjectionConfig — same logic as public.ts/main.ts:
 * branch-path overrides, per-lief fan offsets, the lief-distance wing-shape
 * ramp, and the root-meristem distance carve-out. Rebuilt per render because
 * the live plant (and its block ids) changes between updates.
 */
export function buildProjectionConfigMap(
  plant: Plant,
  styling: StylingConfig,
): Map<string, ProjectionConfig> {
  const blockById = new Map(plant.blocks.map((b) => [b.id, b]));
  const branchPathMaps = buildBranchPathMaps(plant);

  const fanInfoByBlockId = new Map<
    string,
    { idx: number; count: number; side: "left" | "right" }
  >();
  // Fractional position of each lief along its branch (per-side, 0 = base,
  // 1 = tip). Drives the lief-distance curve modulation.
  const liefPositionByBlockId = new Map<string, number>();
  for (const br of plant.branches) {
    const leftIds: string[] = [];
    const rightIds: string[] = [];
    for (const blockId of br.blockIds) {
      const block = blockById.get(blockId);
      if (!block || block.kind !== "lief") continue;
      if (block.side === "left") leftIds.push(blockId);
      else rightIds.push(blockId);
    }
    for (let i = 0; i < leftIds.length; i++) {
      fanInfoByBlockId.set(leftIds[i]!, { idx: i, count: leftIds.length, side: "left" });
      liefPositionByBlockId.set(leftIds[i]!, i / Math.max(leftIds.length - 1, 1));
    }
    for (let i = 0; i < rightIds.length; i++) {
      fanInfoByBlockId.set(rightIds[i]!, { idx: i, count: rightIds.length, side: "right" });
      liefPositionByBlockId.set(rightIds[i]!, i / Math.max(rightIds.length - 1, 1));
    }
  }

  // Root meristem carve-out: its projection ray uses rootMeristemDistance so
  // the root title lifts clear of the plant. Mirrors public.ts/main.ts.
  const rootBranch = plant.branches[0];
  const rootMeristem = rootBranch
    ? plant.blocks.find((b) => b.kind === "meristem" && b.branchId === rootBranch.id)
    : undefined;
  const rootMeristemBlockId = rootMeristem?.id;

  const map = new Map<string, ProjectionConfig>();
  for (const b of plant.blocks) {
    if (b.kind !== "lief" && b.kind !== "meristem") continue;
    const path = branchPathForWithMaps(b, branchPathMaps);
    const cfg = resolveProjectionConfig(path, styling.projection, styling.overrides);

    let liefRelativeAngle = cfg.liefRelativeAngle;
    if (b.kind === "lief") {
      const info = fanInfoByBlockId.get(b.id);
      if (info) {
        liefRelativeAngle += fanOffsetForLief(info.idx, info.count, cfg.liefFanRange, info.side);
      }
    }

    // Lief-distance ramp: base liefs reach wider than tip liefs (wing shape).
    let liefDistance = cfg.liefDistance;
    if (b.kind === "lief") {
      const amp = cfg.liefDistanceCurveAmp;
      if (amp > 0) {
        const t = liefPositionByBlockId.get(b.id) ?? 0;
        liefDistance = cfg.liefDistance * (1 + amp * (1 - t));
      }
    }

    const meristemDistance =
      b.kind === "meristem" && b.id === rootMeristemBlockId
        ? cfg.rootMeristemDistance
        : cfg.meristemDistance;

    map.set(b.id, { ...cfg, liefDistance, liefRelativeAngle, meristemDistance, _depth: 0 });
  }
  return map;
}

/**
 * Pure projection-map override for the unfurl fold-out: returns a NEW map in
 * which every id present in both `liefAngleById` and `map` has its
 * `liefRelativeAngle` replaced by the given radians (each ProjectionConfig is
 * cloned, so neither the input map nor its configs are mutated). Ids not in
 * `map` are ignored; entries absent from `liefAngleById` pass through unchanged.
 * `collectRayParams` reads this overridden angle to compute the ray azimuth, so
 * overriding it sweeps that lief's ray (the fold-out animation).
 */
export function applyLiefAngleOverrides(
  map: Map<string, ProjectionConfig>,
  liefAngleById: Map<string, number> | undefined,
): Map<string, ProjectionConfig> {
  if (!liefAngleById || liefAngleById.size === 0) return map;
  const out = new Map(map);
  for (const [id, angle] of liefAngleById) {
    const cfg = out.get(id);
    if (cfg) out.set(id, { ...cfg, liefRelativeAngle: angle });
  }
  return out;
}

/** The set of label (lief + meristem) block ids belonging to the unfurling
 *  node N's SUBTREE in `frame`: N's own branch (the branch whose tip-meristem
 *  `hierarchyId === nodeId`) plus every descendant branch (walked via
 *  `parentBranchId`). The scope the lief-text-reveal is restricted to, so a
 *  sweep only hides N's subtree titles/liefs — not the whole coral (Fix 2).
 *  Returns an empty set when no branch matches `nodeId` (a no-op scope: nothing
 *  dims). Pure — exported for unit testing. */
/** Label-inclusive framing bounds for a branch's subtree: the AABB of the branch
 *  + all descendant branches' lief/meristem nodes AND their projected label-ray
 *  endpoints. Framing on raw `branch.bounds` excludes the meristem/root label
 *  rays (which reach out by `meristemDistance` / `rootMeristemDistance`), so the
 *  camera over-zooms and clips the titles. Falls back to the branch's raw bounds
 *  (then the whole plant) when the subtree yields no labels. Exported so the
 *  camera-framing tests compute the same target the mount does. */
export function frameBoundsForBranch(
  plant: Plant,
  styling: StylingConfig,
  projConfigByBlockId: Map<string, ProjectionConfig> | undefined,
  branchId: string,
): Bounds {
  const branchIds = new Set<string>([branchId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const br of plant.branches) {
      if (!branchIds.has(br.id) && br.parentBranchId !== null && branchIds.has(br.parentBranchId)) {
        branchIds.add(br.id);
        grew = true;
      }
    }
  }
  const blockIds = new Set<string>();
  for (const b of plant.blocks) {
    if ((b.kind === "lief" || b.kind === "meristem") && branchIds.has(b.branchId)) blockIds.add(b.id);
  }
  return (
    projectedSubtreeBounds(plant, styling, projConfigByBlockId, blockIds) ??
    plant.branches.find((b) => b.id === branchId)?.bounds ??
    plant.bounds
  );
}

/** Fraction of a branch's PARENT extent below which the camera won't zoom in —
 *  so a tiny deep stub shows its siblings rather than filling the viewport. */
export const SIBLING_MIN_FRACTION = 0.4;

/** The framing bounds the camera actually uses for a branch: its label-inclusive
 *  bounds (frameBoundsForBranch), floored to `SIBLING_MIN_FRACTION` of its
 *  parent's extent (centred on the branch) so deep, tiny branches show their
 *  SIBLINGS instead of over-zooming. The root (no parent) is returned as-is.
 *  Exported so the camera-framing tests target what the mount frames. */
export function framedBoundsForBranch(
  plant: Plant,
  styling: StylingConfig,
  projConfigByBlockId: Map<string, ProjectionConfig> | undefined,
  branchId: string,
): Bounds {
  const target = frameBoundsForBranch(plant, styling, projConfigByBlockId, branchId);
  const parentId = plant.branches.find((b) => b.id === branchId)?.parentBranchId;
  if (!parentId) return target;
  const parent = frameBoundsForBranch(plant, styling, projConfigByBlockId, parentId);
  const tcx = (target.min.x + target.max.x) / 2;
  const tcy = (target.min.y + target.max.y) / 2;
  const halfW = Math.max((target.max.x - target.min.x) / 2, ((parent.max.x - parent.min.x) * SIBLING_MIN_FRACTION) / 2);
  const halfH = Math.max((target.max.y - target.min.y) / 2, ((parent.max.y - parent.min.y) * SIBLING_MIN_FRACTION) / 2);
  return { min: { x: tcx - halfW, y: tcy - halfH }, max: { x: tcx + halfW, y: tcy + halfH } };
}

export function subtreeLabelBlockIds(frame: Plant, nodeId: string): Set<string> {
  const ids = new Set<string>();
  const rootBranchId = frame.blocks.find(
    (b) => b.kind === "meristem" && (b as { hierarchyId?: string }).hierarchyId === nodeId,
  )?.branchId;
  if (rootBranchId === undefined) return ids;
  // Collect N's branch + all descendant branches (transitive closure over
  // parentBranchId). A fixed-point sweep handles any branch ordering.
  const branchIds = new Set<string>([rootBranchId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const br of frame.branches) {
      if (branchIds.has(br.id)) continue;
      if (br.parentBranchId !== null && branchIds.has(br.parentBranchId)) {
        branchIds.add(br.id);
        grew = true;
      }
    }
  }
  for (const b of frame.blocks) {
    if ((b.kind === "lief" || b.kind === "meristem") && branchIds.has(b.branchId)) {
      ids.add(b.id);
    }
  }
  return ids;
}

function applyCssVars(el: HTMLElement, s: StylingConfig): void {
  const set = (k: string, v: string) => el.style.setProperty(k, v);
  set("--proj-light", s.projection.light);
  set("--proj-meristem-light", s.projection.meristemLight);
  set("--proj-path-light", s.projection.pathLight);
  set("--curve", s.stem.color);
  set("--bg", s.background.color);
  set("--proj-path-opacity", String(s.projection.pathOpacity));
  set("--proj-light-opacity", String(s.projection.lightOpacity));
  set("--proj-source-opacity", String(s.projection.sourceOpacity));
  set("--proj-ray-stroke", s.projection.ray.stroke);
  set("--proj-ray-opacity", String(s.projection.ray.opacity));
  set("--proj-ray-width", String(s.projection.ray.width));
}
