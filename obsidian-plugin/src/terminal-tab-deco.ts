// obsidian-plugin/src/terminal-tab-deco.ts
import { type WorkspaceLeaf } from "obsidian";

const PILL_CLASS = "liefwork-agent-pill";

// tabHeaderEl/tabHeaderInnerTitleEl are undocumented workspace internals — the only way to decorate a tab header today; both are optional-guarded so an Obsidian change degrades to "no pill", never a crash.
type TabLeaf = WorkspaceLeaf & {
  tabHeaderEl?: HTMLElement;
  tabHeaderInnerTitleEl?: HTMLElement;
};

/** Tint a terminal leaf's tab (color stripe + CSS var) and inject a branch-name
 *  pill BEFORE the plugin's live title — never overwriting that title. */
export function applyTabDeco(leaf: WorkspaceLeaf, color: string, label: string): void {
  const l = leaf as TabLeaf;
  const tab = l.tabHeaderEl;
  if (!tab) return;
  tab.style.setProperty("--liefwork-agent-color", color);
  tab.addClass("liefwork-agent-tab");
  const title = l.tabHeaderInnerTitleEl;
  if (title && !title.querySelector(`.${PILL_CLASS}`)) {
    // createSpan (Obsidian DOM helper) creates in `title`'s own document —
    // correct for terminals popped out to their own window.
    const pill = title.createSpan({ cls: PILL_CLASS, text: label });
    pill.style.setProperty("--liefwork-agent-color", color);
    title.prepend(pill);
  }
}

/** Remove our tab tint + pill. Idempotent. */
export function clearTabDeco(leaf: WorkspaceLeaf): void {
  const l = leaf as TabLeaf;
  const tab = l.tabHeaderEl;
  if (tab) {
    tab.removeClass("liefwork-agent-tab");
    tab.style.removeProperty("--liefwork-agent-color");
  }
  l.tabHeaderInnerTitleEl?.querySelector(`.${PILL_CLASS}`)?.remove();
}
