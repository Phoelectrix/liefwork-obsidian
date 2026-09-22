import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  requestUrl,
  type SettingDefinitionItem,
  type SettingDefinitionGroup,
  type SettingGroup,
  type SettingGroupItem,
} from "obsidian";
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

/** Control keys the declarative tab reads/writes through getControlValue /
 *  setControlValue — each maps onto a plugin getter/setter pair, not a
 *  `plugin.settings` bag (the plugin keeps its state in typed fields). */
type ControlKey = "theme" | "style" | "showMeristemNotes" | "display" | "selectionMagnify" | "spectralPulse";

const PRO_DISCLOSURE =
  "Activation and key removal each contact lemonsqueezy.com once; nothing else ever leaves your vault.";

/** The plugin's settings tab, declared through Obsidian 1.13's
 *  `getSettingDefinitions()` so every setting is searchable in the settings
 *  search (the directory scan's one true finding, 24 July 2026). Stateful rows
 *  — the four live text-sizing sliders and the Pro licence flow — are `render`
 *  items; the rest are plain controls. `display()` stays as a thin fallback
 *  renderer over the SAME definitions for Obsidian < 1.13 (minAppVersion is
 *  1.8.7), so nothing is written twice. */
export class LiefworkSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LiefworkPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const pro = this.plugin.proStore;
    // Definitions are re-read on every render (and by rerender() below), so a
    // value computed here — the activation date — is as live as a callback.
    const proState = pro.getState();
    return [
      // ── Display — free accessibility knobs (deliberately NOT under Pro). ──
      // These sliders drive the renderer's OWN adaptive targets — the screen-px
      // size labels are lifted toward, and how far attention propagates down
      // the tree (see text-sizing.ts) — not screen-level multipliers; open
      // corals redraw instantly via plugin.setTextSizing.
      {
        type: "group",
        heading: "Display",
        items: [
          this.textSizingSlider("Meristem text", "Screen size that branch titles grow toward.", MERISTEM_TEXT_RANGE, "optimalSize"),
          this.textSizingSlider("Lief text", "Screen size that lief labels grow toward.", LIEF_TEXT_RANGE, "liefOptimalSize"),
          this.textSizingSlider(
            "Depth falloff",
            "How far a branch's prominence carries into its sub-branches — low is steep, high is flat.",
            DEPTH_FALLOFF_RANGE,
            "attentionPropagationDecay",
          ),
          this.textSizingSlider(
            "Branch emphasis",
            "How much a branch's size lifts its title — 0 treats every branch alike, 1 makes the biggest stand well out.",
            BRANCH_EMPHASIS_RANGE,
            "subtreeBoost",
          ),
          // One-click restore for the whole display section (the per-slider
          // rotate-ccw buttons reset one knob each; this resets them all).
          {
            name: "Reset display settings",
            desc: "Restore all sliders above to their defaults.",
            render: (setting) => {
              setting.addButton((b) =>
                b.setButtonText("Reset to defaults").onClick(async () => {
                  await this.plugin.setTextSizing({ ...DEFAULT_TEXT_SIZING });
                  new Notice("Liefwork: display settings restored to defaults");
                  this.rerender(); // rebuild so the sliders snap back
                }),
              );
            },
          },
        ],
      },
      // ── Coral — structural display (rebuilds open corals on change). ──
      {
        type: "group",
        heading: "Coral",
        items: [
          {
            name: "Theme",
            desc:
              "Dark is the Meridian night look. Light is Meltemi — Cycladic whitewash " +
              "in strong sun. The command \"Toggle light/dark coral\" flips this too.",
            control: { type: "dropdown", key: "theme", options: { dark: "Dark (Meridian)", light: "Light (Meltemi)" } },
          },
          {
            name: "Style",
            desc:
              "Default fans every branch out at the same angle. Organic starts wider " +
              "and lets each branch lean in a little more than the last, so dense " +
              "corals read more like a plant.",
            control: { type: "dropdown", key: "style", options: { default: "Default", organic: "Organic" } },
          },
          {
            name: "Show meristem notes on branches",
            desc:
              "Show each branch's folder-note as a lief pinned at the branch base — " +
              "matching the file explorer, which lists it as a note. Off by default: " +
              "the folder-note stays the branch's own page (its meristem).",
            control: { type: "toggle", key: "showMeristemNotes" },
          },
          {
            name: "Display",
            desc:
              "Notes only shows just your markdown notes (the default, keeping memory " +
              "corals curated). All files also shows images, PDFs and every other file " +
              "the file explorer lists — click one to open it in Obsidian's own viewer.",
            control: { type: "dropdown", key: "display", options: { notes: "Notes only", all: "All files" } },
          },
          // Core, not a Pro perk: default ON so the keyboard cursor (and click-
          // selection) stays findable at a glance. Lives in Coral, not the Pro
          // section, so it never reads as paywalled.
          {
            name: "Magnify the selected item",
            desc: "Enlarge the highlighted note or branch so the cursor stays easy to find, especially on big branches.",
            control: { type: "toggle", key: "selectionMagnify" },
          },
        ],
      },
      // The Obsidian review bot bans the plugin name inside settings headings,
      // so the Liefwork Pro section is headed just "Pro"; the full product name
      // lives in the setting descriptions below.
      {
        type: "group",
        heading: "Pro",
        items: [
          {
            name: "Licence",
            desc:
              `Liefwork Pro is active on this install${proState ? ` (activated ${proState.activatedAt.slice(0, 10)})` : ""}. ` +
              PRO_DISCLOSURE,
            visible: () => pro.isPro(),
            render: (setting) => {
              setting.addButton((b) =>
                b.setButtonText("Remove key").onClick(async () => {
                  b.setDisabled(true);
                  await pro.removeKey(requestUrlHttp);
                  new Notice("Liefwork: licence key removed");
                  this.rerender();
                }),
              );
            },
          },
          {
            name: "Licence key",
            desc: createFragment((frag) => {
              frag.appendText("Paste the Liefwork Pro key from your purchase email, then activate. ");
              frag.createEl("a", { text: "Get a licence key", href: PRO_CHECKOUT_URL });
              frag.appendText(". " + PRO_DISCLOSURE);
            }),
            visible: () => !pro.isPro(),
            render: (setting) => {
              let pendingKey = "";
              setting
                .addText((t) => t.setPlaceholder("Licence key").onChange((v) => (pendingKey = v)))
                .addButton((b) =>
                  b
                    .setButtonText("Activate")
                    .setCta()
                    .onClick(async () => {
                      b.setDisabled(true);
                      const result = await pro.activate(requestUrlHttp, pendingKey);
                      b.setDisabled(false);
                      if (result.ok) {
                        new Notice("Liefwork: licence activated — thank you!");
                        this.rerender();
                      } else if (result.reason === "network") {
                        new Notice("Couldn't reach the store — check your connection and try again.");
                      } else {
                        new Notice(`Liefwork: the licence key was rejected — ${result.message}`);
                      }
                    }),
                );
            },
          },
          // Pro perk — a cosmetic thank-you (see agent-colors.ts). Visible to
          // everyone; without a key the toggle is locked with a "Pro" tag, the
          // same gentle upsell as the color picker's Pro-tagged wheel and named
          // swatches (five accents free; the deep-sea set + the color space are
          // the perk).
          {
            name: "Spectral pulse",
            desc: "An agent's coral tint drifts gently through neighbouring hues as it pulses.",
            aliases: ["Pro"],
            render: (setting) => {
              if (pro.isPro()) {
                setting.addToggle((t) =>
                  t.setValue(this.plugin.getSpectralPulseSetting()).onChange(async (v) => {
                    await this.plugin.setSpectralPulse(v);
                  }),
                );
              } else {
                setting.nameEl.createSpan({ cls: "liefwork-pro-tag", text: "Pro" });
                setting.addToggle((t) => t.setValue(false).setDisabled(true));
              }
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    switch (key as ControlKey) {
      case "theme":
        return this.plugin.getTheme();
      case "style":
        return this.plugin.getStyle();
      case "showMeristemNotes":
        return this.plugin.getShowMeristemNotes();
      case "display":
        return this.plugin.getAllFiles() ? "all" : "notes";
      case "selectionMagnify":
        return this.plugin.getSelectionMagnify();
      case "spectralPulse":
        return this.plugin.getSpectralPulseSetting();
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key as ControlKey) {
      case "theme":
        return this.plugin.setTheme(value === "light" ? "light" : "dark");
      case "style":
        return this.plugin.setStyle(value === "organic" ? "organic" : "default");
      case "showMeristemNotes":
        return this.plugin.setShowMeristemNotes(value === true);
      case "display":
        return this.plugin.setAllFiles(value === "all");
      case "selectionMagnify":
        return this.plugin.setSelectionMagnify(value === true);
      case "spectralPulse":
        return this.plugin.setSpectralPulse(value === true);
    }
  }

  /** Re-render after an action changed what the rows show (a slider reset, the
   *  Pro state flipping). On 1.13+ `update()` re-reads the definitions and the
   *  visibility predicates; on the fallback path display() is the renderer. */
  private rerender(): void {
    // Feature-detected, not version-gated: `update` / `refreshDomState` exist
    // exactly where definitions render (1.13+); below that, display() is the
    // renderer. Typed as optional so the 1.8.7 floor stays honest.
    const tab = this as unknown as { update?: () => void; refreshDomState?: () => void };
    if (tab.update) {
      tab.update();
      tab.refreshDomState?.();
    } else if (this.containerEl.isShown()) {
      this.display();
    }
  }

  /** Whether this Obsidian renders tabs from getSettingDefinitions() (1.13+).
   *  Feature-detected, not version-parsed: the base class only carries
   *  `update` where the declarative renderer exists. */
  private declarative(): boolean {
    return typeof (PluginSettingTab.prototype as { update?: unknown }).update === "function";
  }

  /** Fallback for Obsidian < 1.13.0 (declarative tabs unsupported): render the
   *  same definitions imperatively — no row is written twice. Not called on
   *  1.13+, where the framework renders from getSettingDefinitions() and skips
   *  display(); the deprecation is the API's, the floor (1.8.7) is ours. */
  display(): void {
    if (this.declarative()) return;
    const { containerEl } = this;
    containerEl.empty();
    for (const item of this.getSettingDefinitions()) this.renderFallback(containerEl, item);
  }

  private renderFallback(containerEl: HTMLElement, item: SettingDefinitionItem): void {
    if ("type" in item && (item.type === "group" || item.type === "list")) {
      const group = item as SettingDefinitionGroup;
      if (group.heading) new Setting(containerEl).setName(group.heading).setHeading();
      for (const child of group.items ?? []) this.renderFallback(containerEl, child);
      return;
    }
    if ("type" in item) return; // pages: none declared
    const def = item as SettingGroupItem & { name: string };
    const visible = typeof def.visible === "function" ? def.visible() : def.visible !== false;
    if (!visible) return;
    const setting = new Setting(containerEl).setName(def.name);
    if (def.desc) setting.setDesc(def.desc);
    if ("render" in def && def.render) {
      def.render(setting, undefined as unknown as SettingGroup);
    } else if ("control" in def && def.control) {
      const c = def.control;
      const key = c.key;
      if (c.type === "toggle") {
        setting.addToggle((t) =>
          t.setValue(this.getControlValue(key) === true).onChange((v) => void this.setControlValue(key, v)),
        );
      } else if (c.type === "dropdown") {
        setting.addDropdown((d) => {
          for (const [k, label] of Object.entries(c.options)) d.addOption(k, label);
          d.setValue(String(this.getControlValue(key))).onChange((v) => void this.setControlValue(key, v));
        });
      }
    }
  }

  /** One text-sizing slider + a restore-default button (the reset idiom of
   *  Obsidian's own font-size setting) as a `render` definition. Imperative
   *  because it is live: `setInstant(true)` so a drag updates open corals as
   *  it moves — setTextSizing redraws in place (no rebuild). The coral view's
   *  own "Aa" overlay shares this state; if it changes the values while this
   *  tab is open, these sliders show stale positions until the tab re-renders
   *  — acceptable. */
  private textSizingSlider(
    name: string,
    desc: string,
    range: { min: number; max: number; step: number },
    key: keyof TextSizingSettings,
  ): SettingGroupItem {
    return {
      name,
      desc,
      render: (setting) => {
        setting
          .addExtraButton((b) =>
            b
              .setIcon("rotate-ccw")
              .setTooltip("Restore default")
              .onClick(async () => {
                await this.plugin.setTextSizing({ [key]: DEFAULT_TEXT_SIZING[key] });
                this.rerender(); // rebuild so the slider snaps back to the default
              }),
          )
          .addSlider((s) =>
            s
              .setLimits(range.min, range.max, range.step)
              .setValue(this.plugin.getTextSizing()[key])
              // Deprecated upstream because newer apps show the value inline; on
              // the 1.8.7–1.12 apps this plugin still supports the tooltip is the
              // only readout. Deliberate (scan recommendation); drop with the floor.
              .setDynamicTooltip()
              .setInstant(true)
              .onChange(async (v) => {
                await this.plugin.setTextSizing({ [key]: v });
              }),
          );
      },
    };
  }
}
