/**
 * Obsidian-facing glue for "Seed as Coral": the dialogue (preferences + the
 * founding prompt) and the vault writer. The decision of *what* to write is the
 * pure `planSeed` (seed-coral.ts); this is just I/O + UI.
 */
import { App, Modal, Notice, Setting, TFolder } from "obsidian";
import { planSeed, type SeedFile, type SeedOptions } from "./seed-coral.ts";
import { GROWTH_CHARTER_BASENAME, AGENT_POINTER_BASENAMES } from "./seed-templates.ts";
import { sanitizeName } from "./lief-writer.ts";
import { mergeKeeperHook } from "./settings-merge.ts";
import {
  planReseed,
  type ArchivePlan,
  type FolderCoralFacts,
  type LifecyclePlan,
  type RenameOp,
} from "./coral-lifecycle.ts";

/** A dot-prefixed path Obsidian's vault API ignores (must go through the adapter). */
function isDotClaudePath(path: string): boolean {
  return path.includes(".claude/");
}

/** Walk up from `folder`: an ancestor Growth Charter (or legacy CLAUDE.md)
 *  means this is a sub-coral (inherits the parent rules) — no new markers. */
export function isSubCoral(app: App, folder: TFolder): boolean {
  let cur: TFolder | null = folder.parent;
  while (cur) {
    const dir = cur.path === "/" || cur.path === "" ? "" : cur.path;
    const at = (name: string) => (dir ? `${dir}/${name}` : name);
    if (app.vault.getAbstractFileByPath(at(GROWTH_CHARTER_BASENAME))) return true;
    if (app.vault.getAbstractFileByPath(at("CLAUDE.md"))) return true;
    cur = cur.parent;
  }
  return false;
}

/** A direct child folder is the leftover of an Undo Seeding (un-seed). */
export const UNSEED_ARCHIVE_PREFIX = "_archive — unseeded (";

/** Read a folder's own coral-presence facts (the Guard's input). Keys on what
 *  THIS folder has — `<folder>/Growth Charter.md` (primary root marker), its
 *  legacy `<folder>/CLAUDE.md`, its folder-note meristem `<folder>/<name>.md`,
 *  and an `_archive — unseeded (…)/` subfolder — plus whether it sits in a coral. */
export function readCoralFacts(app: App, folder: TFolder): FolderCoralFacts {
  const dir = folder.path === "/" || folder.path === "" ? "" : folder.path;
  const at = (name: string) => Boolean(app.vault.getAbstractFileByPath(dir ? `${dir}/${name}` : name));
  return {
    hasOwnCharter: at(GROWTH_CHARTER_BASENAME),
    hasOwnClaude: at("CLAUDE.md"),
    hasOwnMeristem: at(`${folder.name || app.vault.getName()}.md`),
    hasUnseedArchive: unseedArchives(folder).length > 0,
    insideCoral: isSubCoral(app, folder),
  };
}

/** The unseed-archive subfolders directly under `folder`, latest (by dated name) first. */
export function unseedArchives(folder: TFolder): TFolder[] {
  return folder.children
    .filter((c): c is TFolder => c instanceof TFolder && c.name.startsWith(UNSEED_ARCHIVE_PREFIX))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** A never-overwrite destination for `path`: if it's already taken (in the vault
 *  index), insert " 2" (then " 3", …) before the `.md` extension for files, or
 *  append it for folders / non-`.md` paths. Shared by the write-dedupe in
 *  {@link applyLifecyclePlan} and the archive-rename dedupe in {@link applyArchivePlan}. */
export function dedupePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const isMd = /\.md$/i.test(path);
  const base = isMd ? path.replace(/\.md$/i, "") : path;
  const ext = isMd ? ".md" : "";
  let n = 2;
  while (app.vault.getAbstractFileByPath(`${base} ${n}${ext}`)) n++;
  return `${base} ${n}${ext}`;
}

/** Apply a lifecycle plan: renames first (so a chronicle reflects the post-state),
 *  then the chronicle writes — never overwriting (a taken path gets a " 2" suffix). */
export async function applyLifecyclePlan(app: App, plan: LifecyclePlan): Promise<void> {
  for (const r of plan.renames) {
    const f = app.vault.getAbstractFileByPath(r.from);
    if (f) await app.fileManager.renameFile(f, r.to);
  }
  for (const w of plan.writes) {
    await app.vault.create(dedupePath(app, w.path), w.content);
  }
}

/** Apply an archive plan (Undo un-seed or Re-seed): create the archive folder,
 *  move the scaffold (+ grown, if any) aside, then write the notes (fresh seed
 *  and/or provenance log) — never overwriting. `.claude/` artifacts are moved
 *  through the adapter (the vault API ignores dot-prefixed paths). */
export async function applyArchivePlan(app: App, plan: ArchivePlan): Promise<string[]> {
  if (!app.vault.getAbstractFileByPath(plan.archiveFolder)) {
    await app.vault.createFolder(plan.archiveFolder);
  }
  for (const r of plan.renames) {
    // A same-day Undo/Re-seed can land two moves on one archive path; dedupe the
    // destination so nothing is overwritten and the plan never aborts mid-way.
    const to = dedupePath(app, r.to);
    if (isDotClaudePath(r.from)) {
      await renameViaAdapter(app, { from: r.from, to });
    } else {
      const f = app.vault.getAbstractFileByPath(r.from);
      if (f) await app.fileManager.renameFile(f, to);
    }
  }
  return writeSeed(app, plan.writes);
}

/** Move a `.claude/` artifact aside via the filesystem adapter, ensuring the
 *  destination dir exists. No-op (silently) if the source isn't present. */
async function renameViaAdapter(app: App, r: RenameOp): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(r.from))) return;
  const dir = r.to.includes("/") ? r.to.slice(0, r.to.lastIndexOf("/")) : "";
  if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
  await adapter.rename(r.from, r.to);
}

/** Local ISO date (yyyy-mm-dd) — the founding lief's `created`. */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Write the planned files, creating parent folders, never overwriting.
 *  `.claude/` files (which the vault API ignores) go through the adapter, and
 *  on a brownfield `settings.json` we *merge* the keeper hook in rather than
 *  overwrite — flipping the manifest's `settingsCreatedByUs` to false. */
export async function writeSeed(app: App, files: SeedFile[]): Promise<string[]> {
  // Did a `.claude/settings.json` already exist before we seeded? If so we merge
  // (don't clobber) and record that we didn't create it, so de-seed un-merges
  // rather than removing the whole file.
  let mergedExistingSettings = false;
  // Non-dot files we found already present and (never-overwrite) left untouched —
  // returned so the caller can be honest that the typed content wasn't written.
  const skipped: string[] = [];

  for (const f of files) {
    if (!isDotClaudePath(f.path)) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      if (dir && !app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir).catch(() => {});
      }
      if (app.vault.getAbstractFileByPath(f.path)) {
        skipped.push(f.path);
      } else {
        await app.vault.create(f.path, f.content);
      }
      continue;
    }

    const adapter = app.vault.adapter;
    const dir = f.path.slice(0, f.path.lastIndexOf("/"));
    if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);

    if (f.path.endsWith(".claude/settings.json")) {
      if (await adapter.exists(f.path)) {
        // Brownfield: merge the keeper hook into the user's existing settings.
        let existing: unknown;
        try {
          existing = JSON.parse(await adapter.read(f.path));
        } catch {
          // The user's settings.json isn't valid JSON (trailing comma, comment, etc.).
          // Leave it untouched — do NOT overwrite — and let the rest of the seed proceed.
          new Notice(
            "Liefwork: existing .claude/settings.json isn't valid JSON — logging hook NOT added. " +
              "Add it manually: hook command `node .claude/hooks/coral-log-keeper.mjs` on UserPromptSubmit.",
          );
          // The file pre-existed and we left it untouched — same provenance as the
          // merge path: record `settingsCreatedByUs: false` so de-seed leaves the
          // user's own settings.json in place (never archives a file we didn't create).
          mergedExistingSettings = true;
          continue;
        }
        await adapter.write(f.path, JSON.stringify(mergeKeeperHook(existing), null, 2));
        mergedExistingSettings = true;
      } else {
        await adapter.write(f.path, f.content);
      }
      continue;
    }

    await adapter.write(f.path, f.content);
  }

  // Patch the manifest *after* the loop so it reflects the settings outcome,
  // regardless of file order in the plan.
  if (mergedExistingSettings) {
    const manifestFile = files.find((f) => f.path.endsWith(".claude/.coral-seed-manifest.json"));
    if (manifestFile) {
      const adapter = app.vault.adapter;
      try {
        const manifest = JSON.parse(await adapter.read(manifestFile.path)) as Record<string, unknown>;
        manifest.settingsCreatedByUs = false;
        await adapter.write(manifestFile.path, JSON.stringify(manifest, null, 2));
      } catch {
        // Manifest we just wrote is unexpectedly unparseable — skip the patch and continue.
        // The seed itself succeeded; the manifest flag will default to the safe value on de-seed.
      }
    }
  }

  return skipped;
}

/** Sanitise a user-typed coral name to a safe filename base, or `""` when nothing
 *  usable survives (all illegal chars / blank) — the caller keeps the modal open
 *  rather than seeding an "Untitled" scaffold. Reuses `sanitizeName`, whose
 *  no-usable-character fallback ("Untitled") is the empty sentinel here (unless the
 *  user literally typed "Untitled"). */
export function sanitizeCoralName(raw: string): string {
  const safe = sanitizeName(raw);
  if (safe === "Untitled" && raw.trim().toLowerCase() !== "untitled") return "";
  return safe;
}

/** Show the honest "kept existing files" notice, if any non-dot files were skipped. */
function noticeSkipped(skipped: string[]): void {
  if (skipped.length > 0) {
    new Notice(`Liefwork: kept ${skipped.length} existing file(s) untouched: ${skipped[0]}…`);
  }
}

/** The scaffold marker basenames — never swept into the archive as "grown content".
 *  `vaultName` is the root fallback for the folder-note name (the vault-root folder
 *  has an empty name; its meristem is named after the vault, matching folderNotePath). */
function scaffoldNames(folder: TFolder, vaultName: string): Set<string> {
  return new Set([
    GROWTH_CHARTER_BASENAME,
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    "Inactive-CLAUDE.md",
    `${folder.name || vaultName}.md`, // the meristem (folder-note)
    "prompt — founding intent.md",
  ]);
}

export class SeedCoralModal extends Modal {
  private readonly folder: TFolder;
  private readonly onSeeded: (folderPath: string) => void;
  private readonly mode: "seed" | "reseed";
  private readonly sub: boolean;
  private name: string;
  private description = "";
  private foundingPrompt = "";
  /** Re-seed only: also move grown content into the archive (blank slate). */
  private archiveGrown = false;
  /** Root corals only: install the Claude Code logging hook (default on). */
  private withKeeperHook = true;

  constructor(
    app: App,
    folder: TFolder,
    onSeeded: (folderPath: string) => void,
    mode: "seed" | "reseed" = "seed",
  ) {
    super(app);
    this.folder = folder;
    this.onSeeded = onSeeded;
    this.mode = mode;
    this.sub = isSubCoral(app, folder);
    this.name = folder.name || app.vault.getName();
  }

  onOpen(): void {
    const { contentEl } = this;
    const reseed = this.mode === "reseed";
    this.titleEl.setText(reseed ? "Re-seed coral" : "Seed as coral");
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: reseed
        ? "Archives the current scaffold (nothing deleted) into a dated _archive folder, then grows a fresh coral here."
        : this.sub
          ? "Inside an existing coral — it'll inherit the parent's Growth Charter (no new files)."
          : "A new coral: writes Growth Charter.md (its growth instructions — rendered in the coral) plus pointer files CLAUDE.md, AGENTS.md and GEMINI.md that direct each AI agent to the Charter (not rendered in the coral; visible in the file explorer).",
    });

    new Setting(contentEl).setName("Coral name").addText((t) =>
      t.setValue(this.name).onChange((v) => (this.name = v.trim() || this.folder.name || this.app.vault.getName())),
    );
    new Setting(contentEl)
      .setName("Description")
      .setDesc("One line: what this coral is.")
      .addText((t) => t.onChange((v) => (this.description = v)));
    new Setting(contentEl)
      .setName("Founding prompt")
      .setDesc("The first intent — what you want grown here. The seed of growth.")
      .addTextArea((t) =>
        t.setPlaceholder("e.g. Get X to market by 1 July …").onChange((v) => (this.foundingPrompt = v)),
      );

    if (!this.sub) {
      new Setting(contentEl)
        .setName("Install the Claude Code logging hook")
        .setDesc(
          "Writes .claude/settings.json (merged into yours if one exists) and " +
            ".claude/hooks/coral-log-keeper.mjs — a local script Claude Code runs on " +
            "each prompt in this folder to keep session logging fresh. Reads only this " +
            "folder, writes only its own state file, no network. Removed by Undo seeding.",
        )
        .addToggle((t) => t.setValue(this.withKeeperHook).onChange((v) => (this.withKeeperHook = v)));
    }

    if (reseed) {
      new Setting(contentEl)
        .setName("Archive existing content too")
        .setDesc("Off: keep grown notes in place (the fresh coral adopts them). On: move them into the archive for a blank slate.")
        .addToggle((t) => t.setValue(this.archiveGrown).onChange((v) => (this.archiveGrown = v)));
    }

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(reseed ? "Re-seed" : "Seed as coral")
        .setCta()
        .onClick(() => void (reseed ? this.reseed() : this.seed())),
    );
  }

  private seedOptions(name: string): SeedOptions {
    return {
      folderPath: this.folder.path === "/" ? "" : this.folder.path,
      name,
      description: this.description,
      foundingPrompt: this.foundingPrompt,
      isSubCoral: this.sub,
      withKeeperHook: this.sub ? false : this.withKeeperHook,
      today: todayISO(),
      createdAt: new Date().toISOString(),
    };
  }

  /** The sanitized coral name, or `null` (with a Notice) when it has no usable
   *  characters — the modal stays open so the user can fix it before seeding. */
  private resolveName(): string | null {
    const name = sanitizeCoralName(this.name);
    if (name === "") {
      new Notice("Liefwork: that name has no usable characters");
      return null;
    }
    return name;
  }

  private async seed(): Promise<void> {
    const name = this.resolveName();
    if (name === null) return;
    const opts = this.seedOptions(name);
    try {
      const skipped = await writeSeed(this.app, planSeed(opts));
      new Notice(`Liefwork: seeded “${name}” as a coral`);
      noticeSkipped(skipped);
      this.close();
      this.onSeeded(opts.folderPath || "/");
    } catch (err) {
      new Notice(`Liefwork: couldn't seed — ${(err as Error).message}`);
    }
  }

  private async reseed(): Promise<void> {
    const name = this.resolveName();
    if (name === null) return;
    const opts = this.seedOptions(name);
    const markers = scaffoldNames(this.folder, this.app.vault.getName());
    const grownEntries = this.archiveGrown
      ? this.folder.children
          .map((c) => c.name)
          .filter((n) => !markers.has(n) && !n.startsWith("_archive — re-seeded ("))
      : [];
    const plan = planReseed({
      seed: opts,
      meristemName: `${this.folder.name || this.app.vault.getName()}.md`,
      markerNames: [GROWTH_CHARTER_BASENAME, ...AGENT_POINTER_BASENAMES].filter((n) =>
        Boolean(this.app.vault.getAbstractFileByPath(opts.folderPath ? `${opts.folderPath}/${n}` : n)),
      ),
      hasFoundingLief: Boolean(
        this.app.vault.getAbstractFileByPath(
          opts.folderPath ? `${opts.folderPath}/prompt — founding intent.md` : "prompt — founding intent.md",
        ),
      ),
      grownEntries,
    });
    try {
      const skipped = await applyArchivePlan(this.app, plan);
      new Notice(`Liefwork: re-seeded “${name}” (old scaffold archived)`);
      noticeSkipped(skipped);
      this.close();
      this.onSeeded(opts.folderPath || "/");
    } catch (err) {
      new Notice(`Liefwork: couldn't re-seed — ${(err as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
