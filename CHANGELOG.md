# Changelog

Release dates recorded here are the authoritative "release date of a
version" for the purposes of §12 (future open-source conversion) of the
[LICENSE](LICENSE).

## 0.2.0 — 22 September 2026

Liefwork steps into the light: a Cycladic light mode, a second branching
style, and the settings tab Obsidian's directory scan asked for.

**Light mode.** A new Theme setting switches the coral between the dark
Meridian look and **Meltemi** — whitewash in strong sun, cool shade marks,
a dark terracotta for non-note files and one sunlit stone colour for the
path back to the root. The command "Toggle light/dark coral" flips it in
place, same camera, for an instant comparison. Light mode is free.

**Small text holds its weight on white.** Dark text on a bright field
loses to anti-aliasing what light text on dark gains from glow, so every
label in light mode is drawn with full opacity and a hairline stroke of
its own colour. Big titles barely notice; labels at 8–12 px stay legible.

**Branch titles lift clear of their branches.** A meristem's title now
sits a little further along its ray, in proportion to how much of the
coral hangs beneath it, so titles of heavy branches stop colliding when
you zoom out. The dark look gains a small lift too, slightly larger
dot-glyphs and a marginally steeper attention curve, so on a wide view the
biggest titles stand alone a little more; its geometry is otherwise
unchanged.

**A second branching style.** The new Style setting offers **Organic**
beside the default fan: the first branch departs wider and each branch
after it leans in a little more than the last, with a floor so no branch
ever folds onto its parent. Dense corals read more like a plant than a
comb. Existing corals keep the default until you choose otherwise.

**Settings are searchable.** The settings tab is now declared through
Obsidian's setting definitions (1.13+), so every Liefwork setting shows up
in the settings search. Older Obsidian versions see the same tab as
before.

**Renaming a coral's own root folder keeps its folder note in sync**, the
one case the rename guard had missed.

## 0.1.6 — 5 August 2026

Fixes to the logging keeper and the coral pane, and two camera controls
tuned at the vault.

**The logging keeper survives a moving working directory.** It was
registered by a path relative to the session's working directory — and a
session's working directory moves as the work moves, so once an agent
worked deeper in the coral the hook failed on every prompt. It is now
anchored to the folder the session started in, and the script locates its
own coral rather than trusting where it was run from.

**A coral you drag between panes keeps the mode it was showing.** Moving a
coral from the sidebar into the main area no longer switches the preview
panel on, and its Preview button no longer reads the opposite of what is
happening. Where a coral *opens* still follows the placement default;
moving one never changes it.

**You can pull back further from a coral** — the zoom-out limit was fixed
at a 25% margin around the full view and is now twice that, so a wide
coral's long branch labels can be read without leaving the frame.

**Trackpad pinch zooms as directly as a two-finger scroll.** A pinch was
being treated as an ordinary scroll despite reporting much smaller
movements, which made it feel unresponsive.

**Clearer about who keeps the memory system's discipline.** The Growth
Charter and the README now say plainly that the recording and pruning are
the agent's job and yours — the logging hook is a reminder, not the
mechanism — and where that reminder is active.

## 0.1.5 — 28 July 2026

The seeding lifecycle is simpler, and the coral's right-click menu is
quieter.

**Seeding now offers one move per folder, decided by its Growth Charter.**
No Charter, so it can be seeded. Its own Charter, so it can be de-seeded.
An archived Charter and none live, so it can be reactivated or seeded
anew. **Re-seed is retired** — it was de-seed then seed, which you can
still do in two deliberate steps.

**"Undo seeding" is now "De-seed".** Undo promised a return to the exact
previous state; what it does is move the scaffold into a dormant one that
**"Reactivate archived seed"** restores.

**Seeding a folder inside a coral now gives it a real Growth Charter**,
after a dialog explaining that it will govern that folder and everything
beneath it while the parent's stays active — agents read both and follow
the nearer one. Previously such a folder got only a meristem note, which
read as a command that had done nothing.

**Fixes and refinements**

- A folder with a hand-written `CLAUDE.md` is no longer mistaken for a
  seeded coral. It was being badged as one and offered the de-seed
  command, which would have archived your own file and stopped it
  governing.
- The "Archive existing content too" option is gone. It moved your notes
  somewhere nothing could bring them back from.
- De-seed sends the three agent pointer files to your trash rather than
  the archive, and Reactivate writes them again; a pointer you have
  edited yourself is archived instead. Reactivate also restores the
  logging hook it had been leaving behind, and clears the spent archive
  folder once only its own log remains.
- A coral takes its name from its folder — a different name produced a
  stray note that no longer matched the folder it summarised.
- The coral's right-click menu no longer repeats the Terminal plugin's
  commands, and Liefwork's own "Open agent terminal here" closes the
  menu. Without the Terminal plugin it now explains itself and changes
  nothing at all; "Stop agent terminal", which stopped nothing, is gone.
- README rewritten: installation, a guide to using the memory system,
  screenshots, and the benchmark figures.

(Converts to Apache-2.0 on 28 July 2030 per LICENSE §12.)

## 0.1.4 — 24 July 2026

Build-verification follow-ups — no feature changes. The root `build`
script now leaves `main.js` at the repository root where verification
looks for it; the `builtin-modules` package is replaced by Node's own
`builtinModules` (byte-identical output). (Converts to Apache-2.0 on
24 July 2030 per LICENSE §12.)

## 0.1.3 — 24 July 2026

`fundingUrl` now points at the Lemon Squeezy storefront
(liefwork.lemonsqueezy.com — a stable, directly reachable page one click
from supporting the project). No other changes. (Converts to Apache-2.0
on 24 July 2030 per LICENSE §12.)

## 0.1.2 — 24 July 2026

Directory health follow-ups — no feature changes. `fundingUrl` points at
the stable product page (the checkout's per-session redirect read as
unreachable to automated checks); a root `build` script (+ esbuild at the
root) enables the directory's build verification against this tree.
(Converts to Apache-2.0 on 24 July 2030 per LICENSE §12.)

## 0.1.1 — 24 July 2026

Directory-review hardening — no feature changes. Visibility toggles moved
from inline styles to stylesheet classes; timers and rAF bound to their own
window (pop-out correctness); lockfiles ship with the release tree so builds
verify; typed-lint clean. Adds this repository's CONTRIBUTING.md. (Converts
to Apache-2.0 on 24 July 2030 per LICENSE §12.)

## 0.1.0 — 23 July 2026

Initial public release: Liefwork for Obsidian — live coral pane, Liefwork
Source-Available License v1.0. (Converts to Apache-2.0 on 23 July 2030 per
LICENSE §12.)
