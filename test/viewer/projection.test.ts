import { describe, expect, test } from "bun:test";
import { liefSunAzimuth, meristemSunAzimuth, resolveMeristemSide } from "../../viewer/src/projection.ts";
import { rayEndpoint } from "../../viewer/src/projection.ts";
import { build, defaultEngineConfig } from "../../src/index.ts";
import { branchPathFor } from "../../viewer/src/projection.ts";

describe("liefSunAzimuth", () => {
  test("right-side lief, tangent 0, 90° relative → +π/2", () => {
    expect(liefSunAzimuth({ tangent: 0, side: "right" }, Math.PI / 2))
      .toBeCloseTo(Math.PI / 2, 6);
  });

  test("left-side lief mirrors across tangent (perpendicular outward both sides)", () => {
    // Tangent=0, θ=π/2: right→+π/2 (above), left→-π/2 (below) — both
    // perpendicular-outward, mirrored across the branch axis.
    expect(liefSunAzimuth({ tangent: 0, side: "left" }, Math.PI / 2))
      .toBeCloseTo(-Math.PI / 2, 6);
  });

  test("left-side lief mirrors deviation from perpendicular (both sides tilt the same way)", () => {
    // θ < π/2 → tilt toward tip on both sides.
    // Right side: tangent + θ (rotated CCW less than 90°). Left side: tangent − θ
    // (rotated CW less than 90°) — mirror image relative to branch axis.
    const tilt = Math.PI / 3; // 60° = past 90° below perpendicular, biased toward tip
    expect(liefSunAzimuth({ tangent: 0, side: "right" }, tilt)).toBeCloseTo(tilt, 6);
    expect(liefSunAzimuth({ tangent: 0, side: "left" }, tilt)).toBeCloseTo(-tilt, 6);
  });

  test("tangent +π/2 + 90° relative, right-side → π", () => {
    expect(liefSunAzimuth({ tangent: Math.PI / 2, side: "right" }, Math.PI / 2))
      .toBeCloseTo(Math.PI, 6);
  });

  test("relative angle 0, right-side → azimuth equals tangent", () => {
    expect(liefSunAzimuth({ tangent: 1.234, side: "right" }, 0)).toBeCloseTo(1.234, 6);
  });
});

describe("meristemSunAzimuth", () => {
  test("along-tangent (angle 0) → azimuth equals tangent", () => {
    expect(meristemSunAzimuth({ tangent: Math.PI / 2 }, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(meristemSunAzimuth({ tangent: 0 }, 0)).toBeCloseTo(0, 6);
    expect(meristemSunAzimuth({ tangent: -1.2 }, 0)).toBeCloseTo(-1.2, 6);
  });

  test("non-zero relative angle offsets the tangent", () => {
    expect(meristemSunAzimuth({ tangent: Math.PI / 2 }, Math.PI / 6))
      .toBeCloseTo(Math.PI / 2 + Math.PI / 6, 6);
  });

  test("no side flip (meristems have no side)", () => {
    expect(meristemSunAzimuth({ tangent: 0 }, 0)).toBeCloseTo(0, 6);
  });
});

describe("resolveMeristemSide", () => {
  test("positive departureAngle → right", () => {
    expect(resolveMeristemSide(0.5)).toBe("right");
    expect(resolveMeristemSide(Math.PI / 4)).toBe("right");
  });

  test("negative departureAngle → left", () => {
    expect(resolveMeristemSide(-0.5)).toBe("left");
    expect(resolveMeristemSide(-Math.PI / 4)).toBe("left");
  });

  test("zero departureAngle (stem) → right", () => {
    expect(resolveMeristemSide(0)).toBe("right");
  });
});

describe("rayEndpoint", () => {
  test("endpoint = origin + (distance·shortSide)·(cos az, sin az)", () => {
    const p = rayEndpoint({ x: 10, y: 20 }, 0, 100, 4);
    expect(p.x).toBeCloseTo(10 + 400, 4);
    expect(p.y).toBeCloseTo(20, 4);
  });

  test("azimuth +π/2 extends along +y", () => {
    const p = rayEndpoint({ x: 0, y: 0 }, Math.PI / 2, 50, 2);
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeCloseTo(100, 4);
  });

  test("distance 0 → endpoint equals origin", () => {
    const p = rayEndpoint({ x: 7, y: 13 }, 1.5, 100, 0);
    expect(p.x).toBeCloseTo(7, 6);
    expect(p.y).toBeCloseTo(13, 6);
  });
});

describe("branchPathFor", () => {
  const mini = {
    root: {
      id: "root",
      name: "Root",
      children: [
        {
          id: "a",
          name: "Comedies",
          children: [{ id: "a1", name: "As-You-Like-It", children: [] }],
        },
        {
          id: "b",
          name: "Tragedies",
          children: [{ id: "b1", name: "Hamlet", children: [{ id: "b1a", name: "Act1", children: [] }] }],
        },
      ],
    },
  };

  const plant = build(mini, undefined, defaultEngineConfig);

  test("stem meristem has empty path", () => {
    const stem = plant.blocks.find(
      (b) => b.kind === "meristem" && b.branchId === plant.branches[0]!.id,
    );
    expect(stem).toBeDefined();
    expect(branchPathFor(stem!, plant)).toBe("");
  });

  test("child branch path joins ancestor names with /", () => {
    const hamletBranch = plant.branches.find((br) =>
      plant.blocks.some(
        (blk) =>
          blk.branchId === br.id &&
          "name" in blk &&
          blk.name === "Hamlet",
      ),
    );
    expect(hamletBranch).toBeDefined();
    const hamletMeristem = plant.blocks.find(
      (b) => b.kind === "meristem" && b.branchId === hamletBranch!.id,
    );
    expect(branchPathFor(hamletMeristem!, plant)).toBe("Tragedies/Hamlet");
  });
});

import { resolveProjectionConfig } from "../../viewer/src/projection.ts";

describe("resolveProjectionConfig", () => {
  const base = {
    liefRelativeAngle: Math.PI / 2,
    meristemRelativeAngle: 0,
    magnification: 3.0,
    distance: 4.0,
  };

  test("empty overrides returns base unchanged", () => {
    expect(resolveProjectionConfig("Tragedies/Hamlet", base, {})).toEqual(base);
  });

  test("direct match override wins", () => {
    const merged = resolveProjectionConfig(
      "Tragedies/Hamlet",
      base,
      { "Tragedies/Hamlet": { magnification: 5.0 } },
    );
    expect(merged.magnification).toBe(5.0);
    expect(merged.distance).toBe(4.0);
  });

  test("ancestor match applies", () => {
    const merged = resolveProjectionConfig(
      "Tragedies/Hamlet",
      base,
      { "Tragedies": { magnification: 5.0 } },
    );
    expect(merged.magnification).toBe(5.0);
  });

  test("closer ancestor overrides further ancestor", () => {
    const merged = resolveProjectionConfig(
      "Tragedies/Hamlet",
      base,
      {
        "Tragedies": { magnification: 5.0 },
        "Tragedies/Hamlet": { magnification: 7.0 },
      },
    );
    expect(merged.magnification).toBe(7.0);
  });

  test("non-matching overrides are ignored", () => {
    const merged = resolveProjectionConfig(
      "Tragedies/Hamlet",
      base,
      { "Comedies": { magnification: 5.0 } },
    );
    expect(merged.magnification).toBe(3.0);
  });

  test("empty path (stem) matches only empty-key override", () => {
    const merged = resolveProjectionConfig(
      "",
      base,
      {
        "": { magnification: 5.0 },
        "Tragedies": { magnification: 7.0 },
      },
    );
    expect(merged.magnification).toBe(5.0);
  });
});
