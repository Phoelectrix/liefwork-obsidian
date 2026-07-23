import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import { PRO_CHECKOUT_URL, type LicenseHttp } from "./pro.ts";
import {
  BRANCH_EMPHASIS_RANGE,
  DEFAULT_TEXT_SIZING,
  DEPTH_FALLOFF_RANGE,
  LIEF_TEXT_RANGE,
  MERISTEM_TEXT_RANGE,
  type TextSizingSettings,
} from "./text-sizing.ts";
import type LiefworkPlugin from "./main.ts";

/** Adapt Obsidian's `requestUrl` to the injected `LicenseHttp` shape the pure
 *  licence logic (pro.ts) consumes. `throw: false` → non-2xx resolves and only
 *  a transport failure rejects, which is exactly how pro.ts tells a rejected
 *  key apart from an unreachable store. */
const requestUrlHttp: LicenseHttp = async (req) => {
  const res = await requestUrl(req);
  let json: unknown = null;
  try {
    json = res.json;
  } catch {
    /* non-JSON body — pro.ts treats it as an unexpected store response */
  }
  return { status: res.status, json };
};

export class LiefworkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LiefworkPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.render();
  }

  /** Rebuilds the tab's content — called from display() and after any action
   *  that flips the Pro state (activate / remove key). */
  private render(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Display — free accessibility knobs (deliberately NOT under Pro). ──
    // These sliders drive the renderer's OWN adaptive targets — the screen-px
    // size labels are lifted toward, and how far attention propagates down the
    // tree (see text-sizing.ts) — not screen-level multipliers; open corals
    // redraw instantly via plugin.setTextSizing. The coral view's own "Aa"
    // overlay shares this state; if it changes the values while this tab is
    // open, these sliders show stale positions until the tab re-renders —
    // acceptable.
    this.textSizingSlider(
      "Meristem text",
      "Screen size that branch titles grow toward.",
      MERISTEM_TEXT_RANGE,
      "optimalSize",
    );
    this.textSizingSlider(
      "Lief text",
      "Screen size that lief labels grow toward.",
      LIEF_TEXT_RANGE,
      "liefOptimalSize",
    );
    this.textSizingSlider(
      "Depth falloff",
      "How far a branch's prominence carries into its sub-branches — low is steep, high is flat.",
      DEPTH_FALLOFF_RANGE,
      "attentionPropagationDecay",
    );
    this.textSizingSlider(
      "Branch emphasis",
      "How much a branch's size lifts its title \u2014 0 treats every branch alike, 1 makes the biggest stand well out.",
      BRANCH_EMPHASIS_RANGE,
      "subtreeBoost",
    );

    // One-click restore for the whole display section (the per-slider
    // rotate-ccw buttons reset one knob each; this resets them all).
    new Setting(containerEl)
      .setName("Reset display settings")
      .setDesc("Restore all sliders above to their defaults.")
      .addButton((b) =>
        b.setButtonText("Reset to defaults").onClick(async () => {
          await this.plugin.setTextSizing({ ...DEFAULT_TEXT_SIZING });
          new Notice("Liefwork: display settings restored to defaults");
          this.render(); // rebuild so the sliders snap back
        }),
      );

    // ── Coral — structural display (rebuilds open corals on change). ──
    new Setting(containerEl).setName("Coral").setHeading();

    new Setting(containerEl)
      .setName("Show meristem notes on branches")
      .setDesc(
        "Show each branch's folder-note as a lief pinned at the branch base — " +
        "matching the file explorer, which lists it as a note. Off by default: " +
        "the folder-note stays the branch's own page (its meristem).",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.getShowMeristemNotes()).onChange(async (v) => {
          await this.plugin.setShowMeristemNotes(v);
        }),
      );

    new Setting(containerEl)
      .setName("Display")
      .setDesc(
        "Notes only shows just your markdown notes (the default, keeping memory " +
        "corals curated). All files also shows images, PDFs and every other file " +
        "the file explorer lists — click one to open it in Obsidian's own viewer.",
      )
      .addDropdown((d) =>
        d
          .addOption("notes", "Notes only")
          .addOption("all", "All files")
          .setValue(this.plugin.getAllFiles() ? "all" : "notes")
          .onChange(async (v) => {
            await this.plugin.setAllFiles(v === "all");
          }),
      );

    // Core, not a Pro perk: default ON so the keyboard cursor (and click-
    // selection) stays findable at a glance. Lives in Coral, not the Pro
    // section, so it never reads as paywalled.
    new Setting(containerEl)
      .setName("Magnify the selected item")
      .setDesc("Enlarge the highlighted note or branch so the cursor stays easy to find, especially on big branches.")
      .addToggle((t) =>
        t.setValue(this.plugin.getSelectionMagnify()).onChange(async (v) => {
          await this.plugin.setSelectionMagnify(v);
        }),
      );

    // The Obsidian review bot bans the plugin name inside settings headings,
    // so the Liefwork Pro section is headed just "Pro"; the full product name
    // lives in the setting descriptions below.
    new Setting(containerEl).setName("Pro").setHeading();
    const pro = this.plugin.proStore;

    if (pro.isPro()) {
      const state = pro.getState();
      new Setting(containerEl)
        .setName("Licence")
        .setDesc(
          `Liefwork Pro is active on this install${state ? ` (activated ${state.activatedAt.slice(0, 10)})` : ""}.`,
        )
        .addButton((b) =>
          b.setButtonText("Remove key").onClick(async () => {
            b.setDisabled(true);
            await pro.removeKey(requestUrlHttp);
            new Notice("Liefwork: licence key removed");
            this.render();
          }),
        );
    } else {
      let pendingKey = "";
      new Setting(containerEl)
        .setName("Licence key")
        .setDesc("Paste the Liefwork Pro key from your purchase email, then activate.")
        .addText((t) => t.setPlaceholder("Licence key").onChange((v) => (pendingKey = v)))
        .addButton((b) =>
          b
            .setButtonText("Activate")
            .setCta()
            .onClick(async () => {
              b.setDisabled(true);
              const result = await this.plugin.proStore.activate(requestUrlHttp, pendingKey);
              b.setDisabled(false);
              if (result.ok) {
                new Notice("Liefwork: licence activated — thank you!");
                this.render();
              } else if (result.reason === "network") {
                new Notice("Couldn't reach the store — check your connection and try again.");
              } else {
                new Notice(`Liefwork: the licence key was rejected — ${result.message}`);
              }
            }),
        );
      const buy = containerEl.createEl("p", { cls: "liefwork-pro-buy" });
      buy.createEl("a", { text: "Get a licence key", href: PRO_CHECKOUT_URL });
    }

    // Pro perks — cosmetic thank-yous (see agent-colors.ts). Visible to
    // everyone; without a key the toggle is locked with a "Pro" tag, the same
    // gentle upsell as the color picker's Pro-tagged wheel and named swatches
    // (five accents free; the deep-sea set + the color space are the perk).
    const spectral = new Setting(containerEl)
      .setName("Spectral pulse")
      .setDesc("An agent's coral tint drifts gently through neighbouring hues as it pulses.");
    if (pro.isPro()) {
      spectral.addToggle((t) =>
        t.setValue(this.plugin.getSpectralPulseSetting()).onChange(async (v) => {
          await this.plugin.setSpectralPulse(v);
        }),
      );
    } else {
      spectral.nameEl.createSpan({ cls: "liefwork-pro-tag", text: "Pro" });
      spectral.addToggle((t) => t.setValue(false).setDisabled(true));
    }

    containerEl.createEl("p", {
      text: "Activation and key removal each contact lemonsqueezy.com once; nothing else ever leaves your vault.",
      cls: "liefwork-pro-disclosure",
    });
  }

  /** One text-sizing slider + a restore-default button (the reset idiom of
   *  Obsidian's own font-size setting). `setInstant(true)` so a drag updates
   *  open corals live — setTextSizing redraws in place (no rebuild). */
  private textSizingSlider(
    name: string,
    desc: string,
    range: { min: number; max: number; step: number },
    key: keyof TextSizingSettings,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip("Restore default")
          .onClick(async () => {
            await this.plugin.setTextSizing({ [key]: DEFAULT_TEXT_SIZING[key] });
            this.render(); // rebuild so the slider snaps back to the default
          }),
      )
      .addSlider((s) =>
        s
          .setLimits(range.min, range.max, range.step)
          .setValue(this.plugin.getTextSizing()[key])
          .setDynamicTooltip()
          .setInstant(true)
          .onChange(async (v) => {
            await this.plugin.setTextSizing({ [key]: v });
          }),
      );
  }
}
