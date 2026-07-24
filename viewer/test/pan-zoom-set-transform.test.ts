import { describe, expect, test } from "bun:test";
// happy-dom is registered globally by the test preload (viewer/test/setup-dom.ts,
// wired via bunfig.toml [test] preload) — do NOT re-register here (double
// registration throws in the full suite).
import { installPanZoom } from "../src/pan-zoom.ts";
import type { Bounds } from "../../src/types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const bounds: Bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };

function makeSvg(): { svg: SVGSVGElement; world: SVGGElement } {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const world = document.createElementNS(SVG_NS, "g") as SVGGElement;
  svg.appendChild(world);
  document.body.appendChild(svg);
  return { svg, world };
}

describe("PanZoomHandle.setTransform", () => {
  test("writes the world transform and fires onCommit + onTransformChange", () => {
    const { svg, world } = makeSvg();
    const commits: Array<[number, number, number]> = [];
    const changes: Array<[number, number, number]> = [];
    const handle = installPanZoom(
      svg, world, bounds,
      undefined,
      (tx, ty, scale) => changes.push([tx, ty, scale]),
      null,
      (tx, ty, scale) => commits.push([tx, ty, scale]),
    );

    handle.setTransform(12, 34, 2);

    expect(world.getAttribute("transform")).toBe("translate(12.000 34.000) scale(2.000)");
    expect(commits.at(-1)).toEqual([12, 34, 2]);
    expect(changes.at(-1)).toEqual([12, 34, 2]);
  });
});
