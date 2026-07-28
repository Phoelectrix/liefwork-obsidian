import { App, Modal, Setting } from "obsidian";
import { PRO_CHECKOUT_URL } from "./pro.ts";
import { SUPPORT_NO_LABEL, SUPPORT_YES_LABEL } from "./support-prompt-copy.ts";

/** The gentle support dialog: a stage's copy (support-prompt-copy.ts) as body
 *  paragraphs plus the spec's two verbatim dialogue options — "Sure, I'll
 *  help!" opens the checkout page and closes; "Not now, thanks." (and the
 *  modal's standard X) just closes. Which stage shows, and when, is entirely
 *  the engine's business (support-prompt.ts). */
export class SupportPromptModal extends Modal {
  constructor(
    app: App,
    private readonly body: string,
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("liefwork-support-prompt");
    const body = this.contentEl.createDiv({ cls: "liefwork-support-prompt-body" });
    for (const para of this.body.split("\n\n")) {
      body.createEl("p", { text: para });
    }
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(SUPPORT_NO_LABEL).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(SUPPORT_YES_LABEL)
          .setCta()
          .onClick(() => {
            window.open(PRO_CHECKOUT_URL);
            this.close();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
