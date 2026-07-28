import type { HierarchyInput } from "../../src/types.ts";

const act = (prefix: string, n: number): any => ({
  id: `${prefix}-act${n}`,
  name: `Act ${n}`,
  createdAt: `2026-04-20T10:00:${String(n).padStart(2, "0")}Z`,
  children: [
    { id: `${prefix}-act${n}-sc1`, name: "Scene 1", createdAt: `2026-04-20T10:00:${n}0Z` },
    { id: `${prefix}-act${n}-sc2`, name: "Scene 2", createdAt: `2026-04-20T10:00:${n}5Z` },
  ],
});

const play = (id: string, name: string): any => ({
  id, name, createdAt: "2026-04-20T10:00:00Z",
  children: [act(id, 1), act(id, 2), act(id, 3)],
});

export const shakespeareMini: HierarchyInput = {
  root: {
    id: "shk",
    name: "Shakespeare",
    children: [
      play("tempest", "The Tempest"),
      play("macbeth", "Macbeth"),
      play("hamlet", "Hamlet"),
    ],
  },
};
