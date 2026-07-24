import type { SpiralParams, Vec2 } from "../types.ts";

export interface SpiralCurveSpec {
  arcLength: number;
  originAngle: number;
  spiral: SpiralParams;
}

/** Canonical inward log-spiral around centre (0, startRadius): point(0) = (0,0)
 *  with tangent along +x; radius shrinks as e^(-shrink·t) so it coils into the
 *  centre (the meristem at t=1). The whole curve is then rotated by originAngle.
 *  Tangent is taken numerically (robust) from the rotated point. */
export function sampleSpiral(spec: SpiralCurveSpec, t: number): {
  point: Vec2; tangent: number; arcLength: number;
} {
  const { turns, startRadius, shrink, handedness } = spec.spiral;
  const A = spec.originAngle;
  const cosA = Math.cos(A), sinA = Math.sin(A);

  const canon = (u: number): Vec2 => {
    const uu = Math.max(0, Math.min(1, u));
    const beta = -Math.PI / 2 + handedness * turns * 2 * Math.PI * uu;
    const rho = startRadius * Math.exp(-shrink * uu);
    const qx = rho * Math.cos(beta);
    const qy = startRadius + rho * Math.sin(beta);
    return { x: qx * cosA - qy * sinA, y: qx * sinA + qy * cosA };
  };

  const tt = Math.max(0, Math.min(1, t));
  const point = canon(tt);
  const eps = 1e-4;
  const a = canon(Math.max(0, tt - eps));
  const b = canon(Math.min(1, tt + eps));
  const tangent = Math.atan2(b.y - a.y, b.x - a.x);

  return { point, tangent, arcLength: spec.arcLength * tt };
}
