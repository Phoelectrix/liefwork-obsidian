import { describe, expect, test } from "bun:test";
// Arrow keys move the coral cursor — but inside the HUD's compose field an
// arrow must move the CARET. Same duck-typed target check as the shipped Escape
// handler: a pop-out window builds elements from THAT window's constructors, so
// instanceof against this realm's globals is always false there. tagName survives.
import { cursorKeyAction, shouldIgnoreCursorKey } from "../src/view-behavior.ts";

const el = (tagName: string, contentEditable = false) =>
  ({ tagName, isContentEditable: contentEditable }) as unknown as HTMLElement;

describe("shouldIgnoreCursorKey", () => {
  test("ignores arrows inside a text input", () => {
    expect(shouldIgnoreCursorKey(el("INPUT"))).toBe(true);
    expect(shouldIgnoreCursorKey(el("TEXTAREA"))).toBe(true);
  });

  test("ignores arrows inside a contenteditable", () => {
    expect(shouldIgnoreCursorKey(el("DIV", true))).toBe(true);
  });

  test("handles arrows anywhere else", () => {
    expect(shouldIgnoreCursorKey(el("DIV"))).toBe(false);
    expect(shouldIgnoreCursorKey(el("CANVAS"))).toBe(false);
    expect(shouldIgnoreCursorKey(null)).toBe(false);
  });
});

// The keyboard cursor is a PREVIEW-mode feature: it moves a highlight and opens
// the HUD to preview it. With preview (HUD) OFF — the explorer-like mode where a
// click just opens the note — an arrow must do NOTHING and pass through, not
// drag the HUD back into view. It also passes through inside a text field.
describe("cursorKeyAction", () => {
  test("acts only when the HUD is enabled and the target isn't a text field", () => {
    expect(cursorKeyAction(true, el("CANVAS"))).toBe("act");
    expect(cursorKeyAction(true, null)).toBe("act");
  });

  test("passes through when preview is off (cursor inert in explorer mode)", () => {
    expect(cursorKeyAction(false, el("CANVAS"))).toBe("passthrough");
    expect(cursorKeyAction(false, null)).toBe("passthrough");
  });

  test("passes through inside a text field regardless of preview state", () => {
    expect(cursorKeyAction(true, el("INPUT"))).toBe("passthrough");
    expect(cursorKeyAction(true, el("TEXTAREA"))).toBe("passthrough");
    expect(cursorKeyAction(true, el("DIV", true))).toBe("passthrough");
    expect(cursorKeyAction(false, el("INPUT"))).toBe("passthrough");
  });
});
