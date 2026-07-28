# Changelog

Release dates recorded here are the authoritative "release date of a
version" for the purposes of §12 (future open-source conversion) of the
[LICENSE](LICENSE).

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
