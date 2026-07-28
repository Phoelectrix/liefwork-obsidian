import { describe, test, expect } from "bun:test";
import type { Plant, Branch, Block, LiefBlock, MeristemBlock } from "../../src/types.ts";
import {
  UNFURL_EXPAND_STENCIL,
  UNFURL_FURL_STENCIL,
} from "../src/unfurl-affordance.ts";
import {
  furlableBranchIds,
  seedFurledByDepth,
  hiddenBranchIds,
  directChildBranchIds,
  hiddenBlockIds,
  unfurlOneLevel,
  furlBranch,
  clickIntentFor,
  type FurlState,
} from "../src/furl-tree.ts";

// --- Minimal fixture builders -----------------------------------------
// Mirrors the fake-Plant pattern in viewer/test/pulse-geometry.test.ts: we
// don't run the full engine, just satisfy the Plant/Branch/Block shapes
// with placeholder values for fields these pure functions never read.

function makeBranch(id: string, parentBranchId: string | null, depth: number): Branch {
  return {
    id,
    parentBranchId,
    parentBranchNodeId: null,
    depth,
    shortSide: 1,
    departureAngle: 0,
    blockIds: [],
    curve: { type: "straight", arcLength: 10, originAngle: 0 },
    arcLength: 10,
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  };
}

function makeLief(id: string, branchId: string, stencilId?: string): LiefBlock {
  return {
    id,
    branchId,
    index: 0,
    shortSide: 1,
    arcPosition: 0,
    position: { x: 0, y: 0 },
    tangent: 0,
    rotation: 0,
    kind: "lief",
    hierarchyId: id,
    name: id,
    side: "left",
    stencilId,
  };
}

function makeMeristem(id: string, branchId: string): MeristemBlock {
  return {
    id,
    branchId,
    index: 0,
    shortSide: 1,
    arcPosition: 0,
    position: { x: 0, y: 0 },
    tangent: 0,
    rotation: 0,
    kind: "meristem",
    hierarchyId: id,
    name: id,
  };
}

function makePlant(branches: Branch[], blocks: Block[] = []): Plant {
  return {
    schemaVersion: "1.0.0",
    id: "fake",
    metadata: {
      builtAt: "",
      engineVersion: "",
      configHash: "",
      hierarchyHash: "",
      counts: { events: 0, blocks: blocks.length, branches: branches.length },
    },
    config: {} as Plant["config"],
    events: [],
    anchor: { position: { x: 0, y: 0 }, orientationAngle: 0 },
    stemBranchId: branches[0]?.id ?? "root",
    branches,
    blocks,
    rings: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  } satisfies Plant;
}

// --- Shared tree fixture ------------------------------------------------
// root(0) -> a(1) -> a1(2) -> a1x(3)   [a, a1 furlable; a1x a leaf]
// root(0) -> b(1)                      [b a leaf branch with a content lief]
function buildTree() {
  const root = makeBranch("root", null, 0);
  const a = makeBranch("a", "root", 1);
  const a1 = makeBranch("a1", "a", 2);
  const a1x = makeBranch("a1x", "a1", 3);
  const b = makeBranch("b", "root", 1);
  const branches = [root, a, a1, a1x, b];

  const blocks: Block[] = [
    makeMeristem("rootMeristem", "root"),

    makeMeristem("aMeristem", "a"),
    makeLief("aLief", "a"),
    makeLief("aExpand", "a", UNFURL_EXPAND_STENCIL),
    makeLief("aFurl", "a", UNFURL_FURL_STENCIL),

    makeMeristem("a1Meristem", "a1"),
    makeLief("a1Lief", "a1"),
    makeLief("a1Expand", "a1", UNFURL_EXPAND_STENCIL),
    makeLief("a1Furl", "a1", UNFURL_FURL_STENCIL),

    makeMeristem("a1xMeristem", "a1x"),
    makeLief("a1xLief", "a1x"),

    makeMeristem("bMeristem", "b"),
    makeLief("bLief", "b"),
  ];

  const plant = makePlant(branches, blocks);
  return { plant, root, a, a1, a1x, b, blocks };
}

describe("furlableBranchIds", () => {
  test("branches with >=1 direct child branch are furlable; leaves are not", () => {
    const { plant } = buildTree();
    expect(furlableBranchIds(plant)).toEqual(new Set(["root", "a", "a1"]));
  });
});

describe("seedFurledByDepth", () => {
  test("furlable branches with depth >= initialDepth", () => {
    const { plant } = buildTree();
    expect(seedFurledByDepth(plant, 1)).toEqual(new Set(["a", "a1"]));
  });

  test("depth 0 includes root too (root is furlable)", () => {
    const { plant } = buildTree();
    expect(seedFurledByDepth(plant, 0)).toEqual(new Set(["root", "a", "a1"]));
  });
});

describe("directChildBranchIds", () => {
  test("returns direct child branch ids of a branch", () => {
    const { plant } = buildTree();
    expect(directChildBranchIds(plant, "root")).toEqual(["a", "b"]);
    expect(directChildBranchIds(plant, "a")).toEqual(["a1"]);
    expect(directChildBranchIds(plant, "a1x")).toEqual([]);
  });
});

describe("hiddenBranchIds", () => {
  test("strict descendants of a furled branch, not the branch itself", () => {
    const { plant } = buildTree();
    expect(hiddenBranchIds(plant, new Set(["a"]))).toEqual(new Set(["a1", "a1x"]));
  });

  test("no furled branches -> nothing hidden", () => {
    const { plant } = buildTree();
    expect(hiddenBranchIds(plant, new Set())).toEqual(new Set());
  });
});

describe("hiddenBlockIds", () => {
  test("enabled + furled({a}): a's content+furl-affordance hidden, meristem+expand-affordance shown, descendant a1 fully hidden", () => {
    const { plant } = buildTree();
    const state: FurlState = { enabled: true, furled: new Set(["a"]) };
    const hidden = hiddenBlockIds(plant, state);

    // a's own content lief hidden.
    expect(hidden.has("aLief")).toBe(true);
    // a's furl-affordance hidden (branch furled, not meristem/expand).
    expect(hidden.has("aFurl")).toBe(true);
    // a's expand-affordance NOT hidden (branch furled -> expand cue shows).
    expect(hidden.has("aExpand")).toBe(false);
    // a's meristem NOT hidden.
    expect(hidden.has("aMeristem")).toBe(false);

    // A block on descendant a1 is hidden (strict descendant of furled a) —
    // including its meristem and affordances, unconditionally.
    expect(hidden.has("a1Lief")).toBe(true);
    expect(hidden.has("a1Meristem")).toBe(true);
    expect(hidden.has("a1Expand")).toBe(true);
    expect(hidden.has("a1Furl")).toBe(true);
    expect(hidden.has("a1xLief")).toBe(true);
    expect(hidden.has("a1xMeristem")).toBe(true);

    // b is untouched: unfurled, not furled, not a descendant of a furled
    // branch -> not hidden. b has no affordance blocks (leaf, not furlable).
    expect(hidden.has("bMeristem")).toBe(false);
    expect(hidden.has("bLief")).toBe(false);

    // root: not furled, so root's own expand-affordance would be hidden if
    // it had one — it doesn't in this fixture, but root's content/meristem
    // must not be hidden.
    expect(hidden.has("rootMeristem")).toBe(false);
  });

  test("disabled: every affordance block hidden, everything else shown", () => {
    const { plant } = buildTree();
    const state: FurlState = { enabled: false, furled: new Set(["a"]) };
    const hidden = hiddenBlockIds(plant, state);

    expect(hidden).toEqual(
      new Set(["aExpand", "aFurl", "a1Expand", "a1Furl"]),
    );
  });

  test("unfurled branch: expand-affordance hidden (case d), furl-affordance visible (reciprocal)", () => {
    const { plant } = buildTree();
    // enabled + unfurled (furled: new Set() means no branches are furled)
    const state: FurlState = { enabled: true, furled: new Set() };
    const hidden = hiddenBlockIds(plant, state);

    // Branch 'a' is unfurled and has both affordances.
    // When unfurled, the expand-affordance should be hidden (case d:
    // expand cue shows only when branch is furled).
    expect(hidden.has("aExpand")).toBe(true);

    // The furl-affordance should be visible (reciprocal: furl control
    // shows when the branch is unfurled/expanded).
    expect(hidden.has("aFurl")).toBe(false);

    // The meristem and content lief should not be hidden either.
    expect(hidden.has("aMeristem")).toBe(false);
    expect(hidden.has("aLief")).toBe(false);

    // b is also unfurled with no affordances, just meristem and content.
    expect(hidden.has("bMeristem")).toBe(false);
    expect(hidden.has("bLief")).toBe(false);
  });
});

describe("unfurlOneLevel", () => {
  test("removes branchId, adds its direct child branch ids (reveals one level)", () => {
    const { plant } = buildTree();
    const seed = seedFurledByDepth(plant, 1); // {a, a1}
    const next = unfurlOneLevel(plant, seed, "a");

    expect(next).toEqual(new Set(["a1"]));
    // Original set untouched (pure transition).
    expect(seed).toEqual(new Set(["a", "a1"]));

    // a1 now shown as itself (directly furled, not hidden); a1x still hidden
    // as a1's strict descendant.
    const hidden = hiddenBranchIds(plant, next);
    expect(hidden.has("a1")).toBe(false);
    expect(hidden.has("a1x")).toBe(true);
  });
});

describe("furlBranch", () => {
  test("adds a branch id to the furled set without mutating the input", () => {
    const original = new Set(["a"]);
    const next = furlBranch(original, "a1");

    expect(next).toEqual(new Set(["a", "a1"]));
    expect(original).toEqual(new Set(["a"])); // unmutated
  });
});

describe("clickIntentFor", () => {
  const { plant, blocks } = buildTree();
  const byId = (id: string): Block => blocks.find((b) => b.id === id)!;

  test("expand-affordance -> expand-only", () => {
    const state: FurlState = { enabled: true, furled: new Set(["a"]) };
    expect(clickIntentFor(byId("aExpand"), state)).toBe("expand-only");
  });

  test("furl-affordance -> furl", () => {
    const state: FurlState = { enabled: true, furled: new Set([]) };
    expect(clickIntentFor(byId("aFurl"), state)).toBe("furl");
  });

  test("meristem of a furled branch -> expand-and-open", () => {
    const state: FurlState = { enabled: true, furled: new Set(["a"]) };
    expect(clickIntentFor(byId("aMeristem"), state)).toBe("expand-and-open");
  });

  test("meristem of a NOT-furled branch -> normal", () => {
    const state: FurlState = { enabled: true, furled: new Set([]) };
    expect(clickIntentFor(byId("aMeristem"), state)).toBe("normal");
  });

  test("ordinary lief -> normal", () => {
    const state: FurlState = { enabled: true, furled: new Set(["a"]) };
    expect(clickIntentFor(byId("aLief"), state)).toBe("normal");
  });

  test("disabled: anything -> normal, even affordance blocks", () => {
    const state: FurlState = { enabled: false, furled: new Set(["a"]) };
    expect(clickIntentFor(byId("aExpand"), state)).toBe("normal");
    expect(clickIntentFor(byId("aFurl"), state)).toBe("normal");
    expect(clickIntentFor(byId("aMeristem"), state)).toBe("normal");
  });
});
