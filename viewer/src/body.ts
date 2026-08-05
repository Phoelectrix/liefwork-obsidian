import type { Plant, Block, Branch } from "../../src/types.ts";
import { shadowTransform, type SunParams } from "./shadow.ts";
import { parseHexColor, type StylingConfig } from "./styling.ts";

const PHI = (1 + Math.sqrt(5)) / 2;
const BASE_ANGLE_SCREEN_HORIZONTAL = -Math.PI / 2;

// Canvas translucent-body renderer. Mirrors installSkin's lifecycle but uses
// source-over compositing so bodies read as "translucent glass of the leaf"
// rather than additive glow. Each body is painted under a per-block shear
// matrix that matches the SVG projection exactly, so it sits on top of the
// dark pool.
//
// Cursor reactivity: brightness (opacity) ramps up near the cursor using a
// t^2 falloff on world-coord distance. No additive accumulation — the body
// just brightens toward cursorBoost * baseOpacity when the cursor is close.
//
// Edge softness: `styling.body.edgeSoftness` controls where the radial
// gradient begins fading — 0 = sharp edge at the silhouette extent, 1 = fade
// from the centre outward.

export type BodyHandle = {
  setConfig(cfg: StylingConfig): void;
  setTransform(tx: number, ty: number, scale: number): void;
  setCursor(screenX: number, screenY: number): void;
  clearCursor(): void;
  setPlant(plant: Plant): void;
  destroy(): void;
};

type Transform = { tx: number; ty: number; scale: number };
type IdentityBlock = Extract<Block, { name: string }>;
export type BodyParams = {
  x: number;
  y: number;
  longSide: number;
  shortSide: number;
  /** Block's engine rotation (branch tangent direction, radians). */
  rotation: number;
  /** "left" adds π to the global sun azimuth; "right" leaves it. */
  side: "left" | "right";
  /** Source block id — the render-gate (Task 5) cull key. */
  blockId: string;
};

export function installBody(
  canvas: HTMLCanvasElement,
  plant: Plant,
  initial: StylingConfig,
): BodyHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  // The canvas's own window — popouts are a separate window, and mixing
  // another window's clock/rAF/observer primitives is the New-window-bug law.
  const win = canvas.ownerDocument.defaultView ?? window;

  let cfg: StylingConfig = initial;
  const transform: Transform = { tx: 0, ty: 0, scale: 1 };
  let cursorScreen: { x: number; y: number } | null = null;
  let dirty = true;
  let rafId = 0;

  let cursorRadius = computeCursorRadius(plant);
  let bodies = collectBodies(plant);

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = win.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    dirty = true;
  };

  resize();
  win.addEventListener("resize", resize);

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dpr = win.devicePixelRatio || 1;
    const s = transform.scale * dpr;
    ctx.setTransform(s, 0, 0, s, transform.tx * dpr, transform.ty * dpr);
    ctx.globalCompositeOperation = "source-over";

    let cwx = 0;
    let cwy = 0;
    const cursorActive = cursorScreen !== null && cfg.body.cursorBoost > 0;
    if (cursorActive && cursorScreen) {
      cwx = (cursorScreen.x - transform.tx) / transform.scale;
      cwy = (cursorScreen.y - transform.ty) / transform.scale;
    }

    const [r, g, b] = parseHexColor(cfg.body.fill);
    const base = cfg.body.baseOpacity;
    const softness = Math.max(0, Math.min(1, cfg.body.edgeSoftness));

    for (const body of bodies) {
      let opacity = base;
      if (cursorActive) {
        const dx = cwx - body.x;
        const dy = cwy - body.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, 1 - dist / cursorRadius);
        opacity += base * cfg.body.cursorBoost * t * t;
      }
      opacity = Math.min(1, opacity);
      if (opacity < 0.005) continue;

      paintBody(
        ctx,
        body,
        r, g, b,
        opacity,
        softness,
        cfg.sun,
        "follow-tangent",
      );
    }
  };

  const loop = (): void => {
    if (dirty) {
      paint();
      dirty = false;
    }
    rafId = win.requestAnimationFrame(loop);
  };
  rafId = win.requestAnimationFrame(loop);

  return {
    setConfig(next) {
      cfg = next;
      bodies = collectBodies(plant);
      dirty = true;
    },
    setTransform(tx, ty, scale) {
      transform.tx = tx;
      transform.ty = ty;
      transform.scale = scale;
      dirty = true;
    },
    setCursor(screenX, screenY) {
      cursorScreen = { x: screenX, y: screenY };
      if (cfg.body.cursorBoost > 0) dirty = true;
    },
    clearCursor() {
      cursorScreen = null;
      if (cfg.body.cursorBoost > 0) dirty = true;
    },
    setPlant(nextPlant) {
      plant = nextPlant;
      bodies = collectBodies(plant);
      cursorRadius = computeCursorRadius(plant);
      dirty = true;
    },
    destroy() {
      win.cancelAnimationFrame(rafId);
      win.removeEventListener("resize", resize);
    },
  };
}

export function paintBody(
  ctx: CanvasRenderingContext2D,
  body: BodyParams,
  r: number,
  g: number,
  b: number,
  opacity: number,
  softness: number,
  sunCfg: StylingConfig["sun"],
  baseline: "follow-tangent" | "screen-horizontal",
): void {
  // Match the projection's per-block sun: global azimuth plus π for left-side
  // blocks. Mirrors render-shadows.ts so the body aligns with the projection.
  const sun: SunParams = {
    azimuth: sunCfg.azimuth + (body.side === "left" ? Math.PI : 0),
    elevation: sunCfg.elevation,
  };
  const baseAngle =
    baseline === "follow-tangent"
      ? body.rotation - Math.PI / 2
      : BASE_ANGLE_SCREEN_HORIZONTAL;
  const m = shadowTransform({ x: body.x, y: body.y }, baseAngle, sun);

  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);

  const L = body.longSide;
  const W = body.shortSide;
  const midV = L / 2;
  const hW = W / 2;

  // Leaf silhouette (symmetric ovate lens) — same curve as leafSilhouettePath.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(hW, midV, 0, L);
  ctx.quadraticCurveTo(-hW, midV, 0, 0);
  ctx.closePath();

  if (softness < 0.01) {
    ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
  } else {
    // Radial gradient from centre (full) to edge (fade-out based on softness).
    // Softness = 1 means gradient begins at centre; softness = 0 means hard.
    const grad = ctx.createRadialGradient(0, midV, 0, 0, midV, Math.max(hW, midV));
    grad.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
    grad.addColorStop(
      1 - softness,
      `rgba(${r},${g},${b},${opacity})`,
    );
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
  }
  ctx.fill();
  ctx.restore();
}

export function collectBodies(plant: Plant): BodyParams[] {
  const branchById = new Map(plant.branches.map((br) => [br.id, br]));
  const bodies: BodyParams[] = [];
  for (const block of plant.blocks) {
    if (block.kind !== "lief" && block.kind !== "meristem") continue;
    const side = resolveSide(block, branchById);
    bodies.push({
      x: block.position.x,
      y: block.position.y,
      longSide: block.shortSide * PHI,
      shortSide: block.shortSide,
      rotation: block.rotation,
      side,
      blockId: block.id,
    });
  }
  return bodies;
}

function resolveSide(
  block: IdentityBlock,
  branchById: Map<string, Branch>,
): "left" | "right" {
  if (block.kind === "lief") return block.side;
  const branch = branchById.get(block.branchId);
  if (!branch) return "right";
  return branch.departureAngle < 0 ? "left" : "right";
}

function computeCursorRadius(plant: Plant): number {
  const bw = plant.bounds.max.x - plant.bounds.min.x;
  const bh = plant.bounds.max.y - plant.bounds.min.y;
  return Math.max(bw, bh) * 0.15;
}
