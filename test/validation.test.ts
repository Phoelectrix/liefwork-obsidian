import { describe, expect, test } from "bun:test";
import { validateHierarchy } from "../src/validation.ts";
import type { HierarchyInput } from "../src/types.ts";

const makeNode = (id: string, name: string, children?: any[]): any => ({
  id, name, children,
});

describe("validateHierarchy", () => {
  test("accepts a minimal well-formed tree", () => {
    const input: HierarchyInput = {
      root: makeNode("r", "root", [makeNode("a", "A"), makeNode("b", "B")]),
    };
    const result = validateHierarchy(input);
    expect(result.errors).toEqual([]);
  });

  test("rejects MERISTEM name > 200 chars (path/breadcrumb legibility)", () => {
    const input: HierarchyInput = {
      // The over-long node has a child → it is a meristem (a path component).
      root: makeNode("r", "root", [
        makeNode("m", "M".repeat(201), [makeNode("c", "C")]),
      ]),
    };
    const result = validateHierarchy(input);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toMatch(/200/);
  });

  test("allows long LIEF names (terminal content is uncapped)", () => {
    const input: HierarchyInput = {
      // No children → a lief → name length is not capped (adaptive-fit in LiefView).
      root: makeNode("r", "root", [makeNode("a", "A".repeat(500))]),
    };
    const result = validateHierarchy(input);
    expect(result.errors).toEqual([]);
  });

  test("warns on summary > 200 chars (as an error for v1.0)", () => {
    const node = makeNode("a", "A");
    node.summary = "x".repeat(201);
    const input: HierarchyInput = { root: makeNode("r", "root", [node]) };
    const result = validateHierarchy(input);
    expect(result.errors.some((e) => /200/.test(e.message))).toBe(true);
  });

  test("rejects duplicate IDs", () => {
    const input: HierarchyInput = {
      root: makeNode("r", "root", [makeNode("a", "A"), makeNode("a", "A2")]),
    };
    const result = validateHierarchy(input);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  test("warns on _engine applied to a terminal lief", () => {
    const leaf = makeNode("l", "leaf");
    leaf._engine = { curveType: "straight" };
    const input: HierarchyInput = { root: makeNode("r", "root", [leaf]) };
    const result = validateHierarchy(input);
    expect(result.warnings.some((w) => /_engine/i.test(w.message))).toBe(true);
  });
});
