import { describe, it, expect } from "bun:test";
import {
  foldWheelZoom,
  zoomAboutPoint,
  compositeMotionTransform,
  clientPointToWorld,
  foldWheelDeltas,
} from "../../viewer/src/pan-zoom-math.ts";

describe("foldWheelZoom", () => {
  it("coalescing summed deltas equals applying them sequentially (batching preserves zoom)", () => {
    const floor = 0.001, ceil = 200;
    // Two wheel events of -50 arriving in one frame, summed and applied once...
    const summed = foldWheelZoom(1, -100, floor, ceil);
    // ...must equal the old per-event behaviour (apply each in turn).
    const sequential = foldWheelZoom(foldWheelZoom(1, -50, floor, ceil), -50, floor, ceil);
    expect(summed).toBeCloseTo(sequential, 10);
  });

  it("positive deltaY zooms out, negative zooms in", () => {
    expect(foldWheelZoom(1, -100, 0.001, 200)).toBeGreaterThan(1);
    expect(foldWheelZoom(1, 100, 0.001, 200)).toBeLessThan(1);
  });

  it("clamps to the zoom floor", () => {
    expect(foldWheelZoom(0.05, 5000, 0.02, 200)).toBe(0.02);
  });

  it("clamps to the zoom ceiling", () => {
    expect(foldWheelZoom(150, -5000, 0.02, 200)).toBe(200);
  });
});

describe("zoomAboutPoint", () => {
  it("keeps the world point under the cursor fixed across a zoom", () => {
    const tx = 30, ty = -10, oldScale = 2, newScale = 5;
    const px = 120, py = 80;
    // The world point currently projecting to the cursor (screen = world*scale + t).
    const worldX = (px - tx) / oldScale;
    const worldY = (py - ty) / oldScale;

    const r = zoomAboutPoint(tx, ty, oldScale, newScale, px, py);

    // After the zoom, that same world point must still project to the cursor.
    expect(worldX * newScale + r.tx).toBeCloseTo(px, 10);
    expect(worldY * newScale + r.ty).toBeCloseTo(py, 10);
  });
});

describe("compositeMotionTransform", () => {
  it("wrapper ∘ settled reproduces the current transform for any world point", () => {
    const settled = { tx: 30, ty: -10, scale: 2 };
    const current = { tx: 55, ty: 12, scale: 3.5 };
    const d = compositeMotionTransform(settled, current);

    for (const p of [{ x: 0, y: 0 }, { x: 100, y: -40 }, { x: -250, y: 80 }]) {
      const sx = settled.scale * p.x + settled.tx;
      const sy = settled.scale * p.y + settled.ty;
      const wx = d.a * sx + d.wx;
      const wy = d.a * sy + d.wy;
      expect(wx).toBeCloseTo(current.scale * p.x + current.tx, 9);
      expect(wy).toBeCloseTo(current.scale * p.y + current.ty, 9);
    }
  });

  it("is identity when current === settled", () => {
    const t = { tx: 7, ty: 9, scale: 1.5 };
    const d = compositeMotionTransform(t, { ...t });
    expect(d.a).toBeCloseTo(1, 12);
    expect(d.wx).toBeCloseTo(0, 12);
    expect(d.wy).toBeCloseTo(0, 12);
  });
});

describe("clientPointToWorld", () => {
  it("is the plain screen-projection inverse when no wrapper is live", () => {
    const settled = { tx: 30, ty: -10, scale: 2 };
    const world = { x: 125, y: -60 };
    // screen = world * scale + t, measured from the svg's (untransformed) origin.
    const px = world.x * settled.scale + settled.tx;
    const py = world.y * settled.scale + settled.ty;
    const w = clientPointToWorld(px, py, settled, 1);
    expect(w.x).toBeCloseTo(world.x, 9);
    expect(w.y).toBeCloseTo(world.y, 9);
  });

  it("recovers the world point under a live composited wrapper transform", () => {
    // Mid-settle/tween scenario: the SVG is frozen at `settled` while the
    // wrapper carries the composite delta toward `current`. The svg's gBCR
    // corner (the TRANSFORMED origin) already absorbs the wrapper translation
    // (corner = untransformed origin + (wx, wy)), so measuring the click from
    // the corner leaves only the wrapper scale + the SETTLED transform to invert.
    const settled = { tx: 30, ty: -10, scale: 2 };
    const current = { tx: -180, ty: 55, scale: 3.25 };
    const d = compositeMotionTransform(settled, current);
    const L0 = { left: 340, top: 120 }; // untransformed svg origin (client coords)

    for (const world of [{ x: 0, y: 0 }, { x: 125, y: -60 }, { x: -80, y: 240 }]) {
      // Where the point is PAINTED: wrapper ∘ settled, offset by the origin.
      const qx = world.x * settled.scale + settled.tx;
      const qy = world.y * settled.scale + settled.ty;
      const clientX = L0.left + d.a * qx + d.wx;
      const clientY = L0.top + d.a * qy + d.wy;
      // The transformed gBCR corner, as blockAtClientPoint reads it mid-motion.
      const cornerLeft = L0.left + d.wx;
      const cornerTop = L0.top + d.wy;

      const w = clientPointToWorld(clientX - cornerLeft, clientY - cornerTop, settled, d.a);
      expect(w.x).toBeCloseTo(world.x, 9);
      expect(w.y).toBeCloseTo(world.y, 9);

      // And it agrees with inverting the CURRENT transform from the
      // UNTRANSFORMED origin (wrapper ∘ settled ≡ current) — the two valid
      // formulations of the same inverse.
      expect(w.x).toBeCloseTo((clientX - L0.left - current.tx) / current.scale, 9);
      expect(w.y).toBeCloseTo((clientY - L0.top - current.ty) / current.scale, 9);
    }
  });

  it("demonstrates the pre-fix bug: inverting the live state against the transformed corner misses by the wrapper translation", () => {
    const settled = { tx: 0, ty: 0, scale: 1 };
    const current = { tx: 300, ty: 0, scale: 1 }; // a 300px pan, still compositing
    const d = compositeMotionTransform(settled, current);
    const world = { x: 500, y: 40 };
    const clientX = 0 + d.a * (world.x * settled.scale + settled.tx) + d.wx;
    const cornerLeft = 0 + d.wx; // transformed gBCR.left
    // Old code: ((clientX - gBCR.left) - current.tx) / current.scale
    const buggy = (clientX - cornerLeft - current.tx) / current.scale;
    expect(Math.abs(buggy - world.x)).toBeCloseTo(300, 9); // off by the pan delta
    const fixed = clientPointToWorld(clientX - cornerLeft, 0, settled, d.a);
    expect(fixed.x).toBeCloseTo(world.x, 9);
  });
});

describe("foldWheelDeltas", () => {
  it("pure horizontal wheel pans tx and never touches scale or ty", () => {
    const r = foldWheelDeltas(100, 50, 0.5, 120, 0, 400, 300, 0.02);
    expect(r.scale).toBe(0.5);
    expect(r.ty).toBe(50);
    // Content follows fingers (natural scrolling): deltaX +120 → tx -= 120.
    expect(r.tx).toBe(100 - 120);
  });

  it("pure vertical wheel matches foldWheelZoom + zoomAboutPoint exactly", () => {
    const nextScale = foldWheelZoom(0.5, -200, 0.02);
    const anchored = zoomAboutPoint(100, 50, 0.5, nextScale, 400, 300);
    const r = foldWheelDeltas(100, 50, 0.5, 0, -200, 400, 300, 0.02);
    expect(r.scale).toBe(nextScale);
    expect(r.tx).toBe(anchored.tx);
    expect(r.ty).toBe(anchored.ty);
  });

  it("diagonal wheel composes: zoom-anchored translate then the deltaX pan", () => {
    const nextScale = foldWheelZoom(0.5, -200, 0.02);
    const anchored = zoomAboutPoint(100, 50, 0.5, nextScale, 400, 300);
    const r = foldWheelDeltas(100, 50, 0.5, 120, -200, 400, 300, 0.02);
    expect(r.scale).toBe(nextScale);
    expect(r.tx).toBe(anchored.tx - 120);
    expect(r.ty).toBe(anchored.ty);
  });

  it("zoom floor/ceil clamp still applies through foldWheelDeltas", () => {
    const rFloor = foldWheelDeltas(0, 0, 0.03, 0, 100000, 0, 0, 0.02);
    expect(rFloor.scale).toBe(0.02);
    const rCeil = foldWheelDeltas(0, 0, 100, 0, -100000, 0, 0, 0.02, 200);
    expect(rCeil.scale).toBe(200);
  });
});
