import { App, Modal, Setting } from "obsidian";
import { PRO_CHECKOUT_URL } from "./pro.ts";
import {
  ICE_CREAM_PANELS,
  ICE_CREAM_START,
  advanceIceCream,
  type IceCreamPanelKey,
} from "./ice-cream-man.ts";
import { ICE_CREAM_ASSETS } from "./ice-cream-man-assets.ts";

/** The Ice Cream Man clickventure dialog — a thin renderer over the pure
 *  panel flow in ice-cream-man.ts: art slot on top (ICE_CREAM_ASSETS), the
 *  panel's copy, then its dialogue options as buttons. Every click runs
 *  advanceIceCream; a checkout step opens the Pro checkout page. The modal's
 *  standard X closes from any panel, ending the vignette for this trigger
 *  (the engine's parity advance already happened — see support-prompt.ts).
 *
 *  `isPro` forks the flow at the cone's thank-you: a supporter gets the gratitude
 *  send-off instead of the collection basket. It reaches every advanceIceCream
 *  call rather than being read once, so the whole walk stays consistent. */
export class IceCreamManModal extends Modal {
  constructor(
    app: App,
    private readonly isPro = false,
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("liefwork-ice-cream-man");
    this.renderPanel(ICE_CREAM_START);
  }

  private renderPanel(key: IceCreamPanelKey): void {
    const panel = ICE_CREAM_PANELS[key];
    this.contentEl.empty();
    this.contentEl
      .createDiv({ cls: "liefwork-ice-cream-art" })
      // Decorative (the copy carries the scene), hence the empty alt.
      .createEl("img", { attr: { src: ICE_CREAM_ASSETS[key], alt: "" } });
    // One <p> per line: the bodies carry "\n" where the author wants a break.
    // As a single paragraph beneath 360px of art the patter read as a wall of
    // text — and it's a series of beats, not a block. Splitting here (rather than
    // guessing sentence boundaries with a regex) keeps the breaks authored: the
    // copy is data, and where it breathes is the author's call, not punctuation's.
    const body = this.contentEl.createDiv({ cls: "liefwork-ice-cream-body" });
    for (const line of panel.body.split("\n")) body.createEl("p", { text: line });
    if (panel.choices.length === 0) return; // terminal panel — only the X remains
    const buttons = new Setting(this.contentEl);
    for (const [index, choice] of panel.choices.entries()) {
      buttons.addButton((b) => {
        b.setButtonText(choice.label).onClick(() => {
          const step = advanceIceCream(key, { kind: "choose", index }, this.isPro);
          if (step.checkout) window.open(PRO_CHECKOUT_URL);
          if (step.panel === null) this.close();
          else this.renderPanel(step.panel);
        });
        if (choice.cta) b.setCta();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
