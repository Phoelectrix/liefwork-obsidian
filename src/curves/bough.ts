import type { BoughParams, Vec2 } from "../types.ts";

export interface BoughSpec {
  arcLength: number;
  originAngle: number;
  bough: BoughParams;
}

// Bough curve: integrate a scale-invariant curvature profile from 0 to
// t·arcLength by a fixed 256-step Euler quadrature. The profile combines an
// exponentially-decaying entry bow, mid-branch sinusoidal undulation (both
// normalized to arcLength so they're length-invariant), and a sigmoid ramp
// into a spiral at turnPoint that integrates to the full spiralAngle over
// the spiral region. Output: position, tangent, traversed arc length.
export function sampleBough(spec: BoughSpec, t: number): {
  point: Vec2; tangent: number; arcLength: number;
} {
  const p = spec.bough;
  const STEPS = 256;
  const tTarget = Math.max(0, Math.min(1, t));
  const dt = tTarget / STEPS;
  let x = 0, y = 0, theta = spec.originAngle;
  const L = spec.arcLength;
  const dsPerStep = (tTarget * L) / STEPS;

  const norm = (2 * Math.PI) / Math.max(L, 1e-9);
  const spiralLength = L * Math.max(0.01, 1 - p.turnPoint);
  const spiralRate = p.spiralAngle / spiralLength;

  for (let i = 0; i < STEPS; i++) {
    const u = (i + 0.5) * dt;
    const bow = p.entryBow * norm * Math.exp(-p.bowFalloff * 5 * u);
    const undu = p.undulationAmp * norm *
      Math.sin(2 * Math.PI * p.undulationFreq * u + p.undulationPhase);
    const fade = 1 / (1 + Math.exp(-p.turnSharpness * 10 * (u - p.turnPoint)));
    const turn = spiralRate * fade;

    const kappa = bow + undu + turn;
    theta += kappa * dsPerStep;
    x += Math.cos(theta) * dsPerStep;
    y += Math.sin(theta) * dsPerStep;
  }

  return {
    point: { x, y },
    tangent: theta,
    arcLength: tTarget * L,
  };
}
