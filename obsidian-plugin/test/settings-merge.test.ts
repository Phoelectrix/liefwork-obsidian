import { test, expect } from "bun:test";
import { mergeKeeperHook, unmergeKeeperHook, KEEPER_COMMAND } from "../src/settings-merge.ts";
import { CORAL_SETTINGS_JSON } from "../src/seed-templates.ts";

const keeperEntry = (s: any) =>
  (s.hooks?.UserPromptSubmit ?? []).some((g: any) =>
    (g.hooks ?? []).some((h: any) => String(h.command).includes("coral-log-keeper.mjs")),
  );

test("mergeKeeperHook: adds our hook into empty settings", () => {
  const merged = mergeKeeperHook({});
  expect(keeperEntry(merged)).toBe(true);
});

test("mergeKeeperHook: preserves a pre-existing unrelated hook", () => {
  const existing = {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    permissions: { allow: ["Bash"] },
  };
  const merged = mergeKeeperHook(existing);
  expect(keeperEntry(merged)).toBe(true);
  const cmds = merged.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks.map((h: any) => h.command));
  expect(cmds).toContain("echo hi");
  expect(merged.permissions).toEqual({ allow: ["Bash"] });
});

test("mergeKeeperHook: idempotent — no duplicate keeper entry", () => {
  const once = mergeKeeperHook({});
  const twice = mergeKeeperHook(once);
  const count = twice.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks)
    .filter((h: any) => String(h.command).includes("coral-log-keeper.mjs")).length;
  expect(count).toBe(1);
});

test("unmergeKeeperHook: removes our entry, keeps the unrelated one", () => {
  const merged = mergeKeeperHook({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  const out = unmergeKeeperHook(merged);
  expect(keeperEntry(out)).toBe(false);
  const cmds = out.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks.map((h: any) => h.command));
  expect(cmds).toContain("echo hi");
});

test("unmergeKeeperHook: prunes empty containers when we were the only hook", () => {
  const out = unmergeKeeperHook(mergeKeeperHook({}));
  expect(out.hooks).toBeUndefined();
});

test("mergeKeeperHook: tolerates non-object input (null, string)", () => {
  const fromNull = mergeKeeperHook(null);
  expect(keeperEntry(fromNull)).toBe(true);

  const fromString = mergeKeeperHook("string");
  expect(keeperEntry(fromString)).toBe(true);
});

// ── the command must survive a moving working directory ─────────────────────
// Claude Code runs a hook in the SESSION's current directory, which moves as the
// work moves — so a cwd-relative `node .claude/hooks/…` breaks the moment the
// session leaves the coral root (5 Aug: MODULE_NOT_FOUND on every prompt).
// `$CLAUDE_PROJECT_DIR` is the directory Claude Code was started in — the coral
// root, the same directory this settings.json was loaded from.

test("KEEPER_COMMAND anchors the script to $CLAUDE_PROJECT_DIR, never to cwd", () => {
  expect(KEEPER_COMMAND).toContain("$CLAUDE_PROJECT_DIR");
  // The bare relative form is the bug — it must not be what we write.
  expect(KEEPER_COMMAND).not.toBe("node .claude/hooks/coral-log-keeper.mjs");
  // A coral path can contain spaces ("Main Vault", "Lake Carla NG pitch"), so
  // the expansion must be quoted or the shell splits it into argv.
  expect(KEEPER_COMMAND).toMatch(/"\$\{?CLAUDE_PROJECT_DIR[^"]*"/);
});

test("the seeded settings.json registers exactly that command on UserPromptSubmit", () => {
  const settings = JSON.parse(CORAL_SETTINGS_JSON);
  const cmds = settings.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks.map((h: any) => h.command));
  expect(cmds).toEqual([KEEPER_COMMAND]);
});

test("the merge still recognises a coral seeded with the OLD relative command", () => {
  // Corals already in the wild carry `node .claude/hooks/coral-log-keeper.mjs`.
  // Identification is by script name, so merge stays idempotent (no second,
  // duplicate entry) and un-merge still removes theirs.
  const legacy = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node .claude/hooks/coral-log-keeper.mjs" }] }],
    },
  };
  const merged = mergeKeeperHook(legacy);
  const count = merged.hooks!.UserPromptSubmit!.flatMap((g: any) => g.hooks)
    .filter((h: any) => String(h.command).includes("coral-log-keeper.mjs")).length;
  expect(count).toBe(1);
  expect(unmergeKeeperHook(legacy).hooks).toBeUndefined();
});
