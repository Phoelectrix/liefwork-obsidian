import type {
  Anchor,
  BlockBase,
  BlockId,
  BoughParams,
  BranchId,
  BranchNodeBlock,
  Bounds,
  CurveSpec,
  GrowthEvent,
  HierarchyId,
  HierarchyInput,
  HierarchyNode,
  LiefBlock as SharedLiefBlock,
  MeristemBlock as SharedMeristemBlock,
  PerBranchOverride,
  PlantId,
  PlantMetadata,
  SpacerBlock,
  SortKey,
  StencilDef,
  StencilId,
  StencilLibrary,
  Vec2,
} from "../types.ts";

// Re-export shared primitives
export type {
  Anchor,
  BlockBase,
  BlockId,
  BoughParams,
  BranchId,
  BranchNodeBlock,
  Bounds,
  CurveSpec,
  GrowthEvent,
  HierarchyId,
  HierarchyInput,
  HierarchyNode,
  PerBranchOverride,
  PlantId,
  PlantMetadata,
  SpacerBlock,
  SortKey,
  StencilDef,
  StencilId,
  StencilLibrary,
  Vec2,
};

// Library Lief/Meristem — shared shape + `labelSize`, the baked text size for
// the block's label (see sizePass). Optional for back-compat with stored
// plants; consumers fall back to `shortSide` when absent.
export interface LiefBlock extends SharedLiefBlock {
  labelSize?: number;
}

export interface MeristemBlock extends SharedMeristemBlock {
  labelSize?: number;
}

// New: GrowthBlock
export type GrowthBlockSubtype =
  | "fwd-tangent"
  | "bwd-tangent"
  | "child-axis"
  | "meristem-in"
  | "meristem-out";

export interface GrowthBlock extends BlockBase {
  kind: "growthBlock";
  subtype: GrowthBlockSubtype;
  /** The BN owning this block (for fwd/bwd/child-axis), or the Meristem
   * (for meristem-in/out). Pointer for downstream consumers; not used by
   * placement. */
  ownerBlockId: BlockId;
  /** Inherited from owner BN; absent for meristem-* subtypes. */
  side?: "left" | "right";
}

export type Block = LiefBlock | SpacerBlock | BranchNodeBlock | MeristemBlock | GrowthBlock;

/** Library Branch — identical shape to original `Branch`; redeclared here
 * because `Branch.blockIds` references our `Block` union, but the field is
 * `BlockId[]` so the type re-export from src/types.ts is structurally fine.
 * Kept as a re-export rather than a fork. */
export type { Branch } from "../types.ts";

// Library Plant — drops `rings` field
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
  branches: import("../types.ts").Branch[];
  blocks: Block[];
  bounds: Bounds;
  stencils?: StencilLibrary;
}

// Library EngineConfig — `clearance` section remapped
export interface EngineConfig {
  sizing: {
    baseSize: number;
    childScale: number;
    phiOrder: number;
    spacerRatio: number;
    liefTaper: number;
    /** Global multiplier on every baked label size. 1 = today's sizes.
     *  Optional for back-compat with stored configs; treated as 1 when absent. */
    textScale?: number;
    /** Shapes the label-size spread across depth: an exponent on the existing
     *  size curve around the `baseSize` pivot. >1 steepens (bigger gap between
     *  shallow and deep labels), <1 flattens toward uniform, 1 = today's curve.
     *  Optional for back-compat with stored configs; treated as 1 when absent. */
    textContrast?: number;
    /** Scales every non-meristem block's shortSide in this branch's subtree
     *  (lief, spacer, branchNode, growthBlock) — the meristem keeps full
     *  size. 0 = arc shrinks to ~meristem-size (a short stub, tip intact),
     *  1 = full size. Cascades to descendants via effectiveConfig
     *  inheritance. Optional for back-compat with stored configs; treated
     *  as 1 when absent — a default-off knob for the live-sweep unfurl
     *  driver. */
    growthFactor?: number;
  };
  angles: {
    angleMode: "phi-sequence" | "fixed";
    firstBranchAngle: number;
    /** Scales this branch's direct children's departure angles: 0 = children
     *  fold flat against the parent stem, 1 = natural fan. Applies at every
     *  depth (root or inner parent) via per-branch overrides. Optional for
     *  back-compat with stored configs; treated as 1 when absent — a
     *  default-off knob for the live-sweep unfurl driver. */
    foldFactor?: number;
    angleDecay: number;
    /** Floor (degrees) under every departure angle — sibling decay AND the
     *  depth seed (|parent| × decay) stop here instead of collapsing toward
     *  0°. Lets a fan decay without flattening onto its parent. Optional for
     *  back-compat with stored configs; treated as 0 (no floor) when absent. */
    minBranchAngle?: number;
    alternateBranches: boolean;
    alternateLiefs: boolean;
    /** When true (default), each branch departs on the OPPOSITE side from its
     *  parent — the "curl-back" rule — giving a balanced fan. Set false to let
     *  every branch turn the same way, so a single-branch chain coils into a
     *  logarithmic spiral (e.g. the logo). Optional for back-compat with stored
     *  configs; treated as true when absent. */
    curlBack?: boolean;
    /** Suppress alternation for branches whose parent depth is below this
     *  value (root/stem = 0). All such children land on the positive side,
     *  ignoring both alternation and the curl-back flipFirst rule, so the
     *  stem and any forced upper levels render as a one-sided fan.
     *  0 = no suppression (current default). 1 = only stem's children
     *  one-sided. 2 = stem + depth-1's children one-sided. Etc. */
    nonAlternatingDepth: number;
    /** Angle of the root/trunk in degrees. 90 = straight up (default,
     *  conventional), 0 = pointing right, -90 = straight down, 180/-180 =
     *  pointing left. Independent of firstBranchAngle (which controls how
     *  children fan from any branch). Used to tilt the entire plant. */
    rootOrientationAngle: number;
    /** Only meaningful in spiral mode (`curlBack: false`). When true, the
     *  spiral handedness is mirrored by the side of the stem each bough sits
     *  on — left-side lineages coil opposite to right-side lineages, giving a
     *  bilaterally symmetric tree. When false (default), spiral handedness is
     *  global (every lineage coils the same way — legacy behaviour). No effect
     *  when curlBack is true (curl-back fans already mirror by parent side).
     *  Optional for back-compat with stored configs; treated as false absent. */
    mirrorCurl?: boolean;
    /** With `mirrorCurl` on, selects whether a mirrored pair coils AWAY from
     *  the stem (true, default) or TOWARD it (false). No effect unless
     *  mirrorCurl is on. Optional for back-compat; treated as true when absent. */
    curlOutward?: boolean;
  };
  clearance: {
    branchBuffer: number;
    expansionEpsilonRatio: number;
    childAxisGrowthBlockFactor: number;
    meristemInFactor: number;
    meristemOutFactor: number;
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
