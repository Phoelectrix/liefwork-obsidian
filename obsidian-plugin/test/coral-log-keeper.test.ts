import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORAL_LOG_KEEPER_SCRIPT } from "../src/seed-templates.ts";

// Materialize the shipped script to a temp .mjs and import its exported pure fns.
let mod: any;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "coral-keeper-"));
  const file = join(dir, "coral-log-keeper.mjs");
  writeFileSync(file, CORAL_LOG_KEEPER_SCRIPT);
  mod = await import(file);
});

const base = () => ({ recordingPref: "default", counter: 0, lastLiefMtime: 1000, threshold: 4 });

test("reminderFor: counter 0 is silent", () => {
  expect(mod.reminderFor(0, 4)).toBeNull();
});

test("reminderFor: quiet tier for 1..T-2", () => {
  expect(mod.reminderFor(1, 4)).toContain("Coral logging active");
  expect(mod.reminderFor(2, 4)).toContain("Coral logging active");
});

test("reminderFor: firm tier at T-1 and T carries the ad-hoc off-ramp", () => {
  for (const c of [3, 4]) {
    const m = mod.reminderFor(c, 4);
    expect(m).toContain("since the last lief");
    expect(m).toContain("ad-hoc");
  }
});

test("reminderFor: firm+specific tier above T", () => {
  const m = mod.reminderFor(5, 4);
  expect(m).toContain("Pause and log");
  expect(m).toContain("ad-hoc");
});

test("decide: a newer lief resets the counter to 0 and advances lastLiefMtime", () => {
  const { state, message } = mod.decide({ ...base(), counter: 3 }, 2000);
  expect(state.counter).toBe(0);
  expect(state.lastLiefMtime).toBe(2000);
  expect(message).toBeNull();
});

test("decide: no new lief increments the counter", () => {
  const { state, message } = mod.decide({ ...base(), counter: 1 }, 1000);
  expect(state.counter).toBe(2);
  expect(state.lastLiefMtime).toBe(1000);
  expect(message).toContain("Coral logging active");
});

test("decide: ad-hoc is always silent and leaves state untouched", () => {
  const st = { ...base(), recordingPref: "adhoc", counter: 9 };
  const { state, message } = mod.decide(st, 5000);
  expect(message).toBeNull();
  expect(state.counter).toBe(9);
});

// ── maxDirMtime ────────────────────────────────────────────────────────────────

test("maxDirMtime: returns max mtime across nested dirs", () => {
  const root = mkdtempSync(join(tmpdir(), "mdir-"));
  mkdirSync(join(root, "Topic", "Sub"), { recursive: true });
  // root itself + Topic + Topic/Sub all exist; result must be > 0
  const result = mod.maxDirMtime(root);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThan(0);
});

test("maxDirMtime: adding a new nested subdir raises the value", async () => {
  const root = mkdtempSync(join(tmpdir(), "mdir2-"));
  mkdirSync(join(root, "Topic"), { recursive: true });
  const before = mod.maxDirMtime(root);
  // small delay so the new dir gets a strictly later mtime
  await new Promise((r) => setTimeout(r, 20));
  mkdirSync(join(root, "Topic", "NewBranch"), { recursive: true });
  const after = mod.maxDirMtime(root);
  expect(after).toBeGreaterThan(before);
});

test("maxDirMtime: dot-dirs are excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "mdir3-"));
  const dotDir = join(root, ".claude");
  mkdirSync(dotDir, { recursive: true });
  mkdirSync(join(root, "Topic"), { recursive: true });
  // Stamp .claude with a far-future mtime (now + 1e9 seconds).
  // A correct impl excludes it → result < futureMtime.
  // A buggy impl that walks .claude would return futureMtime and fail.
  const futureDate = new Date(Date.now() + 1e9 * 1000);
  utimesSync(dotDir, futureDate, futureDate);
  const futureMtime = futureDate.getTime();
  const result = mod.maxDirMtime(root);
  expect(result).toBeGreaterThan(0);           // positive control: root/Topic counted
  expect(result).toBeLessThan(futureMtime);    // discriminant: .claude mtime was NOT counted
});

test("maxDirMtime: _archive dirs are excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "mdir4-"));
  const archiveDir = join(root, "_archive-old");
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(join(root, "Topic"), { recursive: true });
  // Stamp _archive-old with a far-future mtime.
  // A correct impl excludes it → result < futureMtime.
  // A buggy impl that walks _archive-old would return futureMtime and fail.
  const futureDate = new Date(Date.now() + 1e9 * 1000);
  utimesSync(archiveDir, futureDate, futureDate);
  const futureMtime = futureDate.getTime();
  const result = mod.maxDirMtime(root);
  expect(result).toBeGreaterThan(0);           // positive control: root/Topic counted
  expect(result).toBeLessThan(futureMtime);    // discriminant: _archive-old mtime was NOT counted
});
