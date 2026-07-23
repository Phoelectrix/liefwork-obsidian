import { App, Modal, Notice, Setting, type ButtonComponent } from "obsidian";
import { canSelectColor, colorSwatches } from "./agent-colors.ts";
import { PRO_CHECKOUT_URL } from "./pro.ts";

/** The gentle-upsell Notice for a Pro color refusal, with the checkout one
 *  click away: `lead` states what was locked; the link goes straight to the
 *  Lemon Squeezy page (the settings route still works and is named for the
 *  paste-the-key step). Held on screen longer than a default Notice so the
 *  link is clickable at a human pace. */
function proColorNudge(lead: string): void {
  const frag = createFragment();
  frag.appendText(`${lead} — a small thank-you for supporters. `);
  frag.createEl("a", { text: "Get a licence key", href: PRO_CHECKOUT_URL });
  frag.appendText(", then paste it in settings.");
  new Notice(frag, 10000);
}

/** Pick a color for a new agent terminal. `initial` is the auto-assigned color,
 *  preselected. The five bare accents are free; the three NAMED deep-sea
 *  swatches and the color WHEEL are the Liefwork Pro color perk (settled
 *  23 July, refining the 14 July inversion). Everything shows to everyone —
 *  the locked swatches and the wheel are visible, tagged, and a free pick of
 *  either snaps back with a gentle nudge toward settings instead of taking.
 *  Resolves to a hex string, or null if dismissed. */
/** Read/write access to the RAW spectral-pulse choice (ungated) — the picker's
 *  toggle. Injected so this module stays free of the plugin's persistence. */
export interface SpectralPulseAccess {
  get(): boolean;
  set(on: boolean): Promise<void>;
}

export function promptForColor(
  app: App,
  title: string,
  initial: string,
  isPro: boolean,
  spectral: SpectralPulseAccess,
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private value = initial;
      private settled = false;
      onOpen() {
        this.titleEl.setText(title);
        const swatches = new Setting(this.contentEl).setName("Agent color");
        // The ● marker must follow the live selection, so keep references to every
        // swatch button and repaint all their labels whenever the value changes
        // (the marker was previously set once at construction and never moved).
        const swatchButtons: { color: string; btn: ButtonComponent }[] = [];
        // Case-insensitive: the wheel emits lowercase hex while the palette is
        // written uppercase, so a Pro user dialling a swatch's own color by hand
        // must still light that swatch's marker.
        const isSelected = (hex: string): boolean =>
          hex.toLowerCase() === this.value.toLowerCase();
        const refreshMarkers = (): void => {
          for (const { color, btn } of swatchButtons) {
            btn.setButtonText(isSelected(color) ? "●" : " ");
          }
        };
        // Guards the wheel's onChange while we sync it programmatically after a
        // swatch click: Obsidian may re-emit onChange from setValue, which would
        // otherwise be read as a WHEEL pick and refused as Pro-only — locking
        // free users out of the free swatches.
        let syncingWheel = false;
        const syncWheel = (hex: string): void => {
          syncingWheel = true;
          wheel.setValue(hex);
          syncingWheel = false;
        };
        for (const c of colorSwatches()) {
          const locked = c.pro && !isPro;
          swatches.addButton((b) => {
            swatchButtons.push({ color: c.hex, btn: b });
            b.setButtonText(isSelected(c.hex) ? "●" : " ")
              .onClick(() => {
                if (locked) {
                  // Same register as the wheel's refusal: no selection change,
                  // just the door, one click away.
                  proColorNudge(`${c.name} is a Liefwork Pro color`);
                  return;
                }
                this.value = c.hex;
                syncWheel(c.hex);
                refreshMarkers();
              })
              .then((btn) => {
                btn.buttonEl.addClass("liefwork-swatch-btn");
                if (locked) btn.buttonEl.addClass("liefwork-swatch-locked");
                btn.buttonEl.style.setProperty("--liefwork-swatch-color", c.hex);
                if (c.name) btn.setTooltip(locked ? `${c.name} — Liefwork Pro` : c.name);
              });
          });
        }
        let wheel!: { setValue(v: string): void };
        const wheelSetting = new Setting(this.contentEl).setName("Or pick any color");
        if (!isPro) {
          wheelSetting.nameEl.createSpan({ cls: "liefwork-pro-tag", text: "Pro" });
          wheelSetting.setDesc(
            "Any color you like — and the three named deep-sea swatches — are a Liefwork Pro perk. The first five swatches are always free.",
          );
        }
        wheelSetting.addColorPicker((p) => {
          p.setValue(initial).onChange((v) => {
            if (syncingWheel) return; // our own sync after a swatch click
            if (!canSelectColor(v, isPro)) {
              // Gentle upsell, in the support prompts' register — no modal, no
              // selection change, just the door, one click away.
              proColorNudge("Picking any color you like is a Liefwork Pro perk");
              syncWheel(this.value); // snap back to the live selection
              return;
            }
            // A wheel pick moves the selection off the swatches — refresh their
            // markers so the dot doesn't lie about which color is active.
            this.value = v;
            refreshMarkers();
          });
          wheel = p;
        });

        // Spectral pulse — the other Pro perk, mirrored here from the settings
        // tab so it sits where agent colors are actually chosen. It is a GLOBAL
        // choice, not per-terminal (the renderer's spectral shift is one flag
        // over every tint), so the description says so out loud — a toggle in a
        // per-terminal dialog would otherwise read as "this terminal only".
        // Writes persist immediately and push to every open coral, so the
        // effect is visible behind the modal.
        const spectralSetting = new Setting(this.contentEl)
          .setName("Spectral pulse")
          .setDesc("Agent tints drift gently through neighbouring hues as they pulse — every agent, not just this one.");
        if (isPro) {
          spectralSetting.addToggle((t) =>
            t.setValue(spectral.get()).onChange((v) => void spectral.set(v)),
          );
        } else {
          // Visible but locked, exactly as the settings tab shows it.
          spectralSetting.nameEl.createSpan({ cls: "liefwork-pro-tag", text: "Pro" });
          spectralSetting.addToggle((t) => t.setValue(false).setDisabled(true));
        }

        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
          .addButton((b) => b.setButtonText("Open terminal").setCta().onClick(() => this.finish(this.value)));
      }
      private finish(v: string | null) {
        if (this.settled) return;
        this.settled = true;
        this.close();
        resolve(v);
      }
      onClose() {
        if (!this.settled) {
          this.settled = true;
          resolve(null);
        }
      }
    })(app);
    modal.open();
  });
}
