import { nextAgentColor } from "./agent-colors.ts";

export type LaunchedVia = "integrated" | "external" | "manual";

export interface Binding {
  id: string;
  branchPath: string;
  color: string;
  /** WorkspaceLeaf at runtime; null/undefined when manual. */
  leaf: unknown;
  launchedVia: LaunchedVia;
}

/** Session-only, Obsidian-free store of live terminal↔branch color bindings.
 *  The single source of truth for all Coral Terminals rendering. */
export class BindingStore {
  private bindings: Binding[] = [];
  private counter = 0;
  private subs = new Set<() => void>();

  create(input: { branchPath: string; color?: string; leaf?: unknown; launchedVia: LaunchedVia }): Binding {
    const color = input.color ?? nextAgentColor(this.bindings.map((b) => b.color));
    const binding: Binding = {
      id: `b${++this.counter}`,
      branchPath: input.branchPath,
      color,
      leaf: input.leaf ?? null,
      launchedVia: input.launchedVia,
    };
    this.bindings.push(binding);
    this.emit();
    return binding;
  }

  endById(id: string): void {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter((b) => b.id !== id);
    if (this.bindings.length !== before) this.emit();
  }

  endByLeaf(leaf: unknown): void {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter((b) => b.leaf !== leaf);
    if (this.bindings.length !== before) this.emit();
  }

  all(): Binding[] {
    return [...this.bindings];
  }

  colorForBranch(branchPath: string): string | null {
    return this.bindings.find((b) => b.branchPath === branchPath)?.color ?? null;
  }

  colorByBranchPath(): Map<string, string> {
    const m = new Map<string, string>();
    for (const b of this.bindings) m.set(b.branchPath, b.color);
    return m;
  }

  /** All agent colors per branch, in bind order — for branches that have ≥1
   *  terminal. Multiple terminals on one branch keep all their colors (the
   *  branch tint shows them combined). */
  colorsByBranchPath(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const b of this.bindings) {
      const list = m.get(b.branchPath);
      if (list) list.push(b.color);
      else m.set(b.branchPath, [b.color]);
    }
    return m;
  }

  /** Every binding on a branch, in bind order (empty if none). */
  bindingsForBranch(branchPath: string): Binding[] {
    return this.bindings.filter((b) => b.branchPath === branchPath);
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit(): void {
    for (const cb of this.subs) cb();
  }
}
