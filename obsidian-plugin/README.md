# Liefwork

Render a folder of your vault as a living Liefwork coral — a chronological,
growing structure where every branch is a folder and every lief a note. Built
as the visible half of the Liefwork memory system for AI-assisted work.

## The coral vocabulary
Four words cover everything:
- **Coral** — a folder-tree of your vault rendered as one living, growing
  structure. Nothing is copied or converted: the coral *is* your folder, drawn
  differently.
- **Branch** — a folder. Sub-folders are sub-branches.
- **Lief** — a note, drawn as a node along its branch (Liefwork's word for a
  leaf). "Lief" and "note" name the same file: a note in the vault is a lief
  on the coral.
- **Meristem** — a branch's named growing tip, where new liefs appear (in a
  plant, the tissue where growth happens). A branch can carry a meristem note —
  its folder note — holding the branch's own summary.

## Getting started
- **Open a coral:** click the ribbon's sprout icon (vault-root coral) or
  right-click a folder → "Open as Liefwork coral". Liefs sit on their branch
  ordered oldest → tip.
- **Move around:** drag to pan, wheel/pinch to zoom, double-click a node to
  fit its branch, "Show full view" to return to the whole coral. The on-coral
  "Aa" control adjusts text sizing.
- **Read & write:** click a node to open its HUD — read the lief right there,
  add a new lief to the branch, or jump to the note in Obsidian's editor
  ("Open note ↗") to edit it. Right-click a node for the full menu — new child
  branch, promote a lief into a branch (and demote a single-note branch back
  into a lief), colours, archive….
- **Display settings:** *Show meristem notes on branches* adds each branch's
  folder-note as a lief pinned at the branch base (explorer parity; off by
  default). *Display: Notes only / All files* — All files also shows images,
  PDFs and every other file the explorer lists; click one to open it in
  Obsidian's own viewer. Non-note files are tinted teal so they stand out from
  your notes at a glance. Note: non-markdown files can't carry `order`
  frontmatter, and a branch only follows your editorial `order` when *every*
  sibling has it — so adding a file to a deliberately-ordered branch drops it
  to date sorting. For strict editorial order, keep *Notes only* or park
  attachments in a subfolder.
- **Grow a memory coral:** "Seed as coral" scaffolds a folder into a Liefwork
  memory coral — `Growth Charter.md` (the open instruction set any AI agent
  reads to grow the coral), pointer files for the big CLI agents (`CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md` — each redirects its agent to the Charter), and the
  root meristem note; "Undo seeding" reverses it exactly.
- **Agents:** "Open agent terminal here" (needs the community Terminal
  plugin) launches a colour-coded terminal pinned to that branch — the coral
  becomes a live dashboard of the work.

## What this plugin does to your vault — full disclosure
- **Desktop only.** It reads folder creation times via Node's `fs`
  (`statSync` birthtime) — mobile has no such API.
- **It writes notes you ask it to create** (liefs, meristem folder-notes) and
  stamps frontmatter in them: `created`, `order` (and on archive actions:
  `kind`, `originalParent`, `originalOrder`, `archivedAt`). Rendering a coral
  never modifies existing notes.
- **Folder-note rename sync** (inside open corals only): renaming a meristem
  folder renames its folder-note to match, and vice versa.
- **Seeding a root coral (optional, disclosed in the dialog, opt-out toggle):**
  writes `Growth Charter.md` (the coral's canonical growth instructions), three
  short agent pointer files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) that
  redirect Claude Code, AGENTS.md-standard agents (Codex, Copilot, Cursor and
  friends) and Gemini CLI to the Charter, and the root meristem note. When you type a founding prompt, it is also captured as a `prompt — founding intent.md` note (the coral's founding lief). The three
  pointer files are deliberately **not rendered in the coral** — they are
  configuration breadcrumbs, not memory; they remain visible in Obsidian's file
  explorer as normal. If enabled, seeding also writes a Claude Code logging hook — `.claude/settings.json` (merged non-destructively into an existing one), `.claude/hooks/coral-log-keeper.mjs` — a readable Node script that Claude Code (not Obsidian) executes on each prompt in that folder; it reads only that folder tree, writes only its own state file (`.claude/.coral-log-state.json`), and never touches the network. Hook or not, seeding always records a provenance manifest (`.claude/.coral-seed-manifest.json`) listing exactly what was planted. "Undo seeding" removes exactly what was planted.
- **Terminal integration (optional):** "Open agent terminal here" launches a
  shell via the community **Terminal** plugin, if you have it installed and
  enabled — this plugin never spawns processes itself and degrades to a
  notice when Terminal is absent.
- **No telemetry.** The plugin collects nothing. Its only network calls are
  the user-initiated licence activation described under
  [Network](#network--full-disclosure) below.

## Payment
The plugin is free and fully functional for individual, non-profit, and
educational use; no primary feature is gated. Other organizations need a
commercial license for internal use — see the [LICENSE](../LICENSE). An
optional supporter licence ("Liefwork Pro") is a one-time purchase made
externally through Lemon Squeezy, then activated by pasting the key into the
plugin's settings. Pro unlocks cosmetic perks only — a free hand with the agent
terminal color picker (the three named deep-sea swatches plus any color at all
from the wheel; the first five preset swatches are always free) and an optional
spectral-pulse effect that drifts agent tints through neighbouring hues — and
permanently stops the support prompts below.

**Support prompts.** Two moments qualify as a prompt occasion: opening a
coral agent terminal while another is already live, and every fifth coral
open (the tally persists across sessions). Either way at most one dialog
shows per Obsidian session; after the first five gentle prompts the plugin
mostly stays silent, with a playful ice-cream vignette on some later
occasions. The dialogs never
block or gate anything: "Not now, thanks." or the modal's close button
dismisses them, and activating Pro stops them permanently.

## Network — full disclosure
The plugin's only network surface is licence handling, and every call is
user-initiated from the settings tab:
- **Activate** sends the pasted key once to Lemon Squeezy's public
  licence-activation endpoint (`api.lemonsqueezy.com`, via Obsidian's
  `requestUrl`). On success the entitlement is stored locally and trusted
  from then on — there is no startup or recurring validation, ever.
- **Remove key** sends one best-effort deactivation request to the same
  endpoint so the activation slot is freed; the local key is cleared whether
  or not the store answers.

Nothing else ever leaves your vault: no telemetry, no analytics, no update
checks, no other requests of any kind. "Get a licence key" links simply open
the store page in your default browser.

## The coral pane is dark by design
The canvas renders on Liefwork's own dark palette in both Obsidian themes;
the HUD and controls follow your theme.

## License
Source-available — see [LICENSE](../LICENSE). Free to read, run, audit, and
modify for individual, non-profit, and educational use; competing
redistribution is not permitted, and bespoke client work must credit
Liefwork and pass the license along (LICENSE §2.4). Every released version
automatically converts to Apache-2.0 four years after its release date as
recorded in the [CHANGELOG](../CHANGELOG.md).
