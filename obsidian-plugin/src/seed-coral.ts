/**
 * Pure planner for the "Seed as Coral" command.
 *
 * Given the seeding inputs, returns the list of files to write to turn a folder
 * into a coral. The Obsidian-facing writer (vault.create) + the modal + the menu
 * wiring live elsewhere; everything that can be reasoned about without the vault
 * lives here so it can be unit-tested. (Mirrors lief-writer.ts.)
 */

import {
  fillTemplate,
  GROWTH_CHARTER_TEMPLATE,
  GROWTH_CHARTER_BASENAME,
  AGENT_POINTER_BASENAMES,
  VENDOR_POINTER_TEMPLATE,
  ROOT_MERISTEM_TEMPLATE,
  CORAL_LOG_KEEPER_SCRIPT,
  CORAL_SETTINGS_JSON,
  coralLogStateInitial,
  coralSeedManifest,
} from "./seed-templates.ts";

export interface SeedOptions {
  /** Folder being seeded; "" = vault root. */
  folderPath: string;
  /** Coral / root-meristem name (caller defaults this to the folder basename). */
  name: string;
  /** One-line description of what this coral is. */
  description: string;
  /** The founding prompt (the seed-of-growth); "" → no founding lief. */
  foundingPrompt: string;
  /** Install the Claude Code logging keeper (.claude settings + hook script). */
  withKeeperHook: boolean;
  /** ISO date, e.g. "2026-06-12" — for prose + archive names. Passed in; pure
   *  code stamps no clock. */
  today: string;
  /** ISO datetime, e.g. "2026-06-23T14:32:05.123Z" — for `created` frontmatter,
   *  so same-day notes sort chronologically (not alphabetically by name). */
  createdAt: string;
}

export interface SeedFile {
  path: string;
  content: string;
}

/** Join a coral-relative name onto its folder ("" / "/" = vault root → no prefix). */
function join(folderPath: string, name: string): string {
  return folderPath === "" || folderPath === "/" ? name : `${folderPath}/${name}`;
}

export function planSeed(opts: SeedOptions): SeedFile[] {
  const files: SeedFile[] = [];
  const vars = {
    Root: opts.name,
    Project: opts.name,
    Description: opts.description.trim() || opts.name,
    date: opts.today,
    createdAt: opts.createdAt,
  };

  // EVERY seed writes a Charter. Seeding used to skip it for a folder nested
  // inside a coral, on the theory that a second Charter would compete with the
  // parent's — it doesn't. Claude Code loads every CLAUDE.md from the working
  // directory up to the root and layers them, the NEAREST file winning on
  // conflict (AGENTS.md and GEMINI.md use the same convention). So a nested
  // Charter governs its folder and descendants while the parent's stays active
  // above it, which is exactly what a self-governing sub-project wants. The
  // modal confirms the nesting before this runs. (Founder, 28 July: seeding an
  // already-governed folder that produced no Charter read as a broken command.)
  {
    files.push({
      path: join(opts.folderPath, GROWTH_CHARTER_BASENAME),
      content: fillTemplate(GROWTH_CHARTER_TEMPLATE, vars),
    });
    for (const pointer of AGENT_POINTER_BASENAMES) {
      files.push({
        path: join(opts.folderPath, pointer),
        content: fillTemplate(VENDOR_POINTER_TEMPLATE, vars),
      });
    }
    // The logging keeper — a gentle, reversible UserPromptSubmit hook that keeps
    // episode-floor logging from decaying. Root corals only; sub-corals inherit it.
    // Opt-out (seed modal): when withKeeperHook is off, no hook artifacts are planted.
    if (opts.withKeeperHook) {
      files.push({ path: join(opts.folderPath, ".claude/settings.json"), content: CORAL_SETTINGS_JSON });
      files.push({ path: join(opts.folderPath, ".claude/hooks/coral-log-keeper.mjs"), content: CORAL_LOG_KEEPER_SCRIPT });
      files.push({ path: join(opts.folderPath, ".claude/.coral-log-state.json"), content: coralLogStateInitial() });
    }
    // The provenance manifest is always written — Undo seeding needs it, hook or not.
    files.push({ path: join(opts.folderPath, ".claude/.coral-seed-manifest.json"), content: coralSeedManifest() });
  }

  // Root meristem (folder-note): <folder>/<Name>.md
  files.push({
    path: join(opts.folderPath, `${opts.name}.md`),
    content: fillTemplate(ROOT_MERISTEM_TEMPLATE, vars),
  });

  // Founding lief — the seed-of-growth. Skipped when there's no prompt.
  const prompt = opts.foundingPrompt.trim();
  if (prompt !== "") {
    files.push({
      path: join(opts.folderPath, "prompt — founding intent.md"),
      content:
        `---\ncreated: ${opts.createdAt}\nkind: prompt\norder: 10\n---\n\n` +
        `# prompt — founding intent\n\n> ${prompt}\n`,
    });
  }

  return files;
}
