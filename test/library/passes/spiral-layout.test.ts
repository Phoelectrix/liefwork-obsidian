import { describe, expect, test } from "bun:test";
import { structurePass } from "../../../src/library/passes/structure.ts";
import { anglePass } from "../../../src/library/passes/angle.ts";
import { sizePass } from "../../../src/library/passes/size.ts";
import { spiralLayoutPass } from "../../../src/library/passes/spiral-layout.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";
import type { HierarchyInput } from "../../../src/library/types.ts";

// Root with a normal branch and an archive branch holding three entries.
const input: HierarchyInput = {
  root: {
    id: "/", name: "root",
    children: [
      { id: "n", name: "normal", children: [{ id: "n/a", name: "a" }] },
      { id: "_archive", name: "_archive", isArchive: true, children: [
        { id: "_archive/x", name: "x", order: 10 },
        { id: "_archive/y", name: "y", order: 20 },
        { id: "_archive/z", name: "z", order: 30 },
      ]},
    ],
  },
};

describe("spiralLayoutPass", () => {
  const run = () => {
    const s = structurePass(input, defaultEngineConfig);
    anglePass(s, defaultEngineConfig);
    const sized = sizePass(s, defaultEngineConfig);
    return spiralLayoutPass(sized, defaultEngineConfig);
  };

  test("archive branch gets a spiral curve; normal branches keep theirs", () => {
    const s = run();
    const arc = s.branches.find((b) => b.isArchive)!;
    const normal = s.branches.find((b) => !b.isArchive && b.parentBranchId !== null);
    expect(arc.curve.type).toBe("spiral");
    expect(arc.curve.spiral).toBeDefined();
    expect(normal?.curve.type).not.toBe("spiral");
  });

  test("archive lief blocks are tapered (shortSide non-increasing toward the tip) and one-sided", () => {
    const s = run();
    const arc = s.branches.find((b) => b.isArchive)!;
    const liefs = arc.blockIds
      .map((id) => s.blocks.find((b) => b.id === id)!)
      .filter((b) => b.kind === "lief");
    expect(liefs.length).toBeGreaterThan(0);
    expect(liefs.every((l) => (l as { side: string }).side === "left")).toBe(true);
    for (let i = 1; i < liefs.length; i++) {
      expect(liefs[i]!.shortSide).toBeLessThanOrEqual(liefs[i - 1]!.shortSide + 1e-9);
    }
  });

  test("archive meristem block is named Archive", () => {
    const s = run();
    const arc = s.branches.find((b) => b.isArchive)!;
    const mer = arc.blockIds
      .map((id) => s.blocks.find((b) => b.id === id)!)
      .find((b) => b.kind === "meristem") as { name: string } | undefined;
    expect(mer?.name).toBe("Archive");
  });
});
