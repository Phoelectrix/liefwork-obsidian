/**
 * Bundled coral scaffold templates (the plugin can't read docs/templates/ at
 * runtime, so the canonical text is inlined here). Charter-centric: the
 * canonical growth rules live in the open Growth Charter; the vendor files
 * (CLAUDE.md / AGENTS.md / GEMINI.md) are generated disposable pointers to it.
 *
 * Placeholders: {{Root}} {{Project}} {{Description}} {{date}} {{createdAt}}.
 */

/** Substitute {{key}} → vars[key]; an unknown key is left intact (so a stray
 *  placeholder is visible rather than silently blanked). */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`,
  );
}

/** The root meristem (folder-note) — roll-up index; areas grow as branches. */
export const ROOT_MERISTEM_TEMPLATE = `---
title: {{Root}}
created: {{createdAt}}
---

# {{Root}}

*Root meristem — {{Project}} rendered as a living coral. The canonical roll-up; each area below is a branch that grows as it's worked. Working rules: this folder's \`Growth Charter.md\`.*

## Summary

{{Description}}

**Where it stands ({{date}}):** Just seeded — growth starts from the founding prompt.

## Areas (branches)

*(Areas grow into the coral discipline — meristem roll-ups + per-turn liefs — as they're worked; not retrofitted up front.)*
`;

/**
 * The Coral Logging Keeper — a self-contained Claude Code UserPromptSubmit
 * hook script written into a seeded root coral's `.claude/hooks/`. Node
 * built-ins only (runs in the user's Claude Code Node runtime). Single source
 * of truth: tests materialize this string to a temp file and import it.
 * Design: docs/superpowers/specs/2026-06-17-coral-logging-enforcement-design.md
 */
export const CORAL_LOG_KEEPER_SCRIPT = `import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_PATH = join(".claude", ".coral-log-state.json");
const DEFAULT_THRESHOLD = 4;

const QUIET =
  "Coral logging active (episode-floor): when a work episode concludes, record it as a prompt + summarised response lief in the active branch.";

function firm(n) {
  return "\\u26a0 " + n + " turns since the last lief was recorded. If an episode has concluded (a brainstorm, a decision, a completed task), log it now before continuing. If logging this work isn't wanted, switch recording to ad-hoc to silence this.";
}

function firmSpecific(n) {
  return "\\u26a0 " + n + " turns without a recorded lief. Pause and log the concluded episode(s): one prompt lief (the ask, verbatim) + one summarised response lief in the active branch. If you are genuinely mid-episode, note that and continue. If logging this work isn't wanted, switch recording to ad-hoc to silence this.";
}

export function reminderFor(counter, threshold) {
  const T = threshold;
  if (counter <= 0) return null;
  if (counter <= T - 2) return QUIET;
  if (counter <= T) return firm(counter);
  return firmSpecific(counter);
}

export function decide(state, newestLiefMtimeMs) {
  const T = state.threshold ?? DEFAULT_THRESHOLD;
  if (state.recordingPref === "adhoc") return { state, message: null };
  let counter, lastLiefMtime = state.lastLiefMtime ?? 0;
  if (newestLiefMtimeMs > lastLiefMtime) {
    counter = 0;
    lastLiefMtime = newestLiefMtimeMs;
  } else {
    counter = (state.counter ?? 0) + 1;
  }
  const next = { ...state, counter, lastLiefMtime, threshold: T };
  return { state: next, message: reminderFor(counter, T) };
}

function isLief(path) {
  try {
    return /^kind:\\s*(prompt|response)\\b/m.test(readFileSync(path, "utf8").slice(0, 400));
  } catch {
    return false;
  }
}

export function scanNewestLiefMtime(rootDir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("_archive")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.name.endsWith(".md") && isLief(p)) {
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {}
      }
    }
  };
  walk(rootDir);
  return newest;
}

export function maxDirMtime(rootDir) {
  let max = 0;
  const walk = (d) => {
    try {
      const m = statSync(d).mtimeMs;
      if (m > max) max = m;
    } catch {}
    let entries;
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

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { recordingPref: "default", counter: 0, lastLiefMtime: 0, lastDirMtimeMax: 0, threshold: DEFAULT_THRESHOLD };
  }
}

function main() {
  try {
    const state = loadState();
    if (state.recordingPref === "adhoc") { process.exit(0); }
    const curDirMtime = maxDirMtime(".");
    let newestLiefMtime;
    if (curDirMtime > (state.lastDirMtimeMax ?? 0)) {
      newestLiefMtime = scanNewestLiefMtime(".");
    } else {
      newestLiefMtime = state.lastLiefMtime ?? 0;
    }
    const { state: next, message } = decide(state, newestLiefMtime);
    next.lastDirMtimeMax = curDirMtime;
    try { writeFileSync(STATE_PATH, JSON.stringify(next, null, 2)); } catch {}
    if (message) process.stdout.write(message + "\\n");
  } catch {
    // fail safe: never throw, never block
  }
  process.exit(0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
`;

/** `.claude/settings.json` registering the keeper on UserPromptSubmit. */
export const CORAL_SETTINGS_JSON = JSON.stringify(
  {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node .claude/hooks/coral-log-keeper.mjs" }] },
      ],
    },
  },
  null,
  2,
);

/** Initial keeper state — episode-floor default, silent until drift. */
export function coralLogStateInitial(): string {
  return JSON.stringify({ recordingPref: "default", counter: 0, lastLiefMtime: 0, lastDirMtimeMax: 0, threshold: 4 }, null, 2);
}

/** Record of what seeding added, so de-seed removes exactly this set. */
export function coralSeedManifest(): string {
  return JSON.stringify(
    {
      tool: "coral-log-keeper",
      version: 1,
      files: [
        ".claude/hooks/coral-log-keeper.mjs",
        ".claude/.coral-log-state.json",
        ".claude/.coral-seed-manifest.json",
      ],
      // The writer flips this to false if it merged into a pre-existing settings.json.
      settingsCreatedByUs: true,
    },
    null,
    2,
  );
}

/** The coral marker file — its presence classifies a folder as a seeded root
 *  coral. The canonical, self-contained growth instructions any agent reads. */
export const GROWTH_CHARTER_BASENAME = "Growth Charter.md";

/** The generated vendor pointer files (v1 set, verified July 2026): AGENTS.md
 *  covers Codex/Copilot/Cursor/Windsurf/Zed; Gemini CLI reads GEMINI.md;
 *  CLAUDE.md is Claude Code's native file. Disposable — the Charter is canon. */
export const AGENT_POINTER_BASENAMES: readonly string[] = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];

/** Canonical Growth Charter — the open, self-contained instruction set for
 *  reading and growing this coral. Standard: a zero-context agent reading only
 *  the Charter (+ the roll-ups it points to) is fully oriented. */
export const GROWTH_CHARTER_TEMPLATE = `# {{Project}} — Growth Charter (canonical)

*This folder is a **Liefwork coral** — living project memory any AI agent can inhabit and grow. This Charter is the canonical, self-contained instruction set for reading and growing it. The vendor files (\`CLAUDE.md\`, \`AGENTS.md\`, \`GEMINI.md\`) are generated pointers to this document and are disposable — delete them all and the coral still explains itself.*

**{{Project}}** — {{Description}}.

## The whole project is a coral

This folder **is** the project's living memory, organised as a coral. The root meristem is **[[{{Root}}]]**; each area is a branch. The coral holds the memory and narrative; engineering detail lives in the repo + git, not here.

## Session start ritual

1. Read **[[{{Root}}]]** (root roll-up).
2. Read the relevant area + topic branch(es).
3. **Confirm the recording preference for this session** — *default* (one \`prompt\` lief + one summarised \`response\` lief at each episode boundary, live as we go) **or** *ad-hoc* ("I'll tell you when to record a lief"). Agents with hook support (currently Claude Code) also write the chosen value (\`"default"\` or \`"adhoc"\`) into \`.claude/.coral-log-state.json\` → \`recordingPref\`. This also reminds you to **log + branch** as the work unfolds.
4. **First session in a freshly-seeded, already-populated folder only:** ask the user **what of the existing material to read / skim**, then **propose a structure of growing meristems** before working. (Afterwards, orient via this ritual + the roll-ups — no re-interview.)
5. Then proceed.

## The memory rules of this coral

1. **Organised by topic, not date.** Each thread of work is a living branch (under its area, under [[{{Root}}]]), grown whenever worked on — across any number of days. No date-named session folders. **At each episode boundary, before moving on, record the episode** as a \`prompt\` lief (the ask, verbatim) + a summarised \`response\` lief in the active branch. A multi-turn skill (e.g. brainstorming) is one episode, logged when it concludes. At each new prompt, continue the topic or branch/switch by content.
2. **Roll up the meristem chain.** Liefs roll into topic meristems; topics into area meristems; areas into [[{{Root}}]]. Each is the truthful distillation of everything below it — newest state first. **Distil by subtraction — prune as you roll up** (rolling up is append *and* prune, or it accretes into a changelog): walk the existing summary and, for each entry no longer current-state, apply the lightest move that loses nothing — **drop** it (a lief below already records it), **abridge to a stub** (one present-tense line of the irreducible decision + outcome), or, only for prose that was never a discrete lief, **demote** it verbatim under a \`## Superseded\` heading. Never remove a line unless a stub remains, a lief carries it, or it is demoted — nothing is lost. On demand, an agent may also run a deeper pass: *scan a branch and propose a drop/stub/demote diff for approval.*
3. **Structure follows growth.** New strands start new branches; topics that grow sub-strands gain children. Don't pre-create empty structure; let topics emerge.
4. **Engineering detail lives in the repo + git, not here.** The coral is the working memory and narrative, not a code mirror.
5. **Time is an attribute, not a container.** Chronology lives in each note's creation date (within-branch ordering, oldest→tip). Write dates as "10 June 2026"; frontmatter \`created\` stays ISO (\`2026-06-10\`).
6. **Co-editing hygiene.** Announce the branch you're growing; reference liefs by \`[[link]]\`, never by position; don't add to a branch someone else is actively on.
7. **Link by basename.** \`[[Note]]\`, not full vault paths. Keep meristem/topic names vault-unique. (Enforce via \`newLinkFormat: shortest\` in \`.obsidian/app.json\`.)
`;

/** A vendor pointer file — a generated breadcrumb redirecting any agent's
 *  native auto-load to the canonical Charter. Same content for every vendor. */
export const VENDOR_POINTER_TEMPLATE = `# {{Project}} — a Liefwork coral

This folder is a **Liefwork coral** — living project memory. Before working here, read **\`Growth Charter.md\`** (in this folder) and follow it as you work. The Charter is the canonical instruction set; this file is only a generated pointer to it — each agent's auto-load finds the Charter through its own pointer file, and re-seeding regenerates them.
`;

