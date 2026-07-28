import type {
  Anchor, Block, Branch, BranchId, BlockId, EngineConfig, HierarchyId,
  HierarchyInput, HierarchyNode, PerBranchOverride, SortKey,
  BranchNodeBlock, LiefBlock, MeristemBlock,
} from "../types.ts";

export interface StructureOutput {
  anchor: Anchor;
  stemBranchId: BranchId;
  branches: Branch[];
  blocks: Block[];
  /** Cached effective per-branch config (merged defaults + overrides). */
  effectiveConfig: Map<BranchId, EngineConfig>;
  /** Map of HierarchyId → home branch, for the ring pass (lief nodes only). */
  liefHome: Map<HierarchyId, BranchId>;
  /** Map of BranchId → ancestor BranchNode BlockId chain (root-first). */
  ancestorBranchNodes: Map<BranchId, BlockId[]>;
  /** Map of BranchId → ancestor Branch chain (root-first, excluding self). */
  ancestorBranches: Map<BranchId, BranchId[]>;
}

let _bid = 0;
let _brid = 0;
const newBlockId = (): BlockId => `blk_${_bid++}`;
const newBranchId = (): BranchId => `br_${_brid++}`;
const resetIds = (): void => { _bid = 0; _brid = 0; };

/** Merge PerBranchOverride on top of an EngineConfig. Later wins. */
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
  return next;
}

function resolveEffectiveConfig(
  baseConfig: EngineConfig,
  node: HierarchyNode,
): EngineConfig {
  const fromConfig = baseConfig.overrides?.[node.id];
  const fromInline = node._engine;
  if (!fromConfig && !fromInline) return baseConfig;
  const afterConfig = applyOverride(baseConfig, fromConfig);
  return applyOverride(afterConfig, fromInline);
}

// Returns children in CHAIN ORDER (base → meristem). The meristem is at the
// end of the chain (highest index); "newest-first" therefore means oldest at
// the base and newest adjacent to the meristem — mirroring real plant growth,
// where new tissue emerges at the tip and pushes older tissue outward.
function sortChildren(
  children: HierarchyNode[],
  key: SortKey,
  liefsLast: boolean,
): HierarchyNode[] {
  const arr = [...children];
  if (typeof key === "function") arr.sort(key);
  else switch (key) {
    case "newest-first":
      // Ascending createdAt → oldest at base, newest closest to meristem.
      arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      break;
    case "oldest-first":
      // Descending createdAt → newest at base, oldest closest to meristem.
      arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      break;
    case "alphabetical":
      // Z at base, A closest to meristem.
      arr.sort((a, b) => b.name.localeCompare(a.name));
      break;
  }
  if (liefsLast) {
    // Stable secondary sort — Array.prototype.sort is stable in modern JS.
    arr.sort((a, b) => {
      const aLief = (a.children?.length ?? 0) === 0 ? 1 : 0;
      const bLief = (b.children?.length ?? 0) === 0 ? 1 : 0;
      return aLief - bLief;
    });
  }
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

  // Builds a branch whose tip meristem represents `ownerNode` (the hierarchy
  // node whose children live on this branch — the stem's owner is input.root,
  // a subfolder's owner is the promoted hierarchy node).
  const buildBranch = (
    ownerNode: HierarchyNode,
    parentBranchId: BranchId | null,
    parentBranchNodeId: BlockId | null,
    depth: number,
    ancestorBranchIds: BranchId[],
    ancestorBranchNodeIds: BlockId[],
    parentConfig: EngineConfig,
  ): BranchId => {
    const effectiveForThisBranch = resolveEffectiveConfig(parentConfig, ownerNode);

    const branch: Branch = {
      id: newBranchId(),
      parentBranchId,
      parentBranchNodeId,
      depth,
      shortSide: 0,
      departureAngle: 0,
      blockIds: [],
      curve: { type: effectiveForThisBranch.curve.curveType, arcLength: 0, originAngle: 0 },
      arcLength: 0,
      bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    };
    branches.push(branch);
    effectiveConfig.set(branch.id, effectiveForThisBranch);
    ancestorBranches.set(branch.id, ancestorBranchIds);
    ancestorBranchNodes.set(branch.id, ancestorBranchNodeIds);

    const sortedChildren = sortChildren(
      ownerNode.children ?? [],
      effectiveForThisBranch.sort.default,
      effectiveForThisBranch.sort.liefsLast ?? false,
    );

    let sideFlip = false;
    const alt = effectiveForThisBranch.angles.alternateLiefs;

    for (const child of sortedChildren) {
      const spacerId = newBlockId();
      blocks.push({
        id: spacerId, branchId: branch.id, index: branch.blockIds.length,
        shortSide: 0, arcPosition: 0,
        position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
        kind: "spacer", role: "standard",
      });
      branch.blockIds.push(spacerId);

      const hasChildren = (child.children?.length ?? 0) > 0;
      const side: "left" | "right" = alt && sideFlip ? "right" : "left";
      sideFlip = !sideFlip;

      if (hasChildren) {
        // Promotion: structural-only BranchNode on this chain; child's
        // identity travels down onto the child branch's tip meristem.
        const bnId = newBlockId();
        const bnBlock: BranchNodeBlock = {
          id: bnId, branchId: branch.id, index: branch.blockIds.length,
          shortSide: 0, arcPosition: 0,
          position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
          kind: "branchNode", childBranchId: "", side,
        };
        blocks.push(bnBlock);
        branch.blockIds.push(bnId);

        const childBranchId = buildBranch(
          child, branch.id, bnId, depth + 1,
          [...ancestorBranchIds, branch.id],
          [...ancestorBranchNodeIds, bnId],
          effectiveForThisBranch,
        );
        bnBlock.childBranchId = childBranchId;
      } else {
        const liefId = newBlockId();
        const lief: LiefBlock = {
          id: liefId, branchId: branch.id, index: branch.blockIds.length,
          shortSide: 0, arcPosition: 0,
          position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
          kind: "lief", hierarchyId: child.id, name: child.name,
          ...(child.summary !== undefined ? { summary: child.summary } : {}),
          ...(child.stencilId !== undefined ? { stencilId: child.stencilId } : {}),
          side,
        };
        blocks.push(lief);
        branch.blockIds.push(liefId);
        liefHome.set(child.id, branch.id);
      }
    }

    // Spacers immediately before the meristem — gives the tip breathing room
    // on the curve, so the identity block isn't jammed up against the last
    // content block.
    const pushSpacer = (): void => {
      const sid = newBlockId();
      blocks.push({
        id: sid, branchId: branch.id, index: branch.blockIds.length,
        shortSide: 0, arcPosition: 0,
        position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
        kind: "spacer", role: "standard",
      });
      branch.blockIds.push(sid);
    };
    const meristemLeadIn = Math.max(
      0, Math.floor(effectiveForThisBranch.clearance.meristemLeadInSpacers),
    );
    for (let i = 0; i < meristemLeadIn; i++) pushSpacer();

    // Tip meristem — carries the owner node's identity. For the stem this is
    // input.root (the Root Meristem); for a non-root branch this is the
    // promoted hierarchy node whose children populate the branch.
    const mId = newBlockId();
    const meristem: MeristemBlock = {
      id: mId, branchId: branch.id, index: branch.blockIds.length,
      shortSide: 0, arcPosition: 0,
      position: { x: 0, y: 0 }, tangent: 0, rotation: 0,
      kind: "meristem", hierarchyId: ownerNode.id, name: ownerNode.name,
      ...(ownerNode.summary !== undefined ? { summary: ownerNode.summary } : {}),
      ...(ownerNode.stencilId !== undefined ? { stencilId: ownerNode.stencilId } : {}),
    };
    blocks.push(meristem);
    branch.blockIds.push(mId);

    // Trailing spacers past the meristem — extend the branch's arcLength so
    // the curve (especially a bough spiral) has room to unfold beyond the tip.
    // The meristem stays where it is; these spacers simply occupy arc space.
    const meristemTrailing = Math.max(
      0, Math.floor(effectiveForThisBranch.clearance.meristemTrailingSpacers),
    );
    for (let i = 0; i < meristemTrailing; i++) pushSpacer();

    return branch.id;
  };

  // Stem: single root branch, tip meristem is the Root Meristem.
  const stemBranchId = buildBranch(input.root, null, null, 0, [], [], config);

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
