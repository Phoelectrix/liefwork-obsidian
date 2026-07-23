import type {
  Block,
  LiefBlock,
  MeristemBlock,
  Plant,
} from "../../src/types.ts";

export type PointerPos = { x: number; y: number };

export function exceedsDragThreshold(
  start: PointerPos,
  current: PointerPos,
  threshold: number,
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= threshold * threshold;
}

/** Whether the native click that concludes a pointer interaction must be
 *  suppressed. Pointer capture retargets the release to the pan surface, so
 *  Chromium fires a compatibility click after EVERY mousedown→mouseup pair on
 *  it, regardless of distance dragged — without suppression, releasing a pan
 *  over a node's hit box selects/opens that node. `dragDistancePx` is the
 *  interaction's maximum displacement from its start point (Infinity for a
 *  multi-pointer gesture); `>=` mirrors {@link exceedsDragThreshold}, so any
 *  drag that armed panning also suppresses its trailing click. */
export function shouldSuppressClick(
  dragDistancePx: number,
  thresholdPx: number,
): boolean {
  return dragDistancePx >= thresholdPx;
}

/** Identity-bearing blocks — the only kinds that can be "selected" as
 *  themselves. Non-identity blocks (spacer, branchNode) resolve to their
 *  branch's tip meristem via {@link resolveIdentityBlock}. */
export type IdentityBlock = LiefBlock | MeristemBlock;

export function resolveIdentityBlock(
  clicked: Block,
  plant: Plant,
): IdentityBlock | null {
  if (clicked.kind === "lief" || clicked.kind === "meristem") return clicked;
  const tip = plant.blocks.find(
    (b) => b.branchId === clicked.branchId && b.kind === "meristem",
  );
  return (tip as MeristemBlock | undefined) ?? null;
}
