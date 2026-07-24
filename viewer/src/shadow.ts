// Sun → SVG shear matrix. The plate stands vertically at a given ground
// position and orientation; the sun's azimuth/elevation determine how a
// unit of plate-height projects as a unit of shadow on the ground.
//
// Matrix semantics (SVG matrix(a,b,c,d,e,f)):
//   (x_plate, y_plate) → (a*x + c*y + e, b*x + d*y + f)
// where x_plate runs along the base edge and y_plate runs from base toward
// tip. (a,b) = base-edge unit vector in ground; (c,d) = sun's shadow vector.

export interface SunParams {
  /** Direction the shadow extends in ground coords (radians, CCW from +x). */
  azimuth: number;
  /** Sun angle above ground plane (radians, (0, π/2]). */
  elevation: number;
}

export interface ShearTransform {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

// Horizon is clamped so shadows have a finite upper bound. In practice the
// slider enforces a higher floor, but the math must not blow up if called
// with elevation=0.
const MIN_ELEVATION = 1e-3;

export function shadowTransform(
  base: { x: number; y: number },
  baseAngle: number,
  sun: SunParams,
): ShearTransform {
  const phi = Math.max(sun.elevation, MIN_ELEVATION);
  const len = 1 / Math.tan(phi);
  return {
    a: Math.cos(baseAngle),
    b: Math.sin(baseAngle),
    c: Math.cos(sun.azimuth) * len,
    d: Math.sin(sun.azimuth) * len,
    e: base.x,
    f: base.y,
  };
}

export function matrixToSvg(m: ShearTransform): string {
  return `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
}
