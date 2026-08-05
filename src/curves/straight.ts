import type { Vec2 } from "../types.ts";

export interface StraightSpec { arcLength: number; originAngle: number; }

export function sampleStraight(spec: StraightSpec, t: number): {
  point: Vec2; tangent: number; arcLength: number;
} {
  const s = t * spec.arcLength;
  return {
    point: { x: s * Math.cos(spec.originAngle), y: s * Math.sin(spec.originAngle) },
    tangent: spec.originAngle,
    arcLength: s,
  };
}
