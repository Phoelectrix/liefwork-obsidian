import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { CORAL_LOG_KEEPER_SCRIPT } from "../src/seed-templates.ts";

// Build a temp coral with a .claude/ keeper + state, then run the script via node.
function makeCoral(state: object | null) {
  const dir = mkdtempSync(join(tmpdir(), "coral-run-"));
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(dir, ".claude", "hooks", "coral-log-keeper.mjs"), CORAL_LOG_KEEPER_SCRIPT);
  if (state) writeFileSync(join(dir, ".claude", ".coral-log-state.json"), JSON.stringify(state));
  return dir;
}

async function run(dir: string) {
  const proc = Bun.spawn(["node", ".claude/hooks/coral-log-keeper.mjs"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(
      `coral-log-keeper exited with code ${proc.exitCode}\nstderr: ${stderr || "(empty)"}\nstdout: ${out || "(empty)"}`
    );
  }

  const statePath = join(dir, ".claude", ".coral-log-state.json");
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (err) {
    throw new Error(
      `coral-log-keeper exited ${proc.exitCode} but state file could not be read: ${(err as Error).message}\nstderr: ${stderr || "(empty)"}`
    );
  }

  return { out, state, code: proc.exitCode };
}

function writeLief(dir: string, relPath: string) {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `---\nkind: prompt\norder: 10\n---\n\n# ${relPath}\n`);
}

test("run: with no liefs the counter increments and a quiet reminder prints", async () => {
  const dir = makeCoral({ recordingPref: "default", counter: 1, lastLiefMtime: 0, threshold: 4 });
  const { out, state, code } = await run(dir);
  expect(code).toBe(0);
  expect(state.counter).toBe(2);
  expect(out).toContain("Coral logging active");
});

test("run: a fresh lief (nested in a subdirectory) resets the counter and prints nothing (counter 0 is silent)", async () => {
  // Lief is nested under Topic/ to prove scanNewestLiefMtime walks recursively.
  // decide() sees newestLiefMtime > lastLiefMtime → counter resets to 0 → reminderFor(0, 4) === null → silent.
  const dir = makeCoral({ recordingPref: "default", counter: 3, lastLiefMtime: 0, threshold: 4 });
  writeLief(dir, "Topic/prompt — hello.md");
  const { out, state } = await run(dir);
  expect(state.counter).toBe(0);
  expect(out.trim()).toBe("");
});

test("run: ad-hoc prints nothing and leaves the counter untouched", async () => {
  const dir = makeCoral({ recordingPref: "adhoc", counter: 5, lastLiefMtime: 0, threshold: 4 });
  const { out, state } = await run(dir);
  expect(out.trim()).toBe("");
  expect(state.counter).toBe(5);
});

test("run: missing state file is recreated with defaults and exits 0", async () => {
  const dir = makeCoral(null);
  const { state, code } = await run(dir);
  expect(code).toBe(0);
  expect(state.recordingPref).toBe("default");
  expect(state.threshold).toBe(4);
});

test("run: corrupt state file does not throw — exit 0, state rebuilt", async () => {
  const dir = makeCoral(null);
  writeFileSync(join(dir, ".claude", ".coral-log-state.json"), "{ not json");
  const { code, state } = await run(dir);
  expect(code).toBe(0);
  expect(state.recordingPref).toBe("default");
});

// ── dir-mtime short-circuit gate tests ─────────────────────────────────────

// Helper: compute the max dir mtime for a coral dir (mirrors maxDirMtime logic,
// excluding .claude and _archive* dirs, stat-only, root included).
function computeMaxDirMtime(rootDir: string): number {
  let max = 0;
  const walk = (d: string) => {
    try {
      const m = statSync(d).mtimeMs;
      if (m > max) max = m;
    } catch {}
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("_archive")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(rootDir);
  return max;
}

test("run gate-closed: when lastDirMtimeMax matches current, counter increments without resetting (no new lief scan needed)", async () => {
  // Build coral with a lief already present.
  const dir = makeCoral(null); // no state yet
  writeLief(dir, "Topic/prompt — existing.md");
  // Capture current max dir mtime AFTER all writes.
  const currentMax = computeMaxDirMtime(dir);
  // Seed state: lastDirMtimeMax = currentMax (gate closed), counter = 1,
  // lastLiefMtime = 0 (not far-future).
  //
  // Discriminant: if the gate works (scan skipped), newestLiefMtime = lastLiefMtime = 0
  // → decide sees 0 > 0 = false → counter increments to 2, never resets to 0.
  // If the gate is broken (scan runs), it finds the real lief mtime (> 0)
  // → decide sees mtime > 0 = true → counter resets to 0. So asserting counter==2 ≠ 0
  // is genuinely falsifiable.
  writeFileSync(
    join(dir, ".claude", ".coral-log-state.json"),
    JSON.stringify({
      recordingPref: "default",
      counter: 1,
      lastLiefMtime: 0,          // NOT far-future: lets decide discriminate
      lastDirMtimeMax: currentMax, // gate is CLOSED (no new dir writes since)
      threshold: 4,
    }),
  );
  const { state } = await run(dir);
  // Gate closed → scan skipped → newestLiefMtime = 0 = lastLiefMtime → increments
  expect(state.counter).toBe(2);   // counter advanced
  expect(state.counter).not.toBe(0); // explicitly: did NOT reset (scan did not run)
  // lastDirMtimeMax is written back
  expect(typeof state.lastDirMtimeMax).toBe("number");
});

test("run gate-open: adding a lief opens the gate, scan runs, counter resets to 0", async () => {
  // Start with lastDirMtimeMax = 0 so any real dir mtime opens the gate.
  const dir = makeCoral({
    recordingPref: "default",
    counter: 3,
    lastLiefMtime: 0,
    lastDirMtimeMax: 0,
    threshold: 4,
  });
  writeLief(dir, "Topic/prompt — new.md");
  const { out, state } = await run(dir);
  expect(state.counter).toBe(0);
  expect(out.trim()).toBe("");
  expect(typeof state.lastDirMtimeMax).toBe("number");
  expect(state.lastDirMtimeMax).toBeGreaterThan(0);
});
