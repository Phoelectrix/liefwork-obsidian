import { describe, test, expect } from "bun:test";
import type { Plant, Branch, Block, LiefBlock, MeristemBlock } from "../../src/types.ts";
import { collectBodies } from "../src/body.ts";

// --- Minimal fixture builders -----------------------------------------
// Mirrors the fake-Plant pattern in viewer/test/pulse-geometry.test.ts: we
// don't run the full engine, just satisfy the Plant/Branch/Block shapes with
// placeholder values for fields collectBodies never reads.

function makeBranch(id: string, parentBranchId: string | null): Branch {
  return {
    id,
    parentBranchId,
    parentBranchNodeId: null,
    depth: parentBranchId === null ? 0 : 1,
    shortSide: 1,
    departureAngle: 0,
    blockIds: [],
    curve: { type: "straight", arcLength: 10, originAngle: 0 },
    arcLength: 10,
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  };
}

function makeMeristemBlock(id: string, branchId: string): MeristemBlock {
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

function makeLiefBlock(id: string, branchId: string): LiefBlock {
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

describe("collectBodies — blockId tagging (Task 5 render-gate cull key)", () => {
  test("each BodyParams carries the source block's id", () => {
    const root = makeBranch("root", null);
    const child = makeBranch("child", "root");
    const plant = makePlant(
      [root, child],
      [
        makeMeristemBlock("m_root", "root"),
        makeMeristemBlock("m_child", "child"),
      ],
    );

    const bodies = collectBodies(plant);
    expect(bodies.map((b) => b.blockId).sort()).toEqual(["m_child", "m_root"]);
  });

  test("liefs are also tagged with their blockId", () => {
    const root = makeBranch("root", null);
    const plant = makePlant(
      [root],
      [makeMeristemBlock("m_root", "root"), makeLiefBlock("l_root_1", "root")],
    );

    const bodies = collectBodies(plant);
    expect(bodies.map((b) => b.blockId).sort()).toEqual(["l_root_1", "m_root"]);
  });
});
