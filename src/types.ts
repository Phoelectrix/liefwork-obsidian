// Primitives
export type PlantId     = string;
export type BranchId    = string;
export type BlockId     = string;
export type HierarchyId = string;
export type EventId     = string;
export type StencilId   = string;

export interface Vec2   { x: number; y: number; }
export interface Bounds { min: Vec2; max: Vec2; }

// Sort
export type SortKey =
  | "newest-first"
  | "oldest-first"
  | "alphabetical"
  | ((a: HierarchyNode, b: HierarchyNode) => number);

// Input
export interface HierarchyInput {
  root: HierarchyNode;
}

export interface HierarchyNode {
  id: string;
  name: string;                      // ≤ 200 chars — validated
  createdAt?: string;
  /** Explicit per-branch sort key (a float). When present it overrides
   *  `createdAt` for ordering — the coral's remembered growth-order, immune to
   *  the fs-timestamp re-stamping that `createdAt` rides on. */
  order?: number;
  /** Producer-set: force this node to render as a BRANCH (stem + meristem tip)
   *  even with no children — so an empty folder is a branch, not a lief. Set
   *  ONLY by the plugin's vault adapter, the one producer that knows a node is
   *  a directory. Other producers (site, Studio, fixtures) omit it and keep the
   *  children-only inference. Chosen over a `children: []` sentinel so those
   *  inputs can never be silently re-interpreted. */
  isBranch?: boolean;
  /** Producer-set: this lief is a NON-markdown file (an image/PDF/etc., not a
   *  note). Set only by the plugin's vault adapter in all-files mode. Carried
   *  onto the LiefBlock so the renderer can tint it (teal) apart from notes. */
  nonMd?: boolean;
  /** Producer-set: pin this node at the branch BASE (nearest the stem),
   *  honoured by `sortChildren` ahead of the order/created comparator and any
   *  liefsLast grouping, in either sort direction. Used for a shown folder-note
   *  (the branch's own page). Cannot ride `order`: the all-siblings-ordered
   *  rule would drop the branch to date sorting, and the note's own dates would
   *  place it mid-branch. */
  sortPin?: "base";
  summary?: string;                  // ≤ 200 chars — validated
  stencilId?: StencilId;
  children?: HierarchyNode[];
  /** True for an archive branch (the per-branch `_archive` folder). Its entries
   *  render as a spiral; its children are not expanded into the main coral. */
  isArchive?: boolean;
  _engine?: PerBranchOverride;
}

export interface PerBranchOverride {
  sort?: SortKey;
  curveType?: "bough" | "straight";
  bough?: Partial<BoughParams>;
  /** Override the seed/fixed departure angle for this branch's direct
   *  children (degrees). In phi-sequence mode the value seeds each side's
   *  independent decay; in fixed mode every child takes ±firstBranchAngle. */
  firstBranchAngle?: number;
  /** Scales this branch's direct children's departure angles: 0 = children
   *  fold flat against the parent stem, 1 (default when absent) = natural
   *  fan. Used by the live-sweep unfurl driver to fold/unfold a single
   *  branch's fan in isolation. Optional; treated as 1 when absent. */
  foldFactor?: number;
  /** Scales every non-meristem block's shortSide in this branch's subtree
   *  (lief, spacer, branchNode, growthBlock) — the meristem keeps full size.
   *  0 = arc shrinks to ~meristem-size (a short stub, tip intact), 1
   *  (default when absent) = full size. Cascades to descendant branches.
   *  Used by the live-sweep unfurl driver to grow a single branch's subtree
   *  from a stub. Optional; treated as 1 when absent. */
  growthFactor?: number;
}

// Config
export interface BoughParams {
  undulationAmp: number;
  undulationFreq: number;
  undulationPhase: number;
  entryBow: number;
  bowFalloff: number;
  turnPoint: number;
  turnSharpness: number;
  spiralAngle: number;               // radians
}

export interface SpiralParams {
  /** Total revolutions of the coil. */
  turns: number;
  /** Radius at t=0 (also the centre offset, so the curve starts at local origin). */
  startRadius: number;
  /** Exponential radius decay per unit t (>0 = coils inward). */
  shrink: number;
  /** Coil direction; +1 / -1. Set toward the coral interior by spiralLayoutPass. */
  handedness: 1 | -1;}

export interface EngineConfig {
  sizing: {
    baseSize: number;
    childScale: number;
    phiOrder: number;
    spacerRatio: number;
    liefTaper: number;
  };
  angles: {
    angleMode: "phi-sequence" | "fixed";
    /** Seed angle (degrees) for a sibling group's first branch on each side.
     *  In "phi-sequence" mode, each side runs its own geometric decay seeded
     *  by this value (so a plant is visually symmetrical by construction).
     *  In "fixed" mode, every child branch takes ±firstBranchAngle.
     *  Per-branch overrides replace the value for a single branch's children. */
    firstBranchAngle: number;
    angleDecay: number;
    alternateBranches: boolean;
    alternateLiefs: boolean;
    /** When true (default), each branch departs on the OPPOSITE side from its
     *  parent (the "curl-back" rule). Set false to let every branch turn the
     *  same way. Optional for back-compat; treated as true when absent. Mirrors
     *  the library engine's `angles.curlBack` so shared configs typecheck. */
    curlBack?: boolean;
    /** Spiral-mode handedness mirror — see the library engine's `mirrorCurl`.
     *  Optional; treated as false when absent. */
    mirrorCurl?: boolean;
    /** With `mirrorCurl` on, coil away from the stem (true, default) vs toward.
     *  Optional; treated as true when absent. */
    curlOutward?: boolean;
    /** Suppress alternation for branches whose parent depth is below this
     *  value (root/stem = 0). All such children land on the positive side,
     *  ignoring both alternation and the curl-back flipFirst rule, so the
     *  stem and any forced upper levels render as a one-sided fan.
     *  0 = no suppression (current default). 1 = only stem's children
     *  one-sided. 2 = stem + depth-1's children one-sided. Etc. */
    nonAlternatingDepth: number;
    /** Angle of the root/trunk in degrees. 90 = straight up (default),
     *  0 = right, -90 = down, 180/-180 = left. */
    rootOrientationAngle: number;
  };
  clearance: {
    branchBuffer: number;
    expansionEpsilonRatio: number;
    branchNodeLeadIn: number | "auto";
    leadInMargin: number;
    /** Floor on the number of leading spacers every branch gets before its
     *  first content block. Raises the "auto" lead-in result to at least this
     *  count. Integer, clamped ≥ 1. */
    minBranchLeadInSpacers: number;
    /** Number of spacers inserted immediately before the tip meristem on every
     *  branch. Gives the meristem breathing room on the curve. Integer ≥ 0. */
    meristemLeadInSpacers: number;
    /** Number of spacers appended after the tip meristem. Extends the branch
     *  arcLength past the meristem so curves (especially bough spirals) have
     *  room to unfold beyond the tip. Integer ≥ 0. */
    meristemTrailingSpacers: number;
  };
  curve: {
    curveType: "bough" | "straight";
    boughParams: BoughParams;
  };
  sort: {
    default: SortKey;
    /** When true, after the primary sort, stable-secondary-sort so children
     *  with no children of their own (liefs) come last in each branch's
     *  block order — placing them just behind the tip meristem, with all
     *  branch-node children (sub-meristems) ahead of them toward the base.
     *  Default false (legacy: liefs interleave with branch nodes in primary
     *  sort order). */
    liefsLast: boolean;
  };
  overrides?: Record<HierarchyId, PerBranchOverride>;
}

// Plant
export interface Plant {
  schemaVersion: "1.0.0";
  id: PlantId;
  metadata: PlantMetadata;
  config: EngineConfig;
  events: GrowthEvent[];
  /** Anchor point for the stem (base of the plant, where the curve starts). */
  anchor: Anchor;
  /** The stem branch — the most senior branch; its tip meristem is the Root Meristem. */
  stemBranchId: BranchId;
  branches: Branch[];
  blocks: Block[];
  rings: RingSet[];
  bounds: Bounds;
  stencils?: StencilLibrary;
}

/** Origin + orientation for the stem. A future anchor-element (aesthetic) can
 * extend this without breaking the schema. */
export interface Anchor {
  position: Vec2;
  orientationAngle: number;          // radians; default -π/2 for world-up
}

export interface PlantMetadata {
  builtAt: string;
  engineVersion: string;
  configHash: string;
  hierarchyHash: string;
  counts: { events: number; blocks: number; branches: number };
}

export interface GrowthEvent {
  eventId: EventId;
  liefId: HierarchyId;
  createdAt: string;
}

export interface Branch {
  id: BranchId;
  parentBranchId: BranchId | null;
  parentBranchNodeId: BlockId | null;
  depth: number;                     // 0 for root branches
  shortSide: number;                 // S
  departureAngle: number;            // radians
  blockIds: BlockId[];               // chain order, base → meristem
  curve: CurveSpec;
  arcLength: number;
  /** Subtree AABB: this branch's own blocks unioned with all descendants'
   *  bounds. Used for subtree culling and fit-to-branch camera framing. */
  bounds: Bounds;
  /** Local AABB: only this branch's OWN blocks, excluding descendants. Fed to
   *  the meristem-label viewport-fill (attention) math, which wants the local
   *  label extent — not the whole subtree. Optional so older bundles / test
   *  Branch constructions degrade gracefully (consumers fall back to bounds). */
  localBounds?: Bounds;
  /** True when this branch is an archive branch (laid out as a spiral). */
  isArchive?: boolean;
}

export interface CurveSpec {
  type: "bough" | "straight" | "spiral";
  arcLength: number;
  originAngle: number;               // radians
  bough?: BoughParams;
  spiral?: SpiralParams;}

// Blocks
export type Block = LiefBlock | SpacerBlock | BranchNodeBlock | MeristemBlock;

export interface BlockBase {
  id: BlockId;
  branchId: BranchId;
  index: number;
  shortSide: number;
  arcPosition: number;               // arc-length to block center
  position: Vec2;
  tangent: number;                   // radians
  rotation: number;                  // radians
}

export interface BlockTag {
  /** Pseudorandom 0–1 priority. Lower = survives sparsification longer. */
  random: number;
  /** Optional external rank score 0–1. Higher = more important = lower
   *  effective tag (survives later). Populated by importer when source
   *  data carries a rank metric. */
  importance?: number;
}

export interface LiefBlock extends BlockBase {
  kind: "lief";
  hierarchyId: HierarchyId;
  name: string;
  summary?: string;
  side: "left" | "right";
  stencilId?: StencilId;
  /** True when the source lief is a non-markdown file (producer-set on the
   *  HierarchyNode). Drives the renderer's file-type label tint. */
  nonMd?: boolean;
  /** Sparsification tag baked at build time (Library engine only). */
  tag?: BlockTag;
}

/** Structural-only anchor for a child branch. Carries no identity — its
 * single role is to hold the departure point and accumulate growth rings from
 * descendant events. Identity of the promoted hierarchy node is on the child
 * branch's tip meristem. */
export interface BranchNodeBlock extends BlockBase {
  kind: "branchNode";
  childBranchId: BranchId;
  side: "left" | "right";
}

export interface SpacerBlock extends BlockBase {
  kind: "spacer";
  role: "standard" | "leadIn";
}

/** The growing tip of every branch, including the stem. Acts as the "folder
 * container" for everything on its branch: carries the identity of the
 * hierarchy node whose children live on this branch. The stem's meristem is
 * the Root Meristem — not a separate kind, just the topmost one. */
export interface MeristemBlock extends BlockBase {
  kind: "meristem";
  hierarchyId: HierarchyId;
  name: string;
  summary?: string;
  stencilId?: StencilId;
  /** Sparsification tag baked at build time (Library engine only). */
  tag?: BlockTag;
}

// Rings
export interface RingSet {
  blockId: BlockId;
  forward: Ring[];
  backward: Ring[];
}

export interface Ring {
  eventId: EventId;
  liefId: HierarchyId;               // which lief's birth caused this ring
  width: number;                     // ≥ epsilon
  index: number;
}

// Stencils (reserved)
export interface StencilLibrary {
  viewBox: string;
  defs: Record<StencilId, StencilDef>;
}

export interface StencilDef {
  id: StencilId;
  viewBox?: string;
  content: string;
}
