/** Support-prompt engine — the pacing brain behind the "please consider Pro"
 *  dialogs (copy in support-prompt-copy.ts, dialog in support-prompt-modal.ts).
 *
 *  Qualifying trigger: opening a SECOND coral agent terminal while one is
 *  already live (detected in main.ts off the BindingStore change signal) —
 *  the moment that selects for users the plugin is actively working for.
 *
 *  Lifecycle across qualifying triggers (spec: "Payment Prompt & Mechanics"):
 *    stages 1–5  one gentle prompt per trigger,
 *    quiet       then 3 triggers of silence,
 *    parity      then the Ice Cream Man on every OTHER trigger, forever
 *                (the clickventure itself is Task 2.3 — main.ts holds the hook).
 *  Pacing: at most one state advance per Obsidian session (silent quiet/parity
 *  beats included), and a Pro user is never prompted and never advanced.
 *
 *  Obsidian-free by design (mirrors ProStore): persistence is injected, so
 *  every rule is unit-testable offline. */

export const SUPPORT_STAGE_COUNT = 5;
export const SUPPORT_QUIET_TRIGGERS = 3;
/** Coral opens per qualifying trigger — the SECOND trigger's blunting factor.
 *  A 2nd agent terminal selects for users the plugin is working hard for, but it
 *  is rare enough that most users never met the prompts at all; opening a coral
 *  is the everyday act. Hence 1-in-5 — and the once-per-session cap still applies
 *  on top, so the ceiling stays one prompt per Obsidian session either way. */
export const SUPPORT_CORAL_OPENS_PER_TRIGGER = 5;

/** The persisted slice in plugin data (the once-per-session flag is NOT here —
 *  it lives in memory inside the engine and resets with Obsidian). */
export interface SupportPromptState {
  /** Gentle prompts shown so far, 0–SUPPORT_STAGE_COUNT. */
  stage: number;
  /** Post-stage-5 quiet triggers consumed, 0–SUPPORT_QUIET_TRIGGERS. */
  quiet: number;
  /** Parity bit: whether the next post-quiet trigger shows the Ice Cream Man. */
  iceCreamNext: boolean;
  /** Coral opens since the last coral-open trigger, 0–(N−1). Persisted, unlike
   *  the session flag: a user who opens a coral or two per session would never
   *  reach a trigger if the tally reset with every restart. */
  coralOpens: number;
  /** The Ice Cream Man has appeared at least once (the spec's `iceCreamManMet`).
   *  Unlocks the free user's "See the Ice Cream Man" coral-menu item — he must
   *  introduce himself before he can be summoned. Pro needs no flag: its menu
   *  item is unconditional, since Pro silences his only natural entrance. */
  met: boolean;
}

export type SupportPromptAction =
  /** Show the gentle support dialog for this stage (1-based → SUPPORT_PROMPTS[stage - 1]). */
  | { kind: "stage"; stage: number }
  /** Open the Ice Cream Man clickventure (Task 2.3). */
  | { kind: "ice-cream" };

export function initialSupportPromptState(): SupportPromptState {
  return { stage: 0, quiet: 0, iceCreamNext: true, coralOpens: 0, met: false };
}

/** One qualifying trigger's state advance — the pure rule table. EVERY trigger
 *  that reaches here advances the state, even when the action is silence (a
 *  quiet beat or the off-parity beat); pro-silence and once-per-session gating
 *  live in the engine, which decides whether a trigger reaches here at all. */
export function advanceSupportPrompt(state: SupportPromptState): {
  state: SupportPromptState;
  action: SupportPromptAction | null;
} {
  if (state.stage < SUPPORT_STAGE_COUNT) {
    const stage = state.stage + 1;
    return { state: { ...state, stage }, action: { kind: "stage", stage } };
  }
  if (state.quiet < SUPPORT_QUIET_TRIGGERS) {
    return { state: { ...state, quiet: state.quiet + 1 }, action: null };
  }
  const fires = state.iceCreamNext;
  return {
    state: { ...state, iceCreamNext: !fires, met: state.met || fires },
    action: fires ? { kind: "ice-cream" } : null,
  };
}

/** Revive the persisted state from plugin data; anything malformed falls back
 *  field-by-field to the fresh default (a hand-edited data file must never
 *  crash the plugin — worst case the gentle sequence restarts). */
export function parseSupportPromptState(raw: unknown): SupportPromptState {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const int = (v: unknown, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0;
  return {
    stage: int(r.stage, SUPPORT_STAGE_COUNT),
    quiet: int(r.quiet, SUPPORT_QUIET_TRIGGERS),
    iceCreamNext: typeof r.iceCreamNext === "boolean" ? r.iceCreamNext : true,
    // Clamped BELOW the trigger point: a hand-edited file must not be able to
    // park the tally at N and fire a prompt on the very next coral open.
    coralOpens: int(r.coralOpens, SUPPORT_CORAL_OPENS_PER_TRIGGER - 1),
    met: r.met === true,
  };
}

/** Holds the support-prompt lifecycle for the whole plugin. Persistence is
 *  injected (same idiom as ProStore) so the engine stays Obsidian-free. */
export class SupportPromptEngine {
  private state = initialSupportPromptState();
  /** Once-per-session pacing flag — set on the first advance, never persisted. */
  private advancedThisSession = false;

  constructor(private readonly persist: (state: SupportPromptState) => Promise<void>) {}

  getState(): SupportPromptState {
    return { ...this.state };
  }

  /** Whether the Ice Cream Man has ever appeared — gates the free user's
   *  on-demand menu item (he introduces himself before he can be summoned). */
  hasMetIceCreamMan(): boolean {
    return this.state.met;
  }

  /** Load the persisted lifecycle position at plugin start. */
  load(raw: unknown): void {
    this.state = parseSupportPromptState(raw);
  }

  /** A qualifying trigger landed (second coral terminal opened). Returns what
   *  to show, or null for silence. Pro: complete no-op — never fires, never
   *  advances, doesn't even spend the session's one advance. */
  onQualifyingTrigger(isPro: boolean): SupportPromptAction | null {
    if (isPro || this.advancedThisSession) return null;
    this.advancedThisSession = true;
    const { state, action } = advanceSupportPrompt(this.state);
    this.state = state;
    void this.persist(state);
    return action;
  }

  /** A folder was opened as a coral (main.ts's `openPlant` — the single entry
   *  point for every deliberate open: ribbon, commands, folder menu, seed modal,
   *  reveal. Workspace restores never route through it, so a restart can't fake
   *  a trigger).
   *
   *  Every Nth open becomes a qualifying trigger and walks the SAME ladder as the
   *  terminal trigger — stages → quiet → the Ice Cream Man. Returns what to show,
   *  or null for the counting opens and the silent beats.
   *
   *  Two deliberate refusals to count:
   *   • Pro — never counted, never prompted, mirroring onQualifyingTrigger.
   *   • Once the session's single advance is spent — otherwise a burst of opens
   *     right after a prompt would silently eat the next cycle's tally, and the
   *     following session would fire on its first open. */
  onCoralOpened(isPro: boolean): SupportPromptAction | null {
    if (isPro || this.advancedThisSession) return null;
    const opens = this.state.coralOpens + 1;
    if (opens < SUPPORT_CORAL_OPENS_PER_TRIGGER) {
      this.state = { ...this.state, coralOpens: opens };
      void this.persist(this.state);
      return null;
    }
    // The Nth open: spend the tally, then take a trigger. Reset FIRST so the
    // count restarts even when the ladder's answer is silence (a quiet or
    // off-parity beat) — those are still triggers, and they cost their opens.
    this.state = { ...this.state, coralOpens: 0 };
    return this.onQualifyingTrigger(isPro);
  }
}
