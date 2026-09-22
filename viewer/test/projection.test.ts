import { describe, test, expect } from "bun:test";
import { liefSunAzimuth, projectionVerticalAnchor } from "../src/projection.ts";

const DEG = Math.PI / 180;

// The projected label's ray-tip sits at (cos sunAz, sin sunAz)·rayLen in SVG's
// y-DOWN frame. The ray should land on the box edge facing the branch so the
// label body sits in open space: ray pointing down (sin > 0) → label hangs
// downward → anchor "top"; pointing up (sin < 0) → "bottom"; near-horizontal
// (|sin| small) → "middle". This must depend on the ANGLE, not the lief's side.
describe("projectionVerticalAnchor", () => {
  test("down-right ray hangs the label below → top", () => {
    expect(projectionVerticalAnchor(Math.PI / 4)).toBe("top");
  });
  test("up-left ray raises the label above → bottom", () => {
    expect(projectionVerticalAnchor((-3 * Math.PI) / 4)).toBe("bottom");
  });
  test("up-right ray → bottom", () => {
    expect(projectionVerticalAnchor(-Math.PI / 4)).toBe("bottom");
  });
  test("down-left ray → top", () => {
    expect(projectionVerticalAnchor((3 * Math.PI) / 4)).toBe("top");
  });
  test("straight down → top", () => {
    expect(projectionVerticalAnchor(Math.PI / 2)).toBe("top");
  });
  test("straight up → bottom", () => {
    expect(projectionVerticalAnchor(-Math.PI / 2)).toBe("bottom");
  });
  test("horizontal rays sit in the dead-zone → middle", () => {
    expect(projectionVerticalAnchor(0)).toBe("middle");
    expect(projectionVerticalAnchor(Math.PI)).toBe("middle");
  });
  test("near-horizontal within the dead-zone → middle", () => {
    expect(projectionVerticalAnchor(10 * DEG)).toBe("middle");
  });
  test("clearly diagonal beyond the dead-zone → a corner", () => {
    expect(projectionVerticalAnchor(30 * DEG)).toBe("top");
  });
});

// The reported case: a branch running UP-RIGHT (SVG y-down → tangent −45°),
// liefs projecting perpendicular (liefRelativeAngle = π/2). Pavlos's
// observed-correct corners: the below-branch lief attaches TOP-left (vertical
// "top"), the above-branch lief BOTTOM-right (vertical "bottom"). The old code
// keyed vertical off side (right→"bottom", left→"top") which is exactly
// backwards for this orientation.
describe("projectionVerticalAnchor + liefSunAzimuth — the reported up-right branch", () => {
  const upRight = -Math.PI / 4;
  const perpendicular = Math.PI / 2;
  test("right-side lief (below the branch) → top", () => {
    const az = liefSunAzimuth({ tangent: upRight, side: "right" }, perpendicular);
    expect(projectionVerticalAnchor(az)).toBe("top");
  });
  test("left-side lief (above the branch) → bottom", () => {
    const az = liefSunAzimuth({ tangent: upRight, side: "left" }, perpendicular);
    expect(projectionVerticalAnchor(az)).toBe("bottom");
  });
});
