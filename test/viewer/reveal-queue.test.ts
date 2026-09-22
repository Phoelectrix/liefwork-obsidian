import { describe, expect, test } from "bun:test";
import { buildRevealQueue, type BranchStateChange } from "../../viewer/src/sizing/reveal-queue.ts";

describe("buildRevealQueue", () => {
  test("mounts sorted by depth ascending", () => {
    const changes: BranchStateChange[] = [
      { id: "deep", action: "mount", depth: 3, descendantCount: 5 },
      { id: "stem", action: "mount", depth: 0, descendantCount: 100 },
      { id: "mid", action: "mount", depth: 1, descendantCount: 50 },
    ];
    const queue = buildRevealQueue(changes);
    expect(queue.map((c) => c.id)).toEqual(["stem", "mid", "deep"]);
  });

  test("mounts at same depth sort by descendantCount descending", () => {
    const changes: BranchStateChange[] = [
      { id: "small", action: "mount", depth: 1, descendantCount: 5 },
      { id: "big", action: "mount", depth: 1, descendantCount: 50 },
      { id: "mid", action: "mount", depth: 1, descendantCount: 20 },
    ];
    const queue = buildRevealQueue(changes);
    expect(queue.map((c) => c.id)).toEqual(["big", "mid", "small"]);
  });

  test("unmounts come AFTER mounts and sort by depth descending", () => {
    const changes: BranchStateChange[] = [
      { id: "unmountShallow", action: "unmount", depth: 0, descendantCount: 100 },
      { id: "mountShallow", action: "mount", depth: 0, descendantCount: 100 },
      { id: "unmountDeep", action: "unmount", depth: 3, descendantCount: 5 },
    ];
    const queue = buildRevealQueue(changes);
    expect(queue.map((c) => c.id)).toEqual([
      "mountShallow",
      "unmountDeep",
      "unmountShallow",
    ]);
  });

  test("empty input → empty queue", () => {
    expect(buildRevealQueue([])).toEqual([]);
  });
});
