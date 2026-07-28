import { describe, expect, test } from "bun:test";
import { cullDecision, type CullConfig } from "../../viewer/src/sizing/cull.ts";

const cfg: CullConfig = {
  meristemCullMinPx: 1,
  meristemPeakSize: 200,
  liefCullMinPx: 1,
  liefPeakSize: 100,
};

describe("cullDecision", () => {
  test("below cullMinPx → hide (any kind)", () => {
    expect(cullDecision(0.5, "lief", false, cfg)).toBe("hide");
    expect(cullDecision(0.5, "meristem", false, cfg)).toBe("hide");
  });

  test("above cullMinPx, below peak → render", () => {
    expect(cullDecision(30, "lief", false, cfg)).toBe("render");
    expect(cullDecision(30, "meristem", false, cfg)).toBe("render");
  });

  test("meristem above meristemPeakSize → hide", () => {
    expect(cullDecision(250, "meristem", false, cfg)).toBe("hide");
  });

  test("lief above liefPeakSize → hide (peak now culls, not clamps)", () => {
    expect(cullDecision(150, "lief", false, cfg)).toBe("hide");
  });

  test("lit meristem above meristemPeakSize → render (cursor-light exemption)", () => {
    expect(cullDecision(250, "meristem", true, cfg)).toBe("render");
  });

  test("lit lief above liefPeakSize → render (cursor-light exemption)", () => {
    expect(cullDecision(150, "lief", true, cfg)).toBe("render");
  });

  test("lit meristem below cullMinPx → still hidden (cursor-light doesn't exempt from minimum)", () => {
    expect(cullDecision(0.5, "meristem", true, cfg)).toBe("hide");
  });

  test("lit lief below liefCullMinPx → still hidden", () => {
    expect(cullDecision(0.5, "lief", true, cfg)).toBe("hide");
  });

  test("per-kind cull mins are independent", () => {
    const asymmetric: CullConfig = {
      meristemCullMinPx: 5,
      meristemPeakSize: 200,
      liefCullMinPx: 1,
      liefPeakSize: 100,
    };
    // lief at px=3: above liefCullMinPx=1, below liefPeakSize=100 → render
    expect(cullDecision(3, "lief", false, asymmetric)).toBe("render");
    // meristem at px=3: below meristemCullMinPx=5 → hide
    expect(cullDecision(3, "meristem", false, asymmetric)).toBe("hide");
  });

  test("per-kind peaks are independent", () => {
    const asymmetric: CullConfig = {
      meristemCullMinPx: 1,
      meristemPeakSize: 300,
      liefCullMinPx: 1,
      liefPeakSize: 50,
    };
    // lief at px=100: above liefPeakSize=50 → hide
    expect(cullDecision(100, "lief", false, asymmetric)).toBe("hide");
    // meristem at px=100: below meristemPeakSize=300 → render
    expect(cullDecision(100, "meristem", false, asymmetric)).toBe("render");
  });
});
