// Show/hide via the shared .lw-hidden class instead of inline `style.display`
// literals (which Obsidian's plugin review forbids — static styles belong in
// stylesheets). The rule ships in BOTH style.css (site/Studio) and the
// plugin's scoped styles.css; dom-visibility.test.ts pins both copies.
// Element (not HTMLElement) so SVG stencil groups need no casts.
export const HIDDEN_CLASS = "lw-hidden";

export function setHidden(el: Element, hidden: boolean): void {
  el.classList.toggle(HIDDEN_CLASS, hidden);
}

export function isHidden(el: Element): boolean {
  return el.classList.contains(HIDDEN_CLASS);
}
