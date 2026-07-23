import type { CurveSpec, Vec2 } from "../types.ts";
import { sampleStraight } from "./straight.ts";
import { sampleBough } from "./bough.ts";
import { sampleSpiral } from "./spiral.ts";

export function sampleCurve(spec: CurveSpec, t: number): {
  point: Vec2; tangent: number; arcLength: number;
} {
  if (spec.type === "straight") {
    return sampleStraight({ arcLength: spec.arcLength, originAngle: spec.originAngle }, t);
  }
  if (spec.type === "spiral") {
    if (!spec.spiral) throw new Error("spiral CurveSpec missing spiral params");
    return sampleSpiral(
      { arcLength: spec.arcLength, originAngle: spec.originAngle, spiral: spec.spiral }, t,
    );
  }
  if (!spec.bough) throw new Error("bough CurveSpec missing bough params");
  return sampleBough(
    { arcLength: spec.arcLength, originAngle: spec.originAngle, bough: spec.bough },
    t,
  );
}
