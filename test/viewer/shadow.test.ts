import { describe, expect, test } from "bun:test";
import { shadowTransform, type ShearTransform } from "../../viewer/src/shadow.ts";

// The shear matrix maps stencil-local coords (u along base, v from base toward
// tip) to ground coords. Under an SVG matrix(a,b,c,d,e,f) it resolves as
// (x,y) → (a*x + c*y + e, b*x + d*y + f). The plate's base-edge direction
// sets (a,b); the sun's ground-projection scaled by 1/tan(φ) sets (c,d).

const apply = (m: ShearTransform, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

describe("shadowTransform", () => {
  test("overhead sun collapses shear — shadow length is zero", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: 0, elevation: Math.PI / 2 },
    );
    expect(m.c).toBeCloseTo(0, 6);
    expect(m.d).toBeCloseTo(0, 6);
  });

  test("sun at azimuth 0, 45° elevation → unit shear in +x", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: 0, elevation: Math.PI / 4 },
    );
    expect(m.c).toBeCloseTo(1, 6);
    expect(m.d).toBeCloseTo(0, 6);
  });

  test("sun azimuth 90° rotates shadow to +y", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: Math.PI / 2, elevation: Math.PI / 4 },
    );
    expect(m.c).toBeCloseTo(0, 6);
    expect(m.d).toBeCloseTo(1, 6);
  });

  test("low sun produces long shadow, magnitude matches 1/tan(φ)", () => {
    const phi = Math.PI / 36; // 5°
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: 0, elevation: phi },
    );
    expect(Math.hypot(m.c, m.d)).toBeCloseTo(1 / Math.tan(phi), 4);
  });

  test("plate base angle rotates the plate on the ground plane", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, Math.PI / 2,
      { azimuth: 0, elevation: Math.PI / 2 },
    );
    expect(m.a).toBeCloseTo(0, 6);
    expect(m.b).toBeCloseTo(1, 6);
  });

  test("base origin becomes the matrix translation", () => {
    const m = shadowTransform(
      { x: 100, y: 200 }, 0,
      { azimuth: 0, elevation: Math.PI / 2 },
    );
    expect(m.e).toBe(100);
    expect(m.f).toBe(200);
  });

  test("horizon-grazing sun is clamped, not infinite", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: 0, elevation: 0 },
    );
    expect(Number.isFinite(m.c)).toBe(true);
    expect(Number.isFinite(m.d)).toBe(true);
  });

  test("end-to-end: point (10,20) on plate at (50,60), sun 0°/45° → (80,60)", () => {
    const m = shadowTransform(
      { x: 50, y: 60 }, 0,
      { azimuth: 0, elevation: Math.PI / 4 },
    );
    const g = apply(m, 10, 20);
    expect(g.x).toBeCloseTo(80, 6);
    expect(g.y).toBeCloseTo(60, 6);
  });

  test("point at base (v=0) is unaffected by sun — pins to base edge", () => {
    const m = shadowTransform(
      { x: 0, y: 0 }, 0,
      { azimuth: Math.PI / 3, elevation: Math.PI / 6 },
    );
    const g = apply(m, 10, 0);
    expect(g.x).toBeCloseTo(10, 6);
    expect(g.y).toBeCloseTo(0, 6);
  });
});
