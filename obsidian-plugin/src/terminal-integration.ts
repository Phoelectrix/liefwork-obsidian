// Pure helpers (unit-tested). Obsidian-touching launch/detection helpers are
// added below in Task 4 and are live-verified.

/** The vault-relative branch path for a terminal's absolute cwd, or null if the
 *  cwd is outside the vault. Vault root → "". */
export function vaultBranchFromCwd(cwd: string, vaultBasePath: string): string | null {
  const base = vaultBasePath.replace(/\/+$/, "");
  const dir = cwd.replace(/\/+$/, "");
  if (dir === base) return "";
  const prefix = `${base}/`;
  if (!dir.startsWith(prefix)) return null;
  return dir.slice(prefix.length);
}

/** Display label for the tab pill: the branch's own folder name, or "Vault". */
export function branchPillLabel(branchPath: string): string {
  if (branchPath === "" || branchPath === "/") return "Vault";
  const segs = branchPath.split("/");
  return segs[segs.length - 1];
}

// ── Obsidian-touching helpers (Task 4, live-verified) ─────────────────────

import { type App, type Workspace, type WorkspaceLeaf } from "obsidian";

export const TERMINAL_PLUGIN_ID = "terminal";
export const TERMINAL_VIEW_TYPE = "terminal:terminal";

interface TerminalProfile {
  type?: string;
  platforms?: Record<string, boolean>;
}

/** The Terminal plugin object, defensively typed (not in the public API). */
// Private API: reads the community Terminal plugin's registry entry + settings shape (no public inter-plugin API exists). Fully optional-typed — any Terminal refactor degrades to resolveIntegratedProfile() → null → the manual-binding Notice fallback, never a crash.
function terminalPlugin(app: App): { settings?: { value?: { profiles?: Record<string, TerminalProfile> } } } | undefined {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
  return plugins?.plugins?.[TERMINAL_PLUGIN_ID] as
    | { settings?: { value?: { profiles?: Record<string, TerminalProfile> } } }
    | undefined;
}

/** Whether the community Terminal plugin is installed + enabled. */
export function isTerminalPluginAvailable(app: App): boolean {
  return Boolean(terminalPlugin(app));
}

/** The user's configured integrated-terminal profile for this platform, read from
 *  the Terminal plugin's settings. The plugin needs a valid profile in the view
 *  state to launch a shell; without one it opens an "Invalid" terminal. Returns
 *  null if none is found (→ caller falls back to a manual binding). */
function resolveIntegratedProfile(app: App): TerminalProfile | null {
  const profiles = terminalPlugin(app)?.settings?.value?.profiles;
  if (!profiles) return null;
  // process.platform is "darwin" | "win32" | "linux" — exactly the prefixes the
  // Terminal plugin keys its default profiles by. Accessed without importing a
  // runtime value (so unit tests of this module's pure helpers don't try to
  // resolve the `obsidian` package).
  const plat =
    (typeof window !== "undefined"
      ? (window as Window & { process?: { platform?: string } }).process?.platform
      : undefined) ?? "darwin";
  const preferred = profiles[`${plat}IntegratedDefault`];
  if (preferred?.type === "integrated") return preferred;
  for (const p of Object.values(profiles)) {
    if (p?.type === "integrated" && p.platforms?.[plat]) return p;
  }
  return null;
}

/** A NEW TAB in the MAIN editor area's most-recent tab group — never a sidebar
 *  dock, never a pane split, and never the wrong WINDOW. `getLeaf("tab")`
 *  resolves against the app-GLOBAL active leaf, not the root split — from a
 *  sidebar coral that can wedge the tab into the sidebar itself, and with a
 *  pop-out window focused it opens in that other window entirely (the same
 *  two failure modes `plant-view.ts`'s `openNoteInNewTab` re-anchors against,
 *  and the 16-July pop-out bug notes). Re-anchor first, exactly like
 *  `openNoteInNewTab`: find the MAIN window's most-recent main-area leaf via
 *  `rootSplit` (this is what makes the anchor pop-out-safe — `rootSplit` is
 *  always the main window's root split) and activate it so `getLeaf("tab")`
 *  then resolves there, giving each agent terminal one more (pinned) tab
 *  beside the user's notes instead of carving the pane down (founder call, 20
 *  July — the old horizontal split stacked the main area once per agent). */
export function mainAreaTabLeaf(ws: Workspace): WorkspaceLeaf {
  const main = ws.getMostRecentLeaf(ws.rootSplit);
  if (main) ws.setActiveLeaf(main, { focus: false });
  return ws.getLeaf("tab");
}

/** Open an integrated terminal at an absolute folder path, returning its leaf.
 *  Returns null if the plugin is absent, no integrated profile exists, or the
 *  open fails (in which case the caller creates a manual binding instead). */
export async function openIntegratedTerminal(
  app: App,
  folderAbsPath: string,
): Promise<WorkspaceLeaf | null> {
  const profile = resolveIntegratedProfile(app);
  if (!profile) return null;
  let leaf: WorkspaceLeaf | null = null;
  try {
    leaf = mainAreaTabLeaf(app.workspace);
    // The Terminal plugin nests its view state under the view-type key and
    // needs both a cwd and a valid profile to launch a shell.
    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
      state: { [TERMINAL_VIEW_TYPE]: { cwd: folderAbsPath, profile, focus: true, serial: null } },
    });
    await app.workspace.revealLeaf(leaf);
    // Guard a silent ignore or a failed launch ("Terminal: Invalid").
    if (leaf.view?.getViewType?.() !== TERMINAL_VIEW_TYPE || leaf.getDisplayText() === "Terminal: Invalid") {
      leaf.detach();
      return null;
    }
    // Pin it: the terminal opens as a MAIN-area tab, so it becomes that area's
    // most-recent leaf — and `plant-view.leafForNoteOpen` reuses exactly that
    // leaf for a note opened from a sidebar coral, replacing the running agent
    // with the note. That routing spares a leaf only when it is pinned.
    leaf.setPinned(true);
    return leaf;
  } catch {
    leaf?.detach();
    return null;
  }
}
