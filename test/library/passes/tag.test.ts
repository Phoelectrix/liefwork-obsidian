import { describe, expect, test } from "bun:test";
import { tagPass, hashBlockId, mulberry32 } from "../../../src/library/passes/tag.ts";
import type { Block } from "../../../src/library/types.ts";

const liefId = "block_l_42" as any;
const meristemId = "block_m_7" as any;

const blocks: Block[] = [
  { kind: "lief", id: liefId, hierarchyId: "h_x" as any, name: "L", side: "left", origin: { x: 0, y: 0 }, tangent: 0, rotation: 0, shortSide: 1 } as any,
  { kind: "meristem", id: meristemId, hierarchyId: "h_y" as any, name: "M", origin: { x: 0, y: 0 }, tangent: 0, rotation: 0, shortSide: 1 } as any,
  // a non-tagged block kind:
  { kind: "branchNode", id: "block_bn_1" as any, childBranchId: "br_1" as any, side: "right", origin: { x: 0, y: 0 }, tangent: 0, rotation: 0, shortSide: 1 } as any,
];

describe("hashBlockId", () => {
  test("deterministic", () => {
    expect(hashBlockId("block_l_42")).toBe(hashBlockId("block_l_42"));
  });
  test("different ids → different hashes", () => {
    expect(hashBlockId("block_l_42")).not.toBe(hashBlockId("block_l_43"));
  });
});

describe("mulberry32", () => {
  test("deterministic from seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect(a()).toBeCloseTo(b(), 10);
    expect(a()).toBeCloseTo(b(), 10);
  });
  test("output in [0, 1)", () => {
    const r = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("tagPass", () => {
  test("sets tag.random on liefs and meristems only", () => {
    const localBlocks = JSON.parse(JSON.stringify(blocks)) as Block[];
    tagPass(localBlocks, undefined);
    const lief = localBlocks[0]!;
    const mer = localBlocks[1]!;
    const bn = localBlocks[2]!;
    expect((lief as any).tag?.random).toBeGreaterThanOrEqual(0);
    expect((lief as any).tag?.random).toBeLessThan(1);
    expect((mer as any).tag?.random).toBeGreaterThanOrEqual(0);
    expect((bn as any).tag).toBeUndefined();
  });

  test("idempotent across two builds (same id → same tag)", () => {
    const a = JSON.parse(JSON.stringify(blocks)) as Block[];
    const b = JSON.parse(JSON.stringify(blocks)) as Block[];
    tagPass(a, undefined);
    tagPass(b, undefined);
    expect((a[0] as any).tag.random).toBe((b[0] as any).tag.random);
  });

  test("uniformity sanity over 1000 random ids", () => {
    const many: Block[] = [];
    for (let i = 0; i < 1000; i++) {
      many.push({ kind: "lief", id: `block_l_${i}` as any, hierarchyId: `h_${i}` as any, name: "L", side: "left", origin: { x: 0, y: 0 }, tangent: 0, rotation: 0, shortSide: 1 } as any);
    }
    tagPass(many, undefined);
    const tags = many.map((b) => (b as any).tag.random);
    const mean = tags.reduce((s, x) => s + x, 0) / tags.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  test("copies importance from hierarchy node when present", () => {
    const localBlocks = JSON.parse(JSON.stringify(blocks)) as Block[];
    const importanceMap: Record<string, number> = { h_x: 0.7 };
    tagPass(localBlocks, importanceMap);
    expect((localBlocks[0] as any).tag.importance).toBeCloseTo(0.7, 5);
    expect((localBlocks[1] as any).tag.importance).toBeUndefined();
  });
});

import { build } from "../../../src/library/build.ts";
import { defaultEngineConfig } from "../../../src/library/defaults.ts";

describe("integration: build emits tagged blocks", () => {
  test("Library build attaches tags to liefs + meristems", () => {
    const hier = {
      root: {
        id: "root",
        name: "root",
        children: [
          { id: "a", name: "A", children: [{ id: "a1", name: "A1" }, { id: "a2", name: "A2" }] },
          { id: "b", name: "B", children: [{ id: "b1", name: "B1" }] },
        ],
      },
    } as any;
    const plant = build(hier, undefined, defaultEngineConfig);
    const liefs = plant.blocks.filter((b: any) => b.kind === "lief");
    const merists = plant.blocks.filter((b: any) => b.kind === "meristem");
    expect(liefs.length).toBeGreaterThan(0);
    expect(merists.length).toBeGreaterThan(0);
    for (const l of liefs) expect((l as any).tag?.random).toBeDefined();
    for (const m of merists) expect((m as any).tag?.random).toBeDefined();
  });
});
