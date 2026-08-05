import { test, expect } from "bun:test";
import { build, defaultEngineConfig } from "../../src/library/index.ts";
import type { HierarchyInput } from "../../src/library/types.ts";
import { mergeStylingConfig } from "../src/styling.ts";
import { projectedContentBounds } from "../src/skeleton-canvas.ts";

const area = (b: { min: { x: number; y: number }; max: { x: number; y: number } }): number =>
  (b.max.x - b.min.x) * (b.max.y - b.min.y);

test("projectedContentBounds is a superset of plant.bounds", () => {
  const tree: HierarchyInput = {
    root: { id: "root", name: "root", children: [{ id: "a", name: "a" }, { id: "b", name: "b" }] },
  };
  const plant = build(tree, undefined, defaultEngineConfig);
  const cb = projectedContentBounds(plant, mergeStylingConfig({}));

  expect(cb.min.x).toBeLessThanOrEqual(plant.bounds.min.x);
  expect(cb.min.y).toBeLessThanOrEqual(plant.bounds.min.y);
  expect(cb.max.x).toBeGreaterThanOrEqual(plant.bounds.max.x);
  expect(cb.max.y).toBeGreaterThanOrEqual(plant.bounds.max.y);
});

test("projectedContentBounds extends past the node footprint for the projected labels", () => {
  // A minimal coral — root meristem + one child. This is the case that broke:
  // the root title (rootMeristemDistance) dwarfs the tiny branch footprint.
  const tree: HierarchyInput = { root: { id: "root", name: "root", children: [{ id: "a", name: "a" }] } };
  const plant = build(tree, undefined, defaultEngineConfig);
  const cb = projectedContentBounds(plant, mergeStylingConfig({}));

  // The projected labels must enlarge the fitted area (otherwise titles clip).
  expect(area(cb)).toBeGreaterThan(area(plant.bounds));
});
