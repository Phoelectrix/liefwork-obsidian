import { test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/index.ts";
import { subtreeNormByBranch } from "../../viewer/src/subtree-weight.ts";
import { buildProjectionConfigMap } from "../../viewer/src/mount-plant.ts";
import { mergeStylingConfig } from "../../viewer/src/styling.ts";

// Root with one heavy bough (many liefs + a sub-branch) and one light bough.
const leaf = (id: string) => ({ id, name: id, children: [] });
const mini = {
  root: {
    id: "root",
    name: "Root",
    children: [
      {
        id: "heavy",
        name: "Heavy",
        children: [
          leaf("h1"), leaf("h2"), leaf("h3"), leaf("h4"), leaf("h5"), leaf("h6"),
          { id: "hsub", name: "HeavySub", children: [leaf("s1"), leaf("s2"), leaf("s3")] },
        ],
      },
      { id: "light", name: "Light", children: [leaf("l1")] },
    ],
  },
};
const plant = build(mini, undefined, defaultEngineConfig);
const branchByName = (name: string) => {
  const m = plant.blocks.find((b) => b.kind === "meristem" && (b as { name: string }).name === name)!;
  return plant.branches.find((br) => br.id === m.branchId)!;
};
const meristemOf = (name: string) =>
  plant.blocks.find((b) => b.kind === "meristem" && (b as { name: string }).name === name)!;

test("subtreeNormByBranch: root is 1, heavy > light, log-normalised", () => {
  const norm = subtreeNormByBranch(plant);
  expect(norm.get(branchByName("Root").id)).toBeCloseTo(1, 6);
  const heavy = norm.get(branchByName("Heavy").id)!;
  const light = norm.get(branchByName("Light").id)!;
  expect(heavy).toBeGreaterThan(light);
  expect(light).toBeGreaterThan(0);
  expect(heavy).toBeLessThan(1);
});

test("meristemDistanceWeightGain 0 reproduces today's rays exactly", () => {
  const styling = mergeStylingConfig({ projection: { meristemDistance: 3, rootMeristemDistance: 5 } as never });
  const map = buildProjectionConfigMap(plant, styling);
  expect(map.get(meristemOf("Heavy").id)!.meristemDistance).toBe(3);
  expect(map.get(meristemOf("Light").id)!.meristemDistance).toBe(3);
  expect(map.get(meristemOf("Root").id)!.meristemDistance).toBe(5);
});

test("with gain, a heavy branch's ray lifts by (1 + gain × subtreeNorm); root uses its own base", () => {
  const gain = 2;
  const styling = mergeStylingConfig({
    projection: { meristemDistance: 3, rootMeristemDistance: 5, meristemDistanceWeightGain: gain } as never,
  });
  const norm = subtreeNormByBranch(plant);
  const map = buildProjectionConfigMap(plant, styling);
  const heavyNorm = norm.get(branchByName("Heavy").id)!;
  const lightNorm = norm.get(branchByName("Light").id)!;
  expect(map.get(meristemOf("Heavy").id)!.meristemDistance).toBeCloseTo(3 * (1 + gain * heavyNorm), 9);
  expect(map.get(meristemOf("Light").id)!.meristemDistance).toBeCloseTo(3 * (1 + gain * lightNorm), 9);
  expect(map.get(meristemOf("Root").id)!.meristemDistance).toBeCloseTo(5 * (1 + gain * 1), 9);
  // liefs are untouched by the gain
  const lief = plant.blocks.find((b) => b.kind === "lief")!;
  expect(map.get(lief.id)!.meristemDistance).toBe(3);
});

// ── Screen-space lift ────────────────────────────────────────────────────────
// The world-unit ray lift vanishes with the zoom while titles hold their
// screen size (optimalSize) — so zoomed out, titles still pile up (founder,
// 28 Aug: "even at weight 8 barely moves"). The screen lift is in px along
// the ray: meristemLiftEm × fontPx × weight.
import { meristemLiftPx, __collectLabelParamsForTest } from "../../viewer/src/skeleton-canvas.ts";
import { readFileSync } from "node:fs";

test("meristemLiftPx: meristems only; em × fontPx × weight", () => {
  expect(meristemLiftPx("lief", 40, 1, 1.5)).toBe(0);
  expect(meristemLiftPx("meristem", 40, 1, 0)).toBe(0);
  expect(meristemLiftPx("meristem", 40, 1, 1.5)).toBeCloseTo(60, 9);
  expect(meristemLiftPx("meristem", 40, 0.5, 1.5)).toBeCloseTo(30, 9);
});

test("label params carry the branch's subtree weight (root 1, liefs 0)", () => {
  const styling = mergeStylingConfig({});
  const params = __collectLabelParamsForTest(plant, styling, buildProjectionConfigMap(plant, styling));
  const norm = subtreeNormByBranch(plant);
  const root = params.find((p) => p.blockId === meristemOf("Root").id)!;
  const heavy = params.find((p) => p.blockId === meristemOf("Heavy").id)!;
  const lief = params.find((p) => p.kind === "lief")!;
  expect(root.weight).toBeCloseTo(1, 9);
  expect(heavy.weight).toBeCloseTo(norm.get(branchByName("Heavy").id)!, 9);
  expect(lief.weight).toBe(0);
});

test("the screen lift is applied in the draw pass AND hitTest (click boxes follow the glyphs)", () => {
  const src = readFileSync(new URL("../../viewer/src/skeleton-canvas.ts", import.meta.url), "utf8");
  const uses = src.match(/meristemLiftPx\(/g) ?? [];
  expect(uses.length).toBeGreaterThanOrEqual(3); // definition + draw + hitTest
});

// The fit is world-space; a screen-px lift can push the root title off the
// viewport edge on Full View. The fit therefore reserves the worst-case lift
// (root weight 1 at the title's peak px) as an inset on every side.
import { meristemLiftInsetPx, MERISTEM_TITLE_MAX_PX } from "../../viewer/src/skeleton-canvas.ts";
test("meristemLiftInsetPx: worst-case root lift, 0 when the lift is off", () => {
  expect(meristemLiftInsetPx(0)).toBe(0);
  expect(meristemLiftInsetPx(1.5)).toBeCloseTo(1.5 * MERISTEM_TITLE_MAX_PX, 9);
});

// The fit never reserved the root title's own height either (Main Vault was
// clipped top-left before any lift existed). The fit inset = lift + one
// title height at the peak px.
import { fitLabelInsetPx } from "../../viewer/src/skeleton-canvas.ts";
test("fitLabelInsetPx: title height always, plus the worst-case lift", () => {
  expect(fitLabelInsetPx(0)).toBe(MERISTEM_TITLE_MAX_PX);
  expect(fitLabelInsetPx(1.5)).toBeCloseTo(MERISTEM_TITLE_MAX_PX + 1.5 * MERISTEM_TITLE_MAX_PX, 9);
});
