import type {
  Anchor, Block, BlockId, Branch, BranchId, BranchNodeBlock, EngineConfig,
  GrowthBlock, GrowthBlockSubtype, HierarchyId, HierarchyInput, HierarchyNode,
  LiefBlock, MeristemBlock, PerBranchOverride, SortKey,
} from "../types.ts";

export interface StructureOutput {
  anchor: Anchor;
  stemBranchId: BranchId;
  branches: Branch[];
  blocks: Block[];
  effectiveConfig: Map<BranchId, EngineConfig>;
  liefHome: Map<HierarchyId, BranchId>;
  ancestorBranchNodes: Map<BranchId, BlockId[]>;
  ancestorBranches: Map<BranchId, BranchId[]>;
}

let _bid = 0;
let _brid = 0;
const newBlockId = (): BlockId => `blk_${_bid++}`;
const newBranchId = (): BranchId => `br_${_brid++}`;
const resetIds = (): void => { _bid = 0; _brid = 0; };

function applyOverride(
  base: EngineConfig, override: PerBranchOverride | undefined,
): EngineConfig {
  if (!override) return base;
  const next: EngineConfig = {
    ...base,
    curve: {
      ...base.curve,
      boughParams: { ...base.curve.boughParams, ...(override.bough ?? {}) },
    },
    sort: { ...base.sort, ...(override.sort ? { default: override.sort } : {}) },
  };
  if (override.curveType) next.curve.curveType = override.curveType;
  if (override.firstBranchAngle !== undefined) {
    next.angles = { ...next.angles, firstBranchAngle: override.firstBranchAngle };
  }
  if (override.foldFactor !== undefined) {
    next.angles = { ...next.angles, foldFactor: override.foldFactor };
  }
  if (override.growthFactor !== undefined) {
    next.sizing = { ...next.sizing, growthFactor: override.growthFactor };
  }
  return next;
}

function resolveEffectiveConfig(
  baseConfig: EngineConfig, node: HierarchyNode,
): EngineConfig {
  const fromConfig = baseConfig.overrides?.[node.id];
  const fromInline = node._engine;
  if (!fromConfig && !fromInline) return baseConfig;
  const afterConfig = applyOverride(baseConfig, fromConfig);
  return applyOverride(afterConfig, fromInline);
}

export function sortChildren(
  children: HierarchyNode[],
  key: SortKey,
  liefsLast: boolean,
): HierarchyNode[] {
  const arr = [...children];
  // Use the explicit `order` only when EVERY sibling carries it — a proper total
  // order that migrates cleanly: a half-migrated branch keeps its createdAt
  // ordering until all children have `order` (then flips), rather than jumbling.
  // Same orientation as the createdAt compare it replaces, so direction is unchanged.
  const useOrder = arr.length > 0 && arr.every((c) => c.order != null);
  // Deterministic tiebreakers so two siblings can NEVER resolve to the same
  // position — even if their `order` (or `createdAt`) collides. This is
  // mechanical: placement never depends on an agent stamping unique orders.
  // Colliding orders fall back to createdAt, then to the filesystem-unique
  // `name` as the guaranteed final disambiguator (no two siblings share a name).
  const byKey = (x: HierarchyNode, y: HierarchyNode): number => {
    if (useOrder) {
      const d = (x.order ?? 0) - (y.order ?? 0);
      if (d !== 0) return d;
    }
    const c = (x.createdAt ?? "").localeCompare(y.createdAt ?? "");
    if (c !== 0) return c;
    return x.name.localeCompare(y.name);
  };
  if (typeof key === "function") arr.sort(key);
  else switch (key) {
    case "newest-first":
      arr.sort((a, b) => byKey(a, b));
      break;
    case "oldest-first":
      arr.sort((a, b) => byKey(b, a));
      break;
    case "alphabetical":
      arr.sort((a, b) => b.name.localeCompare(a.name));
      break;
  }
  if (liefsLast) {
    // Stable secondary sort — Array.prototype.sort is stable in modern JS,
    // so returning 0 preserves the primary sort within the lief/non-lief
    // groupings.
    arr.sort((a, b) => {
      const aLief = (a.children?.length ?? 0) === 0 ? 1 : 0;
      const bLief = (b.children?.length ?? 0) === 0 ? 1 : 0;
      return aLief - bLief;
    });
  }
  // sortPin: "base" — a pinned child (a shown folder-note, §3) always sorts to
  // the branch BASE (index 0 → nearest the stem), ahead of every comparator
  // above INCLUDING liefsLast, regardless of sort direction. Applied as a
  // stable partition (NOT inside the byKey comparator) precisely so an
  // oldest-first branch, which reverses byKey, cannot flip the pin to the tip.
  // Stable → multiple pins keep their relative order.
  arr.sort((a, b) => {
    const aPin = a.sortPin === "base" ? 0 : 1;
    const bPin = b.sortPin === "base" ? 0 : 1;
    return aPin - bPin;
  });
  return arr;
}

export function structurePass(
  input: HierarchyInput, config: EngineConfig,
): StructureOutput {
  resetIds();
  const branches: Branch[] = [];
  const blocks: Block[] = [];
  const effectiveConfig = new Map<BranchId, EngineConfig>();
  const liefHome = new Map<HierarchyId, BranchId>();
  const ancestorBranchNodes = new Map<BranchId, BlockId[]>();
  const ancestorBranches = new Map<BranchId, BranchId[]>();

  const pushGB = (
    branchId: BranchId, blockIds: BlockId[],
    subtype: GrowthBlockSubtype, ownerBlockId: BlockId,
    side?: "left" | "right",
  ): GrowthBlock => {
    const id = newBlockId();
    const gb: GrowthBlock = {
      id, branchId, index: blockIds.length,
      shortSide: 0, arcPosition: 0,
      position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
      kind: "growthBlock",
      subtype,
      ownerBlockId,
      ...(side ? { side } : {}),
    };
    blocks.push(gb);
    blockIds.push(id);
    return gb;
  };

  const pushSpacer = (branchId: BranchId, blockIds: BlockId[]): void => {
    const id = newBlockId();
    blocks.push({
      id, branchId, index: blockIds.length,
      shortSide: 0, arcPosition: 0,
      position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
      kind: "spacer", role: "standard",
    });
    blockIds.push(id);
  };

  const buildBranch = (
    ownerNode: HierarchyNode,
    parentBranchId: BranchId | null,
    parentBranchNodeId: BlockId | null,
    depth: number,
    ancestorBranchIds: BranchId[],
    ancestorBranchNodeIds: BlockId[],
    parentConfig: EngineConfig,
  ): BranchId => {
    const eff = resolveEffectiveConfig(parentConfig, ownerNode);

    const branch: Branch = {
      id: newBranchId(),
      parentBranchId,
      parentBranchNodeId,
      depth,
      shortSide: 0,
      departureAngle: 0,
      blockIds: [],
      curve: { type: eff.curve.curveType, arcLength: 0, originAngle: 0 },
      arcLength: 0,
      bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      isArchive: ownerNode.isArchive ?? false,
    };
    branches.push(branch);
    effectiveConfig.set(branch.id, eff);
    ancestorBranches.set(branch.id, ancestorBranchIds);
    ancestorBranchNodes.set(branch.id, ancestorBranchNodeIds);

    // Non-stem chain: child-axis Growth Block at chain start.
    // Owner is the parent BN (parentBranchNodeId). Side inherited from parent BN.
    if (parentBranchNodeId !== null) {
      const parentBn = blocks.find((b) => b.id === parentBranchNodeId);
      const parentSide = (parentBn && parentBn.kind === "branchNode") ? parentBn.side : undefined;
      pushGB(branch.id, branch.blockIds, "child-axis", parentBranchNodeId, parentSide);
    }

    const sortedChildren = sortChildren(
      ownerNode.children ?? [],
      eff.sort.default,
      eff.sort.liefsLast ?? false,
    );

    let sideFlip = false;
    const alt = eff.angles.alternateLiefs;

    for (const child of sortedChildren) {
      // Kind: a node is a branch when it HAS children, or when a producer that
      // knows folder-vs-file (the plugin's vault adapter) explicitly flags it
      // via `isBranch` — so an empty folder renders as a branch (stem + meristem
      // tip), never a lief. Other producers omit the flag and keep the
      // children-only inference. (The root always takes the buildBranch path.)
      const isBranch = (child.children?.length ?? 0) > 0 || child.isBranch === true;
      const side: "left" | "right" = alt && sideFlip ? "right" : "left";
      sideFlip = !sideFlip;

      if (isBranch) {
        // BN slot: bwd-tangent-GB(B), B, fwd-tangent-GB(B). No preceding spacer.
        const bnId = newBlockId();
        const bnBlock: BranchNodeBlock = {
          id: bnId, branchId: branch.id, index: -1,
          shortSide: 0, arcPosition: 0,
          position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
          kind: "branchNode", childBranchId: "", side,
        };
        // bwd-tangent first (before BN)
        pushGB(branch.id, branch.blockIds, "bwd-tangent", bnId, side);
        // BN itself
        bnBlock.index = branch.blockIds.length;
        blocks.push(bnBlock);
        branch.blockIds.push(bnId);
        // fwd-tangent (after BN)
        pushGB(branch.id, branch.blockIds, "fwd-tangent", bnId, side);

        const childBranchId = buildBranch(
          child, branch.id, bnId, depth + 1,
          [...ancestorBranchIds, branch.id],
          [...ancestorBranchNodeIds, bnId],
          eff,
        );
        bnBlock.childBranchId = childBranchId;
      } else {
        // Lief slot: Spacer, Lief.
        pushSpacer(branch.id, branch.blockIds);
        const liefId = newBlockId();
        const lief: LiefBlock = {
          id: liefId, branchId: branch.id, index: branch.blockIds.length,
          shortSide: 0, arcPosition: 0,
          position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
          kind: "lief", hierarchyId: child.id, name: child.name,
          ...(child.summary !== undefined ? { summary: child.summary } : {}),
          ...(child.stencilId !== undefined ? { stencilId: child.stencilId } : {}),
          ...(child.nonMd === true ? { nonMd: true } : {}),
          side,
        };
        blocks.push(lief);
        branch.blockIds.push(liefId);
        liefHome.set(child.id, branch.id);
      }
    }

    // Tip: meristem-in-GB, meristem, meristem-out-GB.
    const meristemId = newBlockId();
    const meristem: MeristemBlock = {
      id: meristemId, branchId: branch.id, index: -1,  // index set below
      shortSide: 0, arcPosition: 0,
      position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
      kind: "meristem", hierarchyId: ownerNode.id, name: ownerNode.name,
      ...(ownerNode.summary !== undefined ? { summary: ownerNode.summary } : {}),
      ...(ownerNode.stencilId !== undefined ? { stencilId: ownerNode.stencilId } : {}),
    };
    pushGB(branch.id, branch.blockIds, "meristem-in", meristemId);
    meristem.index = branch.blockIds.length;
    blocks.push(meristem);
    branch.blockIds.push(meristemId);
    pushGB(branch.id, branch.blockIds, "meristem-out", meristemId);

    return branch.id;
  };

  const stemBranchId = buildBranch(input.root, null, null, 0, [], [], config);

  // rootOrientationAngle is in degrees: 90 = straight up (default), 0 = right,
  // -90 = down, 180 = left. Convert to engine's internal radian convention
  // where +Y is down and -π/2 points up.
  const rootDeg = config.angles.rootOrientationAngle ?? 90;
  const anchor: Anchor = {
    position: { x: 0, y: 0 },
    orientationAngle: -(rootDeg * Math.PI) / 180,
  };

  return {
    anchor, stemBranchId, branches, blocks, effectiveConfig, liefHome,
    ancestorBranchNodes, ancestorBranches,
  };
}
