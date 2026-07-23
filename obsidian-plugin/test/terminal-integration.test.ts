import { test, expect } from "bun:test";
import {
  vaultBranchFromCwd,
  branchPillLabel,
  mainAreaTabLeaf,
  openIntegratedTerminal,
  TERMINAL_VIEW_TYPE,
} from "../src/terminal-integration.ts";

const VAULT = "/Users/pav/Vault";

test("vaultBranchFromCwd: nested folder → vault-relative path", () => {
  expect(vaultBranchFromCwd(`${VAULT}/Projects/Alpha`, VAULT)).toBe("Projects/Alpha");
});

test("vaultBranchFromCwd: vault root → empty string", () => {
  expect(vaultBranchFromCwd(VAULT, VAULT)).toBe("");
  expect(vaultBranchFromCwd(`${VAULT}/`, VAULT)).toBe("");
});

test("vaultBranchFromCwd: outside the vault → null", () => {
  expect(vaultBranchFromCwd("/tmp/elsewhere", VAULT)).toBeNull();
});

test("vaultBranchFromCwd: tolerates a trailing slash on the base", () => {
  expect(vaultBranchFromCwd(`${VAULT}/A/B`, `${VAULT}/`)).toBe("A/B");
});

test("branchPillLabel: last segment, or Vault for root", () => {
  expect(branchPillLabel("Projects/Alpha")).toBe("Alpha");
  expect(branchPillLabel("")).toBe("Vault");
  expect(branchPillLabel("/")).toBe("Vault");
});

// ── Main-area routing: a terminal opened from a sidebar coral opens as a NEW
//    TAB in the MAIN editor area (never a sidebar dock, never a pane split) —
//    each agent is one more pinned tab (founder call, 20 July). ──

/** A minimal fake Workspace recording how a leaf was obtained. `mainLeaf` is what
 *  getMostRecentLeaf(rootSplit) returns (null → main area empty). Records
 *  `setActiveLeaf` too, so the re-anchor-before-getLeaf ordering is assertable
 *  (mainAreaTabLeaf's whole fix is that ORDER). */
function fakeWorkspace(mainLeaf?: unknown) {
  const calls: string[] = [];
  const ROOT = { id: "root" };
  const ws = {
    rootSplit: ROOT,
    calls,
    getMostRecentLeaf(root: unknown) {
      calls.push(`getMostRecentLeaf(${root === ROOT ? "rootSplit" : "?"})`);
      return mainLeaf;
    },
    setActiveLeaf(leaf: unknown) {
      calls.push(`setActiveLeaf(${leaf === mainLeaf ? "main" : "?"})`);
    },
    createLeafBySplit(leaf: unknown, dir: string) {
      calls.push(`createLeafBySplit(${leaf === mainLeaf ? "main" : "?"},${dir})`);
      return { id: "split-of-main" };
    },
    getLeaf(kind: string, dir?: string) {
      calls.push(`getLeaf(${kind},${dir})`);
      return { id: "tab-leaf" };
    },
    revealLeaf() {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ws as any;
}

test("mainAreaTabLeaf: re-anchors to the main window's most-recent main-area leaf BEFORE getLeaf('tab'), never a pane split", () => {
  const ws = fakeWorkspace({ id: "main" });
  const leaf = mainAreaTabLeaf(ws);
  expect(leaf).toEqual({ id: "tab-leaf" });
  // Re-anchor happens: getMostRecentLeaf(rootSplit) → setActiveLeaf(main) →
  // THEN getLeaf('tab') — the exact sequence that makes getLeaf resolve in the
  // main window's main area instead of wherever the app-global active leaf is.
  expect(ws.calls).toEqual(["getMostRecentLeaf(rootSplit)", "setActiveLeaf(main)", "getLeaf(tab,undefined)"]);
  expect(ws.calls.some((c: string) => c.startsWith("createLeafBySplit"))).toBe(false);
});

test("mainAreaTabLeaf: main area empty → skips setActiveLeaf, still falls back to getLeaf('tab')", () => {
  const ws = fakeWorkspace(undefined);
  const leaf = mainAreaTabLeaf(ws);
  expect(leaf).toEqual({ id: "tab-leaf" });
  expect(ws.calls).toEqual(["getMostRecentLeaf(rootSplit)", "getLeaf(tab,undefined)"]);
  expect(ws.calls.some((c: string) => c.startsWith("setActiveLeaf"))).toBe(false);
});

/** The Terminal plugin's settings, carrying one integrated profile matched via
 *  the platforms map so these tests pass regardless of the host platform. */
function fakeTerminalPlugins() {
  return {
    // Nested twice: the registry is `app.plugins.plugins[id]`.
    plugins: {
      plugins: {
        terminal: {
          settings: {
            value: {
              profiles: {
                myIntegrated: {
                  type: "integrated",
                  platforms: { darwin: true, linux: true, win32: true },
                },
              },
            },
          },
        },
      },
    },
  };
}

// A terminal opened from a sidebar coral becomes the main area's most-recent
// leaf, so plant-view's `leafForNoteOpen` would reuse it and open the note
// straight over the running agent. That routing spares a leaf only when it is
// pinned — so the terminal has to pin itself on open.
test("openIntegratedTerminal: pins the terminal so a note-open can't replace it", async () => {
  const pinCalls: boolean[] = [];
  const splitLeaf = {
    id: "split-of-main",
    async setViewState() {},
    setPinned: (v: boolean) => pinCalls.push(v),
    view: { getViewType: () => TERMINAL_VIEW_TYPE },
    getDisplayText: () => "Terminal: bash",
  };
  const app = {
    workspace: {
      rootSplit: { id: "root" },
      getMostRecentLeaf: () => undefined, // mainAreaTabLeaf's re-anchor: no main leaf yet
      setActiveLeaf: () => {},
      getLeaf: () => splitLeaf,
      revealLeaf: () => {},
    },
    ...fakeTerminalPlugins(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await openIntegratedTerminal(app as any, "/abs/vault/Work");
  expect(pinCalls).toEqual([true]);
});

// A terminal that failed to launch is detached, so pinning it would leave a
// pinned ghost tab behind.
test("openIntegratedTerminal: does not pin a terminal that failed to launch", async () => {
  const pinCalls: boolean[] = [];
  let detached = false;
  const splitLeaf = {
    id: "split-of-main",
    async setViewState() {},
    setPinned: (v: boolean) => pinCalls.push(v),
    detach: () => {
      detached = true;
    },
    view: { getViewType: () => TERMINAL_VIEW_TYPE },
    getDisplayText: () => "Terminal: Invalid",
  };
  const app = {
    workspace: {
      rootSplit: { id: "root" },
      getMostRecentLeaf: () => undefined, // mainAreaTabLeaf's re-anchor: no main leaf yet
      setActiveLeaf: () => {},
      getLeaf: () => splitLeaf,
      revealLeaf: () => {},
    },
    ...fakeTerminalPlugins(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaf = await openIntegratedTerminal(app as any, "/abs/vault/Work");
  expect(leaf).toBeNull();
  expect(detached).toBe(true);
  expect(pinCalls).toEqual([]);
});

test("openIntegratedTerminal: opens the terminal as a main-area tab (no split)", async () => {
  const splitLeaf = {
    id: "tab-leaf",
    async setViewState() {},
    setPinned() {},
    view: { getViewType: () => TERMINAL_VIEW_TYPE },
    getDisplayText: () => "Terminal: bash",
  };
  const calls: string[] = [];
  const app = {
    workspace: {
      rootSplit: { id: "root" },
      getMostRecentLeaf: () => undefined, // mainAreaTabLeaf's re-anchor: no main leaf yet
      setActiveLeaf: () => {},
      getLeaf: (kind: string) => {
        calls.push(`getLeaf(${kind})`);
        return splitLeaf;
      },
      revealLeaf: () => {},
    },
    plugins: {
      plugins: {
        terminal: {
          settings: {
            value: {
              // A generic integrated profile matched via the platforms map, so the
              // test passes regardless of the host platform.
              profiles: {
                myIntegrated: {
                  type: "integrated",
                  platforms: { darwin: true, linux: true, win32: true },
                },
              },
            },
          },
        },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaf = await openIntegratedTerminal(app as any, "/abs/vault/Work");
  expect(leaf).toBe(splitLeaf as never);
  expect(calls).toContain("getLeaf(tab)");
  expect(calls.some((c: string) => c.startsWith("createLeafBySplit"))).toBe(false);
});
