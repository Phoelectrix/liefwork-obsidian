import { test, expect } from "bun:test";
import {
  SUPPORT_STAGE_COUNT,
  SUPPORT_QUIET_TRIGGERS,
  SUPPORT_CORAL_OPENS_PER_TRIGGER,
  SupportPromptEngine,
  advanceSupportPrompt,
  initialSupportPromptState,
  parseSupportPromptState,
  type SupportPromptAction,
  type SupportPromptState,
} from "../src/support-prompt.ts";
import { SUPPORT_PROMPTS } from "../src/support-prompt-copy.ts";

const S = (
  stage: number,
  quiet = 0,
  iceCreamNext = true,
  coralOpens = 0,
  met = false,
): SupportPromptState => ({
  stage,
  quiet,
  iceCreamNext,
  coralOpens,
  met,
});

function newEngine(state?: SupportPromptState) {
  const persisted: SupportPromptState[] = [];
  const engine = new SupportPromptEngine((s) => {
    persisted.push(s);
    return Promise.resolve();
  });
  if (state) engine.load(state);
  return { engine, persisted };
}

// --- advanceSupportPrompt: single-step rule table ------------------------------

const STEPS: {
  name: string;
  from: SupportPromptState;
  to: SupportPromptState;
  action: SupportPromptAction | null;
}[] = [
  { name: "fresh install → first gentle prompt", from: S(0), to: S(1), action: { kind: "stage", stage: 1 } },
  { name: "stage 1 → prompt 2", from: S(1), to: S(2), action: { kind: "stage", stage: 2 } },
  { name: "stage 4 → fifth and last gentle prompt", from: S(4), to: S(5), action: { kind: "stage", stage: 5 } },
  { name: "after stage 5 → first quiet beat (silent advance)", from: S(5, 0), to: S(5, 1), action: null },
  { name: "quiet 2 → third quiet beat, still silent", from: S(5, 2), to: S(5, 3), action: null },
  { name: "quiet done + parity on → Ice Cream Man, parity flips off, MET is set", from: S(5, 3, true), to: S(5, 3, false, 0, true), action: { kind: "ice-cream" } },
  { name: "quiet done + parity off → silent, parity flips back on (met untouched)", from: S(5, 3, false, 0, true), to: S(5, 3, true, 0, true), action: null },
];

for (const c of STEPS) {
  test(`advance: ${c.name}`, () => {
    expect(advanceSupportPrompt(c.from)).toEqual({ state: c.to, action: c.action });
  });
}

test("advance: never mutates its input state", () => {
  const from = S(5, 3, true);
  advanceSupportPrompt(from);
  expect(from).toEqual(S(5, 3, true));
});

// --- the whole lifecycle, one qualifying trigger after another -----------------

test("advance: full lifecycle — 5 prompts, 3 quiet, then Ice Cream Man every other trigger forever", () => {
  const expected: (SupportPromptAction | null)[] = [
    { kind: "stage", stage: 1 },
    { kind: "stage", stage: 2 },
    { kind: "stage", stage: 3 },
    { kind: "stage", stage: 4 },
    { kind: "stage", stage: 5 },
    null, // quiet 1
    null, // quiet 2
    null, // quiet 3
    { kind: "ice-cream" },
    null,
    { kind: "ice-cream" },
    null,
    { kind: "ice-cream" }, // …and so on until the end of time
  ];
  let state = initialSupportPromptState();
  for (const [i, want] of expected.entries()) {
    const r = advanceSupportPrompt(state);
    expect({ trigger: i + 1, action: r.action }).toEqual({ trigger: i + 1, action: want });
    state = r.state;
  }
});

// --- engine gating: pro-silence + once per session ------------------------------

test("engine: pro is a complete no-op — no action, no advance, no persist, no session spend", () => {
  const { engine, persisted } = newEngine();
  expect(engine.onQualifyingTrigger(true)).toBeNull();
  expect(engine.getState()).toEqual(S(0));
  expect(persisted).toEqual([]);
  // The pro trigger didn't burn the session's one advance: if the key were
  // removed mid-session, the next trigger still prompts.
  expect(engine.onQualifyingTrigger(false)).toEqual({ kind: "stage", stage: 1 });
});

test("engine: pro stays silent even deep in the lifecycle", () => {
  const { engine, persisted } = newEngine(S(5, 3, true));
  expect(engine.onQualifyingTrigger(true)).toBeNull();
  expect(engine.getState()).toEqual(S(5, 3, true));
  expect(persisted).toEqual([]);
});

test("engine: at most one advance per session — later triggers are no-ops", () => {
  const { engine, persisted } = newEngine();
  expect(engine.onQualifyingTrigger(false)).toEqual({ kind: "stage", stage: 1 });
  expect(engine.onQualifyingTrigger(false)).toBeNull();
  expect(engine.onQualifyingTrigger(false)).toBeNull();
  expect(engine.getState()).toEqual(S(1));
  expect(persisted).toEqual([S(1)]);
});

test("engine: a silent quiet beat still spends the session's one advance", () => {
  const { engine, persisted } = newEngine(S(5, 0));
  expect(engine.onQualifyingTrigger(false)).toBeNull(); // quiet 1, silent
  expect(engine.onQualifyingTrigger(false)).toBeNull(); // same session → no advance
  expect(engine.getState()).toEqual(S(5, 1));
  expect(persisted).toEqual([S(5, 1)]);
});

test("engine: sessions chain — each new engine resumes from the persisted state", () => {
  // Simulate five one-trigger Obsidian sessions: a fresh engine per session,
  // loading whatever the previous one persisted.
  let saved: SupportPromptState | undefined;
  const actions: (SupportPromptAction | null)[] = [];
  for (let session = 0; session < 5; session++) {
    const { engine, persisted } = newEngine(saved);
    actions.push(engine.onQualifyingTrigger(false));
    saved = persisted.at(-1);
  }
  expect(actions).toEqual([
    { kind: "stage", stage: 1 },
    { kind: "stage", stage: 2 },
    { kind: "stage", stage: 3 },
    { kind: "stage", stage: 4 },
    { kind: "stage", stage: 5 },
  ]);
  expect(saved).toEqual(S(5));
});

// --- parseSupportPromptState (persisted-data revival) ---------------------------

test("parse: revives a valid persisted state verbatim", () => {
  expect(parseSupportPromptState(S(3, 0, true))).toEqual(S(3, 0, true));
  expect(parseSupportPromptState(S(5, 3, false))).toEqual(S(5, 3, false));
});

test("parse: garbage falls back field-by-field to the fresh default", () => {
  expect(parseSupportPromptState(null)).toEqual(S(0));
  expect(parseSupportPromptState(undefined)).toEqual(S(0));
  expect(parseSupportPromptState("nope")).toEqual(S(0));
  expect(parseSupportPromptState({})).toEqual(S(0));
  expect(parseSupportPromptState({ stage: "5", quiet: -1, iceCreamNext: 1 })).toEqual(S(0));
  expect(parseSupportPromptState({ stage: 2.5, quiet: 2 })).toEqual(S(0, 2));
});

test("parse: out-of-range counters clamp to their maxima, never overshoot", () => {
  expect(parseSupportPromptState({ stage: 99, quiet: 99, iceCreamNext: false })).toEqual(
    S(SUPPORT_STAGE_COUNT, SUPPORT_QUIET_TRIGGERS, false),
  );
});

// --- the SECOND trigger: opening a folder as a coral ------------------------------
// The terminal trigger (a 2nd agent terminal) selects for users the plugin is
// working hard for — but it's rare, so most users never met the prompts at all.
// Opening a coral is the everyday act, so every Nth open takes a trigger and walks
// the SAME ladder (stages → quiet → Ice Cream Man). It is deliberately blunted:
// 1-in-N, and the once-per-session cap still applies on top.

test("coral opens: the first N-1 are silent and just count", () => {
  const { engine, persisted } = newEngine();
  for (let i = 1; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) {
    expect(engine.onCoralOpened(false)).toBeNull();
    expect(engine.getState().coralOpens).toBe(i);
  }
  // Counting persists — the tally must survive a restart, or a user who opens a
  // coral or two per session would never reach a trigger.
  expect(persisted.length).toBe(SUPPORT_CORAL_OPENS_PER_TRIGGER - 1);
});

test("coral opens: the Nth is a qualifying trigger and resets the tally", () => {
  const { engine } = newEngine();
  let action = null;
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) action = engine.onCoralOpened(false);
  expect(action).toEqual({ kind: "stage", stage: 1 });
  expect(engine.getState().coralOpens).toBe(0);
  expect(engine.getState().stage).toBe(1);
});

test("coral opens: walks the same ladder — reaching the Ice Cream Man", () => {
  // Parked at the end of the quiet spell with the parity bit up.
  const { engine } = newEngine(S(SUPPORT_STAGE_COUNT, SUPPORT_QUIET_TRIGGERS, true));
  let action = null;
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) action = engine.onCoralOpened(false);
  expect(action).toEqual({ kind: "ice-cream" });
});

test("coral opens: Pro is never counted, let alone prompted", () => {
  const { engine, persisted } = newEngine();
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER * 3; i++) {
    expect(engine.onCoralOpened(true)).toBeNull();
  }
  expect(engine.getState().coralOpens).toBe(0);
  expect(persisted).toHaveLength(0);
});

test("coral opens: once prompted this session, further opens don't burn the tally", () => {
  const { engine } = newEngine();
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) engine.onCoralOpened(false);
  expect(engine.getState().coralOpens).toBe(0);
  // The session's one advance is spent; opens now neither prompt nor accumulate,
  // so the next session starts the count fresh rather than firing immediately.
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) {
    expect(engine.onCoralOpened(false)).toBeNull();
  }
  expect(engine.getState().coralOpens).toBe(0);
});

test("coral opens: the terminal trigger still shares the session cap", () => {
  const { engine } = newEngine();
  // A coral-open trigger spends the session's advance…
  for (let i = 0; i < SUPPORT_CORAL_OPENS_PER_TRIGGER; i++) engine.onCoralOpened(false);
  // …so a 2nd-terminal trigger in the same session stays silent.
  expect(engine.onQualifyingTrigger(false)).toBeNull();
});

// --- met: the Ice Cream Man introduction flag ------------------------------------
// Unlocks the free user's "See the Ice Cream Man" menu item — he introduces
// himself before he can be summoned. Set once, never unset.

test("met: the engine reports it false until the first appearance, true after", () => {
  const { engine } = newEngine(S(5, 3, true));
  expect(engine.hasMetIceCreamMan()).toBe(false);
  expect(engine.onQualifyingTrigger(false)).toEqual({ kind: "ice-cream" });
  expect(engine.hasMetIceCreamMan()).toBe(true);
});

test("met: persists — a later session revives it", () => {
  const { engine, persisted } = newEngine(S(5, 3, true));
  engine.onQualifyingTrigger(false);
  const { engine: nextSession } = newEngine(parseSupportPromptState(persisted.at(-1)));
  expect(nextSession.hasMetIceCreamMan()).toBe(true);
});

test("parse: met revives only from a literal true — junk is false", () => {
  expect(parseSupportPromptState(S(5, 3, false, 0, true)).met).toBe(true);
  expect(parseSupportPromptState({ met: 1 }).met).toBe(false);
  expect(parseSupportPromptState({ met: "true" }).met).toBe(false);
  expect(parseSupportPromptState({}).met).toBe(false);
});

test("parse: a missing or junk coralOpens falls back to 0", () => {
  expect(parseSupportPromptState({ stage: 2 }).coralOpens).toBe(0);
  expect(parseSupportPromptState({ coralOpens: -3 }).coralOpens).toBe(0);
  expect(parseSupportPromptState({ coralOpens: "x" }).coralOpens).toBe(0);
  // Clamped, so a hand-edited file can't park it above the trigger point.
  expect(parseSupportPromptState({ coralOpens: 99 }).coralOpens).toBe(
    SUPPORT_CORAL_OPENS_PER_TRIGGER - 1,
  );
});

// --- the copy ---------------------------------------------------------------------

test("copy: one prompt per stage, none empty, all multi-paragraph", () => {
  expect(SUPPORT_PROMPTS).toHaveLength(SUPPORT_STAGE_COUNT);
  for (const text of SUPPORT_PROMPTS) {
    expect(text.length).toBeGreaterThan(0);
    expect(text.split("\n\n").length).toBeGreaterThan(1);
  }
});
