import { test, expect } from "bun:test";
import { keepContributedEntries, type ContributedEntry } from "../src/coral-menu.ts";

// ── The coral's right-click menu fires Obsidian's `file-menu` event so core and
//    EVERY plugin contribute their items (explorer parity). One contributor is
//    the community Terminal plugin, which appends its own three "open a
//    terminal here" commands right beside Liefwork's own coral commands — three
//    terminal commands that are NOT ours, next to the one that is. The coral
//    menu now keeps exactly one terminal command: Liefwork's.
//
//    keepContributedEntries is that rule, pure: given the entries a trigger
//    appended (in order) and a way to read each one, it returns the survivors. ──

const item = (title: string): ContributedEntry => ({ isSeparator: false, title });
const sep: ContributedEntry = { isSeparator: true, title: "" };
const describe = (e: ContributedEntry): ContributedEntry => e;

test("a foreign terminal command is dropped; every other contribution survives", () => {
  const region = [
    item("Open as Liefwork coral"),
    item("Open in integrated terminal"),
    item("Move file to…"),
  ];
  expect(keepContributedEntries(region, describe).map((e) => e.title)).toEqual([
    "Open as Liefwork coral",
    "Move file to…",
  ]);
});

test("the Terminal plugin's whole block goes — items AND the separators it bracketed them with", () => {
  // The plugin's real shape (obsidian-terminal 3.23): a separator, then a
  // second separator, then one item per configured profile.
  const region = [
    item("Open as Liefwork coral"),
    sep,
    sep,
    item("Open in integrated terminal"),
    item("Open in external terminal"),
    item("Open in developer console terminal"),
  ];
  expect(keepContributedEntries(region, describe).map((e) => e.title)).toEqual([
    "Open as Liefwork coral",
  ]);
});

test("matching is case-insensitive and matches the word anywhere in the title", () => {
  const region = [item("Terminal here"), item("Open Integrated Terminal"), item("Rename…")];
  expect(keepContributedEntries(region, describe).map((e) => e.title)).toEqual(["Rename…"]);
});

test("a separator between two survivors is kept — the region's own grouping is not flattened", () => {
  const region = [item("Open as Liefwork coral"), sep, item("Move file to…")];
  expect(keepContributedEntries(region, describe)).toHaveLength(3);
});

test("a leading separator is dropped — the coral already ends its own items with one", () => {
  // plant-view adds a separator before firing the trigger, so a contributed
  // separator at the head of the region would render as a double rule.
  const region = [sep, item("Move file to…")];
  expect(keepContributedEntries(region, describe).map((e) => e.title)).toEqual(["Move file to…"]);
});

test("consecutive separators collapse to one", () => {
  const region = [item("Move file to…"), sep, sep, item("Open as Liefwork coral")];
  expect(keepContributedEntries(region, describe).map((e) => e.isSeparator)).toEqual([
    false,
    true,
    false,
  ]);
});

test("a trailing separator is dropped — nothing of ours follows it", () => {
  const region = [item("Move file to…"), sep];
  expect(keepContributedEntries(region, describe).map((e) => e.title)).toEqual(["Move file to…"]);
});

test("a region that was only the Terminal plugin's block returns empty, not a bare rule", () => {
  const region = [sep, sep, item("Open in integrated terminal")];
  expect(keepContributedEntries(region, describe)).toEqual([]);
});

test("nothing to drop → the region is returned untouched, in order", () => {
  const region = [item("Open as Liefwork coral"), sep, item("Seed as coral")];
  expect(keepContributedEntries(region, describe)).toEqual(region);
});

test("the describe callback is what reads a foreign shape — survivors come back as the ORIGINALS", () => {
  // plant-view calls this with Obsidian's own MenuItem objects, read through a
  // describe() that sniffs titleEl; the return value must be those same objects
  // so they can be spliced back into the live menu.
  const menuish = [
    { id: 1, label: "Move file to…" },
    { id: 2, label: "Open in integrated terminal" },
  ];
  const kept = keepContributedEntries(menuish, (e) => ({ isSeparator: false, title: e.label }));
  expect(kept).toEqual([{ id: 1, label: "Move file to…" }]);
  expect(kept[0]).toBe(menuish[0]); // identity, not a copy
});
