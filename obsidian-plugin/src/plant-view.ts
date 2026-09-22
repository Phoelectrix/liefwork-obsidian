import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  Scope,
  setIcon,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
// The LIBRARY engine — Studio's default since 2026-05. The original engine
// (src/index.ts) still has the chain-crossing limitation that the library
// engine's bottom-up clearance fix (2026-05-06) resolved; importing it here
// produced visible branch crossings on dense corals.
import { build } from "../../src/library/index.ts";
import type { Plant } from "../../src/types.ts";
import { mountPlant, type PlantMountHandle, type NodeRef } from "../../viewer/src/mount-plant.ts";
import { installDevPanel } from "../../viewer/src/dev-panel.ts";
import type { EngineKnobs } from "../../viewer/src/mount-plant.ts";
import {
  type PlantPlacement,
  classifyHudFile,
  effectiveHudEnabled,
  hudPlacementChange,
  nodeAction,
  selectionAfterRefresh,
  noteOpenNeedsReanchor,
  shouldDeferRefresh,
  canDemoteBranch,
  cursorKeyAction,
} from "./view-behavior.ts";
import { toggleSelection, surviveRefresh, isInSelection, bulkDeleteTitle, resolveBulkTargets } from "./multi-select.ts";
import { menuEntryCount, pruneContributedEntries } from "./coral-menu.ts";
import { vaultFolderToNode, folderNotePath, folderNoteMeristemId } from "./ingest/vault-adapter.ts";
import { liefFilename, liefNotePlan, untitledFilename, childBranchPaths } from "./lief-writer.ts";
import { archivePaths, archiveNoteContent } from "./archive-paths.ts";
import { promptForName, confirm, tellUser } from "./name-prompt-modal.ts";
import { AGENT_COLORS, FREE_AGENT_COLORS, nextAgentColor } from "./agent-colors.ts";
import { promptForColor } from "./color-prompt-modal.ts";
import { openIntegratedTerminal, isTerminalPluginAvailable, agentTerminalOutcome } from "./terminal-integration.ts";
import { nextOrder, liefNoteContent, resolveOrder, collectBranchOrders, restoreOrder } from "./lief-frontmatter.ts";
import { traversalOrder, stepTraversal } from "./traversal.ts";
import {
  folderToHierarchy,
  countFolderNodes,
  depthLimitForCap,
  truncateAtDepth,
} from "./ingest/folder-to-hierarchy.ts";
import { stylingForTheme, type CoralTheme } from "./theme.ts";
import type { CoralStyle } from "./style.ts";
import { defaultStylingConfig } from "../../viewer/src/styling.ts";
import { seededRootPaths } from "./coral-lifecycle.ts";
import { coralEngineConfig, applyEngineKnobs, engineKnobsOf } from "./engine-config.ts";
import {
  BRANCH_EMPHASIS_RANGE,
  DEFAULT_TEXT_SIZING,
  DEPTH_FALLOFF_RANGE,
  LIEF_TEXT_RANGE,
  MERISTEM_TEXT_RANGE,
  liefMaxLiftForOptimalSize,
  type TextSizingSettings,
} from "./text-sizing.ts";
import { type BindingStore } from "./binding-store.ts";

export const LIEFWORK_VIEW_TYPE = "liefwork-plant-view";

/** What the view needs to know about the Pro entitlement — injected by main.ts
 *  so the view stays decoupled from ProStore. `spectralShift()` is the
 *  EFFECTIVE state (entitlement AND the setting — see spectralShiftActive). */
export interface ProPerksAccess {
  isPro(): boolean;
  spectralShift(): boolean;
  /** The RAW spectral-pulse choice, ungated — what the toggle in the color
   *  picker shows and writes. The entitlement gate is applied at read time by
   *  spectralShift(), so removing a key silences the perk without forgetting
   *  the preference. */
  spectralPulseSetting(): boolean;
  /** Persist the spectral-pulse choice; main.ts pushes it to every open coral. */
  setSpectralPulse(on: boolean): Promise<void>;
  /** Open the Ice Cream Man on demand (the coral-menu item). Pro silences the
   *  support prompts, which are the only way he ever appears — so without this,
   *  supporters are the one group who never meet him. */
  openIceCreamMan(): void;
  /** Whether the Ice Cream Man has ever appeared — unlocks the free user's
   *  menu item (he introduces himself before he can be summoned). */
  hasMetIceCreamMan(): boolean;
}

/** Access to the user's display settings — injected by main.ts so the view
 *  stays decoupled from the plugin's persistence. `textSizing()` is read fresh
 *  wherever needed; `setTextSizing()` persists a change and pushes it to every
 *  open coral instantly (main.ts calls each view's applyTextSizing). The
 *  setter powers the on-coral sizing overlay. */
export interface DisplaySettingsAccess {
  textSizing(): TextSizingSettings;
  setTextSizing(patch: Partial<TextSizingSettings>): Promise<void>;
  /** Show each branch's folder-note as a base-pinned lief (§3). Read fresh in
   *  buildPlant; a change triggers a full rebuild (main.refreshOpenViews). */
  showMeristemNotes(): boolean;
  /** Display non-md files as liefs (§4). Read fresh in buildPlant. */
  allFiles(): boolean;
  /** Magnify the selected item — feeds selection into the mount's lit set
   *  (cursorMagnification + crowding-cap/peak-ceiling exemption). Free (NOT
   *  Pro-gated, unlike spectral pulse); default ON. */
  selectionMagnify(): boolean;
  /** Coral colour theme (theme.ts) — read at mount; a change rebuilds via
   *  main.refreshOpenViews so the plant remounts wearing the other palette. */
  theme(): CoralTheme;
  /** Coral branching style (style.ts) — read fresh in buildPlant; a change is
   *  structural and rebuilds via main.refreshOpenViews. */
  style(): CoralStyle;
}

/** Ceiling of the engine's WORKABLE band per the 2026-05-15 perf audit
 *  (zippy ≤ ~4,500; workable to ~8,000 — paint ≤ ~750ms, settles ≤ ~120ms;
 *  beyond that the DOM tax needs real tile-LOD). Oversized trees degrade in
 *  stages: drop heading-children → depth-fit with (+N) collapsed leaves →
 *  only then refuse. */
const NODE_CAP = 8000;

/** Watcher debounce for queueRefreshForPaths — a burst of vault events (a
 *  branch create is three: folder, folder-note, starter lief) coalesces into
 *  one rebuild. Runs on each view's OWN window clock (see the method). */
const REBUILD_DEBOUNCE_MS = 300;

export class PlantView extends ItemView {
  private mount: PlantMountHandle | null = null;
  private folderPath: string;
  /** The split shell: the plant mounts into `plantEl`, the HUD docks in `hudEl`
   *  (hidden until a node is clicked). Built once by `ensureShell`. */
  private plantEl: HTMLElement | null = null;
  private shellEl: HTMLElement | null = null;
  /** The "Preview" toggle button — kept so its placement-derived label can be
   *  re-synced after a "Move to new window" migration (see
   *  syncHudPlacementDisplay). */
  private previewBtn: HTMLElement | null = null;
  private hudEl: HTMLElement | null = null;
  private hudSummaryEl: HTMLElement | null = null;
  private selectedNode: NodeRef | null = null;
  /** Cmd/ctrl-click multi-selection (ordered oldest→newest). Homogeneous —
   *  all liefs or all branches — with branch sets holding independent subtrees
   *  only; the rules are pure in multi-select.ts. Size ≥2 closes the HUD (a
   *  single-node instrument). Per-view, per-session; never persisted. */
  private multiSelection: NodeRef[] = [];
  /** HUD width mode — persisted in view state. Narrow (default 320px) / Rect
   *  (portrait golden) / Square (width == height). */
  private hudMode: "narrow" | "rect" | "square" = "narrow";
  /** User's explicit "Preview" (HUD) on/off choice, overriding the placement
   *  default (sidebar → off, main/pop-out → on). null = follow the default.
   *  Persisted in view state. See view-behavior.ts. */
  private hudOverride: boolean | null = null;
  /** The placement the HUD chrome was last derived for, so a CHANGE of
   *  placement can be noticed. A coral can move between the sidebar, the main
   *  area and a pop-out without ever being rebuilt — see hudPlacementChange. */
  private lastPlacement: PlantPlacement | null = null;
  /** Flat pre-order reading walk (node paths) for the HUD's "Next item" button —
   *  recomputed whenever the plant is (re)built. See `traversalOrder`. */
  private traversalIds: string[] = [];
  /** Path of a just-grown lief to re-select once the watcher's rebuild lands —
   *  so growing a note re-focuses it (HUD + parent-branch frame) instead of
   *  leaving the view zoomed out to the whole plant. */
  private pendingSelectPath: string | null = null;
  /** A refresh/rerender arrived while the view was hidden (e.g. another tab
   *  was foregrounded). Re-fitting against a hidden pane's 0×0 viewport
   *  produces a NaN/zero transform and a permanently blank plant — so we
   *  defer, and apply when the view becomes visible again. */
  private pendingRefresh = false;
  /** The deferred replay must be a full remount (a theme change arrived while
   *  hidden), not an in-place update — see `remount()`. */
  private pendingRemount = false;
  /** One-shot visibilitychange replay armed by deferRefresh (hidden window). */
  private visibilityReplayArmed = false;
  /** The per-view watcher debounce (queueRefreshForPaths) — the timer id AND
   *  the window it was scheduled on, so a view that migrates between windows
   *  clears the right clock. */
  private refreshTimer: { win: Window; id: number } | null = null;

  private store: BindingStore;
  private storeUnsub: (() => void) | null = null;
  private perks: ProPerksAccess;
  private display: DisplaySettingsAccess;

  constructor(
    leaf: WorkspaceLeaf,
    store: BindingStore,
    perks: ProPerksAccess,
    display: DisplaySettingsAccess,
  ) {
    super(leaf);
    this.folderPath = "/";
    this.store = store;
    this.perks = perks;
    this.display = display;
    // Esc clears the multi-selection and the HUD — on the VIEW's scope, so it
    // fires only while this view is active (never steals the app-wide Esc).
    this.scope = new Scope(this.app.scope);
    this.scope.register([], "Escape", (evt) => {
      // Esc inside the HUD's compose input must not destroy a half-typed lief
      // (the file's standing draft-safety invariant): blur the field, keep the HUD.
      // Duck-typed, not instanceof: a pop-out window's elements are built from
      // THAT window's constructors, so instanceof against this realm's globals
      // is always false there (the standing per-window law) — tagName survives.
      const t = evt.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        t.blur();
        return false;
      }
      this.clearMultiSelection();
      this.closeHud();
      return false;
    });
    // Arrow keys walk the coral: → next (older→younger), ← previous. On the
    // VIEW's scope, so they fire only while this view is active and never steal
    // the app-wide arrows. The cursor is a PREVIEW-mode feature — inert when the
    // HUD is off (explorer mode) and inside the compose field (caret moves) —
    // so on "passthrough" we return true (don't consume, don't move the cursor):
    // an arrow with preview off must not drag the HUD back nor jump to the root.
    for (const [key, dir] of [["ArrowRight", 1], ["ArrowLeft", -1]] as const) {
      this.scope.register([], key, (evt) => {
        if (cursorKeyAction(this.hudEnabled(), evt.target as HTMLElement | null) === "passthrough") {
          return true;
        }
        this.moveCursor(dir);
        return false;
      });
    }
  }

  getViewType(): string { return LIEFWORK_VIEW_TYPE; }
  getDisplayText(): string { return `Liefwork: ${this.folderPath}`; }
  getIcon(): string { return "sprout"; }

  getState(): Record<string, unknown> {
    return { ...super.getState(), folderPath: this.folderPath, hudMode: this.hudMode, hudOverride: this.hudOverride };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object") {
      const s = state as { folderPath?: unknown; hudMode?: unknown; hudOverride?: unknown };
      if (typeof s.folderPath === "string") this.folderPath = s.folderPath;
      if (s.hudMode === "narrow" || s.hudMode === "rect" || s.hudMode === "square") {
        this.hudMode = s.hudMode;
      }
      if (typeof s.hudOverride === "boolean" || s.hudOverride === null) {
        this.hudOverride = s.hudOverride;
      }
    }
    await super.setState(state, result);
    // Refresh the tab title (getDisplayText) — otherwise it keeps the
    // constructor-time "/" and misreports which folder the plant shows.
    // Private API: leaf.updateHeader() is the only way to refresh the tab title after setState; optional-guarded so removal degrades to a stale title, never a crash.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    this.rerender();
  }

  /** True when `path` lives inside (or is) this view's folder — used by the
   *  watcher to skip rebuilds for changes elsewhere in the vault. */
  containsPath(path: string): boolean {
    if (this.folderPath === "/" || this.folderPath === "") return true;
    return path === this.folderPath || path.startsWith(this.folderPath + "/");
  }

  /** Build a Plant from the current folder; on failure, a user-facing message. */
  private buildPlant(): { plant: Plant | null; message: string | null } {
    // The vault root is not reachable via getAbstractFileByPath("/") — it must
    // come from getRoot(). Any other folder resolves by path.
    const folder =
      this.folderPath === "/" || this.folderPath === ""
        ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(this.folderPath);
    if (!(folder instanceof TFolder)) {
      return { plant: null, message: `Liefwork: folder not found — ${this.folderPath}` };
    }
    // Canon: lief = note/leaf-folder, so headings stay collapsed (a saved
    // transcript is ONE lief, not forty prompt-response liefs). Heading
    // expansion arrives later as a per-node "expand lief → branch" action.
    // Node-cap guard: depth-fit to the cap with "(+N)" collapsed leaves;
    // refuse only when a single folder has >CAP direct children.
    let node = vaultFolderToNode(folder, this.app, { allFiles: this.display.allFiles() });
    const count = countFolderNodes(node);
    if (count > NODE_CAP) {
      const depthLimit = depthLimitForCap(node, NODE_CAP);
      if (depthLimit === null) {
        return {
          plant: null,
          message:
            `Liefwork: "${this.folderPath}" has more than ${NODE_CAP} direct ` +
            `children — too wide to render. Open a subfolder instead.`,
        };
      }
      node = truncateAtDepth(node, depthLimit);
    }
    const input = folderToHierarchy(node, { showMeristemNotes: this.display.showMeristemNotes() });
    this.traversalIds = traversalOrder(input.root);
    // Tuned engine defaults — the user's text-sizing knobs are applied at the
    // renderer (screen) level, not baked into the build; see engine-config.ts.
    const cfg = applyEngineKnobs(coralEngineConfig(this.display.style()), this.engineKnobOverrides);
    try {
      // Library Plant lacks `rings` (viewer type keeps it for the original
      // engine); structurally compatible otherwise — same cast Studio uses.
      return { plant: build(input, undefined, cfg) as unknown as Plant, message: null };
    } catch (err) {
      // e.g. validation failures (over-long names) — surface, don't dead-pane.
      return { plant: null, message: `Liefwork: engine error — ${(err as Error).message}` };
    }
  }

  /** "Can render NOW": non-zero layout size (a background tab is display:none →
   *  0×0) AND a visible document. The document check is not redundant — an
   *  occluded/minimised pop-out WINDOW keeps its layout size, but its rAF is
   *  paused, so rendering into it paints nothing and leaves the deferred
   *  selectNode camera move queued on a dead rAF, replaying stale (black,
   *  over-zoomed) when the window next becomes visible. Defer instead; the
   *  replay paths are active-leaf-change, onResize, and the one-shot
   *  visibilitychange listener armed at defer time (deferRefresh). */
  private isVisible(): boolean {
    return !shouldDeferRefresh(
      this.contentEl.clientWidth,
      this.contentEl.clientHeight,
      this.contentEl.ownerDocument.visibilityState,
    );
  }

  /** Debounced watcher entry point, called by main.ts on every vault
   *  create/delete/rename with the changed paths. Irrelevant paths are dropped
   *  here (typing anywhere in the vault must not rebuild every open plant).
   *  The debounce runs on THIS VIEW'S OWN window clock — never the ambient
   *  global: a hidden Electron window's timers are FROZEN (measured: a 300ms
   *  timeout never fires), so the old main-window debounce simply never ran
   *  while the user worked in a pop-out covering the main window. A view that
   *  cannot paint right now (hidden window / background tab) skips the timer
   *  entirely and goes through deferRefresh, whose replay paths do not depend
   *  on any clock. */
  queueRefreshForPaths(paths: string[]): void {
    if (!paths.some((p) => this.containsPath(p))) return;
    if (!this.isVisible()) {
      this.deferRefresh();
      return;
    }
    const win = this.contentEl.win;
    if (this.refreshTimer !== null) {
      this.refreshTimer.win.clearTimeout(this.refreshTimer.id);
    }
    this.refreshTimer = {
      win,
      id: win.setTimeout(() => {
        this.refreshTimer = null;
        this.refresh();
      }, REBUILD_DEBOUNCE_MS),
    };
  }

  /** Record a refresh for later and, when the cause is a hidden WINDOW, arm a
   *  one-shot visibilitychange replay on the view's OWN document — resolved at
   *  defer time, so a view that has migrated between windows arms the right
   *  one (the ①–③ lesson: never reach for the ambient global). Tab-visibility
   *  deferrals need no listener — active-leaf-change / onResize replay those. */
  private deferRefresh(): void {
    this.pendingRefresh = true;
    if (this.visibilityReplayArmed) return;
    const doc = this.contentEl.ownerDocument;
    if (doc.visibilityState !== "hidden") return;
    this.visibilityReplayArmed = true;
    const onVisible = () => {
      if (doc.visibilityState === "hidden") return; // hidden→hidden noise: stay armed
      doc.removeEventListener("visibilitychange", onVisible);
      this.visibilityReplayArmed = false;
      this.applyPendingIfVisible();
    };
    this.registerDomEvent(doc, "visibilitychange", onVisible);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("liefwork-plant-view");
    // Apply any deferred refresh the moment this view's leaf is foregrounded.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf !== this.leaf) return;
        // First focus after a Move-to-new-window may precede any resize event —
        // catch the migration here too.
        if (this.remountIfMigrated()) return;
        // Second door to the same check: a drag that lands the leaf without a
        // resize still comes through here when it takes focus.
        this.syncPlacementIfChanged();
        this.applyPendingIfVisible();
      }),
    );
    // Subscribe to the binding store so canvas tints update whenever a terminal
    // is bound/unbound.
    this.storeUnsub = this.store.subscribe(() => {
      this.mount?.setAgentTints(this.store.colorsByBranchPath());
      this.pushSeedBadges();
    });
    // Defer one frame so the pane has a non-zero size for fit-to-bounds.
    this.contentEl.win.requestAnimationFrame(() => this.rerender());
  }

  /** Obsidian calls this when the view's dimensions change — including when
   *  it becomes visible after being a background tab. */
  onResize(): void {
    // Migration check first: Obsidian fires onResize when a leaf lands in its
    // new window, and a migrated mount must be rebuilt, not resized (see
    // remountIfMigrated) — a plain refresh would keep the dead-window mount.
    if (this.remountIfMigrated()) return;
    // A same-window drag between the sidebar and the main area resizes the pane
    // but rebuilds nothing — this is where that placement change is noticed.
    this.syncPlacementIfChanged();
    this.applyPendingIfVisible();
  }

  private applyPendingIfVisible(): void {
    if (!this.pendingRefresh || !this.isVisible()) return;
    this.pendingRefresh = false;
    const remount = this.pendingRemount;
    this.pendingRemount = false;
    if (this.mount && !remount) this.refresh();
    else this.rerender();
  }

  /** Rebuild the coral from scratch wearing the CURRENT styling (theme
   *  change — view-behavior.ts `settingRefreshMode`). rerender() restores the
   *  camera on a same-plant rebuild, so the switch lands in the same view. */
  remount(): void {
    if (!this.isVisible()) {
      this.pendingRemount = true;
      this.deferRefresh();
      return;
    }
    this.rerender();
  }

  /** Build the persistent plant+HUD split once. The plant mounts into
   *  `plantEl`; the HUD lives in `hudEl` and survives plant rebuilds. */
  /** True when this view lives in an Obsidian pop-out (separate OS window). In a
   *  pop-out the HUD overlays the plant instead of docking, so opening it never
   *  resizes the plant pane — sidestepping the resize/reflow fights that async
   *  pop-out layout causes. The user pans/zooms if the panel covers a node. */
  private isPopout(): boolean {
    return this.contentEl.ownerDocument !== document;
  }

  /** Where this view lives — drives the HUD default + click semantics.
   *  Sidebar (docked next to the explorer) behaves like the file explorer;
   *  main-area tab / pop-out window run the inline HUD. See view-behavior.ts. */
  private placement(): PlantPlacement {
    if (this.isPopout()) return "popout";
    const root = this.leaf.getRoot();
    const ws = this.app.workspace;
    if (root === ws.leftSplit || root === ws.rightSplit) return "sidebar";
    return "main";
  }

  /** Effective HUD (Preview) on/off: the user's toggle wins, else the default. */
  private hudEnabled(): boolean {
    return effectiveHudEnabled(this.placement(), this.hudOverride);
  }

  /** Re-derive the placement-dependent HUD chrome — the Preview button's label
   *  and the overlay-vs-docked layout — from the CURRENT placement. Must run
   *  after a "Move to new window" migration: `ensureShell` adopts the existing
   *  shell and early-returns, so without this the Preview button stays frozen
   *  on the origin window's state. That froze label then reads inverted — the
   *  toggle flips off the LIVE `hudEnabled()` while the user sees the stale
   *  text — which silently drives the HUD off and makes clicks open notes and
   *  the keyboard cursor start from a null selection. Idempotent; null-safe. */
  private syncHudPlacementDisplay(): void {
    this.lastPlacement = this.placement();
    this.shellEl?.toggleClass("is-overlay-hud", this.isPopout());
    if (this.previewBtn) {
      const on = this.hudEnabled();
      this.previewBtn.setText(on ? "Preview on" : "Preview off");
      this.previewBtn.toggleClass("is-active", on);
    }
  }

  /** Re-sync the HUD chrome when the coral has CHANGED placement without being
   *  rebuilt — dragged from the sidebar into the main area (or back), where the
   *  leaf moves inside one window and no rerender is triggered. Cheap enough to
   *  call from every resize / leaf-change: `hudPlacementChange` returns no work
   *  when the placement is the same, which is nearly always. Founder, 5 Aug: a
   *  coral dragged into the main area showed the HUD while its button still
   *  read "Preview off" — the 22 July migration freeze through a second door,
   *  now handled by one rule for both. And once the label told the truth, the
   *  flip itself was the remaining fault: a move now PRESERVES the mode that
   *  was showing (see hudPlacementChange) rather than adopting the new
   *  placement's default. */
  private syncPlacementIfChanged(): void {
    const { resync, adoptOverride } = hudPlacementChange(
      this.lastPlacement,
      this.placement(),
      this.hudOverride,
    );
    if (!resync) return;
    // Pin what was on screen BEFORE re-deriving the chrome, so the label and
    // the live state are computed from the same (preserved) value.
    if (adoptOverride !== null) {
      this.hudOverride = adoptOverride;
      this.app.workspace.requestSaveLayout(); // hudOverride is view state
    }
    this.syncHudPlacementDisplay();
  }

  private ensureShell(): void {
    if (this.plantEl && this.contentEl.contains(this.plantEl)) return;
    this.contentEl.empty();
    this.contentEl.addClass("liefwork-plant-view");
    const shell = this.contentEl.createDiv({ cls: "liefwork-shell" });
    this.shellEl = shell;
    // Pop-out: float the HUD over the plant (no docking → no plant resize).
    // The overlay class + the preview label are placement-derived and applied
    // by syncHudPlacementDisplay (below + on migration), not inline here.
    this.plantEl = shell.createDiv({ cls: "liefwork-plant-area" });
    this.hudEl = shell.createDiv({ cls: "liefwork-hud" });
    this.hudEl.hide();
    // Persistent "Full view" control — resets the camera to the default wide
    // view. Lives on the shell (absolute-positioned, out of the flex flow) so it
    // survives `plantEl.empty()` on every rerender.
    const fullViewBtn = shell.createEl("button", {
      cls: "liefwork-full-view",
      text: "Full view",
    });
    fullViewBtn.addEventListener("click", () => this.mount?.fullView());

    // "Preview" toggle — override the placement's HUD default (sidebar off /
    // own-window on). Persisted via view state. When turned off, any open HUD
    // hides and single-click reverts to opening the note (explorer parity).
    const previewBtn = shell.createEl("button", { cls: "liefwork-preview-toggle" });
    previewBtn.setAttribute("aria-label", "Toggle the preview panel (HUD)");
    this.previewBtn = previewBtn;
    // Label states the CURRENT state explicitly ("Preview on/off") — a bare
    // glowing "Preview" read as "click to preview something". Re-derived by
    // syncHudPlacementDisplay so a window migration can't leave it frozen.
    this.syncHudPlacementDisplay();
    previewBtn.addEventListener("click", () => {
      const next = !this.hudEnabled();
      this.hudOverride = next;
      this.syncHudPlacementDisplay();
      if (!next) this.closeHud();
      this.app.workspace.requestSaveLayout();
    });

    // ── Text-sizing overlay (top-left): a compact "Aa" toggle that expands a
    // small panel with the three sliders, so the effect is visible live on the
    // coral while dragging. Shares state with the settings tab — both routes
    // go through plugin.setTextSizing (persist + instant push to open views).
    const sizingToggle = shell.createEl("button", {
      cls: "liefwork-text-sizing-toggle",
      text: "Aa",
    });
    sizingToggle.setAttribute("aria-label", "Adjust text sizing");
    sizingToggle.setAttribute("title", "Adjust text sizing");
    const sizingPanel = shell.createDiv({ cls: "liefwork-text-sizing-panel" });
    sizingPanel.hide();

    const mkSizingSlider = (
      label: string,
      range: { min: number; max: number; step: number },
      key: keyof TextSizingSettings,
    ): HTMLInputElement => {
      const row = sizingPanel.createDiv({ cls: "liefwork-text-sizing-row" });
      row.createSpan({ cls: "liefwork-text-sizing-label", text: label });
      const slider = row.createEl("input", {
        cls: "liefwork-text-sizing-slider",
        attr: {
          type: "range",
          min: String(range.min),
          max: String(range.max),
          step: String(range.step),
          "aria-label": label,
        },
      });
      slider.value = String(this.display.textSizing()[key]);
      slider.addEventListener("input", () => {
        void this.display.setTextSizing({ [key]: Number(slider.value) });
      });
      const reset = row.createEl("button", { cls: "liefwork-text-sizing-reset" });
      setIcon(reset, "rotate-ccw");
      reset.setAttribute("aria-label", `Restore default ${label.toLowerCase()}`);
      reset.setAttribute("title", "Restore default");
      reset.addEventListener("click", () => {
        slider.value = String(DEFAULT_TEXT_SIZING[key]);
        void this.display.setTextSizing({ [key]: DEFAULT_TEXT_SIZING[key] });
      });
      return slider;
    };
    const meristemSlider = mkSizingSlider("Meristem text", MERISTEM_TEXT_RANGE, "optimalSize");
    const liefSlider = mkSizingSlider("Lief text", LIEF_TEXT_RANGE, "liefOptimalSize");
    const falloffSlider = mkSizingSlider(
      "Depth falloff",
      DEPTH_FALLOFF_RANGE,
      "attentionPropagationDecay",
    );
    const emphasisSlider = mkSizingSlider(
      "Branch emphasis",
      BRANCH_EMPHASIS_RANGE,
      "subtreeBoost",
    );

    sizingToggle.addEventListener("click", () => {
      if (sizingPanel.isShown()) {
        sizingPanel.hide();
        sizingToggle.removeClass("is-active");
      } else {
        // Re-sync from the source of truth on open — the settings tab (or
        // another view's overlay) may have changed the values meanwhile.
        const s = this.display.textSizing();
        meristemSlider.value = String(s.optimalSize);
        liefSlider.value = String(s.liefOptimalSize);
        falloffSlider.value = String(s.attentionPropagationDecay);
        emphasisSlider.value = String(s.subtreeBoost);
        sizingPanel.show();
        sizingToggle.addClass("is-active");
      }
    });
    // Clicking anywhere else on the coral pane collapses the panel.
    this.registerDomEvent(shell, "pointerdown", (e) => {
      const t = e.target as Node;
      if (sizingPanel.contains(t) || sizingToggle.contains(t)) return;
      if (!sizingPanel.isShown()) return;
      sizingPanel.hide();
      sizingToggle.removeClass("is-active");
    });
  }

  /** The document the current mount was BUILT in. "Move to new window" adopts
   *  the view's DOM into another document without recreating the view — but the
   *  mount's window-bound primitives (both ResizeObservers, the rAF/timeout
   *  clocks, the cached pan-zoom viewport rect) stay constructed from the
   *  ORIGIN window. They only run while that window renders, and a hidden
   *  Electron window's rAF/timers freeze (window-bug ⑤/⑦) — so the migrated
   *  coral paints a stale backing store (stretched) and its click defers never
   *  fire (unresponsive). A live mount cannot be rebound; on migration we
   *  remount — the same path a coral opened directly in a pop-out takes. */
  private mountDoc: Document | null = null;

  /** Remount if the view's DOM has been adopted into another document since
   *  the mount was built (Move to new window, either direction). Returns true
   *  when a remount was triggered — callers skip their own work then. */
  private remountIfMigrated(): boolean {
    if (!this.mount || !this.mountDoc) return false;
    if (this.contentEl.ownerDocument === this.mountDoc) return false;
    this.rerender();
    return true;
  }

  /** Recompute + push the seeded-coral-root badge set (own Growth Charter.md
   *  or legacy CLAUDE.md — coral-lifecycle.ts's seededRootPaths, the same test
   *  classifyFolder uses for "seeded-root") for every rendered meristem.
   *  Called at the same three points setAgentTints re-pushes at: the
   *  binding-store subscription, fresh-mount rerender(), and refresh()'s
   *  rebuild — so Seed/De-seed/Reactivate (which all trigger a rebuild) show/hide
   *  the badge with no extra listener. A no-op while the mount isn't built. */
  private pushSeedBadges(): void {
    const plant = this.mount?.getPlant();
    if (!plant) return;
    const folderPaths = plant.blocks
      .filter((b) => b.kind === "meristem")
      .map((b) => (b as { hierarchyId?: string }).hierarchyId ?? "");
    const badgePaths = seededRootPaths(folderPaths, (p) => Boolean(this.app.vault.getAbstractFileByPath(p)));
    this.mount?.setSeedBadges(badgePaths);
  }

  private rerender(): void {
    if (!this.isVisible()) {
      this.deferRefresh();
      return;
    }
    this.ensureShell();
    // Re-derive the placement-dependent HUD chrome. On a "Move to new window"
    // migration ensureShell early-returns (the shell is adopted, not rebuilt),
    // so this is the only thing that re-syncs the Preview label + overlay class
    // to the new window's placement — without it the toggle reads inverted.
    this.syncHudPlacementDisplay();
    const plantEl = this.plantEl!;
    this.mountDoc = this.contentEl.ownerDocument;
    // A fresh mount starts a fresh selection world (per-session state).
    this.multiSelection = [];
    this.destroyDevPanel();
    this.mount?.destroy();
    this.mount = null;
    plantEl.empty();
    const { plant, message } = this.buildPlant();
    if (!plant) {
      plantEl.setText(message ?? "Liefwork: could not build coral");
      return;
    }
    // Seed the mount with the user's sizing knobs (the renderer's own adaptive
    // targets; later changes arrive live via applyTextSizing → setSizingKnobs).
    const sizing = this.display.textSizing();
    this.mount = mountPlant(
      plantEl,
      plant,
      // liefMaxLift is coupled to the lief-size slider (see
      // liefMaxLiftForOptimalSize) so the slider isn't swallowed by the cap;
      // applied after the spread so it wins over the shipped default.
      // agentGlow.seedBadges is off by default (viewer/src/styling.ts) — the
      // website/Studio never turn it on — so the plugin opts in here, keeping
      // orb/pips at their own (already-true) defaults.
      {
        ...stylingForTheme(this.display.theme()),
        ...sizing,
        liefMaxLift: liefMaxLiftForOptimalSize(sizing.liefOptimalSize),
        agentGlow: { ...defaultStylingConfig.agentGlow, seedBadges: true },
      },
      {
        onNodeClick: (node) => this.onNodeClick(node),
        onNodeDoubleClick: (node) => this.onNodeDoubleClick(node),
        onNodeContextMenu: (node, evt) => this.showNodeMenu(node, evt),
        onNodeAdditiveClick: (node) => this.onAdditiveClick(node),
      },
    );
    // Push current binding tints + the spectral-shift perk onto the fresh mount.
    this.mount.setAgentTints(this.store.colorsByBranchPath());
    this.pushSeedBadges();
    this.mount.setSpectralShift(this.perks.spectralShift());
    this.mount.setSelectionLight(this.display.selectionMagnify());
    // A node was queued for selection before the mount existed (e.g. "Reveal in
    // Liefwork Plant" opened this plant) — select it now the blocks are built.
    if (this.pendingSelectPath) {
      const path = this.pendingSelectPath;
      this.pendingSelectPath = null;
      // A programmatic single-select supersedes any multi-selection — a stale
      // set would raise a ghost bulk menu.
      this.multiSelection = [];
      this.contentEl.win.requestAnimationFrame(() => this.selectByPath(path));
    }
  }

  /** Select + open the HUD for a note by its vault path, if it lives in this
   *  plant. If the mount isn't built yet (freshly opened), defer to the next
   *  build (rerender consumes pendingSelectPath). Powers "Reveal in Liefwork
   *  Coral" from the editor menu. */
  revealNote(path: string): void {
    // A programmatic single-select supersedes any multi-selection — a stale
    // set would raise a ghost bulk menu.
    this.multiSelection = [];
    if (this.selectByPath(path)) return;
    this.pendingSelectPath = path;
  }

  /** selectNode with the folder-note fallback: a lief's node id IS its file
   *  path, but a folder-note usually has no node of its own (the default
   *  display filters it out of the tree) — its coral identity is the meristem,
   *  keyed by the FOLDER path. Try the file path first so that with meristem
   *  notes shown, revealing one still selects the pinned lief. */
  private selectByPath(path: string): boolean {
    if (this.mount?.selectNode(path)) return true;
    const meristem = folderNoteMeristemId(path, this.app.vault.getName());
    return meristem !== null && !!this.mount?.selectNode(meristem);
  }

  /** Right-click a plant node → Obsidian's own file-menu for the node's
   *  file/folder, so core *and* every plugin's items appear (Rename, Delete,
   *  Move, Open in new tab, "Seed as coral", "Open as Liefwork coral", …) —
   *  the same menu as the file explorer. Meristem → its folder; lief → its file. */
  private showNodeMenu(node: NodeRef, evt: MouseEvent): void {
    // Right-click INSIDE a ≥2 multi-selection → the bulk menu (the whole
    // selection is the target — explorer parity). OUTSIDE it → also explorer
    // parity: the multi-selection resets and the plain single-node menu shows.
    if (this.multiSelection.length >= 2) {
      if (isInSelection(this.multiSelection, node.hierarchyId)) {
        this.showMultiNodeMenu(evt);
        return;
      }
      this.clearMultiSelection();
    }
    const { file, folder } = this.resolveNodeFile(node);
    const target = folder ?? file;
    if (!target) return;
    const menu = new Menu();

    // ── Memory-model-native creation actions (what the explorer doesn't give us) ──
    if (node.kind === "lief") {
      if (file) {
        menu.addItem((i) =>
          i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => {
            void this.app.workspace.getLeaf("tab").openFile(file);
          }),
        );
        menu.addItem((i) =>
          i.setTitle("Open to the right").setIcon("separator-vertical").onClick(() => {
            void this.app.workspace.getLeaf("split", "vertical").openFile(file);
          }),
        );
        // Promote is markdown-only: a non-md file lief can never become a branch.
        if (file.extension === "md") {
          menu.addItem((i) =>
            i.setTitle("Promote to branch").setIcon("git-branch").onClick(() => {
              // Born-empty: the note becomes the folder-note; no child is added.
              void this.promoteToBranch(node);
            }),
          );
        }
      }
    } else {
      menu.addItem((i) =>
        i.setTitle("New note/lief").setIcon("file-plus").onClick(() => {
          void this.addLief(node, "", false).then((p) => {
            // Open the new note in a new tab, ready to edit (like the explorer's
            // "New note"). The coral picks it up on its own rebuild.
            const created = this.app.vault.getAbstractFileByPath(p);
            if (created instanceof TFile) void this.openNoteInNewTab(created);
          });
        }),
      );
      menu.addItem((i) =>
        i.setTitle("New folder/branch").setIcon("git-branch-plus").onClick(() => {
          void this.createChildBranch(node);
        }),
      );
      // Demote to note — the inverse of promote. Only for a branch holding just
      // its folder-note (never the root); the clean undo for a mis-promote.
      if (folder && this.canDemote(folder)) {
        menu.addItem((i) =>
          i.setTitle("Demote to note").setIcon("file").onClick(() => {
            void this.demoteToLief(node);
          }),
        );
      }
      // (The agent-terminal commands used to sit here; they now close the menu
      // with the other Liefwork commands — see below.)
    }

    // ── Archive / Restore: SHELVED for the v1 launch ──
    // The biomimetic prune-to-spiral archive (archiveNode / restoreNode /
    // openAsCoral / isInsideArchive / isArchiveMeristem, the engine spiral pass,
    // and the charter-root design) is intentionally not wired into the menu for
    // launch — see the [[Archiving]] coral branch + docs/superpowers/specs|plans/
    // 2026-06-2*-archiving*. The code is left dormant (not deleted) so the
    // feature can be re-enabled once the UX is settled; users prune manually via
    // ordinary file operations in the meantime.

    // ── Rename / Duplicate: core explorer actions that AREN'T surfaced through
    //    the file-menu event (the core file-explorer adds them internally), so
    //    we add them ourselves to reach explorer parity. ──
    menu.addItem((i) =>
      i.setTitle("Rename…").setIcon("pencil").onClick(() => void this.renameNode(node)),
    );
    if (file) {
      menu.addItem((i) =>
        i.setTitle("Duplicate").setIcon("copy").onClick(() => void this.duplicateFile(file)),
      );
    }
    menu.addSeparator();

    // ── Delete (to trash) ──
    menu.addItem((i) =>
      i
        .setTitle(node.kind === "meristem" ? "Delete branch" : "Delete note")
        .setIcon("trash")
        .onClick(async () => {
          const what =
            node.kind === "meristem"
              ? `the branch "${node.name}" and everything inside it`
              : `the note "${node.name}"`;
          const ok = await confirm(this.app, "Delete", `Move ${what} to trash?`, "Delete");
          if (!ok) return;
          if (this.selectedNode?.hierarchyId === node.hierarchyId) this.closeHud();
          void this.app.fileManager.trashFile(target); // honours the user's trash preference
        }),
    );
    menu.addSeparator();

    // Then every file-menu contributor's items (core event-based ones + EVERY
    // plugin the user runs). Fire with the file-explorer's own source tag so
    // plugins that scope their items to the explorer menu ALSO contribute — the
    // coral should carry the user's full explorer menu, whatever plugins they
    // have. Our own handlers key off the leaf's view, not this tag.
    // Reviewer note: we deliberately pass the explorer's source tag so explorer-scoped plugins contribute their items; the leaf argument is our own PlantView leaf and is never the explorer view — handlers that only read the file/menu (the documented contract) are unaffected.
    const contributedFrom = menuEntryCount(menu);
    this.app.workspace.trigger("file-menu", menu, target, "file-explorer-context-menu", this.leaf);
    // …minus any terminal command that isn't ours. Explorer parity stops at the
    // point where a contributor duplicates a coral command: the community
    // Terminal plugin appends three "open a terminal here" items, which landed
    // beside Liefwork's own coral commands while OUR agent terminal sat far
    // above them — four terminal commands in one menu, only one of them the
    // coral's. They remain in the file explorer's menu, untouched.
    pruneContributedEntries(menu, contributedFrom);

    // ── The Liefwork block closes the menu: the agent terminal joins "Open as
    //    Liefwork coral" / "Seed as coral" (contributed by main.ts through the
    //    trigger above) so every coral command reads as one group. ──
    if (node.kind !== "lief") {
      menu.addItem((i) =>
        i.setTitle("Open agent terminal here").setIcon("terminal").onClick(() => {
          void this.openAgentTerminal(node);
        }),
      );
      const agentBranchPath = node.hierarchyId === "/" ? "" : node.hierarchyId;
      // Jump to the agent's terminal (the first one launched here, if several).
      const firstWithLeaf = this.store.bindingsForBranch(agentBranchPath).find((b) => b.leaf);
      if (firstWithLeaf) {
        menu.addItem((i) =>
          i.setTitle("Go to agent terminal").setIcon("arrow-right").onClick(() => {
            const leaf = firstWithLeaf.leaf as WorkspaceLeaf;
            void this.app.workspace.revealLeaf(leaf);
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
          }),
        );
      }
      // ("Stop agent terminal" lived here until 27 July. It stopped nothing —
      // it cleared the tab decoration and dropped the binding while the shell
      // and the agent ran on. For a real terminal it was already redundant:
      // main.ts's layout-change sweep does exactly that when the leaf closes.
      // Its one genuine use was clearing a LEAFLESS binding, which the guard
      // in openAgentTerminal now makes impossible. Founder call: remove it —
      // closing the terminal is the tab's job.)
    }

    // The Ice Cream Man — LAST in the menu, deliberately after every other
    // contributor's items. For Pro, unconditional (and not as a gate): Pro
    // SILENCES the support prompts, which are the only way he ever shows up,
    // so supporters would otherwise be the one group who never meet him. For
    // free users, unlocked once he has introduced himself (the spec's
    // `iceCreamManMet`) — same vignette, the free ending with the basket ask.
    if (this.perks.isPro() || this.perks.hasMetIceCreamMan()) {
      menu.addSeparator();
      menu.addItem((i) =>
        i.setTitle("See the Ice Cream Man").setIcon("ice-cream-cone").onClick(() => {
          this.perks.openIceCreamMan();
        }),
      );
    }
    menu.showAtMouseEvent(evt);
  }

  /** Bulk right-click menu for a ≥2 multi-selection. A manual "Delete N
   *  notes/branches" (same confirm + trash preference as the single delete),
   *  then Obsidian's `files-menu` — the multi-file sibling of the single
   *  menu's `file-menu` trigger — fired with the explorer's source tag so core
   *  + every plugin's bulk items (Move to folder…, …) appear, exactly like the
   *  file explorer's own multi-select menu. Branch sets are independent
   *  subtrees by construction (multi-select.ts), so per-target trash/move can
   *  never hit a stale child path. */
  private showMultiNodeMenu(evt: MouseEvent): void {
    const selection = [...this.multiSelection];
    const kind = selection[0].kind;
    const targets = resolveBulkTargets(selection, (n) => {
      const { file, folder } = this.resolveNodeFile(n);
      return folder ?? file;
    });
    if (targets.length === 0) return;
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle(bulkDeleteTitle(kind, targets.length))
        .setIcon("trash")
        .onClick(async () => {
          const what =
            kind === "meristem"
              ? `${targets.length} branches and everything inside them`
              : `${targets.length} notes`;
          const ok = await confirm(this.app, "Delete", `Move ${what} to trash?`, "Delete");
          if (!ok) return;
          this.closeHud();
          try {
            for (const n of selection) {
              // Re-resolve at ACTION time — the menu may have sat open while an
              // agent deleted/moved a member (spec: skipped, not fatal); a
              // failing trash of one target must not abort the rest.
              const { file, folder } = this.resolveNodeFile(n);
              const target = folder ?? file;
              if (!target) continue;
              try {
                await this.app.fileManager.trashFile(target); // honours the user's trash preference
              } catch {
                // target vanished mid-flight — skip, keep going
              }
            }
          } finally {
            this.clearMultiSelection();
          }
        }),
    );
    menu.addSeparator();
    // Every files-menu contributor's bulk items (see the single menu's
    // file-menu trigger for why the explorer source tag is passed).
    this.app.workspace.trigger("files-menu", menu, targets, "file-explorer-context-menu", this.leaf);
    menu.showAtMouseEvent(evt);
  }

  /** "Rename…" — the core explorer's inline rename isn't exposed via the
   *  file-menu event, so we prompt + renameFile. A meristem renames its folder
   *  (the folder-note follows via the rename-sync handler in main.ts). */
  private async renameNode(node: NodeRef): Promise<void> {
    const { file, folder } = this.resolveNodeFile(node);
    const target = folder ?? file;
    if (!target) return;
    const current = folder ? folder.name : file!.basename;
    const name = await promptForName(this.app, "Rename", current);
    if (!name || name === current) return;
    const parent = target.parent && target.parent.path !== "/" ? `${target.parent.path}/` : "";
    const dest = folder ? `${parent}${name}` : `${parent}${name}.${file!.extension}`;
    if (this.app.vault.getAbstractFileByPath(dest)) {
      new Notice(`Liefwork: "${name}" already exists here.`);
      return;
    }
    await this.app.fileManager.renameFile(target, dest);
  }

  /** "Duplicate" a lief — core explorer's duplicate isn't surfaced via the
   *  file-menu event. Copies to "<name> N.<ext>", deduping the suffix. */
  private async duplicateFile(file: TFile): Promise<void> {
    const dir = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
    let n = 1;
    let dest = `${dir}${file.basename} ${n}.${file.extension}`;
    while (this.app.vault.getAbstractFileByPath(dest)) {
      n += 1;
      dest = `${dir}${file.basename} ${n}.${file.extension}`;
    }
    await this.app.vault.copy(file, dest);
  }

  /** Create a new child branch under a meristem: prompt for a name, then make the
   *  folder + its folder-note (summary) + one blank starter lief, and select it. */
  private async createChildBranch(node: NodeRef): Promise<void> {
    const { folder } = this.resolveNodeFile(node);
    if (!folder) return;
    const name = await promptForName(this.app, "New child branch");
    if (!name) return;
    const parent = folder.path === "/" || folder.path === "" ? "" : folder.path;
    const paths = childBranchPaths(parent, name);
    // Warn on a same-name sibling branch (mirrors the note-name collision warning).
    if (this.app.vault.getAbstractFileByPath(paths.folder)) {
      const existing = paths.folder.slice(paths.folder.lastIndexOf("/") + 1);
      new Notice(`Liefwork: a branch named "${existing}" already exists here.`);
      return;
    }
    try {
      if (!this.app.vault.getAbstractFileByPath(paths.folder)) {
        await this.app.vault.createFolder(paths.folder);
      }
      const base = paths.folderNote.slice(paths.folderNote.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      // Stamp the meristem folder-note with created + order (order = this branch's
      // position among the PARENT's children) — otherwise it's an un-ordered
      // sibling that drops the whole parent branch to ctime sorting.
      const branchOrder = nextOrder(this.siblingOrders(parent));
      await this.app.vault.create(paths.folderNote, liefNoteContent(`# ${base}`, nowISO(), branchOrder));
      // Born empty (§2): no starter lief. Select the new BRANCH once the
      // watcher's rebuild lands — its meristem's hierarchyId IS the folder path
      // (node ids come from FolderNode.path), so framing targets the folder.
      // The branch name was just typed in the prompt, so no title-edit handoff.
      this.pendingSelectPath = paths.folder;
    } catch (err) {
      new Notice(`Liefwork: couldn't create the branch — ${(err as Error).message}`);
    }
  }

  /** Convert a lief into a branch, born EMPTY: create the folder and rename the
   *  lief's note into it as the folder-note. No child is added — the old note
   *  becomes the meristem; adding content is a separate, deliberate step
   *  (mirrors the born-empty createChildBranch). */
  private async promoteToBranch(node: NodeRef): Promise<void> {
    const { file } = this.resolveNodeFile(node);
    if (!file) return;
    const plan = liefNotePlan(file.path, true);
    if (!plan.promote) return;
    // Same-name guard: refuse rather than silently merge into a pre-existing
    // folder of the same name (mirrors createChildBranch's sibling guard).
    if (this.app.vault.getAbstractFileByPath(plan.promote.folder)) {
      const name = plan.promote.folder.slice(plan.promote.folder.lastIndexOf("/") + 1);
      new Notice(`Liefwork: a branch named "${name}" already exists here.`);
      return;
    }
    try {
      await this.app.vault.createFolder(plan.promote.folder);
      await this.app.fileManager.renameFile(file, plan.promote.folderNote);
      // The new branch's meristem id IS the folder path — frame it post-rebuild.
      this.pendingSelectPath = plan.promote.folder;
    } catch (err) {
      new Notice(`Liefwork: couldn't promote — ${(err as Error).message}`);
    }
  }

  /** Whether this branch's folder can be demoted to a note — safe only for a
   *  non-root folder holding just its folder-note. Wraps the pure predicate and
   *  adds the root guards (never the vault root or the coral's own root). */
  private canDemote(folder: TFolder): boolean {
    if (folder.parent == null) return false;              // vault root
    if (folder.path === this.folderPath) return false;    // the coral's own root
    const notePath = folderNotePath(folder.path, folder.name, this.app.vault.getName());
    return canDemoteBranch(folder.children.map((c) => c.path), notePath);
  }

  /** Demote a branch back to a single note (the inverse of promote): rename the
   *  folder-note out to a loose note (content + created/order preserved, so its
   *  position is unchanged), then trash the now-empty folder. Only valid when
   *  canDemote(folder) — the menu item is gated on it. */
  private async demoteToLief(node: NodeRef): Promise<void> {
    const { file, folder } = this.resolveNodeFile(node);
    if (!folder || !file || !this.canDemote(folder)) return; // file = the folder-note
    const parent = folder.parent!;
    const target = parent.isRoot() ? `${folder.name}.md` : `${parent.path}/${folder.name}.md`;
    if (this.app.vault.getAbstractFileByPath(target)) {
      new Notice(`Liefwork: a note named "${folder.name}" already exists here.`);
      return;
    }
    try {
      await this.app.fileManager.renameFile(file, target); // folder-note → loose note
      await this.app.fileManager.trashFile(folder);        // empty folder → user's trash
      this.pendingSelectPath = target;
    } catch (err) {
      new Notice(`Liefwork: couldn't demote — ${(err as Error).message}`);
    }
  }

  /** Open a color-coded terminal for this meristem's branch and register the
   *  binding that drives the tint + tab color. */
  private async openAgentTerminal(node: NodeRef): Promise<void> {
    const { folder } = this.resolveNodeFile(node);
    if (!folder) return;
    const branchPath = folder.path === "/" ? "" : folder.path;
    // No Terminal plugin, no command — said plainly, and said FIRST. This
    // command used to run its whole course without one: it asked for a color,
    // opened nothing, and bound the branch anyway, leaving a tint with no
    // terminal behind it and nothing able to clear it (founder, 27 July).
    if (!isTerminalPluginAvailable(this.app)) {
      tellUser(
        this.app,
        "Terminal plugin required",
        "This command requires the Terminal community plugin to be installed and enabled.",
      );
      return;
    }
    // Same-branch guard: running two agents on one branch is poor hygiene, so
    // confirm before adding a second (the colors will combine if they proceed).
    if (this.store.bindingsForBranch(branchPath).length > 0) {
      const ok = await confirm(
        this.app,
        "Second agent on this branch?",
        `"${folder.name || "Vault"}" already has an agent terminal. Running two agents on the same branch is generally not recommended. Open another anyway?`,
        "Open anyway",
      );
      if (!ok) return;
    }
    const inUse = this.store.all().map((b) => b.color);
    // A free rotation draws from the five accents only — the auto-assigned
    // color must always be one the user could pick by hand.
    const auto = nextAgentColor(inUse, this.perks.isPro() ? AGENT_COLORS : FREE_AGENT_COLORS);
    const color = await promptForColor(this.app, "Open agent terminal", auto, this.perks.isPro(), {
      get: () => this.perks.spectralPulseSetting(),
      set: (on) => this.perks.setSpectralPulse(on),
    });
    if (color === null) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return; // non-desktop adapter: no terminal to open
    const absPath = adapter.getFullPath(folder.path === "/" ? "" : folder.path);
    const leaf = await openIntegratedTerminal(this.app, absPath);
    const outcome = agentTerminalOutcome({
      pluginAvailable: isTerminalPluginAvailable(this.app),
      leaf,
    });
    if (outcome.kind === "bind") {
      this.store.create({ branchPath, color, leaf, launchedVia: outcome.launchedVia });
      return;
    }
    // The plugin is there but produced no terminal — no integrated profile for
    // this platform, or the launch came back invalid. Say so and bind nothing:
    // a tint whose terminal never existed can never be closed away.
    tellUser(
      this.app,
      "No terminal opened",
      "The Terminal plugin is enabled but couldn't open an integrated terminal here — check that it has an integrated profile configured for this platform.",
    );
  }

  /** Re-apply the Pro perks (+ the free selection-magnify setting) to the live
   *  mount — called by main.ts when the spectral-pulse setting, the Pro
   *  entitlement, or the selection-magnify setting flips, so open corals
   *  follow without a rebuild. */
  applyPerks(): void {
    this.mount?.setSpectralShift(this.perks.spectralShift());
    this.mount?.setSelectionLight(this.display.selectionMagnify());
  }

  /** Push new text-sizing knobs onto the live mount — an in-place redraw (no
   *  plant rebuild, no camera move), so slider drags track instantly. Called
   *  by main.ts on every setTextSizing. A view with no mount yet (opened
   *  hidden / never rendered) falls back to a full refresh, which reads the
   *  current knobs at mount time anyway. */
  applyTextSizing(sizing: TextSizingSettings): void {
    if (this.mount) {
      this.mount.setSizingKnobs({
        optimalSize: sizing.optimalSize,
        liefOptimalSize: sizing.liefOptimalSize,
        attentionPropagationDecay: sizing.attentionPropagationDecay,
        subtreeBoost: sizing.subtreeBoost,
        // Couple the crowding ceiling to the lief-size slider (see
        // liefMaxLiftForOptimalSize) so dragging it actually grows liefs.
        liefMaxLift: liefMaxLiftForOptimalSize(sizing.liefOptimalSize),
      });
    } else {
      this.refresh();
    }
  }

  private devPanel: { destroy: () => void } | null = null;
  /** Dev-panel engine overrides for THIS view — session-only, applied over the
   *  shipped tuning in buildPlant; a set rebuilds through refresh(). */
  private engineKnobOverrides: Partial<EngineKnobs> = {};

  /** The viewer's tuning panel (dev-panel.ts), hosted inside this coral pane.
   *  Off by default, toggled from the command palette; torn down with the mount
   *  so a refresh or a window migration can't leave a stale panel behind.
   *  Returns the new state (true = now showing). */
  toggleDevPanel(): boolean {
    if (this.devPanel) {
      this.devPanel.destroy();
      this.devPanel = null;
      return false;
    }
    if (!this.mount || !this.plantEl) return false;
    // The host must be a positioning context — the panel is absolute inside it.
    this.plantEl.style.position = this.plantEl.style.position || "relative";
    this.devPanel = installDevPanel(this.mount, {
      container: this.plantEl,
      // The plugin mount has no live engine config (buildPlant runs per
      // refresh), so the view serves the engine group itself: sliders seed
      // from the config the coral was actually built with, a drag rebuilds.
      engine: {
        get: () => engineKnobsOf(applyEngineKnobs(coralEngineConfig(this.display.style()), this.engineKnobOverrides)),
        set: (k) => {
          this.engineKnobOverrides = { ...this.engineKnobOverrides, ...k };
          this.refresh();
        },
      },
    });
    return true;
  }

  private destroyDevPanel(): void {
    this.devPanel?.destroy();
    this.devPanel = null;
  }

  /** Rebuild + re-render in place (called by the watcher). */
  refresh(): void {
    if (!this.isVisible()) {
      this.deferRefresh();
      return;
    }
    // Never update() a mount that has migrated windows — its observers/clocks
    // belong to the old window; rebuild it in the new one instead.
    if (this.remountIfMigrated()) return;
    const { plant, message } = this.buildPlant();
    if (!plant) {
      // e.g. the folder grew past the node cap or was deleted mid-session —
      // replace the stale plant with the explanation rather than hang.
      this.destroyDevPanel();
      this.mount?.destroy();
      this.mount = null;
      this.ensureShell();
      this.plantEl!.empty();
      this.plantEl!.setText(message ?? "Liefwork: could not build coral");
      return;
    }
    if (this.mount) {
      this.mount.update(plant);
      // Re-push agent tints: update() resets block/branch IDs, so any tints
      // applied before the rebuild are now stale and must be reapplied.
      this.mount.setAgentTints(this.store.colorsByBranchPath());
      // Same staleness problem for the seed-badge set — and this is the path
      // Seed/De-seed's rebuild takes, so the badge appears/disappears
      // right here with no extra file-watcher listener needed.
      this.pushSeedBadges();
      // Re-focus a just-grown lief once its rebuilt block exists: opens the HUD
      // for it and frames its parent branch (rAF so the refit/layout settle
      // first), instead of leaving the view zoomed out to the whole plant.
      if (this.pendingSelectPath) {
        const path = this.pendingSelectPath;
        this.pendingSelectPath = null;
        // A programmatic single-select supersedes any multi-selection — a stale
        // set would raise a ghost bulk menu.
        this.multiSelection = [];
        this.contentEl.win.requestAnimationFrame(() => this.selectByPath(path));
      } else if (this.multiSelection.length > 0) {
        // Multi-selection survives the rebuild: re-apply the highlight to the
        // members whose paths still resolve; deleted/moved members simply
        // leave the set. highlightNodes never frames — a background vault
        // change must never yank the camera (standing rule). rAF so the
        // rebuild settles first.
        const livePaths = new Set(
          plant.blocks
            .map((b) => (b as { hierarchyId?: string }).hierarchyId)
            .filter((p): p is string => typeof p === "string"),
        );
        this.multiSelection = [...surviveRefresh(this.multiSelection, livePaths)];
        this.contentEl.win.requestAnimationFrame(() => {
          const refs = this.mount?.highlightNodes(this.multiSelection.map((s) => s.hierarchyId));
          if (refs) this.multiSelection = refs;
        });
      } else if (this.selectedNode) {
        // Selection survives the rebuild: mount.update() cleared the canvas
        // highlight, so re-apply it if the selected node still resolves in the
        // new tree; otherwise it was deleted/moved — drop the selection AND the
        // HUD so no stale HUD lingers. (No pendingSelectPath re-focus in play.)
        const path = this.selectedNode.hierarchyId;
        const newPaths = plant.blocks
          .map((b) => (b as { hierarchyId?: string }).hierarchyId)
          .filter((p): p is string => typeof p === "string");
        if (selectionAfterRefresh(path, newPaths) === "reselect") {
          // Re-highlight ONLY — highlightNode never moves the camera. A refresh is
          // driven by a background vault change (agents writing files), and
          // selection must never yank the view (standing rule); selectNode would
          // re-frame the branch. Keep the HUD DOM as-is so a half-typed draft is
          // preserved. rAF so the rebuild settles first.
          this.contentEl.win.requestAnimationFrame(() => {
            const ref = this.mount?.highlightNode(path);
            if (ref) this.selectedNode = ref;
          });
        } else {
          this.closeHud(); // clears selectedNode + hides the HUD
        }
      }
    } else {
      this.pendingSelectPath = null;
      this.rerender(); // never mounted (view opened while hidden)
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  /** Double-click: zoom-to-fit the node's branch — the one gesture that moves
   *  the camera (single-click deliberately never does). Previously this opened
   *  the note, duplicating single-click's HUD-off behaviour and so reading as a
   *  dead gesture in the sidebar. */
  private onNodeDoubleClick(node: NodeRef): void {
    if (nodeAction(this.hudEnabled(), "double") !== "fit") return;
    this.mount?.frameNode(node.branchId);
  }

  /** Single-click. In sidebar/HUD-off mode: open the note (explorer parity). In
   *  HUD-on mode: open/refresh the HUD for the node. Never moves the camera —
   *  framing is explicit only (Full view / Reveal in Coral / double-click). */
  private onNodeClick(node: NodeRef): void {
    // A plain click collapses any cmd-click multi-selection back to the
    // single-select world (the renderer's own selectGroup already repainted
    // the highlight down to just this node).
    this.multiSelection = [];
    // All-files (§4): a non-md lief has no markdown HUD (its affordances are all
    // markdown edits) — always open it natively in Obsidian's own viewer, in
    // both HUD-on and HUD-off modes. A folder resolves to its .md folder-note,
    // so meristems are never caught here.
    const { file } = this.resolveNodeFile(node);
    if (file && file.extension !== "md") {
      void this.openNote(node);
      return;
    }
    // Explorer parity: when the HUD is off (the sidebar default), a single click
    // opens the note in the main editor area instead of the inline HUD.
    if (nodeAction(this.hudEnabled(), "single") === "open") {
      void this.openNote(node);
      return;
    }
    // Draft-safe: re-clicking the node the HUD already shows must NOT rebuild it
    // — renderHud does hud.empty(), which would destroy a half-typed add-a-lief
    // draft. selectedNode is nulled on close, so an equal id here means the HUD
    // is open on this very node; leave its DOM (and the draft) untouched.
    if (
      this.selectedNode?.hierarchyId === node.hierarchyId &&
      this.hudEl &&
      this.hudEl.style.display !== "none"
    ) {
      return;
    }
    this.selectedNode = node;
    this.renderHud(node);
    this.hudEl!.show();
    // A single click NEVER moves the camera — selecting keeps the view put (user
    // preference, 1 July). Camera moves are explicit only: "Full view" (whole
    // coral) and "Reveal in Coral" (zoom-to-fit a branch). This also removes the
    // double-click zoom-out: the leading single-click of a double-click used to
    // frame a meristem's branch (the whole coral for a near-root meristem).
    void this.renderSummary(node).catch((e) => console.error("[liefwork] HUD summary failed", e));
  }

  private closeHud(): void {
    this.selectedNode = null;
    this.hudEl?.hide();
  }

  /** Cmd/ctrl-click (renderer additive channel): toggle `node` in the
   *  multi-selection — rules in multi-select.ts (homogeneous kinds; branch
   *  sets = independent subtrees: covered descendant → no-op, ancestor →
   *  absorb). Never opens a note, never moves the camera. At ≥2 the HUD
   *  closes; the renderer highlight always mirrors the computed set. */
  private onAdditiveClick(node: NodeRef): void {
    // Seed from the HUD's single selection so a first cmd-click EXTENDS it.
    const current: NodeRef[] =
      this.multiSelection.length > 0
        ? this.multiSelection
        : this.selectedNode
          ? [this.selectedNode]
          : [];
    const next = [...toggleSelection(current, node)];
    this.multiSelection = next;
    // The HUD tracks a node only while that node is in the selection: close it
    // when its node leaves the set (toggle-off, kind-flip, or size ≥ 2 — the
    // HUD is a single-node instrument). Also prevents a toggled-off node being
    // resurrected by the next additive click's selectedNode seed.
    if (this.selectedNode && !isInSelection(next, this.selectedNode.hierarchyId)) this.closeHud();
    if (next.length >= 2) this.closeHud();
    this.mount?.highlightNodes(next.map((n) => n.hierarchyId));
  }

  /** Drop the multi-selection and its highlight (plain click / Esc / bulk
   *  action done / right-click outside the selection). */
  private clearMultiSelection(): void {
    if (this.multiSelection.length === 0) return;
    this.multiSelection = [];
    this.mount?.highlightNodes([]);
  }

  /** Switch the HUD width mode (persisted via view state). Updates the width
   *  class + the active-button state without rebuilding the HUD (so a half-typed
   *  lief isn't lost). The width change resizes the plant area → the canvas
   *  ResizeObserver redraws and keeps hit targets aligned. */
  private setHudMode(mode: "narrow" | "rect" | "square"): void {
    this.hudMode = mode;
    this.applyHudMode();
    this.hudEl
      ?.querySelectorAll<HTMLElement>(".liefwork-hud-modes button")
      .forEach((b) => b.toggleClass("is-active", b.getAttribute("data-mode") === mode));
    this.app.workspace.requestSaveLayout(); // persist the choice
  }

  private applyHudMode(): void {
    const el = this.hudEl;
    if (!el) return;
    el.toggleClass("is-rect", this.hudMode === "rect");
    el.toggleClass("is-square", this.hudMode === "square");
    // narrow = neither modifier class (the default 320px flex-basis).
  }

  /** Build the HUD chrome for `node`: title, open-note, summary slot, add-a-lief. */
  private renderHud(node: NodeRef): void {
    const hud = this.hudEl!;
    hud.empty();

    const header = hud.createDiv({ cls: "liefwork-hud-header" });
    header.createDiv({ cls: "liefwork-hud-title", text: node.name });
    // Archived badge: show when the selected node is inside an _archive branch
    if (this.isInsideArchive(node)) {
      header.createSpan({ cls: "liefwork-hud-archived", text: "(Archived)" });
    }
    // Width-mode toggle: icon-only buttons (narrow / portrait-golden / square).
    const modes = header.createDiv({ cls: "liefwork-hud-modes" });
    const mkMode = (mode: "narrow" | "rect" | "square", icon: string, label: string): void => {
      const b = modes.createEl("button");
      setIcon(b, icon);
      b.setAttribute("data-mode", mode);
      b.setAttribute("aria-label", label);
      b.setAttribute("title", label);
      b.toggleClass("is-active", this.hudMode === mode);
      b.onclick = () => this.setHudMode(mode);
    };
    mkMode("narrow", "panel-right", "Narrow");
    mkMode("rect", "rectangle-vertical", "Portrait (golden)");
    mkMode("square", "square", "Square");
    const close = header.createEl("button", { cls: "liefwork-hud-close", text: "✕" });
    close.setAttribute("aria-label", "Close");
    close.onclick = () => this.closeHud();
    this.applyHudMode();

    const open = hud.createEl("button", { cls: "liefwork-hud-open", text: "Open note ↗" });
    open.onclick = () => void this.openNote(node);

    this.hudSummaryEl = hud.createDiv({ cls: "liefwork-hud-summary" });
    this.hudSummaryEl.setText("Loading…");

    const add = hud.createDiv({ cls: "liefwork-hud-add" });
    const input = add.createEl("textarea", { cls: "liefwork-hud-input" });
    input.placeholder = "Write a note to add under this node…";

    // On a lief, adding a note defaults to a SIBLING on the same parent branch
    // (responding to a note shouldn't branch it — else everything goes
    // branch-branch-branch). Ticking "branch off" promotes the lief to a
    // meristem and nests the new note under it. (Meristems: no choice — the
    // note always goes in the folder.)
    let branchToggle: HTMLInputElement | null = null;
    if (node.kind === "lief") {
      const opt = add.createDiv({ cls: "liefwork-hud-add-option" });
      const lbl = opt.createEl("label", { cls: "liefwork-hud-branch-label" });
      branchToggle = lbl.createEl("input", { type: "checkbox" });
      lbl.createSpan({ text: "Branch off this note" });
      lbl.setAttribute(
        "title",
        "Off: add the new note alongside this one, on the same branch. " +
          "On: turn this note into a sub-branch and nest the new note under it.",
      );
    }
    const promote = (): boolean => branchToggle?.checked ?? false;

    const buttons = add.createDiv({ cls: "liefwork-hud-add-buttons" });
    const addBtn = buttons.createEl("button", { cls: "liefwork-hud-add-note", text: "Add note" });
    const addOpenBtn = buttons.createEl("button", {
      cls: "liefwork-hud-add-open mod-cta",
      text: "Add note & open",
    });
    addBtn.onclick = () => void this.submitLief(node, input, false, promote());
    addOpenBtn.onclick = () => void this.submitLief(node, input, true, promote());
    // ⌘/Ctrl+Enter = Add note; add ⇧ to also open it in the editor.
    input.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void this.submitLief(node, input, e.shiftKey, promote());
      }
    });

    const footer = hud.createDiv({ cls: "liefwork-hud-footer" });

    const prev = footer.createEl("button", { cls: "liefwork-hud-prev", text: "← Previous item" });
    prev.setAttribute(
      "title",
      "Open the previous item in reading order — the mirror of Next item.",
    );
    prev.onclick = () => this.selectPrevItem();

    const centre = footer.createEl("button", { cls: "liefwork-hud-centre", text: "Centre" });
    centre.setAttribute("title", "Bring this item back to the middle of the view.");
    centre.onclick = () => {
      if (this.selectedNode) this.mount?.selectNode(this.selectedNode.hierarchyId);
    };

    const next = footer.createEl("button", { cls: "liefwork-hud-next", text: "Next item →" });
    next.setAttribute(
      "title",
      "Open the next item in reading order: a branch's meristem, then its liefs oldest→newest, descending into sub-branches.",
    );
    next.onclick = () => this.selectNextItem();
  }

  /** Move the cursor one step along the reading walk (see `traversalOrder`):
   *  meristem, then liefs oldest→newest, descending into sub-branches and back.
   *  `dir` 1 = next (older→younger), -1 = previous. Skips ids absent from the
   *  current plant; clamps at the ends. */
  private moveCursor(dir: 1 | -1): void {
    if (!this.mount) return;
    for (const id of stepTraversal(this.traversalIds, this.selectedNode?.hierarchyId ?? null, dir)) {
      const ref = this.mount.selectNode(id);
      if (!ref) continue;
      // mount.selectNode only highlights + frames — it deliberately does NOT
      // notify the host, so advance our own selection state and the HUD here;
      // otherwise the next press recomputes from the stale node and the walk
      // stalls on its first step.
      // Collapse any cmd-click multi-selection to the host array only — the
      // renderer's selectGroup (inside selectNode above) has ALREADY repainted
      // the highlight + lit set down to this single node, so calling
      // clearMultiSelection()'s mount.highlightNodes([]) here would wipe the
      // ring and magnification off the node we just framed. Same pattern as
      // onNodeClick.
      this.multiSelection = [];
      this.selectedNode = ref;
      this.renderHud(ref);
      this.hudEl?.show();
      // .catch is defence-in-depth: renderSummary is internally guarded and no
      // longer rejects, but an escaping rejection here would be uncaught in a
      // pop-out window's renderer — the crash class this whole guard prevents.
      void this.renderSummary(ref).catch((e) => console.error("[liefwork] HUD summary failed", e));
      return;
    }
  }

  private selectNextItem(): void { this.moveCursor(1); }
  private selectPrevItem(): void { this.moveCursor(-1); }

  /** Read the node's MD body (minus frontmatter) and render it into the HUD. */
  private async renderSummary(node: NodeRef): Promise<void> {
    const target = this.hudSummaryEl;
    if (!target) return;
    const { file, folder } = this.resolveNodeFile(node);
    target.empty();
    if (!file) {
      target.createEl("em", {
        text: folder
          ? "No note yet — “Open note” or add a lief to create it."
          : "No note found for this node.",
      });
      return;
    }
    // Non-markdown files must NEVER be read as text: cachedRead would decode an
    // image's bytes as UTF-8 and MarkdownRenderer would parse the garbage —
    // wingding glyphs in the main window, a dead renderer process in a pop-out
    // (its async post-processors touch the child window's realm). Show an inline
    // preview for images, a name/type card for everything else.
    const kind = classifyHudFile(file.extension);
    if (kind !== "markdown") {
      if (kind === "image") {
        // The vault resource path is an app:// URL that resolves in any window;
        // the <img> is built in the HUD's own document. onerror falls back to
        // the card so a path that won't load can never leave the slot broken.
        const img = target.createEl("img", { cls: "liefwork-hud-image" });
        img.onerror = () => {
          if (this.selectedNode !== node || this.hudSummaryEl !== target) return;
          target.empty();
          this.renderNonMdCard(target, file);
        };
        img.src = this.app.vault.getResourcePath(file);
      } else {
        this.renderNonMdCard(target, file);
      }
      return;
    }
    // Markdown: read + render, wrapped so a throw can't escape as an unhandled
    // rejection into a pop-out window (this path never had a catch).
    try {
      const body = stripFrontmatter(await this.app.vault.cachedRead(file)).trim();
      if (this.selectedNode !== node) return; // a move landed elsewhere mid-read
      if (!body) {
        target.createEl("em", { text: "(Empty note)" });
        return;
      }
      await MarkdownRenderer.render(this.app, body, target, file.path, this);
    } catch {
      if (this.selectedNode !== node || this.hudSummaryEl !== target) return;
      target.empty();
      target.createEl("em", { text: "(Couldn't render this note.)" });
    }
  }

  /** The HUD summary for a non-markdown file: its type, and that it opens in
   *  Obsidian. Never reads the file — see renderSummary's non-md guard. */
  private renderNonMdCard(target: HTMLElement, file: TFile): void {
    target.createEl("em", { text: `${file.extension.toUpperCase()} file — open it to view in Obsidian.` });
  }

  /** Double-click / "Open note": open the node's MD in an editor, creating the
   *  folder-note on demand for a meristem that doesn't have one yet. */
  private async openNote(node: NodeRef): Promise<void> {
    const { file, folder } = this.resolveNodeFile(node);
    let target = file;
    if (!target && folder) {
      target = await this.app.vault.create(
        folderNotePath(folder.path, folder.name, this.app.vault.getName()),
        `# ${folder.name || this.app.vault.getName()}\n`,
      );
    }
    if (!target) {
      new Notice("Liefwork: no note for this node.");
      return;
    }
    await this.openInEditor(target);
  }

  /** Add a note under `node`. `open` also opens it in Obsidian's editor (for a
   *  richer note than the inline box). Either way the plant rebuilds and the
   *  new note is re-selected in the HUD + framed. */
  private async submitLief(
    node: NodeRef,
    input: HTMLTextAreaElement,
    open: boolean,
    promote: boolean,
  ): Promise<void> {
    const text = input.value.trim();
    // Empty box: "Add note & open" behaves like Obsidian's New Note — create an
    // "Untitled" note and open it to edit. Empty + plain "Add note" is a no-op
    // (nothing to file, and an unopened empty note is just clutter).
    if (!text && !open) return;
    try {
      const newPath = await this.addLief(node, text, promote);
      input.value = "";
      // The vault `create`/`rename` fires the watcher → the plant rebuilds and
      // the new lief unfurls at the tip. Re-select it once that lands so the
      // view settles on the new growth instead of zooming out to the whole plant.
      this.pendingSelectPath = newPath;
      if (open) {
        const file = this.app.vault.getAbstractFileByPath(newPath);
        if (file instanceof TFile) await this.openInEditor(file);
      }
    } catch (err) {
      new Notice(`Liefwork: couldn't add the note — ${(err as Error).message}`);
    }
  }

  /** Open a note in an editor leaf — reuse an existing markdown pane if there is
   *  one, else a fresh tab beside the plant (so we don't spawn a tab each time). */
  private async openInEditor(file: TFile): Promise<WorkspaceLeaf> {
    const leaf = this.leafForNoteOpen();
    await leaf.openFile(file, { active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** Which leaf a note opens into — mirrors the file explorer.
   *  - Main-area / pop-out plant: a sibling tab, so opening a note never
   *    replaces the plant itself.
   *  - Sidebar plant: the MAIN editor area (never the sidebar). Reuse the main
   *    area's active tab, UNLESS it's pinned — then the pinned note stays put
   *    and this note opens in a new main-area tab beside it. `getMostRecentLeaf`
   *    on the root split finds that tab even though the sidebar plant is active. */
  /** Open a note in a NEW tab (used by "New note/lief"). From a sidebar coral
   *  the tab lands in the MAIN editor area (activate a main leaf first so
   *  getLeaf("tab") doesn't open it inside the sidebar). */
  private async openNoteInNewTab(file: TFile): Promise<void> {
    const ws = this.app.workspace;
    if (this.placement() === "sidebar") {
      const main = ws.getMostRecentLeaf(ws.rootSplit);
      if (main) ws.setActiveLeaf(main, { focus: false });
    }
    await ws.getLeaf("tab").openFile(file, { active: true });
  }

  private leafForNoteOpen(): WorkspaceLeaf {
    const ws = this.app.workspace;
    if (this.placement() !== "sidebar") {
      // getLeaf("tab") resolves against the app-global active leaf — and a
      // click on the coral CANVAS never moves leaf focus, so for a pop-out
      // coral that can be a leaf in ANOTHER window: the editor then opens
      // over there and steals OS focus from this window (16 July — the
      // pop-out's new-branch starter lief opened in the main window; the
      // occluded pop-out froze until refocused). Re-anchor to this leaf
      // first, so the tab lands in the coral's OWN window. Same-window
      // active leaves keep today's behaviour (tab beside the last editor).
      const activeDoc = ws.getMostRecentLeaf()?.view?.containerEl?.ownerDocument;
      const sameWindow = activeDoc === this.contentEl.ownerDocument;
      if (noteOpenNeedsReanchor(this.placement(), sameWindow)) {
        ws.setActiveLeaf(this.leaf, { focus: false });
      }
      return ws.getLeaf("tab");
    }

    const main = ws.getMostRecentLeaf(ws.rootSplit);
    if (!main) return ws.getLeaf("tab");
    if (main.getViewState().pinned) {
      // Activate the main group so the new tab lands there, not in the sidebar.
      ws.setActiveLeaf(main, { focus: false });
      return ws.getLeaf("tab");
    }
    return main;
  }

  /** Grow a new note for `node`, returning its path.
   *  - Meristem → a note in its folder (`promote` doesn't apply).
   *  - Lief, default → a **sibling** on the same parent branch (no branching).
   *  - Lief, `promote` → upgrade the lief to a meristem (its MD becomes the
   *    folder-note) and nest the new note under it. */
  private async addLief(node: NodeRef, text: string, promote: boolean): Promise<string> {
    const { file, folder } = this.resolveNodeFile(node);
    let targetFolder: string;
    if (folder) {
      // meristem — note goes in its folder (promote doesn't apply)
      targetFolder = folder.path === "/" || folder.path === "" ? "" : folder.path;
    } else if (file) {
      // lief — sibling by default, or promote it to a meristem first
      const plan = liefNotePlan(file.path, promote);
      if (plan.promote) {
        // upgrade the lief to a meristem: its MD becomes the folder-note (date
        // preserved), the new note becomes its first child. A lief becomes a
        // branch the moment it has one.
        if (!this.app.vault.getAbstractFileByPath(plan.promote.folder)) {
          await this.app.vault.createFolder(plan.promote.folder);
        }
        if (!this.app.vault.getAbstractFileByPath(plan.promote.folderNote)) {
          await this.app.fileManager.renameFile(file, plan.promote.folderNote);
        }
      }
      targetFolder = plan.targetFolder;
    } else {
      throw new Error("node has no note or folder");
    }
    // Empty text → an "Untitled" note with an empty body (the user titles +
    // writes it in the editor); otherwise a named note from the prompt text.
    const existing = this.existingMdNames(targetFolder);
    const name = text ? liefFilename(text, existing) : untitledFilename(existing);
    const path = targetFolder ? `${targetFolder}/${name}` : name;
    // Stamp durable frontmatter so the note carries its own `created`/`order`
    // (not riding the fragile fs timestamp). `order` appends after the branch's
    // current max so the new note lands at the tip.
    const order = nextOrder(this.siblingOrders(targetFolder));
    await this.app.vault.create(path, liefNoteContent(text, nowISO(), order));
    return path;
  }

  /** The note + folder behind a node: a lief resolves to its `.md`; a meristem
   *  to its folder (+ its folder-note if one exists). */
  private resolveNodeFile(node: NodeRef): { file: TFile | null; folder: TFolder | null } {
    const id = node.hierarchyId;
    const abstract =
      id === "/" || id === ""
        ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(id);
    if (abstract instanceof TFile) return { file: abstract, folder: null };
    if (abstract instanceof TFolder) {
      const note = this.app.vault.getAbstractFileByPath(
        folderNotePath(abstract.path, abstract.name, this.app.vault.getName()),
      );
      return { file: note instanceof TFile ? note : null, folder: abstract };
    }
    return { file: null, folder: null };
  }

  /** Existing `.md` filenames directly in `folderPath` (""=root) — for collision-free naming. */
  private existingMdNames(folderPath: string): string[] {
    const f =
      folderPath === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
    if (!(f instanceof TFolder)) return [];
    return f.children
      .filter((c): c is TFile => c instanceof TFile && c.extension === "md")
      .map((c) => c.name);
  }

  /** The `order` frontmatter values of the `.md` files directly in `folderPath`
   *  ("" = root) — to assign the next per-branch order for a new lief.
   *
   *  Includes BOTH loose `.md` liefs AND sub-branch folder-notes
   *  (`<subfolder>/<subfolder>.md`) so that `nextOrder` sees the true max and
   *  never stamps a new lief with an order that collides with or precedes an
   *  existing sub-branch. Mirrors the folder-note lookup in vault-adapter.ts
   *  `folderMeta()`. */
  private siblingOrders(folderPath: string): number[] {
    const f =
      folderPath === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
    if (!(f instanceof TFolder)) return [];
    const looseOrders: number[] = [];
    const subBranchOrders: number[] = [];
    for (const c of f.children) {
      if (c instanceof TFile && c.extension === "md") {
        // Skip the folder's OWN folder-note (`<folder>/<folder>.md`): its `order`
        // is this branch's position among its PARENT's children — a different
        // scope from the liefs we're numbering here. Counting it would inflate
        // (and mis-scope) the next lief's order.
        if (c.basename === f.name) continue;
        const o = resolveOrder(this.app.metadataCache.getFileCache(c)?.frontmatter?.order);
        if (o !== undefined) looseOrders.push(o);
      } else if (c instanceof TFolder) {
        // Resolve the sub-branch's folder-note: <subfolder>/<subfolder>.md
        const notePath = `${c.path}/${c.name}.md`;
        const note = this.app.vault.getAbstractFileByPath(notePath);
        if (note instanceof TFile) {
          const o = resolveOrder(this.app.metadataCache.getFileCache(note)?.frontmatter?.order);
          if (o !== undefined) subBranchOrders.push(o);
        }
      }
    }
    return collectBranchOrders(looseOrders, subBranchOrders);
  }

  /** Move a note/subtree into its parent branch's `_archive`, stamping restore
   *  metadata. Non-destructive — gentle confirm, no trash. */
  private async archiveNode(node: NodeRef): Promise<void> {
    const { file, folder } = this.resolveNodeFile(node);
    const target = folder ?? file;
    if (!target) return;
    const parentPath = target.parent?.path ?? "";
    const count = node.kind === "meristem" ? this.countDescendants(folder!) : 1;
    const what = node.kind === "meristem"
      ? `the branch "${node.name}" and all its contents (${count} items)`
      : `the note "${node.name}"`;
    const ok = await confirm(this.app, "Archive",
      `Archive ${what}? You can restore it later from the Archive branch.`, "Archive");
    if (!ok) return;

    const { archiveFolder, archiveNote } = archivePaths(parentPath);
    try {
      // --- 1. Capture original metadata BEFORE any mutation ---
      const origMetaFile = node.kind === "meristem" ? this.folderNoteFile(folder!) : file instanceof TFile ? file : null;
      const origFm = origMetaFile
        ? this.app.metadataCache.getFileCache(origMetaFile)?.frontmatter
        : undefined;
      const originalOrder = resolveOrder(origFm?.order) ?? nextOrder(this.siblingOrders(parentPath));
      const originalParent = parentPath;

      // --- 2. Ensure _archive folder + kind:archive folder-note exist ---
      if (!this.app.vault.getAbstractFileByPath(archiveFolder)) {
        await this.app.vault.createFolder(archiveFolder);
      }
      if (!this.app.vault.getAbstractFileByPath(archiveNote)) {
        await this.app.vault.create(archiveNote, archiveNoteContent());
      }

      // --- 3. Compute archive tip order BEFORE the move (entry not yet there) ---
      const archiveOrder = nextOrder(this.siblingOrders(archiveFolder));

      // --- 4. Move first — if this throws, nothing has been stamped ---
      const dest = `${archiveFolder}/${target.name}`;
      try {
        await this.app.fileManager.renameFile(target, dest);
      } catch (moveErr) {
        new Notice(`Liefwork: couldn't archive — ${(moveErr as Error).message}`);
        return;
      }

      // --- 5. Stamp restore metadata AFTER a successful move ---
      const movedAbstract = this.app.vault.getAbstractFileByPath(dest);
      const movedMetaFile = node.kind === "meristem"
        ? (movedAbstract instanceof TFolder ? this.folderNoteFile(movedAbstract) : null)
        : (movedAbstract instanceof TFile ? movedAbstract : null);
      if (movedMetaFile) {
        try {
          await this.app.fileManager.processFrontMatter(movedMetaFile, (fm: Record<string, unknown>) => {
            fm.originalOrder = originalOrder;
            fm.originalParent = originalParent;
            fm.archivedAt = nowISO();
            fm.order = archiveOrder; // spiral sequence = archive chronology
          });
        } catch {
          new Notice("Archived, but couldn't write restore metadata.");
        }
      }

      if (this.selectedNode?.hierarchyId === node.hierarchyId) this.closeHud();
      new Notice("Archived — restore from the archive branch.");
    } catch (err) {
      new Notice(`Liefwork: couldn't archive — ${(err as Error).message}`);
    }
  }

  /** Move an archived note/subtree back to its original parent branch, using the
   *  saved `originalParent` / `originalOrder` frontmatter keys stamped by
   *  `archiveNode`. Errors (missing parent, name clash) abort with a Notice and
   *  leave nothing moved. On success, strips the archive metadata and sets the
   *  restored `order`. */
  private async restoreNode(node: NodeRef): Promise<void> {
    const { file, folder } = this.resolveNodeFile(node);
    const target = folder ?? file;
    if (!target) return;
    const metaFile = folder ? this.folderNoteFile(folder) : file ?? null;
    const fm = metaFile ? this.app.metadataCache.getFileCache(metaFile)?.frontmatter : undefined;
    // `originalParent` missing from frontmatter → item wasn't archived via Liefwork
    if (!fm || !("originalParent" in fm)) {
      new Notice("Original branch no longer exists — use 'Move to…' to place it.");
      return;
    }
    const originalParent = typeof fm.originalParent === "string" ? fm.originalParent : "";
    const originalOrder = resolveOrder(fm?.originalOrder) ?? 0;
    // The vault root is not reachable via getAbstractFileByPath — use getRoot().
    const parentFolder =
      originalParent === "" || originalParent === "/"
        ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(originalParent);
    if (!(parentFolder instanceof TFolder)) {
      new Notice("Original branch no longer exists — use 'Move to…' to place it.");
      return;
    }
    const dest = `${originalParent ? originalParent + "/" : ""}${target.name}`;
    if (this.app.vault.getAbstractFileByPath(dest)) {
      new Notice("A note with this name already exists at the destination — rename it or use 'Move to…'.");
      return;
    }
    const newOrder = restoreOrder(originalOrder, this.siblingOrders(originalParent));
    try {
      await this.app.fileManager.renameFile(target, dest);
    } catch (err) {
      new Notice(`Liefwork: couldn't restore — ${(err as Error).message}`);
      return;
    }

    const moved = this.app.vault.getAbstractFileByPath(dest);
    const movedMeta = moved instanceof TFolder ? this.folderNoteFile(moved) : moved instanceof TFile ? moved : null;
    if (movedMeta) {
      try {
        await this.app.fileManager.processFrontMatter(movedMeta, (f: Record<string, unknown>) => {
          f.order = newOrder;
          delete f.archivedAt; delete f.originalParent; delete f.originalOrder;
        });
      } catch {
        new Notice("Restored, but couldn't clear archive metadata.");
      }
    }
    new Notice("Restored.");
  }

  /** Open the node's folder (or its parent for a lief) as a fresh coral view in a
   *  new tab — the same mechanism as the explorer's "Open as Liefwork coral". For
   *  the archive meristem this opens the `_archive` folder; for an archived entry
   *  it opens the entry's folder (or, for a bare note, its parent folder). */
  private async openAsCoral(node: NodeRef): Promise<void> {
    const { folder, file } = this.resolveNodeFile(node);
    const f = folder ?? file?.parent;
    if (!f) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: LIEFWORK_VIEW_TYPE,
      active: true,
      state: { folderPath: f.path },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Count the total number of files (recursively) inside a folder. Used to
   *  give the user an accurate "N items" count in the archive confirmation. */
  private countDescendants(folder: TFolder): number {
    let count = 0;
    const walk = (f: TFolder): void => {
      for (const child of f.children) {
        count++;
        if (child instanceof TFolder) walk(child);
      }
    };
    walk(folder);
    return count;
  }

  /** The folder-note file for a folder (`<folder>/<name>.md`), or null if it
   *  doesn't exist. Used by `archiveNode` to stamp restore metadata on a branch. */
  private folderNoteFile(folder: TFolder): TFile | null {
    const notePath = folderNotePath(folder.path, folder.name, this.app.vault.getName());
    const f = this.app.vault.getAbstractFileByPath(notePath);
    return f instanceof TFile ? f : null;
  }

  /** True if `folder`'s folder-note carries `kind: archive` (the engine's archive marker). */
  private folderIsArchive(folder: TFolder): boolean {
    const note = this.folderNoteFile(folder);
    if (!note) return false;
    return this.app.metadataCache.getFileCache(note)?.frontmatter?.kind === "archive";
  }

  /** True if this node IS an archive-branch meristem (its own folder is kind:archive). */
  private isArchiveMeristem(node: NodeRef): boolean {
    const { folder } = this.resolveNodeFile(node);
    return folder ? this.folderIsArchive(folder) : false;
  }

  /** True if this node lives INSIDE an archive branch (some ancestor folder is kind:archive). */
  private isInsideArchive(node: NodeRef): boolean {
    const { file, folder } = this.resolveNodeFile(node);
    let p: TFolder | null = (folder ?? file)?.parent ?? null;
    while (p) {
      if (this.folderIsArchive(p)) return true;
      p = p.parent;
    }
    return false;
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      this.refreshTimer.win.clearTimeout(this.refreshTimer.id);
      this.refreshTimer = null;
    }
    this.storeUnsub?.();
    this.storeUnsub = null;
    this.destroyDevPanel();
    this.mount?.destroy();
    this.mount = null;
    this.plantEl = this.hudEl = this.hudSummaryEl = null;
    this.selectedNode = null;
  }
}

/** Now, as a full ISO datetime (`2026-06-23T14:32:05.123Z`) — a new lief's
 *  `created`. Date+time (not date-only) so notes created on the same day get
 *  distinct, chronologically-sortable timestamps: the engine sorts `created`
 *  lexicographically, and ISO datetime sorts correctly. Without the time,
 *  same-day siblings tie on `created` and fall back to name (alphabetical). */
function nowISO(): string {
  return new Date().toISOString();
}

/** Drop a leading YAML frontmatter block, if present. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  const after = md.indexOf("\n", end + 1);
  return after === -1 ? "" : md.slice(after + 1);
}
