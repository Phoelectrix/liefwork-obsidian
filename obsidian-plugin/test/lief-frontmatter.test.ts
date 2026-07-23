import { test, expect } from "bun:test";
import {
  resolveCreated,
  resolveOrder,
  nextOrder,
  collectBranchOrders,
  liefNoteContent,
  restoreOrder,
  ORDER_STEP,
} from "../src/lief-frontmatter.ts";

const FALLBACK = "2026-01-01T00:00:00.000Z";

test("resolveCreated: a valid frontmatter date wins; else the fs fallback", () => {
  expect(resolveCreated("2026-06-12", FALLBACK)).toBe("2026-06-12");
  expect(resolveCreated(undefined, FALLBACK)).toBe(FALLBACK);
  expect(resolveCreated("not a date", FALLBACK)).toBe(FALLBACK);
  expect(resolveCreated("", FALLBACK)).toBe(FALLBACK);
});

test("resolveOrder: a finite number, else undefined", () => {
  expect(resolveOrder(20)).toBe(20);
  expect(resolveOrder(0)).toBe(0);
  expect(resolveOrder("20")).toBeUndefined();
  expect(resolveOrder(undefined)).toBeUndefined();
  expect(resolveOrder(Number.NaN)).toBeUndefined();
});

test("nextOrder: appends after the max with a gap; first step when empty", () => {
  expect(nextOrder([])).toBe(ORDER_STEP);
  expect(nextOrder([10, 20])).toBe(30);
  expect(nextOrder([20, 10])).toBe(30); // unordered input is fine
  expect(nextOrder([5])).toBe(15);
});

test("liefNoteContent: created + order frontmatter then the body", () => {
  const out = liefNoteContent("Hello", "2026-06-12", 10);
  expect(out).toContain("created: 2026-06-12");
  expect(out).toContain("order: 10");
  expect(out.endsWith("\n\nHello\n")).toBe(true);
});

test("liefNoteContent: empty body → just the frontmatter (for an Untitled note)", () => {
  const out = liefNoteContent("", "2026-06-12", 10);
  expect(out).toContain("order: 10");
  expect(out.endsWith("---\n\n")).toBe(true);
});

// ── siblingOrders bug regression ──────────────────────────────────────────────
// Before the fix, siblingOrders() ignored TFolder children, so nextOrder() saw
// only the loose lief orders (e.g. [10]) and returned 20 — colliding with the
// sub-branch folder-note at order 80.  collectBranchOrders merges both lists so
// nextOrder sees the true max (80) and returns 90.

test("collectBranchOrders: merges loose and sub-branch orders into one list", () => {
  expect(collectBranchOrders([10], [80])).toEqual([10, 80]);
  expect(collectBranchOrders([], [80])).toEqual([80]);
  expect(collectBranchOrders([10], [])).toEqual([10]);
  expect(collectBranchOrders([], [])).toEqual([]);
});

test("nextOrder after collectBranchOrders: sub-branch at 80 + loose at 10 → next = 90", () => {
  // Reproduces the confirmed bug: without sub-branch orders, nextOrder([10]) = 20.
  // With them, nextOrder(collectBranchOrders([10], [80])) = 90.
  const looseOrders = [10];
  const subBranchOrders = [80]; // sub-branch folder-note carries order: 80
  const all = collectBranchOrders(looseOrders, subBranchOrders);
  expect(nextOrder(all)).toBe(90); // was 20 before the fix
});

test("nextOrder without sub-branch orders (old behaviour, broken): would return 20", () => {
  // Documents the pre-fix wrong answer for clarity.
  expect(nextOrder([10])).toBe(20);
});

// ── restoreOrder: re-insert a restored item by its original position ──────────

test("restoreOrder slots between the closest-preceding survivor and the next", () => {
  // siblings now at 10, 50; original was 30 → between 10 and 50 → 30
  expect(restoreOrder(30, [10, 50])).toBe(30);
});
test("restoreOrder appends at the tip when original is newest", () => {
  expect(restoreOrder(99, [10, 20])).toBe(30); // 20 + STEP
});
test("restoreOrder goes before the first when original precedes all", () => {
  expect(restoreOrder(5, [10, 20])).toBe(5); // < first, keep below 10
});
