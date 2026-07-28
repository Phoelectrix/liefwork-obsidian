import type { HierarchyInput, HierarchyNode } from "./types.ts";

export interface ValidationIssue { hierarchyId?: string; message: string; }
export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateHierarchy(input: HierarchyInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  const walk = (node: HierarchyNode): void => {
    if (seenIds.has(node.id)) {
      errors.push({ hierarchyId: node.id, message: `duplicate node id: ${node.id}` });
    } else {
      seenIds.add(node.id);
    }
    const hasChildren = (node.children?.length ?? 0) > 0;
    if (typeof node.name !== "string") {
      errors.push({ hierarchyId: node.id, message: `name must be a string` });
    } else if (hasChildren && node.name.length > 200) {
      // Length cap applies to MERISTEMS only — their names are path/breadcrumb
      // components, so they must stay short. Liefs are terminal content whose
      // text adaptively sizes to fit its golden-rectangle container (LiefView),
      // so lief names are uncapped.
      errors.push({
        hierarchyId: node.id,
        message: `meristem name exceeds 200 chars (got ${node.name.length})`,
      });
    }
    if (node.summary !== undefined && node.summary.length > 200) {
      errors.push({
        hierarchyId: node.id,
        message: `summary exceeds 200 chars (got ${node.summary.length})`,
      });
    }
    if (node._engine && !hasChildren) {
      warnings.push({
        hierarchyId: node.id,
        message: `_engine applied to terminal lief — ignored`,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(input.root);
  return { errors, warnings };
}
