import type { Bounds } from "../../src/types.ts";
import type { Transform, Easing } from "./shot-engine.ts";

export type Aspect = "16:9" | "9:16" | "1:1";
export type Profile = "cinematic" | "grandeur" | "plain";

export type Keyframe =
  | { transform: Transform }
  | { fitBounds: Bounds }
  | { frameBranch: string }
  | { fit: true };

export interface GrowthConfig {
  every: number;
  msPerEvent: number;
}

export interface SceneSpec {
  specVersion: 1;
  id: string;
  name: string;
  coral: { source: "fixture" | "folder"; ref: string };
  profile: Profile;
  aspects: Aspect[];
  duration: number;
  fps: number;
  camera: { keyframes: Keyframe[]; easing: Easing };
  growth: GrowthConfig | null;
}

export const ASPECT_DIMS: Record<Aspect, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
};

const PROFILES: Profile[] = ["cinematic", "grandeur", "plain"];
const EASING_NAMES: Easing[] = ["linear", "easeInOutCubic", "easeInOutQuad"];

export function defaultSpec(): SceneSpec {
  return {
    specVersion: 1,
    id: "untitled-shot",
    name: "Untitled shot",
    coral: { source: "fixture", ref: "shakespeareMini" },
    profile: "cinematic",
    aspects: ["16:9"],
    duration: 6,
    fps: 30,
    camera: { keyframes: [{ fit: true }, { fit: true }], easing: "easeInOutCubic" },
    growth: null,
  };
}

function isKeyframe(k: unknown): boolean {
  if (typeof k !== "object" || k === null) return false;
  const o = k as Record<string, unknown>;
  if ("transform" in o) return typeof o["transform"] === "object";
  if ("fitBounds" in o) return typeof o["fitBounds"] === "object";
  if ("frameBranch" in o) return typeof o["frameBranch"] === "string";
  if ("fit" in o) return o["fit"] === true;
  return false;
}

export function validateSpec(
  value: unknown,
): { ok: true; spec: SceneSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = value as Record<string, unknown>;
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["spec must be an object"] };
  }
  if (o["specVersion"] !== 1) errors.push("specVersion must be 1");
  if (typeof o["id"] !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(o["id"])) errors.push("id must match ^[a-z0-9][a-z0-9-]*$");
  if (typeof o["name"] !== "string") errors.push("name is required");

  const coral = o["coral"] as Record<string, unknown> | undefined;
  if (!coral || (coral["source"] !== "fixture" && coral["source"] !== "folder") || typeof coral["ref"] !== "string" || (coral["ref"]).length === 0) {
    errors.push("coral must be { source: 'fixture'|'folder', ref: non-empty string }");
  }
  if (!PROFILES.includes(o["profile"] as Profile)) errors.push("profile must be cinematic|grandeur|plain");

  const aspects = o["aspects"];
  if (!Array.isArray(aspects) || aspects.length === 0) {
    errors.push("aspects must be a non-empty array");
  } else {
    for (const a of aspects) if (!(a in ASPECT_DIMS)) errors.push(`unknown aspect: ${String(a)}`);
  }
  if (typeof o["duration"] !== "number" || (o["duration"]) <= 0) errors.push("duration must be > 0");
  if (typeof o["fps"] !== "number" || (o["fps"]) <= 0) errors.push("fps must be > 0");

  const cam = o["camera"] as Record<string, unknown> | undefined;
  if (!cam) {
    errors.push("camera is required");
  } else {
    const kfs = cam["keyframes"];
    if (!Array.isArray(kfs) || kfs.length < 2) errors.push("camera.keyframes must have at least 2 entries");
    else for (const k of kfs) if (!isKeyframe(k)) errors.push("invalid keyframe");
    if (!EASING_NAMES.includes(cam["easing"] as Easing)) errors.push("camera.easing invalid");
  }
  if (o["growth"] !== null && o["growth"] !== undefined) {
    const g = o["growth"] as Record<string, unknown>;
    if (typeof g["every"] !== "number" || typeof g["msPerEvent"] !== "number" || (g["every"]) <= 0 || (g["msPerEvent"]) <= 0) {
      errors.push("growth must be null or { every: number > 0, msPerEvent: number > 0 }");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, spec: value as SceneSpec };
}
