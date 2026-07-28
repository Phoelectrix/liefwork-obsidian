import { test, expect } from "bun:test";
import { mergeKeeperHook, unmergeKeeperHook } from "../src/settings-merge.ts";

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
