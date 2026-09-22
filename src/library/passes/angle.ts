import type { Branch, EngineConfig } from "../types.ts";
import type { StructureOutput } from "./structure.ts";
import { siblingAngles } from "../../math/phi.ts";

export function anglePass(s: StructureOutput, config: EngineConfig): StructureOutput {
  const mode = config.angles.angleMode;
  const alt = config.angles.alternateBranches;
  const decay = config.angles.angleDecay;
  // Backward-compat: older stored configs may not have these fields.
  const nonAltDepth = config.angles.nonAlternatingDepth ?? 0;
  // Curl-back (default on) flips each branch to the opposite side from its
  // parent. Off → every branch turns the same way, so a single-branch chain
  // coils into a logarithmic spiral.
  const curlBack = config.angles.curlBack ?? true;
  // In spiral mode (curlBack off), mirrorCurl keys the coil handedness off the
  // side of the stem each bough sits on, so left/right lineages spiral as
  // mirror images (bilaterally symmetric tree). curlOutward picks whether a
  // mirrored pair coils away from the stem (default) or toward it.
  const mirrorCurl = config.angles.mirrorCurl ?? false;
  const curlOutward = config.angles.curlOutward ?? true;

  // Each branch's children are assigned angles via a per-side decay seeded by
  // that branch's `firstBranchAngle` (config default or per-branch override).
  // Deeper levels shrink their own seed to |parent.departureAngle| × decay so
  // the tree stays angularly bounded under phi-sequence mode.
  const assignChildAngles = (parent: Branch, parentDepth: number, children: Branch[], lineageSign: number): void => {
    if (children.length === 0) return;

    const parentEffective = s.effectiveConfig.get(parent.id) ?? config;
    const isRoot = parent.parentBranchId === null;
    // minBranchAngle floors the depth seed here and the sibling sequence below,
    // so no branch anywhere departs shallower than the floor (0 = off).
    const minDeg = parentEffective.angles.minBranchAngle ?? 0;
    const seedDeg = isRoot
      ? parentEffective.angles.firstBranchAngle
      : Math.max((Math.abs(parent.departureAngle) * 180) / Math.PI * decay, Math.min(minDeg, parentEffective.angles.firstBranchAngle));

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
    // Curl-back mode keys the flip off the parent's side (existing fan rule).
    // Spiral mode normally never flips (global handedness); with mirrorCurl on,
    // it flips by the lineage's stem-side so left/right boughs coil as mirror
    // images, and curlOutward chooses the global sense (away vs toward stem).
    // The stem's own children (lineageSign 0) are left to the natural fan.
    const flipFirst = curlBack
      ? parent.departureAngle > 0
      : mirrorCurl && lineageSign !== 0
        ? (lineageSign < 0) === curlOutward
        : false;

    let anglesDeg: number[];
    if (mode === "fixed") {
      const f = parentEffective.angles.firstBranchAngle;
      const sign0 = flipFirst ? -1 : 1;
      anglesDeg = children.map((_, i) =>
        altEff ? (i % 2 === 0 ? sign0 * f : -sign0 * f) : sign0 * f,
      );
    } else {
      anglesDeg = siblingAngles(children.length, seedDeg, altEff, decay, flipFirst, minDeg);
    }

    // foldFactor scales this parent's children's departure angles: 0 = fold
    // flat against the parent stem, 1 (default, absent) = natural fan. Reads
    // from parentEffective so per-branch overrides fold a single node's fan
    // at any depth (this closure runs for both root and inner parents via
    // the visitChildren recursion below).
    const fold = parentEffective.angles.foldFactor ?? 1;
    for (let i = 0; i < children.length; i++) {
      children[i]!.departureAngle = (anglesDeg[i]! * fold * Math.PI) / 180;
    }
  };

  const blockById = new Map(s.blocks.map((b) => [b.id, b]));
  const branchById = new Map(s.branches.map((b) => [b.id, b]));

  // Stem: departureAngle 0 (aligned with the anchor's orientationAngle).
  const stem = branchById.get(s.stemBranchId)!;
  stem.departureAngle = 0;

  // lineageSign = which side of the stem this branch's bough departed on
  // (+1 right, -1 left, 0 = stem itself). Fixed at depth 1 and inherited down,
  // so a whole lineage shares one coil handedness under mirrorCurl.
  const visitChildren = (parent: Branch, depth: number, lineageSign: number): void => {
    const childBranches: Branch[] = [];
    for (const blockId of parent.blockIds) {
      const block = blockById.get(blockId);
      if (block && block.kind === "branchNode") {
        const child = branchById.get(block.childBranchId);
        if (child) childBranches.push(child);
      }
    }
    assignChildAngles(parent, depth, childBranches, lineageSign);
    for (const c of childBranches) {
      const childLineage = depth === 0 ? Math.sign(c.departureAngle) : lineageSign;
      visitChildren(c, depth + 1, childLineage);
    }
  };

  visitChildren(stem, 0, 0);

  return s;
}
