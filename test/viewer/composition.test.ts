import { describe, expect, test } from "bun:test";
import {
  computeTargetScreenPx,
  type SizingConfig,
} from "../../viewer/src/sizing/composition.ts";

const cfg: SizingConfig = {
  basalMag: 1.4,
  optimalSize: 60,
  liefOptimalSize: 30,
  subtreeBoost: 0,
  subtreeBoostShape: 3,
  cursorMagnification: 3.0,
  liefMaxLift: 0, // off by default in these tests; the cap has its own describe
};

describe("computeTargetScreenPx", () => {
  test("attention=0, no boost → basal only", () => {
    // shortSide=10, titleSize=0.5, basalMag=1.4, zoom=2 → basal = 10*0.5*1.4*2 = 14
    const px = computeTargetScreenPx({
      shortSide: 10,
      titleSize: 0.5,
      zoom: 2,
      attention: 0,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(14);
  });

  test("attention=1, no boost, basal below optimal → grows to optimalSize", () => {
    // basal = 5*0.35*1.4*1 = 2.45. attention=1 lifts to optimal=60.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 1,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(60);
  });

  test("attention=0.5, no boost → halfway basal to optimal", () => {
    // basal = 2.45 (as above). attention=0.5 → 2.45 + 0.5*(60-2.45) = 2.45 + 28.775 = 31.225
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 0.5,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(31.225);
  });

  test("attention=1, basal above optimal → stays at basal (no shrink)", () => {
    // basal = 50*0.5*1.4*2 = 70. Already above optimal=60. attention=1 doesn't shrink.
    const px = computeTargetScreenPx({
      shortSide: 50,
      titleSize: 0.5,
      zoom: 2,
      attention: 1,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(70);
  });

  test("subtree boost lifts meristem toward optimalSize at attention=0", () => {
    // basal = 5*0.35*1.4*1 = 2.45. subtreeNorm=1, boost=1, shape=1 → liftFraction = 0 + 1 = 1 (capped).
    // sizeMultiplier = max(1, 1 + 1 × (optBasal − 1)) = optBasal.
    // target = basal × optBasal = optimalSize = 60.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 0,
      subtreeNorm: 1,
      kind: "meristem",
      isLit: false,
      cfg: { ...cfg, subtreeBoost: 1, subtreeBoostShape: 1 },
    });
    expect(px).toBeCloseTo(60);
  });

  test("partial subtree boost (no attention) lifts proportionally toward optimalSize", () => {
    // basal=2.45, optimalSize=60. subtreeBoost=0.5, subtreeNorm=1, shape=1 → liftFraction=0.5.
    // target = 2.45 + 0.5 × (60 − 2.45) = 2.45 + 28.775 = 31.225.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 0,
      subtreeNorm: 1,
      kind: "meristem",
      isLit: false,
      cfg: { ...cfg, subtreeBoost: 0.5, subtreeBoostShape: 1 },
    });
    expect(px).toBeCloseTo(31.225);
  });

  test("liefs do NOT receive subtree boost", () => {
    // Same inputs as previous test but kind=lief.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 0,
      subtreeNorm: 1,
      kind: "lief",
      isLit: false,
      cfg: { ...cfg, subtreeBoost: 1, subtreeBoostShape: 1 },
    });
    expect(px).toBeCloseTo(2.45); // basal only, no boost
  });

  test("isLit small meristem: multiplicative boost capped at optimal (5 px → 15 px)", () => {
    // basal = 5*0.35*1.4*1 = 2.45. attention=0 → that's the current target.
    // current_target = 2.45. isLit → min(2.45 * 3.0, 60) = 7.35.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 0,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: true,
      cfg,
    });
    expect(px).toBeCloseTo(7.35);
  });

  test("isLit mid-range meristem: caps at optimal", () => {
    // basal big enough that current target > optimal/cursorMag. Try shortSide=30 etc.
    // basal = 30*0.5*1.4*1 = 21. current_target = 21 (attention=0). isLit → min(21 * 3, 60) = 60.
    const px = computeTargetScreenPx({
      shortSide: 30,
      titleSize: 0.5,
      zoom: 1,
      attention: 0,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: true,
      cfg,
    });
    expect(px).toBeCloseTo(60);
  });

  test("isLit oversize meristem: no-op (cursor light doesn't shrink already-large)", () => {
    // basal large. shortSide=100, titleSize=0.5, zoom=2 → basal=140. currentTarget=140.
    // 140 ≥ optimal (60), so cursor light is a no-op: target stays 140.
    // Shrinking to optimal would invert the "more attention → bigger" expectation.
    const px = computeTargetScreenPx({
      shortSide: 100,
      titleSize: 0.5,
      zoom: 2,
      attention: 0,
      subtreeNorm: 0,
      kind: "meristem",
      isLit: true,
      cfg,
    });
    expect(px).toBeCloseTo(140);
  });

  test("lief attention=1 grows toward liefOptimalSize (not meristem optimalSize)", () => {
    // basal = 5*0.35*1.4*1 = 2.45. attention=1, kind=lief. optimal=liefOptimalSize=30.
    // sizeMultiplier = max(1, 1 + 1 × (30/2.45 - 1)) = 12.245.
    // target = 2.45 × 12.245 = 30.
    const px = computeTargetScreenPx({
      shortSide: 5,
      titleSize: 0.35,
      zoom: 1,
      attention: 1,
      subtreeNorm: 0,
      kind: "lief",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(30);
  });

  test("lief target grows freely past former peak (peak now handled by cullDecision, not clamp)", () => {
    // basal huge: shortSide=100, titleSize=0.5, basalMag=1.4, zoom=5 → basal=350.
    // No attention, no boost. currentTarget = 350 (no clamp — cull.ts handles peak cutoff).
    const px = computeTargetScreenPx({
      shortSide: 100,
      titleSize: 0.5,
      zoom: 5,
      attention: 0,
      subtreeNorm: 0,
      kind: "lief",
      isLit: false,
      cfg,
    });
    expect(px).toBeCloseTo(350);
  });

  test("lief isLit grows toward liefOptimalSize", () => {
    // basal small, attention 0. Without cursor light → small target.
    // With isLit → target × cursorMagnification, capped at liefOptimalSize=30.
    const px = computeTargetScreenPx({
      shortSide: 10,
      titleSize: 0.35,
      zoom: 1,
      attention: 0,
      subtreeNorm: 0,
      kind: "lief",
      isLit: true,
      cfg,  // cursorMagnification 3.0, liefOptimalSize 30
    });
    // basal = 10 * 0.35 * 1 * 1.4 = 4.9. No attention lift → currentTarget = 4.9.
    // cursor light: min(4.9 × 3.0, 30) = min(14.7, 30) = 14.7.
    expect(px).toBeCloseTo(14.7);
  });

  // ── native knobs: the adaptive targets ARE the user controls ────────────────
  // computeTargetScreenPx lifts toward optimalSize/liefOptimalSize; moving the
  // knob must move the lifted result 1:1, at any zoom (zoom-correct by
  // construction — the 8 July 2026 native-knobs decision).

  test("meristem at full attention lands on optimalSize — and follows the knob", () => {
    const base = {
      shortSide: 10, titleSize: 1, zoom: 0.01, attention: 1, subtreeNorm: 0,
      kind: "meristem" as const, isLit: false,
    };
    const at = (optimalSize: number) =>
      computeTargetScreenPx({ ...base, cfg: { ...cfg, optimalSize } });
    expect(at(60)).toBeCloseTo(60, 5);
    expect(at(90)).toBeCloseTo(90, 5);
  });

  test("lief at full attention follows liefOptimalSize independently", () => {
    const base = {
      shortSide: 10, titleSize: 1, zoom: 0.01, attention: 1, subtreeNorm: 0,
      kind: "lief" as const, isLit: false,
    };
    const at = (liefOptimalSize: number) =>
      computeTargetScreenPx({ ...base, cfg: { ...cfg, liefOptimalSize } });
    expect(at(20)).toBeCloseTo(20, 5);
    expect(at(40)).toBeCloseTo(40, 5);
  });

  test("knob responsiveness holds across zoom levels (the whole point)", () => {
    const mk = (zoom: number) => ({
      shortSide: 10, titleSize: 1, zoom, attention: 1, subtreeNorm: 0,
      kind: "meristem" as const, isLit: false, cfg: { ...cfg, optimalSize: 80 },
    });
    expect(computeTargetScreenPx(mk(0.005))).toBeCloseTo(80, 5);
    expect(computeTargetScreenPx(mk(0.05))).toBeCloseTo(80, 5);
  });

  test("lit lief already larger than liefOptimalSize: cursor light is a no-op", () => {
    // basal = 50 × 0.5 × 2 × 1.4 = 70. currentTarget = 70.
    // 70 ≥ liefOptimalSize (30), so cursor light is a no-op: target stays 70.
    // Shrinking to liefOptimalSize would invert the attention→size expectation.
    const px = computeTargetScreenPx({
      shortSide: 50,
      titleSize: 0.5,
      zoom: 2,
      attention: 0,
      subtreeNorm: 0,
      kind: "lief",
      isLit: true,
      cfg,
    });
    expect(px).toBeCloseTo(70);
  });
});

describe("lief crowding cap (liefMaxLift)", () => {
  const capped: SizingConfig = { ...cfg, liefMaxLift: 2.2 };
  // basal = 40 * 0.24 * 1.4 * zoom = 13.44 * zoom.
  const lief = (zoom: number, extra: Partial<SizingConfig> = {}, isLit = false) =>
    computeTargetScreenPx({
      shortSide: 40,
      titleSize: 0.24,
      zoom,
      attention: 1,        // the pathological case: a viewport-filling branch
      subtreeNorm: 0,
      kind: "lief",
      isLit,
      cfg: { ...capped, ...extra },
    });

  test("a fully-attended lief at wide zoom is held to the cap, not pinned at optimal", () => {
    // basal = 13.44 * 0.02 = 0.2688 → uncapped this would sit at liefOptimalSize (30).
    const basal = 40 * 0.24 * 1.4 * 0.02;
    expect(lief(0.02)).toBeCloseTo(basal * 2.2);
    expect(lief(0.02)).toBeLessThan(1); // nowhere near the 30 px it used to claim
  });

  test("the cap is a fixed multiple of basal, so it is zoom-invariant", () => {
    // The whole point: overlap can't reappear at some other zoom.
    for (const zoom of [0.01, 0.05, 0.2, 1]) {
      const basal = 40 * 0.24 * 1.4 * zoom;
      const ratio = lief(zoom) / basal;
      expect(ratio).toBeCloseTo(2.2);
    }
  });

  test("once basal exceeds the optimal the cap is inert — it never shrinks a lief", () => {
    // basal at zoom 4 = 53.76 > liefOptimalSize 30, so the lift is already 1x
    // and 2.2x basal is far above: the label draws at its natural size.
    const basal = 40 * 0.24 * 1.4 * 4;
    expect(lief(4)).toBeCloseTo(basal);
  });

  test("a lit lief bypasses the cap — hover must always be able to reveal", () => {
    const uncappedLit = computeTargetScreenPx({
      shortSide: 40, titleSize: 0.24, zoom: 0.02, attention: 1, subtreeNorm: 0,
      kind: "lief", isLit: true, cfg: { ...cfg, liefMaxLift: 0 },
    });
    expect(lief(0.02, {}, true)).toBeCloseTo(uncappedLit);
    expect(lief(0.02, {}, true)).toBeGreaterThan(lief(0.02));
  });

  test("liefMaxLift 0 disables it — byte-identical to the pre-cap behaviour", () => {
    expect(lief(0.02, { liefMaxLift: 0 })).toBeCloseTo(30); // pinned at liefOptimalSize
  });

  test("meristems are untouched by the lief cap", () => {
    const px = computeTargetScreenPx({
      shortSide: 40, titleSize: 0.24, zoom: 0.02, attention: 1, subtreeNorm: 0,
      kind: "meristem", isLit: false, cfg: capped,
    });
    expect(px).toBeCloseTo(60); // still lifts to optimalSize
  });
});
