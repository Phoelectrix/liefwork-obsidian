import type {
  Plant,
  Branch,
  Block,
  LiefBlock,
  MeristemBlock,
  BranchNodeBlock,
  SpacerBlock,
  Vec2,
} from "../../src/types.ts";
import { sampleCurve } from "../../src/index.ts";
import { composeStencilPath, leafSilhouettePath } from "./stencil.ts";
import { setHidden } from "./dom-visibility.ts";
import type { ProjectionConfig } from "./styling.ts";
import {
  liefSunAzimuth,
  meristemSunAzimuth,
  projectionVerticalAnchor,
} from "./projection.ts";
import { bakeWrappedDotPath } from "./dot-text.ts";
import { labelSizeBasis } from "./sizing/composition.ts";
import { displayNameForBoosted } from "./start-here.ts";
import { stemGradientId } from "./render-ids.ts";

const PHI = (1 + Math.sqrt(5)) / 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const CURVE_SAMPLES = 64;

// Audit-mode knob: when true, Bud stencils skip the compound glyph-cutout
// path and render a plain leaf silhouette only. Isolates the cost of letter-
// cutout path complexity from the cost of having ~2k SVG elements at all.
// Flip via ?nobud=1 in main.ts.
//
// `minimal`: render text as SVG `<text>` projected perpendicular to the
// branch tangent, with invisible antenna rects for click-routing. Replaces
// the compound-path Bud entirely — no letter cutouts, no leaf silhouette.
export type RenderOptions = {
  simpleBud?: boolean;
  minimal?: boolean;
  /** Projected variation: source text at branch, light ray to tip, magnified
   *  projection at tip. Takes precedence over `minimal`. Requires
   *  `projectionConfigByBlockId` to be populated for all lief/meristem blocks. */
  projected?: boolean;
  /** Overrides the default LABEL_FONT_SCALE for minimal-skin labels. */
  fontScale?: number;
  /** Per-block resolved ProjectionConfig. Required when `projected: true`. */
  projectionConfigByBlockId?: Map<string, ProjectionConfig>;
  /** Per-block depth (ancestor-meristem count). Passed so render doesn't need
   *  to walk the plant model to resolve depth. */
  depthByBlockId?: Map<string, number>;
  /** Per-block label override for meristems. When a block.id is in this map,
   *  its projection-label renders with the mapped string instead of
   *  block.name. Used for parent-aware label composition; ignored for liefs. */
  meristemLabelByBlockId?: Map<string, string>;
  /** Stem widths — function returning a screen-pixel stroke-width for each
   *  branch. Drives the stroked non-scaling-stroke path. Returns 0 to fall
   *  back to the hairline CSS default. */
  stemWidthsForBranch?: (branchId: string) => number;
  /** Opacity of the gradient stop at the curve tip (0–1). Default 0.3. */
  stemTipOpacity?: number;
  /** Per-branch stem origin override. When present, the mapped position is
   *  used instead of the normal parentBranchNodeId → blockById lookup. Used
   *  by the public viewer, which hydrates frozen plants without BranchNodeBlock
   *  instances; the frozen serializer captures the origin at freeze time. */
  branchOriginOverrides?: Map<string, { x: number; y: number }>;
  /** Branches whose meristem was marked with the `<=Start Here:` MD prefix.
   *  The renderer prepends a visible "Start Here →" cue to the meristem's
   *  rendered label (bud-path letters + projection-label text). The cue
   *  appears ONLY in the plant rendering; block.name itself is already
   *  cleaned by start-here.ts at hydration time, so side-panel titles,
   *  metadata lookups, breadcrumbs etc. all see the canonical name. */
  boostedBranchIds?: Set<string>;
  /** Per-mount instance token, namespacing SVG def ids (stem gradients) so two
   *  plants in one document don't collide on `branch.id` (which resets per build). */
  instanceId?: string;
  /** Render only text labels + the wrappers the cascade/hit-testing need; skip
   *  geometry (stems, stem gradient, light-ray, dot-glyphs, stub-circle) —
   *  geometry is drawn on a sibling canvas layer. Default false.
   *  Leaves all existing callers unchanged (opt-in). */
  labelsOnly?: boolean;
};

// Barebones skeleton renderer. Emits only what the engine produces:
// branch curves and block rectangles. No text, no masks, no defs, no
// aesthetic commitments. Visible blocks (liefs, meristems) draw as
// hairline outlines; structural blocks (branchNodes, spacers) render as
// invisible hit targets. Skins and holographic projection layers are a
// separate render pass that read this DOM — nothing here presumes them.

export function renderPlant(
  plant: Plant,
  world: SVGGElement,
  budBaseline: "follow-tangent" | "screen-horizontal" = "follow-tangent",
  options: RenderOptions = {},
): void {
  while (world.firstChild) world.removeChild(world.firstChild);

  const labelsOnly = options.labelsOnly ?? false;

  const defs = document.createElementNS(SVG_NS, "defs");
  // Only append <defs> when we will actually populate it (stem gradients need
  // it; labels-only mode skips gradients so we defer until needed below).
  if (!labelsOnly) world.appendChild(defs);

  const blockById = new Map(plant.blocks.map((b) => [b.id, b]));
  const tipOpacity = options.stemTipOpacity ?? 0.3;

  for (const branch of plant.branches) {
    const origin = branchOrigin(branch, plant, blockById, options.branchOriginOverrides);
    const group = createBranchGroup(branch);
    if (!labelsOnly) {
      // Stem width: screen pixels (non-scaling-stroke semantics).
      // Absent = 0 (hairline CSS fallback).
      const screenWidth = options.stemWidthsForBranch
        ? options.stemWidthsForBranch(branch.id)
        : 0;
      if (screenWidth > 0) {
        defs.appendChild(createStemGradient(branch, origin, tipOpacity, options.instanceId));
      }
      group.appendChild(createCurvePath(branch, origin, screenWidth, options.instanceId));
    }
    // Blocks sit directly under the branch group — the former `<g class="blocks">`
    // wrapper was a pure structural nesting with no CSS/JS consumer.
    for (const blockId of branch.blockIds) {
      const block = blockById.get(blockId);
      if (!block) continue;
      const labelOverride =
        block.kind === "meristem"
          ? options.meristemLabelByBlockId?.get(block.id)
          : undefined;
      const stencil = stencilFor(block, budBaseline, options, labelOverride);
      if (stencil) group.appendChild(stencil);
    }
    world.appendChild(group);
  }
}

// ---------- branches ----------

function branchOrigin(
  branch: Branch,
  plant: Plant,
  blockById: Map<string, Block>,
  overrides?: Map<string, { x: number; y: number }>,
): Vec2 {
  if (overrides) {
    const override = overrides.get(branch.id);
    if (override) return override;
  }
  if (branch.parentBranchId === null) return plant.anchor.position;
  if (!branch.parentBranchNodeId) return plant.anchor.position;
  const parent = blockById.get(branch.parentBranchNodeId);
  return parent ? parent.position : plant.anchor.position;
}

function createBranchGroup(branch: Branch): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "branch");
  g.setAttribute("data-branch-id", branch.id);
  return g;
}

/** Per-branch linear gradient: opaque at branchOrigin, fading to tipOpacity
 *  at the curve endpoint. Defined in userSpaceOnUse so coordinates match the
 *  world-space path. The stops use `currentColor` so they pick up the
 *  `color: var(--curve)` set on `.branch-curve` — live Studio color updates
 *  work without rebuilding defs. */
function createStemGradient(
  branch: Branch,
  origin: Vec2,
  tipOpacity: number,
  instanceId?: string,
): SVGLinearGradientElement {
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", stemGradientId(branch.id, instanceId));
  grad.setAttribute("gradientUnits", "userSpaceOnUse");
  const { point: tipPoint } = sampleCurve(branch.curve, 1);
  grad.setAttribute("x1", fmt(origin.x));
  grad.setAttribute("y1", fmt(origin.y));
  grad.setAttribute("x2", fmt(origin.x + tipPoint.x));
  grad.setAttribute("y2", fmt(origin.y + tipPoint.y));
  const stop0 = document.createElementNS(SVG_NS, "stop");
  stop0.setAttribute("offset", "0%");
  // Use var(--curve) directly rather than currentColor: in SVG, currentColor
  // inside <stop> resolves on the gradient's parent (typically <defs>
  // inheriting from <html> via `color: var(--hud)`), not on the path that
  // references the gradient. The result was that changing stem.color did
  // nothing because the gradient stop kept inheriting the HUD colour.
  stop0.setAttribute("stop-color", "var(--curve)");
  stop0.setAttribute("stop-opacity", "1");
  const stop1 = document.createElementNS(SVG_NS, "stop");
  stop1.setAttribute("offset", "100%");
  stop1.setAttribute("stop-color", "var(--curve)");
  stop1.setAttribute("stop-opacity", String(tipOpacity));
  grad.appendChild(stop0);
  grad.appendChild(stop1);
  return grad;
}

/** Threshold above which a stem path gets the `branch-curve-major` marker
 *  class. Used by the atmosphere-glow CSS rule to restrict the drop-shadow
 *  filter to visually substantial stems (trunk + boughs + main sub-branches),
 *  skipping the many thin twig-level branches. Pure CSS feature — no impact
 *  on stem stroke geometry itself. */
const STEM_MAJOR_THRESHOLD = 1.5;

function createCurvePath(
  branch: Branch,
  origin: Vec2,
  screenWidth: number,
  instanceId?: string,
): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  const cls = screenWidth >= STEM_MAJOR_THRESHOLD
    ? "branch-curve branch-curve-major"
    : "branch-curve";
  path.setAttribute("class", cls);
  path.setAttribute("d", curveD(branch, origin));
  path.setAttribute("fill", "none");
  if (screenWidth > 0) {
    // Gradient stroke: per-branch linearGradient gives base→tip opacity cue.
    path.setAttribute("stroke", `url(#${stemGradientId(branch.id, instanceId)})`);
    path.setAttribute("stroke-width", String(screenWidth));
  } else {
    // Hairline fallback: stroke uses currentColor → resolves to var(--curve).
    path.setAttribute("stroke", "currentColor");
  }
  return path;
}

function curveD(branch: Branch, origin: Vec2): string {
  const parts: string[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const { point } = sampleCurve(branch.curve, t);
    const x = origin.x + point.x;
    const y = origin.y + point.y;
    parts.push(`${i === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y)}`);
  }
  return parts.join(" ");
}

// ---------- stencils ----------

// Screen-horizontal Bud: tip points screen-up (-π/2 in SVG's +y-down system).
// Keeps text reading left-to-right regardless of branch orientation.
const BUD_SCREEN_HORIZONTAL_ROT = -Math.PI / 2;

function stencilFor(
  block: Block,
  budBaseline: "follow-tangent" | "screen-horizontal",
  options: RenderOptions,
  labelOverride?: string,
): SVGGElement | null {
  const labelsOnly = options.labelsOnly ?? false;
  switch (block.kind) {
    case "lief":
      if (options.projected) {
        const cfg = options.projectionConfigByBlockId!.get(block.id)!;
        return liefTieredWrapper(block, cfg, labelsOnly);
      }
      return options.minimal
        ? stencilMinimal(
            block,
            block.name,
            budBaseline,
            options.fontScale,
          )
        : stencilLief(block, budBaseline, options);
    case "meristem": {
      let meristemName = labelOverride ?? block.name;
      // start-here boosted meristems get a visible "Start Here → " cue
      // prepended to their rendered label. Only affects rendering — the
      // canonical block.name is unchanged so side panel, metadata, etc.
      // stay clean.
      if (options.boostedBranchIds?.has(block.branchId)) {
        meristemName = displayNameForBoosted(meristemName);
      }
      if (options.projected) {
        const cfg = options.projectionConfigByBlockId!.get(block.id)!;
        return stencilProjected(block, meristemName, cfg, labelsOnly);
      }
      return options.minimal
        ? stencilMinimal(
            block,
            meristemName,
            budBaseline,
            options.fontScale,
          )
        : stencilMeristem(block, meristemName, budBaseline, options);
    }
    case "branchNode": return stencilBranchNode(block);
    case "spacer":     return stencilSpacer(block);
    default:           return null; // growthBlock and any future structural-only kinds
  }
}

// Identity blocks (Lief, Meristem) are rendered as a compound stencil path
// (the "Bud"): the outer subpath is a leaf silhouette; inner subpaths are
// glyph outlines for the block name. Even-odd fill makes the letters
// transparent holes through which the Canvas projection is visible. The path
// is simultaneously the click target and the always-visible rimmed source —
// no separate bubble or shadow layer is needed for identity.
function stencilLief(
  block: LiefBlock,
  budBaseline: "follow-tangent" | "screen-horizontal",
  options: RenderOptions,
): SVGGElement {
  const rot = budBaseline === "screen-horizontal" ? BUD_SCREEN_HORIZONTAL_ROT : undefined;
  const g = blockGroup(block, "stencil stencil-lief", rot);
  g.appendChild(budPath(block.name, block.shortSide, options.simpleBud));
  return g;
}

function stencilMeristem(
  block: MeristemBlock,
  displayName: string,
  budBaseline: "follow-tangent" | "screen-horizontal",
  options: RenderOptions,
): SVGGElement {
  const rot = budBaseline === "screen-horizontal" ? BUD_SCREEN_HORIZONTAL_ROT : undefined;
  const g = blockGroup(block, "stencil stencil-meristem", rot);
  g.appendChild(budPath(displayName, block.shortSide, options.simpleBud));
  return g;
}

// Invisible structural blocks (branchNode, spacer) get a hit rect that
// straddles the curve symmetrically — midline of the rect runs along the
// tangent, perpendicular extent covers the 2D envelope a lief could have
// occupied on either side. This gives fat, predictable click targets on
// otherwise-thin branches while adding zero render cost (transparent rects).
function stencilBranchNode(block: BranchNodeBlock): SVGGElement {
  const g = blockGroup(block, "stencil stencil-invisible stencil-branchnode");
  const S = block.shortSide;
  const L = S * PHI;
  g.appendChild(hitRect(-S / 2, -L, S, 2 * L));
  return g;
}

function stencilSpacer(block: SpacerBlock): SVGGElement {
  const g = blockGroup(block, "stencil stencil-invisible stencil-spacer");
  const S = block.shortSide;
  const L = S * PHI;
  g.appendChild(hitRect(-S / 2, -L, S, 2 * L));
  return g;
}

// Minimal stencil: no compound-path Bud. Instead, an SVG `<text>` projects
// perpendicular to the branch tangent (always +u in the block's rotated
// frame, which the engine has aligned with the outward-pointing tangent).
// A single invisible `<rect>` antenna wraps the projected text's bounding
// box and carries clicks — the text is the only visible identity target,
// so a second hit-rect over the (invisible) Bud envelope was pure
// redundancy. Clicks elsewhere in the block's along-branch region fall
// through to adjacent spacer/branchNode rects, which resolve to the
// branch's tip meristem — a reasonable fallback semantic.
//
// Font size scales with `shortSide`, which the engine decays by `childScale`
// per depth — so uniform-per-hierarchy text comes for free. No zoom-adaptive
// sizing (deliberate: size conveys structural depth, not pixel density).
function stencilMinimal(
  block: Block,
  name: string,
  budBaseline: "follow-tangent" | "screen-horizontal",
  fontScale?: number,
): SVGGElement {
  // Block group always follows the tangent — that's what puts the text's
  // landing zone perpendicular-offset from the Bud. The screen-horizontal
  // toggle affects only the text's glyph orientation (counter-rotation
  // below), not the block's placement.
  const cls = `stencil stencil-${block.kind} stencil-minimal`;
  const g = blockGroup(block, cls);
  const S = block.shortSide;
  const L = S * PHI;

  // Stem (petiole) endpoint: the text's anchor point. Angle measured from the
  // branch tangent (+v) toward +u, so (sin θ, cos θ) × length — larger θ leans
  // further toward perpendicular. 55° reads as a leaf branching off the stem
  // rather than clinging to it, while still pointing toward the tip.
  const stemAngle = (STEM_ANGLE_DEG * Math.PI) / 180;
  const stemLen = L * STEM_LENGTH_FACTOR;
  const stemEndX = Math.sin(stemAngle) * stemLen;
  const stemEndY = STEM_ORIGIN_V + Math.cos(stemAngle) * stemLen;
  const gap = S * LABEL_GAP;

  // Visible stem line from branch attachment to text anchor. Follows the
  // block's rotated frame (outer group rotation), so the stem tracks branch
  // orientation in both follow-tangent and screen-horizontal label modes.
  g.appendChild(stemLine(0, STEM_ORIGIN_V, stemEndX, stemEndY));

  // Text anchored at stem tip, extending outward in +u.
  const effectiveFontScale = fontScale ?? LABEL_FONT_SCALE;
  const label = textLabel(name, L, S, stemEndX + gap, stemEndY, effectiveFontScale);

  if (budBaseline === "screen-horizontal") {
    // Counter-rotate just the label around its anchor so glyphs read screen-
    // horizontal, while the anchor point (and thus the perpendicular-offset
    // landing zone) is preserved — the outer block-group rotation lands the
    // anchor at its world position, the inner rotation cancels the local
    // orientation for the text content only.
    const deg = -(block.rotation * 180) / Math.PI;
    const counter = document.createElementNS(SVG_NS, "g");
    counter.setAttribute(
      "transform",
      `rotate(${fmt(deg)} ${fmt(label.anchor.x)} ${fmt(label.anchor.y)})`,
    );
    counter.appendChild(hitRect(label.bounds.x, label.bounds.y, label.bounds.width, label.bounds.height));
    counter.appendChild(label.text);
    g.appendChild(counter);
  } else {
    g.appendChild(hitRect(label.bounds.x, label.bounds.y, label.bounds.width, label.bounds.height));
    g.appendChild(label.text);
  }

  return g;
}

// Projected skin: modelled on stencilMinimal's shape but with two text copies
// — a small source inside the rect that reads along the chain, and a
// magnified projection at the ray tip that reads screen-horizontal. The ray's
// direction comes from a world-frame sun-azimuth (kind-aware: liefs
// perpendicular-outward with side flip, meristems forward along tangent).
//
// Structure (inside blockGroup, which is translated to block.position with
// rotation 0):
//
//   <text class="source-label" rotate(tangent)>            ← in-rect source
//   <g class="projection-branch" rotate(sunAzDeg 0 0)>     ← rotates the ray
//     <line class="light-ray" x1=0 y1=0 x2=rayLen y2=0>
//     <g class="projection-payload" rotate(-sunAzDeg rayLen 0)>   ← screen-horizontal text
//       [ <g class="projection-scaler"> ... ]              ← adaptive wrapper (optional)
//       <rect hit-target/>
//       <rect projection-bounds/>                          ← optional debug
//       <text class="projection-label" x=rayLen centerY=0/>
//     </g>
//   </g>
//
// The two-rotation sandwich (branch rotates by sunAz, payload counter-rotates
// by -sunAz about the tip) places the payload at the tip in stencil-local
// coordinates while keeping its children screen-horizontal. This way cursor-
// light only has to rewrite two transform attrs per frame (branch + payload)
// instead of walking every tspan and hit-rect coordinate.

// Inner projected stencil: returns an unwrapped <g> with all projected-skin
// children but NO position/rotation transform and NO class. Intended to be
// appended to an outer wrapper (blockGroup) that handles positioning.
function stencilProjectedInner(
  block: Block,
  name: string,
  cfg: ProjectionConfig,
  labelsOnly: boolean = false,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  const S = block.shortSide;
  // Label sizing basis: engine-baked `labelSize` (a world-level sizing
  // mechanism, see src/library/passes/size.ts), `shortSide` fallback for
  // plants built by older engines. Text (font size + wrap budget) only — ray
  // length and all other geometry stay on `S`.
  const labelBasis = labelSizeBasis(block);
  const L = labelBasis * PHI;

  const sunAz =
    block.kind === "meristem"
      ? meristemSunAzimuth({ tangent: block.tangent }, cfg.meristemRelativeAngle)
      : liefSunAzimuth(
          { tangent: block.tangent, side: (block as LiefBlock).side },
          cfg.liefRelativeAngle,
        );

  const rayLen = S * (block.kind === "meristem" ? cfg.meristemDistance : cfg.liefDistance);
  const sunAzDeg = (sunAz * 180) / Math.PI;

  // ---- source <text>: small, inside the rect, along the chain.
  // cfg._depth is carried for Studio lookups.
  const sourceFontSize = labelBasis * cfg.titleSize;
  const source = buildWrappedText({
    name,
    fontSize: sourceFontSize,
    boxLength: L,
    x: 0,
    centerY: 0,
    className: "source-label",
  });
  const tangentDeg = (block.tangent * 180) / Math.PI;
  source.text.setAttribute("transform", `rotate(${fmt(tangentDeg)} 0 0)`);
  g.appendChild(source.text);

  // ---- branch group: rotates by sunAzDeg about origin. Contains the ray
  // and the counter-rotated payload. Cursor-light rewrites this transform.
  const branchG = document.createElementNS(SVG_NS, "g");
  branchG.setAttribute("class", "projection-branch");
  branchG.setAttribute("data-default-sun-az", fmt(sunAzDeg));
  branchG.setAttribute("data-ray-len", fmt(rayLen));
  branchG.setAttribute(
    "transform",
    `rotate(${fmt(sunAzDeg)} 0 0)`,
  );
  // Block kind, branch id, and world position live on branchG so cursor-light
  // can filter by kind, identify same-branch siblings for dimming, and compute
  // world distance — all without walking back up to the stencil root or
  // cross-referencing the plant model.
  branchG.setAttribute("data-block-id", block.id);
  // block here is always lief or meristem — both carry .name. The Block union
  // type is broader than runtime, so we access via a type assertion.
  const blockName = (block as { name?: string }).name;
  if (blockName) branchG.setAttribute("data-block-name", blockName);
  branchG.setAttribute("data-kind", block.kind);
  branchG.setAttribute("data-branch-id", block.branchId);
  branchG.setAttribute("data-world-x", fmt(block.position.x));
  branchG.setAttribute("data-world-y", fmt(block.position.y));

  const axis = document.createElementNS(SVG_NS, "line");
  axis.setAttribute("class", "light-ray");
  axis.setAttribute("x1", "0");
  axis.setAttribute("y1", "0");
  axis.setAttribute("x2", fmt(rayLen));
  axis.setAttribute("y2", "0");
  // labelsOnly: geometry (light-ray) is drawn on canvas; skip in SVG.
  if (!labelsOnly) branchG.appendChild(axis);

  // ---- payload: counter-rotated about the tip (rayLen, 0) so its contents
  // end up screen-horizontal after the branch rotation.
  const payloadG = document.createElementNS(SVG_NS, "g");
  payloadG.setAttribute("class", "projection-payload");
  payloadG.setAttribute(
    "transform",
    `rotate(${fmt(-sunAzDeg)} ${fmt(rayLen)} 0)`,
  );

  // ---- projection <text>: magnified, at the tip in payload-local frame.
  // After the two rotations, the text reads horizontally in world/screen
  // coords. Anchor is fixed at render time based on the default sunAz: when
  // the ray points leftward (cos sunAz < 0), the label extends leftward in
  // payload-local so it doesn't double back over the ray. Cursor-light leaves
  // text-anchor alone — if the user rotates the ray to the opposite side,
  // the label may overlap the ray path. Accepted MVP limitation.
  // Projection font-size = source font-size (build-time scale = 1). The
  // runtime scaler in renderPlantPass computes k = targetPx / (effectiveShortSide
  // × titleSize × zoom) and applies it to the projection-scaler transform each
  // settle. Attention boost (cursorMagnification) is handled at runtime via
  // computeTargetScreenPx. Build-time attention scale is always 1.
  const projectionFontSize = sourceFontSize;
  const anchorLeft = Math.cos(sunAz) < 0;
  // Land the ray-tip on the CORNER of the label box nearest the branch, so the
  // text body sits off the ray line. Horizontal edge comes from cos(sunAz)
  // (`anchorLeft`, above); the vertical edge from sin(sunAz) via
  // projectionVerticalAnchor — angle-driven, so it's correct at ANY branch
  // orientation. (The old code keyed the vertical edge off the lief's side,
  // which only held for one orientation — the documented bug.) Meristems sit on
  // the chain axis with the ray along the tangent, so they keep "middle".
  const liefVerticalAnchor: "middle" | "top" | "bottom" =
    block.kind === "lief" ? projectionVerticalAnchor(sunAz) : "middle";
  const projection = buildWrappedText({
    name,
    fontSize: projectionFontSize,
    boxLength: L,
    x: rayLen,
    centerY: 0,
    className: "projection-label",
    textAnchor: anchorLeft ? "end" : "start",
    verticalAnchor: liefVerticalAnchor,
  });
  // attentionScale drives a scale-about-anchor transform on the text element —
  // font-size stays fixed at the rest value, so glyph size and baked tspan
  // line-heights grow uniformly. Pivot: label's x anchor at centerY = 0.
  // Build-time value is always 1; the runtime scaler handles live attention.
  const attentionScale = 1;
  projection.text.setAttribute("data-attention-scale", fmt(attentionScale));
  projection.text.setAttribute("data-anchor-x", fmt(rayLen));
  const hit = hitRect(
    projection.bounds.x,
    projection.bounds.y,
    projection.bounds.width,
    projection.bounds.height,
  );
  const boundsRect = cfg.showBounds
    ? (() => {
        const r = document.createElementNS(SVG_NS, "rect");
        r.setAttribute("class", "projection-bounds");
        r.setAttribute("x", fmt(projection.bounds.x));
        r.setAttribute("y", fmt(projection.bounds.y));
        r.setAttribute("width", fmt(projection.bounds.width));
        r.setAttribute("height", fmt(projection.bounds.height));
        return r;
      })()
    : null;

  // Zoom-adaptive scaler wraps the projection text (plus its hit-rect and any
  // debug bounds) in a scale-about-point group. The pivot is the tip in
  // payload-local coordinates: (rayLen, 0). Scaler lives under the payload
  // so the scale is independent of cursor rotation — the counter-rotation
  // handles orientation, the scaler handles screen-px legibility.
  // renderPlantPass rewrites the scaler's transform each settle via the
  // adaptiveByBlock WeakMap cache.
  {
    const scaler = document.createElementNS(SVG_NS, "g");
    scaler.setAttribute("class", "projection-scaler");
    scaler.setAttribute("data-adaptive", "1");
    scaler.setAttribute("data-kind", block.kind);
    scaler.setAttribute("data-dx", fmt(rayLen));
    scaler.setAttribute("data-dy", "0");
    scaler.setAttribute(
      "transform",
      `translate(${fmt(rayLen)} 0) scale(1) translate(${fmt(-rayLen)} 0)`,
    );
    scaler.appendChild(hit);
    if (boundsRect) scaler.appendChild(boundsRect);
    scaler.appendChild(projection.text);

    // Cursor-light ancestor-path overlay positioning data — applied by
    // updateCursorLight when it lazily creates the `.projection-path` text
    // element on activation. Stashed on the label so we don't have to emit
    // one DOM node per block at render time (~2k extra <text>s on
    // Shakespeare would hit pan/zoom perf at wide zoom).
    const pathY = projection.bounds.y - projectionFontSize * 0.5;
    projection.text.setAttribute("data-path-x", fmt(rayLen));
    projection.text.setAttribute("data-path-y", fmt(pathY));
    projection.text.setAttribute("data-path-font-size", fmt(projectionFontSize));
    projection.text.setAttribute("data-path-anchor", anchorLeft ? "end" : "start");
    // Width budget for the path overlay: the same boxLength the label uses,
    // so wrapped path text matches the visual column of the projection-label
    // underneath. Path stacks upward from `data-path-y` (bottom-aligned).
    projection.text.setAttribute(
      "data-path-box-length",
      fmt(L),
    );

    payloadG.appendChild(scaler);
  }

  branchG.appendChild(payloadG);
  g.appendChild(branchG);

  return g;
}

// Thin wrapper: re-creates the original stencilProjected behaviour for
// meristems. Positioning + rotation = 0 is handled by blockGroup here;
// the inner projected children live in stencilProjectedInner.
function stencilProjected(
  block: Block,
  name: string,
  cfg: ProjectionConfig,
  labelsOnly: boolean = false,
): SVGGElement {
  const cls = `stencil stencil-${block.kind} stencil-projected${
    block.kind === "meristem" ? " meristem-tiered" : ""
  }`;
  // Rotation = 0: inner children work in a world-aligned local frame,
  // translated to block.position. Source text carries its own rotate()
  // transform to read along the chain; projection stays unrotated
  // (screen-horizontal).
  const g = blockGroup(block, cls, 0);
  // Per-block depth is stored for tier-classifier lookups.
  g.dataset["depth"] = String(cfg._depth ?? 0);
  // Per-block colour override (stylingConfig.overrides → resolveProjectionConfig
  // resolves cfg.meristemLight / cfg.light per block). Inline CSS variables on
  // this group element shadow the global vars set on :root, so per-bough tints
  // travel with the meristem text and dot stencils inside the group.
  const gStyle = (g as unknown as HTMLElement).style;
  if (block.kind === "meristem") {
    gStyle.setProperty("--proj-meristem-light", cfg.meristemLight);
  }
  gStyle.setProperty("--proj-light", cfg.light);
  const inner = stencilProjectedInner(block, name, cfg, labelsOnly);
  g.appendChild(inner);

  // Meristem-tiered: pre-mount dot-glyphs and stub-circle alternates alongside
  // the label. Three visible tiers: full → dot-glyphs → single-dot → hide.
  // Default to "single-dot" on first paint so initial render doesn't pay
  // the layout cost of ~hundreds of text labels before the heavy-update
  // pass promotes them. (Same first-paint perf pattern that made Shakespeare
  // smooth-as-silk for liefs.)
  if (block.kind === "meristem") {
    attachMeristemTierAlternates(inner, block, name, cfg, labelsOnly);
    const labelEl = inner.querySelector<SVGElement>(".projection-label");
    const sourceEl = inner.querySelector<SVGElement>(".source-label");
    const dotEl = inner.querySelector<SVGElement>(".projection-dot-text");
    const stubEl = inner.querySelector<SVGElement>(".projection-stub");
    if (labelEl) setHidden(labelEl, true);
    if (sourceEl) setHidden(sourceEl, true);
    // labelsOnly: dot and stub elements are skipped at build time, so these
    // querySelector results will be null — the `if (el)` guards handle that.
    if (dotEl) setHidden(dotEl, true);
    if (stubEl) setHidden(stubEl, false);
    g.dataset["currentTier"] = "single-dot";
  }
  return g;
}

/** Attach dot-glyphs path and stub-circle alternates to a meristem's
 *  projection inner (siblings of projection-label, inside the scaler so they
 *  inherit the same magnification transform). Both start display:none at
 *  creation; the meristem-tier swap in main.ts toggles which sibling is
 *  visible as screen-px crosses the tier thresholds. Three visible tiers:
 *  full → dot-glyphs → single-dot → hide.
 *  When labelsOnly is true, both elements are omitted — geometry is on canvas. */
function attachMeristemTierAlternates(
  inner: SVGGElement,
  block: MeristemBlock,
  name: string,
  cfg: ProjectionConfig,
  labelsOnly: boolean = false,
): void {
  // labelsOnly: dot-glyphs and stub are canvas-drawn geometry; skip in SVG.
  if (labelsOnly) return;

  const parent =
    inner.querySelector<SVGGElement>(".projection-scaler") ??
    inner.querySelector<SVGGElement>(".projection-payload");
  if (!parent) return;

  // Text sizes on the label basis (labelSize ?? shortSide); ray length stays
  // on shortSide (geometry).
  const sourceFontSize = labelSizeBasis(block) * cfg.titleSize;
  // Build-time font-size = source font-size. The runtime scaler in
  // renderPlantPass adjusts to the attention-driven target screen-px.
  const projectionFontSize = sourceFontSize;
  const rayLen = block.shortSide * cfg.meristemDistance;
  const sunAz = meristemSunAzimuth(
    { tangent: block.tangent },
    cfg.meristemRelativeAngle,
  );
  const anchorLeft = Math.cos(sunAz) < 0;

  // Dot-glyphs path — per-character dots that represent text visually without
  // the cost of text shaping. Display:none until tier-swap promotes to "dot-glyphs".
  const dot = document.createElementNS(SVG_NS, "path");
  dot.setAttribute("class", "projection-dot-text");
  // Meristem colour comes from the `.stencil-meristem .projection-dot-text`
  // rule (style.css + the plugin's scoped styles.css) — no inline pin.
  dot.setAttribute("d", bakeWrappedDotPath({
    name,
    fontSize: projectionFontSize,
    boxLength: labelSizeBasis(block) * PHI,
  }));
  const sx = anchorLeft ? -1 : 1;
  dot.setAttribute(
    "transform",
    `translate(${fmt(rayLen)} 0) scale(${sx} 1)`,
  );
  setHidden(dot, true);
  parent.appendChild(dot);

  // Stub circle — single dot at (rayLen, 0). Cheapest visible representation.
  // Display:none until tier-swap sets "single-dot".
  const stub = document.createElementNS(SVG_NS, "circle");
  stub.setAttribute("class", "projection-stub");
  stub.setAttribute("cx", fmt(rayLen));
  stub.setAttribute("cy", "0");
  stub.setAttribute("r", fmt(projectionFontSize * 0.3));
  setHidden(stub, true);
  parent.appendChild(stub);
}

// Tier-aware lief wrapper. Pre-mounts the full Tier-0 stencil plus Tier-1
// (dot-text path) and Tier-2 (stub circle) siblings inside the projection
// payload. Tier-1 and Tier-2 start display:none; the rAF tier-swap in
// main.ts toggles which sibling is visible without any DOM rebuild.
// When labelsOnly is true, Tier-1 and Tier-2 are omitted (canvas draws them).
function liefTieredWrapper(
  block: LiefBlock,
  cfg: ProjectionConfig,
  labelsOnly: boolean = false,
): SVGGElement {
  const g = blockGroup(block, "stencil stencil-lief stencil-projected lief-tiered", 0);
  const depth = cfg._depth ?? 0;
  g.dataset["depth"] = String(depth);
  // Per-block colour override (see stencilProjected for the same pattern).
  // Inline --proj-light shadows the global root variable for this lief and
  // its tier-alternate descendants. Per-bough lief tints set via
  // stylingConfig.overrides flow through here.
  (g as unknown as HTMLElement).style.setProperty("--proj-light", cfg.light);

  // Mount the full Tier-0 stencil as a child of the wrapper.
  const inner = stencilProjectedInner(block, block.name, cfg, labelsOnly);
  g.appendChild(inner);

  // Add Tier 1 (dot-text path) and Tier 2 (stub circle) as siblings of
  // projection-label inside the projection-payload (or scaler if adaptive).
  // Both initially display:none — the rAF tier-swap toggles which is visible.
  // labelsOnly: these are canvas-drawn; skip entirely in SVG.
  attachLiefTierAlternates(inner, block, cfg, labelsOnly);

  // Initial tier default: single-dot. Rendering full text for hundreds of liefs
  // before the first updateLiefTiers swap dominates first-paint cost on
  // dense plants (~900 liefs on Shakespeare). Start at the cheapest visible
  // tier; the rAF tier-swap will promote liefs to "dot-glyphs" or "full" on
  // every classification pass where their post-zoom screen-px crosses the tier
  // thresholds. At fit-zoom (the typical first view) single-dot is the correct
  // tier anyway, so this is a no-op in the common case and a strict win otherwise.
  const labelEl = inner.querySelector<SVGElement>(".projection-label");
  const sourceEl = inner.querySelector<SVGElement>(".source-label");
  const dotEl = inner.querySelector<SVGElement>(".projection-dot-text");
  const stubEl = inner.querySelector<SVGElement>(".projection-stub");
  if (labelEl) setHidden(labelEl, true);
  if (sourceEl) setHidden(sourceEl, true);
  // labelsOnly: dot/stub are absent from DOM — querySelector returns null;
  // the `if (el)` guards are already in place for null-safety.
  if (dotEl) setHidden(dotEl, true);
  if (stubEl) setHidden(stubEl, false);
  g.dataset["currentTier"] = "single-dot";

  return g;
}

// Add dot-glyphs and stub-circle alternate elements alongside the
// projection-label for liefs. All start display:none; the rAF tier-swap in
// main.ts toggles which sibling is visible. Three visible tiers per lief:
// full (projection-label) → dot-glyphs (path) → single-dot (circle).
// When labelsOnly is true, both are omitted — canvas draws them instead.
function attachLiefTierAlternates(
  inner: SVGGElement,
  block: LiefBlock,
  cfg: ProjectionConfig,
  labelsOnly: boolean = false,
): void {
  // labelsOnly: dot-glyphs and stub are canvas-drawn geometry; skip in SVG.
  if (labelsOnly) return;

  // Find where projection-label lives (inside scaler if present, else inside payload).
  const parent =
    inner.querySelector<SVGGElement>(".projection-scaler") ??
    inner.querySelector<SVGGElement>(".projection-payload");
  if (!parent) return;

  // Text sizes on the label basis (labelSize ?? shortSide); ray length stays
  // on shortSide (geometry).
  const sourceFontSize = labelSizeBasis(block) * cfg.titleSize;
  // Build-time font-size = source font-size. The runtime scaler in
  // renderPlantPass adjusts to the attention-driven target screen-px.
  const projectionFontSize = sourceFontSize;
  const rayLen = block.shortSide * cfg.liefDistance;
  const sunAz = liefSunAzimuth(
    { tangent: block.tangent, side: block.side },
    cfg.liefRelativeAngle,
  );
  const anchorLeft = Math.cos(sunAz) < 0;

  // Dot-glyphs path — per-character dots giving visual density of text without
  // text-shaping cost. Mirrors the meristem dot-glyphs pattern.
  const dot = document.createElementNS(SVG_NS, "path");
  dot.setAttribute("class", "projection-dot-text");
  dot.setAttribute("d", bakeWrappedDotPath({
    name: block.name,
    fontSize: projectionFontSize,
    boxLength: labelSizeBasis(block) * PHI,
  }));
  const sx = anchorLeft ? -1 : 1;
  dot.setAttribute(
    "transform",
    `translate(${fmt(rayLen)} 0) scale(${sx} 1)`,
  );
  setHidden(dot, true);
  parent.appendChild(dot);

  // Stub circle — single dot at (rayLen, 0). Cheapest visible representation.
  const stub = document.createElementNS(SVG_NS, "circle");
  stub.setAttribute("class", "projection-stub");
  stub.setAttribute("cx", fmt(rayLen));
  stub.setAttribute("cy", "0");
  stub.setAttribute("r", fmt(projectionFontSize * 0.3));
  setHidden(stub, true);
  parent.appendChild(stub);
}

// Text label built from tspans. Lines wrap at a character budget derived from
// an em-based width estimate (we don't measure the real font, just assume a
// reasonable glyph width in em units). Truncation cap (~80 chars) is generous
// enough that every Shakespeare Lief/Meristem title fits in full.
const MAX_LABEL_CHARS = 80;
const LABEL_FONT_SCALE = 0.28;      // font-size ≈ 0.28 × shortSide
export const LABEL_LINE_HEIGHT = 1.2;      // em
const LABEL_GAP = 0.15;             // × shortSide, gap between stem tip and text
export const LABEL_CHAR_WIDTH_EM = 0.55;   // rough glyph advance for our sans-serif
export const LABEL_MAX_WIDTH_FACTOR = 1.5; // text column width capped at 1.5 × block length
const LABEL_PAD = 0.2;              // × lineHeight, antenna padding around the text box

// Stem (petiole) geometry. Angle is measured from the branch tangent (local
// +v axis) toward +u, so `0°` would run along the branch direction and `90°`
// would be perpendicular. ~55° feels botanically natural — the leaf leans
// toward the tip rather than sticking out flat. Length is proportional to
// the block's long axis so it tracks the engine's hierarchy scaling.
const STEM_ANGLE_DEG = 55;
const STEM_LENGTH_FACTOR = 0.9;     // × L
const STEM_ORIGIN_V = 0;            // stem emerges from the branch-attachment node

interface WrappedTextOpts {
  name: string;
  fontSize: number;
  /** Budget for wrap width — longest axis in local frame, times
   *  LABEL_MAX_WIDTH_FACTOR, is the column budget. */
  boxLength: number;
  x: number;
  centerY: number;
  className: string;
  /** "start" extends rightward from x; "end" extends leftward from x. Lets
   *  the projection label mirror itself on left-side liefs so the ray meets
   *  the label on its outer edge rather than laying under the label body. */
  textAnchor?: "start" | "end";
  /** Where the anchor point sits relative to the text bbox vertically.
   *  - "middle" (default): anchor is at text vertical centerline (legacy).
   *  - "top": anchor is at the TOP of the text — text extends DOWN from anchor.
   *  - "bottom": anchor is at the BOTTOM of the text — text extends UP from anchor.
   *  Used by lief projection labels so the ray-tip lands on a corner of the
   *  text box rather than the middle of a side, keeping the text body off
   *  the ray line. */
  verticalAnchor?: "middle" | "top" | "bottom";
}

function buildWrappedText(opts: WrappedTextOpts): {
  text: SVGTextElement;
  bounds: { x: number; y: number; width: number; height: number };
  anchor: { x: number; y: number };
} {
  const { name, fontSize, boxLength, x, centerY, className } = opts;
  const textAnchor = opts.textAnchor ?? "start";
  const verticalAnchor = opts.verticalAnchor ?? "middle";
  const charWidth = fontSize * LABEL_CHAR_WIDTH_EM;
  const maxWidth = boxLength * LABEL_MAX_WIDTH_FACTOR;
  const maxCharsPerLine = Math.max(6, Math.floor(maxWidth / charWidth));

  const clipped =
    name.length > MAX_LABEL_CHARS
      ? name.slice(0, MAX_LABEL_CHARS - 1) + "…"
      : name;
  const lines = wrapText(clipped, maxCharsPerLine);

  const lineH = fontSize * LABEL_LINE_HEIGHT;
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const textWidth = longest * charWidth;
  const textHeight = lines.length * lineH;

  // Shift the effective center so the requested edge of the text bbox lands
  // at `centerY`. "top" pushes the centerline DOWN by half the text height
  // (text bbox top sits at centerY); "bottom" pulls it UP (bbox bottom at
  // centerY). "middle" leaves centerY as-is.
  const verticalShift =
    verticalAnchor === "top" ? textHeight / 2 :
    verticalAnchor === "bottom" ? -textHeight / 2 :
    0;
  const effectiveCenterY = centerY + verticalShift;
  const startY = effectiveCenterY - ((lines.length - 1) * lineH) / 2;

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("class", className);
  text.setAttribute("font-size", fmt(fontSize));
  text.setAttribute("text-anchor", textAnchor);
  text.setAttribute("dominant-baseline", "middle");
  for (let i = 0; i < lines.length; i++) {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", fmt(x));
    tspan.setAttribute("y", fmt(startY + i * lineH));
    tspan.textContent = lines[i]!;
    text.appendChild(tspan);
  }

  const pad = lineH * LABEL_PAD;
  const boundsX = textAnchor === "end" ? x - textWidth - pad : x - pad;
  const bounds = {
    x: boundsX,
    y: startY - lineH / 2 - pad,
    width: textWidth + pad * 2,
    height: textHeight + pad * 2,
  };
  const anchor = { x, y: centerY };
  return { text, bounds, anchor };
}

function textLabel(
  name: string,
  length: number,
  width: number,
  textX: number,
  centerY: number,
  fontScale?: number,
) {
  const fontSize = width * (fontScale ?? LABEL_FONT_SCALE);
  return buildWrappedText({
    name,
    fontSize,
    boxLength: length,
    x: textX,
    centerY,
    className: "bud-label",
  });
}

export function wrapText(input: string, maxChars: number): string[] {
  const words = input.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    // A single word longer than the line budget: break it hard so we don't
    // overflow. Rare in practice (long filenames, URLs), but ensures bounded
    // label width even for worst-case names.
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = ""; }
      for (let i = 0; i < word.length; i += maxChars) {
        const piece = word.slice(i, i + maxChars);
        if (i + maxChars >= word.length) current = piece;
        else lines.push(piece);
      }
      continue;
    }
    if (!current) current = word;
    else if ((current + " " + word).length <= maxChars) current += " " + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

// ---------- primitives ----------

// Bud: the single SVG path that IS the block. Outer subpath = leaf silhouette;
// glyph outlines are inner subpaths; even-odd fill renders letters as holes
// through which light passes to the projection. The path is also the click
// target — no separate bubble or overlay. Always-visible rim is a stroke on
// the same path (CSS-driven).
function budPath(
  name: string,
  shortSide: number,
  simple: boolean = false,
): SVGPathElement {
  const L = shortSide * PHI;
  const W = shortSide;
  // Simple-bud mode skips the compound glyph-cutout composition — we still
  // emit the outer leaf silhouette so the block is visible and clickable, but
  // there are no letter sub-paths. Lets us measure the cost of cutouts alone.
  const d = simple
    ? leafSilhouettePath(L, W)
    : composeStencilPath(name, {
        length: L,
        width: W,
        fontSize: W * 0.35,
        textMargin: W * 0.1,
      });
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("class", "bud");
  p.setAttribute("d", d);
  p.setAttribute("fill-rule", "evenodd");
  return p;
}

function stemLine(
  x1: number, y1: number, x2: number, y2: number,
): SVGLineElement {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("class", "bud-stem");
  l.setAttribute("x1", fmt(x1));
  l.setAttribute("y1", fmt(y1));
  l.setAttribute("x2", fmt(x2));
  l.setAttribute("y2", fmt(y2));
  return l;
}

function hitRect(
  x: number, y: number, w: number, h: number,
): SVGRectElement {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("class", "hit-target");
  r.setAttribute("x", fmt(x));
  r.setAttribute("y", fmt(y));
  r.setAttribute("width", fmt(w));
  r.setAttribute("height", fmt(h));
  return r;
}

// ---------- helpers ----------

function blockGroup(
  block: Block,
  cls: string,
  rotationOverride?: number,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", cls);
  g.setAttribute("data-block-id", block.id);
  // Write block name for lief/meristem so interaction handlers can look up
  // nodeMetadata without needing to resolve blockId → block.name via the plant.
  if (block.kind === "lief" || block.kind === "meristem") {
    g.setAttribute("data-block-name", block.name);
  }
  const rot = rotationOverride ?? block.rotation;
  const deg = (rot * 180) / Math.PI;
  g.setAttribute(
    "transform",
    `translate(${fmt(block.position.x)} ${fmt(block.position.y)}) rotate(${fmt(deg)})`,
  );
  return g;
}

function fmt(n: number): string {
  return Math.abs(n) < 1e-4 ? "0" : n.toFixed(3);
}
