// Pure cull decision. Single rule derived from targetScreenPx.

export interface CullConfig {
  meristemCullMinPx: number;
  meristemPeakSize: number;
  liefCullMinPx: number;
  liefPeakSize: number;
}

export type CullVerdict = "render" | "hide";

export function cullDecision(
  targetPx: number,
  kind: "lief" | "meristem",
  isLit: boolean,
  cfg: CullConfig,
): CullVerdict {
  const cullMin = kind === "lief" ? cfg.liefCullMinPx : cfg.meristemCullMinPx;
  if (targetPx < cullMin) return "hide";
  if (isLit) return "render";  // cursor-lit blocks always render regardless of peak
  const peak = kind === "lief" ? cfg.liefPeakSize : cfg.meristemPeakSize;
  if (targetPx > peak) return "hide";
  return "render";
}
