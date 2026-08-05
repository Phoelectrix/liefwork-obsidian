import { App, Modal, Setting } from "obsidian";

/** A one-button "here's why nothing happened" dialog. Used where a command
 *  can't do its job and the honest answer is to say so and stop — never to do
 *  something adjacent instead. */
export function tellUser(app: App, title: string, message: string): void {
  new (class extends Modal {
    onOpen() {
      this.titleEl.setText(title);
      this.contentEl.createEl("p", { text: message });
      new Setting(this.contentEl).addButton((b) =>
        b.setButtonText("OK").setCta().onClick(() => this.close()),
      );
    }
    onClose() {
      this.contentEl.empty();
    }
  })(app).open();
}

/** A yes/no confirmation. Resolves true only if the user clicks the CTA. */
export function confirm(app: App, title: string, message: string, ctaText = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private settled = false;
      onOpen() {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", { text: message });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
          .addButton((b) => b.setButtonText(ctaText).setWarning().onClick(() => this.finish(true)));
      }
      private finish(v: boolean) {
        if (this.settled) return;
        this.settled = true;
        this.close();
        resolve(v);
      }
      onClose() {
        if (!this.settled) {
          this.settled = true;
          resolve(false);
        }
      }
    })(app);
    modal.open();
  });
}

/** Pick one folder level from a list (used by "Reveal in Liefwork coral" when no
 *  open plant already shows the note). `levels` are folder paths ("" = vault
 *  root). Resolves the chosen path, or null if dismissed. */
export function pickFolderLevel(
  app: App,
  title: string,
  levels: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private settled = false;
      onOpen() {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", {
          text: "Open the coral at which folder?",
          cls: "setting-item-description",
        });
        // Deepest (immediate parent) first — the most likely choice.
        for (const path of [...levels].reverse()) {
          const label = path === "" ? "/ (vault root)" : path;
          new Setting(this.contentEl).setName(label).addButton((b) =>
            b.setButtonText("Open").onClick(() => this.finish(path)),
          );
        }
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

/** A one-field text prompt. Resolves the entered (trimmed) name, or null if
 *  cancelled / dismissed / left empty. */
export function promptForName(app: App, title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private value = initial;
      private settled = false;
      onOpen() {
        this.titleEl.setText(title);
        new Setting(this.contentEl).setName("Name").addText((t) => {
          t.setValue(initial).onChange((v) => (this.value = v));
          t.inputEl.focus();
          t.inputEl.select();
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              this.finish(this.value);
            }
          });
        });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
          .addButton((b) => b.setButtonText("Create").setCta().onClick(() => this.finish(this.value)));
      }
      private finish(v: string | null) {
        if (this.settled) return;
        this.settled = true;
        this.close();
        resolve(v && v.trim() ? v.trim() : null);
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
