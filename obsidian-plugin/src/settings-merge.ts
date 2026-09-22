/**
 * Pure merge/un-merge of the Coral Logging Keeper's UserPromptSubmit hook into
 * an arbitrary `.claude/settings.json` object. Used by the seed writer
 * (brownfield: a settings.json already exists) and by de-seed (Undo). Identifies
 * our entry solely by the keeper command string, so it never touches unrelated
 * hooks or top-level keys.
 */

/** The registered hook command. Anchored to `$CLAUDE_PROJECT_DIR` — the
 *  directory Claude Code was started in, which is the same directory this
 *  `settings.json` was loaded from, i.e. the coral root.
 *
 *  It must NOT be cwd-relative. A hook runs in the SESSION's current working
 *  directory, and that moves as the work moves: on 5 Aug a session launched at a
 *  coral root walked down into a branch folder, and `node
 *  .claude/hooks/coral-log-keeper.mjs` then resolved against the branch —
 *  MODULE_NOT_FOUND, thrown on every prompt for the rest of the session.
 *  Quoted, because coral paths have spaces in them ("Main Vault").
 *
 *  Identification of our entry (see `isKeeperGroup`) is by SCRIPT NAME, not by
 *  this exact string, so corals seeded with the old relative command are still
 *  recognised — merge stays idempotent and de-seed still un-merges them. */
export const KEEPER_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/coral-log-keeper.mjs"';

export interface HookEntry { type?: string; command?: string }
export interface HookGroup { hooks?: HookEntry[] }
interface HooksMap extends Record<string, unknown> { UserPromptSubmit?: HookGroup[] }
export type Settings = Record<string, unknown> & { hooks?: HooksMap };

function isKeeperGroup(group: HookGroup): boolean {
  return Array.isArray(group?.hooks) &&
    group.hooks.some((h) => String(h?.command).includes("coral-log-keeper.mjs"));
}

export function mergeKeeperHook(existing: unknown): Settings {
  const s: Settings = existing && typeof existing === "object" ? { ...(existing as Settings) } : {};
  const hooks: HooksMap = { ...(s.hooks ?? {}) };
  const ups: HookGroup[] = Array.isArray(hooks.UserPromptSubmit) ? [...hooks.UserPromptSubmit] : [];
  if (!ups.some(isKeeperGroup)) {
    ups.push({ hooks: [{ type: "command", command: KEEPER_COMMAND }] });
  }
  hooks.UserPromptSubmit = ups;
  s.hooks = hooks;
  return s;
}

export function unmergeKeeperHook(existing: unknown): Settings {
  const s: Settings = existing && typeof existing === "object" ? { ...(existing as Settings) } : {};
  if (!s.hooks || !Array.isArray(s.hooks.UserPromptSubmit)) return s;
  const hooks: HooksMap = { ...s.hooks };
  const ups = (hooks.UserPromptSubmit ?? []).filter((g) => !isKeeperGroup(g));
  if (ups.length === 0) {
    delete hooks.UserPromptSubmit;
  } else {
    hooks.UserPromptSubmit = ups;
  }
  if (Object.keys(hooks).length === 0) {
    delete s.hooks;
  } else {
    s.hooks = hooks;
  }
  return s;
}
