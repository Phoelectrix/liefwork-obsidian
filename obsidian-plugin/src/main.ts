import { Plugin, Notice, TFolder, TFile, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { PlantView, LIEFWORK_VIEW_TYPE } from "./plant-view.ts";
import { ancestorFolders } from "./lief-writer.ts";
import { pickFolderLevel } from "./name-prompt-modal.ts";
import {
  SeedCoralModal,
  readCoralFacts,
  applyLifecyclePlan,
  applyArchivePlan,
  deseedArchives,
  todayISO,
} from "./seed-coral-modal.ts";
import { classifyFolder, coralMenuActions, isPristinePointer, planDeseed, planReactivate } from "./coral-lifecycle.ts";
import { GROWTH_CHARTER_BASENAME, AGENT_POINTER_BASENAMES } from "./seed-templates.ts";
import { mergeKeeperHook, unmergeKeeperHook } from "./settings-merge.ts";
import { folderNoteSyncRename, folderRenameFromNote } from "./folder-note-sync.ts";
import { BindingStore } from "./binding-store.ts";
import { applyTabDeco, clearTabDeco } from "./terminal-tab-deco.ts";
import { branchPillLabel, TERMINAL_VIEW_TYPE } from "./terminal-integration.ts";
import { folderContains, pathsForVaultChange, renameInOpenCoral } from "./view-behavior.ts";
import { ProStore, type ProState } from "./pro.ts";
import { spectralShiftActive } from "./agent-colors.ts";
import { SupportPromptEngine, type SupportPromptState } from "./support-prompt.ts";
import { SUPPORT_PROMPTS } from "./support-prompt-copy.ts";
import { SupportPromptModal } from "./support-prompt-modal.ts";
import { IceCreamManModal } from "./ice-cream-man-modal.ts";
import { LiefworkSettingTab } from "./settings-tab.ts";
import { DEFAULT_TEXT_SIZING, mergeTextSizing, type TextSizingSettings } from "./text-sizing.ts";

/** Shape of the plugin's persisted data (loadData/saveData). */
interface LiefworkPluginData {
  pro?: ProState | null;
  supportPrompt?: SupportPromptState;
  /** Pro perk toggles (cosmetic; see agent-colors.ts). The raw user choice is
   *  persisted — the entitlement gate is applied at read time, so removing a
   *  key silences a perk without forgetting the preference. */
  perks?: { spectralPulse?: boolean };
  /** Coral text-sizing knobs (free accessibility feature; see text-sizing.ts). */
  display?: Partial<TextSizingSettings>;
  /** Coral ingest settings (§3/§4, folders-are-branches). Structural — changing
   *  either rebuilds every open coral. */
  showMeristemNotes?: boolean;
  allFiles?: boolean;
  /** Magnify the selected item (keyboard-cursor legibility, Task 5). Free —
   *  NOT nested under `perks` (that bag is Pro-gated cosmetic toggles only) —
   *  and default ON. */
  selectionMagnify?: boolean;
}

export default class LiefworkPlugin extends Plugin {
  readonly bindingStore = new BindingStore();
  /** Pro entitlement (see pro.ts). Validated once at activation time in the
   *  settings tab; from then on the persisted local state is trusted — the
   *  store never phones home on startup or on a schedule. */
  readonly proStore = new ProStore(async (state) => {
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.pro = state;
    await this.saveData(data);
  });

  /** Support-prompt pacing (see support-prompt.ts): stage / quiet / parity
   *  persist in plugin data; the once-per-session flag lives inside the engine. */
  readonly supportPrompt = new SupportPromptEngine(async (state) => {
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.supportPrompt = state;
    await this.saveData(data);
  });

  /** Whether Liefwork Pro is active — for the rest of the plugin to gate on
   *  (subscribe to proStore for the change signal). */
  isPro(): boolean {
    return this.proStore.isPro();
  }

  /** The user's raw spectral-pulse choice (what the settings toggle shows). */
  private spectralPulseSetting = false;

  getSpectralPulseSetting(): boolean {
    return this.spectralPulseSetting;
  }

  /** Effective spectral pulse — the perk runs only with an active entitlement. */
  spectralPulseEnabled(): boolean {
    return spectralShiftActive(this.isPro(), this.spectralPulseSetting);
  }

  /** Persist the spectral-pulse choice and push it to every open coral. */
  async setSpectralPulse(on: boolean): Promise<void> {
    this.spectralPulseSetting = on;
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.perks = { ...data.perks, spectralPulse: on };
    await this.saveData(data);
    this.applyPerksToOpenViews();
  }

  private applyPerksToOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
      if (leaf.view instanceof PlantView) leaf.view.applyPerks();
    }
  }

  /** Whether selecting a lief/branch also LIGHTS it on the coral — the
   *  engine's cursor emphasis (magnification, plus exemption from the lief
   *  crowding cap and the peak ceiling) applied to selection, which is what
   *  makes the keyboard cursor findable at a glance. Free (NOT Pro-gated,
   *  unlike spectral pulse) and default ON. */
  private selectionMagnifySetting = true;

  getSelectionMagnify(): boolean {
    return this.selectionMagnifySetting;
  }

  /** Persist the selection-magnify choice and push it to every open coral.
   *  Reuses applyPerksToOpenViews (→ PlantView.applyPerks), the same
   *  live-refresh path spectral pulse uses — it now pushes both settings. */
  async setSelectionMagnify(on: boolean): Promise<void> {
    this.selectionMagnifySetting = on;
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.selectionMagnify = on;
    await this.saveData(data);
    this.applyPerksToOpenViews();
  }

  /** The user's coral text-sizing knobs (free accessibility — not Pro-gated).
   *  Read at mount time via the view's DisplaySettingsAccess; changes are
   *  pushed live via applyTextSizing. */
  private textSizing: TextSizingSettings = { ...DEFAULT_TEXT_SIZING };

  getTextSizing(): TextSizingSettings {
    return this.textSizing;
  }

  /** Persist a text-sizing change and push it to every open coral instantly.
   *  The knobs are the renderer's own adaptive targets (mount.setSizingKnobs
   *  mutates the live styling config and redraws in place, no plant rebuild),
   *  so slider drags track live with no debounce. applyTextSizing falls back
   *  to a full refresh only for a view that has no mount yet. */
  async setTextSizing(patch: Partial<TextSizingSettings>): Promise<void> {
    this.textSizing = mergeTextSizing({ ...this.textSizing, ...patch });
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.display = { ...this.textSizing };
    await this.saveData(data);
    for (const leaf of this.app.workspace.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
      if (leaf.view instanceof PlantView) leaf.view.applyTextSizing(this.textSizing);
    }
  }

  /** Show each branch's folder-note as a base-pinned lief (§3). Structural. */
  private showMeristemNotes = false;
  /** Display non-md files as liefs (§4). Structural. */
  private allFilesMode = false;

  getShowMeristemNotes(): boolean { return this.showMeristemNotes; }
  getAllFiles(): boolean { return this.allFilesMode; }

  async setShowMeristemNotes(on: boolean): Promise<void> {
    this.showMeristemNotes = on;
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.showMeristemNotes = on;
    await this.saveData(data);
    this.refreshOpenViews();
  }

  async setAllFiles(on: boolean): Promise<void> {
    this.allFilesMode = on;
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    data.allFiles = on;
    await this.saveData(data);
    this.refreshOpenViews();
  }

  /** Rebuild every open coral — for structural settings that change the tree
   *  shape (unlike the text-sizing knobs, which redraw in place). */
  private refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
      if (leaf.view instanceof PlantView) leaf.view.refresh();
    }
  }

  async onload() {
    const data = ((await this.loadData()) ?? {}) as LiefworkPluginData;
    this.proStore.load(data.pro ?? null);
    this.supportPrompt.load(data.supportPrompt ?? null);
    this.spectralPulseSetting = data.perks?.spectralPulse === true;
    this.textSizing = mergeTextSizing(data.display);
    this.showMeristemNotes = data.showMeristemNotes === true;
    this.allFilesMode = data.allFiles === true;
    this.selectionMagnifySetting = data.selectionMagnify !== false; // default ON
    this.addSettingTab(new LiefworkSettingTab(this.app, this));

    // Activating/removing a key changes the EFFECTIVE perk state without the
    // setting toggle moving — re-push it to open corals on entitlement flips.
    this.register(this.proStore.subscribe(() => this.applyPerksToOpenViews()));

    this.registerView(
      LIEFWORK_VIEW_TYPE,
      (leaf) =>
        new PlantView(
          leaf,
          this.bindingStore,
          {
            isPro: () => this.isPro(),
            spectralShift: () => this.spectralPulseEnabled(),
            spectralPulseSetting: () => this.getSpectralPulseSetting(),
            setSpectralPulse: (on) => this.setSpectralPulse(on),
            openIceCreamMan: () => this.openIceCreamMan(),
            hasMetIceCreamMan: () => this.supportPrompt.hasMetIceCreamMan(),
          },
          {
            textSizing: () => this.getTextSizing(),
            setTextSizing: (patch) => this.setTextSizing(patch),
            showMeristemNotes: () => this.getShowMeristemNotes(),
            allFiles: () => this.getAllFiles(),
            selectionMagnify: () => this.getSelectionMagnify(),
          },
        ),
    );

    this.addRibbonIcon("sprout", "Open Liefwork coral (vault root)", () => {
      void this.openPlant("/");
    });

    this.addCommand({
      id: "open-coral",
      name: "Open coral for vault root",
      callback: () => { void this.openPlant("/"); },
    });

    this.addCommand({
      id: "open-coral-window",
      name: "Open coral for vault root in new window",
      callback: () => { void this.openPlant("/", "window"); },
    });

    // The viewer's tuning panel, hosted in the coral pane (dev-panel.ts). Kept
    // past the 21 July tuning session: it is how the shipped defaults get
    // re-tuned against a real vault, and "copy JSON" emits a fragment that
    // pastes straight into liefwork-defaults.ts.
    this.addCommand({
      id: "toggle-dev-panel",
      name: "Dev: toggle coral tuning panel",
      callback: () => {
        const views = this.app.workspace
          .getLeavesOfType(LIEFWORK_VIEW_TYPE)
          .map((leaf) => leaf.view)
          .filter((v): v is PlantView => v instanceof PlantView);
        if (views.length === 0) {
          new Notice("Liefwork: open a coral first");
          return;
        }
        // Toggle on the active coral if one is focused, else the first open one
        // — so the panel lands where you're looking in a multi-coral workspace.
        const active = this.app.workspace.getActiveViewOfType(PlantView);
        const target = active ?? views[0];
        const shown = target.toggleDevPanel();
        if (!shown) new Notice("Liefwork: tuning panel closed");
      },
    });

    // Apply/clear terminal-tab decoration to match live bindings.
    const reconcileTabs = () => {
      for (const b of this.bindingStore.all()) {
        if (b.leaf && b.launchedVia === "integrated") {
          applyTabDeco(b.leaf as WorkspaceLeaf, b.color, branchPillLabel(b.branchPath));
        }
      }
    };
    this.register(this.bindingStore.subscribe(reconcileTabs));

    // Support-prompt qualifying trigger: a coral agent terminal opened while at
    // least one is already live (the binding count GREW to ≥ 2). Detected off
    // the BindingStore change signal so plant-view stays oblivious; the engine
    // (support-prompt.ts) owns all pacing — pro-silence, once-per-session,
    // stage/quiet/parity — and answers with what to show, if anything.
    let bindingCount = this.bindingStore.all().length;
    this.register(
      this.bindingStore.subscribe(() => {
        const count = this.bindingStore.all().length;
        const grew = count > bindingCount;
        bindingCount = count;
        if (!grew || count < 2) return;
        const action = this.supportPrompt.onQualifyingTrigger(this.isPro());
        if (!action) return;
        if (action.kind === "stage") {
          const copy = SUPPORT_PROMPTS[action.stage - 1];
          if (copy) new SupportPromptModal(this.app, copy).open();
        } else {
          this.openIceCreamMan();
        }
      }),
    );

    // End bindings whose terminal leaf has closed.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const live = new Set(this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE));
        for (const b of this.bindingStore.all()) {
          if (b.launchedVia === "integrated" && b.leaf && !live.has(b.leaf as WorkspaceLeaf)) {
            clearTabDeco(b.leaf as WorkspaceLeaf);
            this.bindingStore.endByLeaf(b.leaf);
          }
        }
      }),
    );

    // Right-click a folder → "Open as Liefwork coral" + status-aware seed
    // lifecycle items. One move per state: no Charter → Seed · own Charter →
    // De-seed · archived Charter → Reactivate or Seed anew. (Re-seed retired 28
    // July: it is de-seed then seed, and the user can still do exactly that.)
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle("Open as Liefwork coral")
            .setIcon("sprout")
            .onClick(() => { void this.openPlant(file.path); }),
        );
        menu.addItem((item) =>
          item
            .setTitle("Open as Liefwork coral in new window")
            .setIcon("sprout")
            .onClick(() => { void this.openPlant(file.path, "window"); }),
        );

        const status = classifyFolder(readCoralFacts(this.app, file));
        for (const action of coralMenuActions(status)) {
          if (action === "seed") {
            menu.addItem((item) =>
              item
                .setTitle("Seed as coral")
                .setIcon("sprout")
                .onClick(() => {
                  new SeedCoralModal(this.app, file, (p) => void this.openPlant(p)).open();
                }),
            );
          } else if (action === "deseed") {
            menu.addItem((item) =>
              item
                .setTitle("De-seed")
                .setIcon("sprout")
                .onClick(() => { void this.runLifecycle(file, "deseed"); }),
            );
          } else if (action === "reactivate") {
            menu.addItem((item) =>
              item
                .setTitle("Reactivate archived seed")
                .setIcon("sprout")
                .onClick(() => { void this.runLifecycle(file, "reactivate"); }),
            );
          }
        }
      }),
    );

    // Live update: any vault change debounces a rebuild of open plant views.
    // A folder or md file records its new path; a rename also records its old
    // path (including a `.md` old path when the note was renamed to a non-md
    // extension, whose stale node must still be pruned) — see pathsForVaultChange.
    const onVaultChange = (f: TAbstractFile, oldPath?: string) => {
      // A change "appears" in the coral when it's a folder, a markdown file, or
      // — in all-files mode — any file. The pure fn also prunes a non-md old
      // path when all-files is on (a renamed/deleted image had a live node).
      const allFiles = this.allFilesMode;
      const newAppears = !(f instanceof TFile) || f.extension === "md" || allFiles;
      const paths = pathsForVaultChange(newAppears, f.path, oldPath, allFiles);
      if (paths.length === 0) return;
      // Fan out to each view NOW; each view debounces on ITS OWN window's
      // clock. The old design debounced here on the MAIN window's setTimeout —
      // and a hidden Electron window's timers are FROZEN (measured: a 300ms
      // timeout never fires), so working in a pop-out that covered the main
      // window meant the rebuild never even started until the main window was
      // next raised. The paint must be scheduled where the paint will happen.
      for (const leaf of this.app.workspace.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
        const view = leaf.view;
        if (view instanceof PlantView) view.queueRefreshForPaths(paths);
      }
    };
    // NOTE: deliberately NO "modify" listener. With headings off, the tree's
    // shape depends only on file/folder names + ctimes — content edits can't
    // change it, and rebuilding the whole plant on every autosave was the
    // dominant avoidable lag while working inside a watched folder. The M3
    // recency colour will want a cheap recolor-on-modify path, NOT a rebuild.
    //
    // Register the vault listeners only AFTER the layout is ready: during vault
    // load Obsidian replays a `create` for every existing file, which would fire
    // a spurious full rebuild of every open plant on each app launch. Rename-sync
    // handlers are wrapped for the same reason — vault load fires no renames, so
    // nothing is missed by waiting.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", onVaultChange));
      this.registerEvent(this.app.vault.on("delete", onVaultChange));
      this.registerEvent(this.app.vault.on("rename", onVaultChange));

      // Keep a meristem's folder-note (summary) in sync when its folder is renamed,
      // so the folder-note convention (basename == folder name) doesn't break. The
      // note rename itself fires another `rename` → onVaultChange rebuild.
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (!(file instanceof TFolder)) return;
          if (!this.renameInOpenCoral(oldPath, file.path)) return;
          const plan = folderNoteSyncRename(
            oldPath,
            file.path,
            (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile,
          );
          if (!plan) return;
          const note = this.app.vault.getAbstractFileByPath(plan.from);
          if (note instanceof TFile) {
            void this.app.fileManager
              .renameFile(note, plan.to)
              .catch((e) => new Notice(`Liefwork: couldn't sync the folder note — ${(e as Error).message}`));
          }
        }),
      );

      // Reverse: when the meristem's folder-note is itself renamed (e.g. from its
      // title bar or the explorer), rename the folder to match — otherwise the
      // basename == folder-name convention breaks and the branch loses its summary.
      // Loop-safe with the handler above (see folderRenameFromNote). The folder
      // rename then fires another `rename` → onVaultChange rebuild.
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (!(file instanceof TFile) || file.extension !== "md") return;
          if (!this.renameInOpenCoral(oldPath, file.path)) return;
          const plan = folderRenameFromNote(oldPath, file.path);
          if (!plan) return;
          const folder = this.app.vault.getAbstractFileByPath(plan.from);
          if (folder instanceof TFolder) {
            void this.app.fileManager
              .renameFile(folder, plan.to)
              .catch((e) => new Notice(`Liefwork: couldn't sync the folder note — ${(e as Error).message}`));
          }
        }),
      );
    });

    // "Reveal in Liefwork coral" — added to a markdown file's menu (the editor's
    // ⋮ "more options", the file explorer, etc.). Skip our own plant node menu
    // (source "liefwork-plant-view") where it'd be redundant.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        // Skip inside our own coral view — revealing a note in the coral you're
        // already looking at is redundant. Detect by the leaf's view (the coral
        // now fires the menu with the file-explorer's source tag, so we can't
        // key off the source string).
        if (leaf?.view instanceof PlantView) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((i) =>
          i
            .setTitle("Reveal in Liefwork coral")
            .setIcon("sprout")
            .onClick(() => void this.revealInPlant(file)),
        );
      }),
    );
  }

  onunload() {
    for (const b of this.bindingStore.all()) {
      if (b.launchedVia === "integrated" && b.leaf) {
        clearTabDeco(b.leaf as WorkspaceLeaf);
      }
    }
    // NOTE: do NOT detachLeavesOfType here — the Obsidian guidelines forbid a
    // plugin destroying the user's layout on unload/update; the deferred coral
    // leaves are restored on next load.
  }

  /** The Ice Cream Man clickventure (ice-cream-man.ts) — the engine fires it
   *  on the parity beats after the post-stage-5 quiet spell (see
   *  support-prompt.ts). The state advance is already persisted by the time
   *  this runs, so however the vignette ends (X included) the beat is spent. */
  private openIceCreamMan(): void {
    // isPro forks the ending: a supporter reaches the gratitude send-off rather
    // than the collection basket. Read at open time — the entitlement can change
    // mid-session (activate/remove in settings), and the vignette should reflect
    // whoever is standing there now.
    new IceCreamManModal(this.app, this.isPro()).open();
  }

  /** True when a rename (old → new path) touches the folder of any open coral
   *  view. The folder-note rename sync is a coral convention — it must never act
   *  on vaults or subtrees where the user hasn't opened a coral (it would collide
   *  with e.g. the Folder Notes plugin and silently rename user folders). Both
   *  sides of the rename are checked (see renameInOpenCoral): renaming the open
   *  coral's OWN root folder matches only on the old path. */
  private renameInOpenCoral(oldPath: string, newPath: string): boolean {
    const corals: string[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
      const fp = leaf.getViewState().state?.folderPath;
      if (typeof fp === "string") corals.push(fp);
    }
    return renameInOpenCoral(corals, oldPath, newPath);
  }

  /** Run a reversible seed-lifecycle action on a folder. Archive-over-delete:
   *  De-seed archives ALL the seed documents (not data) into a dated
   *  `_archive — de-seeded (…)/` with a provenance log; Reactivate restores them.
   *  Named De-seed rather than "Undo seeding" (founder, 28 July): undo promises
   *  a return to the exact previous state; this moves the scaffold to dormant.
   *  Nothing is ever deleted. */
  private async runLifecycle(folder: TFolder, kind: "deseed" | "reactivate"): Promise<void> {
    const folderPath = folder.path === "/" ? "" : folder.path;
    const exists = (name: string) =>
      Boolean(this.app.vault.getAbstractFileByPath(folderPath ? `${folderPath}/${name}` : name));
    try {
      if (kind === "deseed") {
        const adapter = this.app.vault.adapter;
        const at = (rel: string) => (folderPath ? `${folderPath}/${rel}` : rel);
        // The keeper script's presence drives `hasKeeper` (whether `planDeseed`
        // archives the keeper artifacts). The manifest tells us how to treat
        // settings.json on de-seed — read it BEFORE `applyArchivePlan`, whose
        // renames relocate it into the archive.
        const hasKeeper = await adapter.exists(at(".claude/hooks/coral-log-keeper.mjs"));
        let settingsCreatedByUs = true;
        const manifestPath = at(".claude/.coral-seed-manifest.json");
        if (hasKeeper && (await adapter.exists(manifestPath))) {
          try {
            const manifest = JSON.parse(await adapter.read(manifestPath)) as { settingsCreatedByUs?: unknown };
            if (manifest?.settingsCreatedByUs === false) settingsCreatedByUs = false;
          } catch {
            /* malformed manifest → treat as created-by-us (archive the whole file) */
          }
        }
        // Split the present pointers: untouched ones are trashed (regenerated
        // on Reactivate), edited ones are archived like any other marker — the
        // user's words never go to the trash.
        const pristine: string[] = [];
        const edited: string[] = [];
        for (const pointer of AGENT_POINTER_BASENAMES) {
          if (!exists(pointer)) continue;
          const file = this.app.vault.getAbstractFileByPath(at(pointer));
          let untouched = false;
          if (file instanceof TFile) {
            try {
              untouched = isPristinePointer(await this.app.vault.read(file));
            } catch {
              /* unreadable → treat as edited, so it is archived rather than trashed */
            }
          }
          (untouched ? pristine : edited).push(pointer);
        }
        const plan = planDeseed({
          folderPath,
          meristemName: `${folder.name || this.app.vault.getName()}.md`,
          markerNames: [GROWTH_CHARTER_BASENAME, ...edited].filter((n) => exists(n)),
          pointerNames: pristine,
          hasFoundingLief: exists("prompt — founding intent.md"),
          hasKeeper,
          today: todayISO(),
        });
        await applyArchivePlan(this.app, plan);
        // settings.json isn't moved by planDeseed: if we created it, archive the
        // whole file; if we merged into the user's, un-merge the keeper hook in
        // place, leaving their settings otherwise intact.
        if (hasKeeper) {
          const settingsPath = at(".claude/settings.json");
          if (await adapter.exists(settingsPath)) {
            if (settingsCreatedByUs) {
              await adapter.rename(settingsPath, `${plan.archiveFolder}/settings.json`);
            } else {
              let parseOk = true;
              let existing: unknown;
              try {
                existing = JSON.parse(await adapter.read(settingsPath));
              } catch {
                // settings.json can't be parsed — the un-merge is skipped, the rest of
                // the de-seed already succeeded. Tell the user to remove the hook manually.
                new Notice(
                  "Liefwork: .claude/settings.json couldn't be parsed — keeper hook entry NOT removed. " +
                    "Remove the UserPromptSubmit hook for coral-log-keeper.mjs manually.",
                );
                parseOk = false;
              }
              if (parseOk) {
                await adapter.write(settingsPath, JSON.stringify(unmergeKeeperHook(existing), null, 2));
              }
            }
          }
        }
        new Notice(`Liefwork: de-seeded “${folder.name}” — seed documents are dormant in the archive (Reactivate to restore)`);
      } else {
        const archive = deseedArchives(folder)[0];
        if (!archive) {
          new Notice(`Liefwork: nothing to reactivate on “${folder.name}”`);
          return;
        }
        const archivedNames = archive.children.map((c) => c.name);
        // Put the keeper artifacts back under `.claude/` FIRST. De-seed parked
        // them in the archive; without this Reactivate returned a coral with no
        // logging hook — it was not the inverse of De-seed, only most of it.
        // They live in dot-paths the vault API cannot see, so they move through
        // the adapter, and they must be gone before applyLifecyclePlan trashes
        // the spent archive folder at the end.
        await this.restoreKeeperArtifacts(archive.path, folderPath);
        const plan = planReactivate({
          folderPath,
          archiveFolder: archive.path,
          meristemName: `${folder.name || this.app.vault.getName()}.md`,
          archivedNames,
        });
        await applyLifecyclePlan(this.app, plan);
        new Notice(`Liefwork: reactivated “${folder.name}”`);
      }
    } catch (err) {
      new Notice(`Liefwork: couldn't ${kind} — ${(err as Error).message}`);
    }
  }

  /** Move the keeper artifacts out of a de-seed archive and back under
   *  `.claude/`. Dot-paths are invisible to the vault API, so every move goes
   *  through the filesystem adapter. `settings.json` is the awkward one: it sits
   *  in the archive only when WE created it, so a live one means the user has
   *  their own and the hook is merged back into it instead. */
  private async restoreKeeperArtifacts(archiveFolder: string, folderPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const at = (rel: string) => (folderPath ? `${folderPath}/${rel}` : rel);
    const move = async (from: string, to: string) => {
      if (!(await adapter.exists(from)) || (await adapter.exists(to))) return;
      const dir = to.slice(0, to.lastIndexOf("/"));
      if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.rename(from, to);
    };
    const inArchive = (name: string) => `${archiveFolder}/${name}`;
    await move(inArchive("coral-log-keeper.mjs"), at(".claude/hooks/coral-log-keeper.mjs"));
    await move(inArchive(".coral-log-state.json"), at(".claude/.coral-log-state.json"));
    await move(inArchive(".coral-seed-manifest.json"), at(".claude/.coral-seed-manifest.json"));

    const archivedSettings = inArchive("settings.json");
    const liveSettings = at(".claude/settings.json");
    if (await adapter.exists(liveSettings)) {
      // The user has their own settings — re-merge the hook entry rather than
      // overwriting, the mirror of the un-merge De-seed performed.
      let existing: unknown = {};
      let parseOk = true;
      try {
        existing = JSON.parse(await adapter.read(liveSettings));
      } catch {
        new Notice(
          "Liefwork: .claude/settings.json couldn't be parsed — keeper hook entry NOT restored. " +
            "Add the UserPromptSubmit hook for coral-log-keeper.mjs manually.",
        );
        parseOk = false;
      }
      if (parseOk) await adapter.write(liveSettings, JSON.stringify(mergeKeeperHook(existing), null, 2));
      if (await adapter.exists(archivedSettings)) await adapter.remove(archivedSettings);
    } else {
      await move(archivedSettings, liveSettings);
    }
  }

  private async openPlant(
    folderPath: string,
    where: "sidebar" | "tab" | "window" = "sidebar",
  ): Promise<WorkspaceLeaf> {
    // Default: open in the LEFT sidebar (as a tab beside the file explorer) — the
    // coral is an explorer replacement, and notes then open in the main area with
    // the HUD off. "window" opens a new OS window (pop-out, HUD on); "tab" a
    // main-area tab. Sidebar falls back to a tab if no left dock (mobile).
    const ws = this.app.workspace;
    // Sidebar reuse: reveal an existing coral leaf for this folder rather than
    // piling up duplicate "Liefwork" sidebar tabs on every ribbon click (they'd
    // also persist in the saved layout). getViewState().state reads the folder
    // WITHOUT loading a deferred view. Explicit "tab"/"window" always open fresh.
    if (where === "sidebar") {
      for (const leaf of ws.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
        if (leaf.getViewState().state?.folderPath === folderPath) {
          await ws.revealLeaf(leaf);
          return leaf;
        }
      }
    }
    const leaf =
      where === "sidebar" ? (ws.getLeftLeaf(false) ?? ws.getLeaf("tab")) : ws.getLeaf(where);
    await leaf.setViewState({
      type: LIEFWORK_VIEW_TYPE,
      active: true,
      state: { folderPath },
    });
    await ws.revealLeaf(leaf);
    this.onCoralOpened();
    return leaf;
  }

  /** The support engine's SECOND trigger: a folder opened as a coral. Every Nth
   *  open takes a qualifying trigger and walks the same ladder as the 2nd-terminal
   *  trigger (see support-prompt.ts); the engine owns the counting, the Pro
   *  silence and the once-per-session cap.
   *
   *  Called from `openPlant`, which is the single entry point for every DELIBERATE
   *  open — ribbon, commands, folder menu, seed modal, reveal. Workspace restores
   *  rebuild views through registerView instead, so a restart can never fake a
   *  trigger (the same replay trap the vault watcher sidesteps with
   *  onLayoutReady). */
  private onCoralOpened(): void {
    const action = this.supportPrompt.onCoralOpened(this.isPro());
    if (!action) return;
    if (action.kind === "stage") {
      const copy = SUPPORT_PROMPTS[action.stage - 1];
      if (copy) new SupportPromptModal(this.app, copy).open();
    } else {
      this.openIceCreamMan();
    }
  }

  /** "Reveal in Liefwork coral" (editor ⋮ menu): if an open plant already shows
   *  the note, bring it to front + select it; otherwise let the user pick which
   *  ancestor folder to open a new plant at, then select the note there. */
  private async revealInPlant(file: TFile): Promise<void> {
    const ws = this.app.workspace;
    // Match by the leaf's saved folderPath (read from getViewState, which works
    // on a DEFERRED leaf) rather than `view instanceof PlantView` — after an app
    // restart the coral leaf is deferred and its view isn't a PlantView yet, so
    // the old check missed it and opened a duplicate coral.
    for (const leaf of ws.getLeavesOfType(LIEFWORK_VIEW_TYPE)) {
      const folderPath = leaf.getViewState().state?.folderPath;
      if (typeof folderPath === "string" && folderContains(folderPath, file.path)) {
        await leaf.loadIfDeferred?.();
        await ws.revealLeaf(leaf);
        if (leaf.view instanceof PlantView) leaf.view.revealNote(file.path);
        return;
      }
    }
    const folder = await pickFolderLevel(this.app, "Reveal in Liefwork coral", ancestorFolders(file.path));
    if (folder === null) return;
    const leaf = await this.openPlant(folder);
    if (leaf.view instanceof PlantView) leaf.view.revealNote(file.path);
  }
}
