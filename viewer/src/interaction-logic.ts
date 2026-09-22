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

/** Mobile split view: opening the half panel frames the tapped node's branch
 *  into the half-height stage so the coral stays in frame above the panel —
 *  but not once the reader has placed the camera by hand (pinch/pan/wheel;
 *  host framing and unfurl moves don't count). A tap then must not move the
 *  view: the pan-zoom layer already preserves an owned camera through the
 *  stage's half-height reflow, matching the desktop "single click never
 *  moves the view" canon. Desktop never frames on open (the inset model
 *  handles the panel there). */
export function shouldFrameOnPanelOpen(args: {
  unfurlEnabled: boolean;
  isPortraitViewport: boolean;
  branchId: string | undefined;
  userCameraOwned: boolean;
}): boolean {
  return (
    args.unfurlEnabled &&
    args.isPortraitViewport &&
    !!args.branchId &&
    !args.userCameraOwned
  );
}

/** Mobile split view: closing the panel grows the stage back to full height.
 *  When the reader hasn't placed the camera by hand, re-frame so the coral
 *  isn't left cropped in the top half; a hand-placed camera is preserved —
 *  the grown stage only reveals more, and moving it would discard the
 *  reader's zoom. */
export function shouldReframeOnPanelClose(args: {
  isPortraitViewport: boolean;
  userCameraOwned: boolean;
}): boolean {
  return args.isPortraitViewport && !args.userCameraOwned;
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
