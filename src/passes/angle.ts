import type { Branch, EngineConfig } from "../types.ts";
import type { StructureOutput } from "./structure.ts";
import { siblingAngles } from "../math/phi.ts";

export function anglePass(s: StructureOutput, config: EngineConfig): StructureOutput {
  const mode = config.angles.angleMode;
  const alt = config.angles.alternateBranches;
  const decay = config.angles.angleDecay;
  // Backward-compat: older stored configs may not have this field.
  const nonAltDepth = config.angles.nonAlternatingDepth ?? 0;

  // Each branch's children are assigned angles via a per-side decay seeded by
  // that branch's `firstBranchAngle` (config default or per-branch override).
  // Deeper levels shrink their own seed to |parent.departureAngle| × decay so
  // the tree stays angularly bounded under phi-sequence mode.
  const assignChildAngles = (parent: Branch, parentDepth: number, children: Branch[]): void => {
    if (children.length === 0) return;

    const parentEffective = s.effectiveConfig.get(parent.id) ?? config;
    const isRoot = parent.parentBranchId === null;
    const seedDeg = isRoot
      ? parentEffective.angles.firstBranchAngle
      : (Math.abs(parent.departureAngle) * 180) / Math.PI * decay;

    // Side-aware first child: if the parent itself departed on the positive
    // side, its first child lands on the negative side (and vice versa). This
    // prevents the systematic curl-back where every first child turns the same
    // way as its parent and grandchildren compound back toward the grandparent
    // chain. Stem (departureAngle == 0) keeps the legacy positive-first order.
    //
    // When this parent's depth falls inside the `nonAlternatingDepth` band,
    // alternation is suppressed (all children on the same side). The natural
    // flipFirst curl-back rule is preserved at every depth — so the stem's
    // children all go right (stem.departureAngle=0 → no flip), then each
    // depth-1 branch's children flip back to the other side (curl-back),
    // unfolding the plant as a self-similar fan rather than a one-direction
    // straight cascade.
    const oneSided = parentDepth < nonAltDepth;
    const altEff = oneSided ? false : alt;
    const flipFirst = parent.departureAngle > 0;

    let anglesDeg: number[];
    if (mode === "fixed") {
      const f = parentEffective.angles.firstBranchAngle;
      const sign0 = flipFirst ? -1 : 1;
      anglesDeg = children.map((_, i) =>
        altEff ? (i % 2 === 0 ? sign0 * f : -sign0 * f) : sign0 * f,
      );
    } else {
      anglesDeg = siblingAngles(children.length, seedDeg, altEff, decay, flipFirst);
    }

    for (let i = 0; i < children.length; i++) {
      children[i]!.departureAngle = (anglesDeg[i]! * Math.PI) / 180;
    }
  };

  const blockById = new Map(s.blocks.map((b) => [b.id, b]));
  const branchById = new Map(s.branches.map((b) => [b.id, b]));

  // Stem: departureAngle 0 (aligned with the anchor's orientationAngle).
  const stem = branchById.get(s.stemBranchId)!;
  stem.departureAngle = 0;

  const visitChildren = (parent: Branch, depth: number): void => {
    const childBranches: Branch[] = [];
    for (const blockId of parent.blockIds) {
      const block = blockById.get(blockId);
      if (block && block.kind === "branchNode") {
        const child = branchById.get(block.childBranchId);
        if (child) childBranches.push(child);
      }
    }
    assignChildAngles(parent, depth, childBranches);
    for (const c of childBranches) visitChildren(c, depth + 1);
  };

  visitChildren(stem, 0);

  return s;
}
