import { describe, test, expect } from "bun:test";
import {
  folderToHierarchy,
  countFolderNodes,
  depthLimitForCap,
  truncateAtDepth,
} from "../src/ingest/folder-to-hierarchy.ts";
import type { FolderNode } from "../src/ingest/folder-node.ts";

// 1 root + 2 folders at depth 1 + 4 notes at depth 2 = 7 nodes
const wideTree: FolderNode = {
  name: "root",
  path: "root",
  children: [
    { name: "a", path: "root/a", children: [
      { name: "a1", path: "root/a/a1.md" },
      { name: "a2", path: "root/a/a2.md" },
    ] },
    { name: "b", path: "root/b", children: [
      { name: "b1", path: "root/b/b1.md" },
      { name: "b2", path: "root/b/b2.md" },
    ] },
  ],
};

test("depthLimitForCap picks the deepest level that fits", () => {
  expect(depthLimitForCap(wideTree, 7)).toBe(2);  // whole tree fits
  expect(depthLimitForCap(wideTree, 6)).toBe(1);  // depth-2 notes overflow
  expect(depthLimitForCap(wideTree, 3)).toBe(1);  // root + 2 folders = 3
  expect(depthLimitForCap(wideTree, 2)).toBe(null); // even depth 1 overflows
});

test("truncateAtDepth collapses subtrees into (+N) leaves, keeps path identity", () => {
  const t = truncateAtDepth(wideTree, 1);
  expect(countFolderNodes(t)).toBe(3);
  const a = t.children![0]!;
  expect(a.name).toBe("a (+2)");
  expect(a.path).toBe("root/a"); // id stays the real folder path
  expect(a.children).toBeUndefined();
  // leaves and nodes above the limit pass through untouched
  expect(truncateAtDepth(wideTree, 5)).toEqual(wideTree);
});

test("countFolderNodes counts self + all descendants", () => {
  const root: FolderNode = {
    name: "memory",
    path: "memory",
    children: [
      { name: "a", path: "memory/a.md" },
      { name: "sub", path: "memory/sub", children: [
        { name: "b", path: "memory/sub/b.md", children: [
          { name: "H1", path: "memory/sub/b.md#0-H1" },
        ] },
      ] },
    ],
  };
  expect(countFolderNodes(root)).toBe(5);
  expect(countFolderNodes({ name: "leaf", path: "x.md" })).toBe(1);
});

test("single empty folder → root with no children", () => {
  const root: FolderNode = { name: "memory", path: "memory", children: [] };
  const input = folderToHierarchy(root);
  expect(input.root.id).toBe("memory");
  expect(input.root.name).toBe("memory");
  expect(input.root.children).toBeUndefined();
});

test("folder with two notes → two leaf children, ids = paths", () => {
  const root: FolderNode = {
    name: "memory",
    path: "memory",
    children: [
      { name: "alpha", path: "memory/alpha.md", createdAt: "2026-01-01T00:00:00.000Z" },
      { name: "beta", path: "memory/beta.md", createdAt: "2026-01-02T00:00:00.000Z" },
    ],
  };
  const input = folderToHierarchy(root);
  expect(input.root.children?.length).toBe(2);
  const [a, b] = input.root.children!;
  expect(a!.id).toBe("memory/alpha.md");
  expect(a!.name).toBe("alpha");
  expect(a!.createdAt).toBe("2026-01-01T00:00:00.000Z");
  expect(a!.children).toBeUndefined();
  expect(b!.id).toBe("memory/beta.md");
});

test("nested folders → nested branches", () => {
  const root: FolderNode = {
    name: "memory",
    path: "memory",
    children: [
      { name: "sub", path: "memory/sub", children: [
        { name: "deep", path: "memory/sub/deep.md" },
      ] },
    ],
  };
  const input = folderToHierarchy(root);
  const sub = input.root.children![0]!;
  expect(sub.id).toBe("memory/sub");
  expect(sub.children?.length).toBe(1);
  expect(sub.children![0]!.id).toBe("memory/sub/deep.md");
});

test("note with headings → heading children", () => {
  const root: FolderNode = {
    name: "memory",
    path: "memory",
    children: [
      { name: "note", path: "memory/note.md", createdAt: "2026-01-01T00:00:00.000Z", children: [
        { name: "First", path: "memory/note.md#0-First", createdAt: "2026-01-01T00:00:00.000Z" },
        { name: "Second", path: "memory/note.md#1-Second", createdAt: "2026-01-01T00:00:00.000Z" },
      ] },
    ],
  };
  const input = folderToHierarchy(root);
  const note = input.root.children![0]!;
  expect(note.children?.length).toBe(2);
  expect(note.children![0]!.id).toBe("memory/note.md#0-First");
  expect(note.children![0]!.name).toBe("First");
});

test("folder-note (file named like its folder) is excluded from children — it is the meristem MD", () => {
  const tree: FolderNode = {
    name: "Topic",
    path: "Topic",
    children: [
      { name: "Topic", path: "Topic/Topic.md" }, // folder-note → meristem MD, not a lief
      { name: "a note", path: "Topic/a note.md" }, // real lief
      { name: "Sub", path: "Topic/Sub", children: [{ name: "x", path: "Topic/Sub/x.md" }] },
    ],
  };
  const names = (folderToHierarchy(tree).root.children ?? []).map((c) => c.name);
  expect(names).toEqual(["a note", "Sub"]); // "Topic" folder-note excluded
});

test("a same-named SUBFOLDER is NOT excluded (only .md files are folder-notes)", () => {
  const tree: FolderNode = {
    name: "Topic",
    path: "Topic",
    children: [{ name: "Topic", path: "Topic/Topic", children: [] }], // folder, not a note
  };
  const names = (folderToHierarchy(tree).root.children ?? []).map((c) => c.name);
  expect(names).toEqual(["Topic"]);
});

test("an isArchive branch carries the flag and collapses its entries to one node each", () => {
  const archive: FolderNode = {
    name: "_archive", path: "P/_archive", isArchive: true,
    children: [
      { name: "_archive", path: "P/_archive/_archive.md" },               // folder-note (excluded)
      { name: "old-note", path: "P/_archive/old-note.md", order: 10 },
      { name: "old-sub", path: "P/_archive/old-sub", order: 20, children: [
        { name: "old-sub", path: "P/_archive/old-sub/old-sub.md" },
        { name: "buried", path: "P/_archive/old-sub/buried.md" },
      ]},
    ],
  };
  const h = folderToHierarchy({ name: "P", path: "P", children: [archive] });
  const arc = h.root.children!.find((c) => c.id === "P/_archive")!;
  expect(arc.isArchive).toBe(true);
  expect(arc.children!.map((c) => c.id)).toEqual(["P/_archive/old-note.md", "P/_archive/old-sub"]);
  // the subtree entry is collapsed — no grandchildren in the main layout
  expect(arc.children!.find((c) => c.id === "P/_archive/old-sub")!.children).toBeUndefined();
});

describe("folderToHierarchy — isBranch propagation", () => {
  test("an empty folder (isBranch, no children) → HierarchyNode with isBranch true", () => {
    const root: FolderNode = {
      name: "root", path: "/", isBranch: true,
      children: [{ name: "EmptyFolder", path: "EmptyFolder", isBranch: true }],
    };
    const { root: hn } = folderToHierarchy(root);
    const empty = hn.children!.find((c) => c.id === "EmptyFolder")!;
    expect(empty.isBranch).toBe(true);
    expect(empty.children).toBeUndefined();
  });

  test("a note (no isBranch) → HierarchyNode without isBranch", () => {
    const root: FolderNode = {
      name: "root", path: "/", isBranch: true,
      children: [{ name: "note", path: "note.md" }],
    };
    const { root: hn } = folderToHierarchy(root);
    const note = hn.children!.find((c) => c.id === "note.md")!;
    expect(note.isBranch).toBeUndefined();
  });
});

describe("folderToHierarchy — meristem-note visibility (showMeristemNotes)", () => {
  const branchWithNote: FolderNode = {
    name: "root", path: "/", isBranch: true,
    children: [
      {
        name: "Work", path: "Work", isBranch: true,
        children: [
          { name: "Work", path: "Work/Work.md" },   // the folder-note (same name, .md)
          { name: "task", path: "Work/task.md", createdAt: "2026-06-05" },
        ],
      },
    ],
  };

  test("default (off): the folder-note is filtered out", () => {
    const { root } = folderToHierarchy(branchWithNote);
    const work = root.children!.find((c) => c.id === "Work")!;
    const ids = (work.children ?? []).map((c) => c.id);
    expect(ids).toContain("Work/task.md");
    expect(ids).not.toContain("Work/Work.md");
  });

  test("on: the folder-note joins as a lief pinned at the base (sortPin base)", () => {
    const { root } = folderToHierarchy(branchWithNote, { showMeristemNotes: true });
    const work = root.children!.find((c) => c.id === "Work")!;
    const note = (work.children ?? []).find((c) => c.id === "Work/Work.md");
    expect(note).toBeDefined();
    expect(note!.sortPin).toBe("base");
    // the ordinary lief is NOT pinned
    const task = (work.children ?? []).find((c) => c.id === "Work/task.md")!;
    expect(task.sortPin).toBeUndefined();
  });

  test("on: a folder whose ONLY child is its folder-note shows one pinned lief", () => {
    const onlyNote: FolderNode = {
      name: "root", path: "/", isBranch: true,
      children: [
        { name: "Solo", path: "Solo", isBranch: true, children: [{ name: "Solo", path: "Solo/Solo.md" }] },
      ],
    };
    const { root } = folderToHierarchy(onlyNote, { showMeristemNotes: true });
    const solo = root.children!.find((c) => c.id === "Solo")!;
    expect((solo.children ?? []).map((c) => c.id)).toEqual(["Solo/Solo.md"]);
    expect(solo.children![0].sortPin).toBe("base");
  });
});

describe("folderToHierarchy — nonMd propagation (colour-by-file-type)", () => {
  test("a FolderNode leaf marked nonMd → HierarchyNode lief with nonMd true", () => {
    const root: FolderNode = {
      name: "root", path: "/", isBranch: true,
      children: [
        { name: "note", path: "note.md" },
        { name: "pic.png", path: "pic.png", nonMd: true },
      ],
    };
    const { root: hn } = folderToHierarchy(root);
    const pic = hn.children!.find((c) => c.id === "pic.png")!;
    const note = hn.children!.find((c) => c.id === "note.md")!;
    expect(pic.nonMd).toBe(true);
    expect(note.nonMd).toBeUndefined();
  });
});
