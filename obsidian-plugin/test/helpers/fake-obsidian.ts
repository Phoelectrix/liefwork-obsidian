// Shared "obsidian" module mock for tests.
//
// bun:test's `mock.module(specifier, factory)` registers a specifier's mock
// ONCE per process: the first call for "obsidian" to actually run wins, and
// later `mock.module("obsidian", ...)` calls from OTHER test files are
// effectively no-ops for the rest of the run (this holds even across files —
// bun evaluates every test file's top-level module code, interleaved via the
// `await import(...)` idiom below, before any of those imports resolve). So
// every test file that mocks "obsidian" with a DIFFERENT shape is a landmine:
// whichever file's registration happens to land first decides what every
// other file's `import ... from "obsidian"` sees — including named exports
// that file never itself needed. A consumer statically importing a name the
// winning mock lacks (e.g. `import { TFile } from "obsidian"`) fails with a
// "Export named 'X' not found" SyntaxError, regardless of which test file
// triggered the load.
//
// Fix: one shared mock shape + one shared set of fake classes, imported by
// every file that needs to stub "obsidian". Whichever registration wins, it's
// the same classes — so `instanceof` checks inside the modules under test
// stay correct no matter the load order.

export class FakeNotice {
  constructor(public msg: string) {}
}

export class FakeModal {
  app: unknown;
  constructor(app: unknown) {
    this.app = app;
  }
}

export class FakeSetting {
  constructor(_: unknown) {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText() {
    return this;
  }
  addTextArea() {
    return this;
  }
  addToggle() {
    return this;
  }
  addButton() {
    return this;
  }
}

export class FakeTFolder {
  name: string;
  path: string;
  children: unknown[];
  parent: FakeTFolder | null;
  constructor(name = "", children: unknown[] = [], path?: string, parent: FakeTFolder | null = null) {
    this.name = name;
    this.path = path ?? name;
    this.children = children;
    this.parent = parent;
  }
}

export class FakeTFile {
  name: string; // full basename incl. extension, as the real obsidian TFile.name is
  basename: string;
  extension: string;
  path: string;
  stat = { ctime: 0, mtime: 0 };
  constructor(name = "", path?: string) {
    this.name = name;
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      this.basename = name.slice(0, dot);
      this.extension = name.slice(dot + 1);
    } else {
      this.basename = name;
      this.extension = "";
    }
    this.path = path ?? name;
  }
}

/** No fake vault adapter in this suite is ever an instance of this — good
 *  enough to make `instanceof FileSystemAdapter` checks resolve to `false`
 *  cleanly rather than throw. */
export class FakeFileSystemAdapter {}

/** The full mock shape for `mock.module("obsidian", fakeObsidianModule)` —
 *  a superset covering every export any test file currently needs. */
export function fakeObsidianModule() {
  return {
    Notice: FakeNotice,
    Modal: FakeModal,
    Setting: FakeSetting,
    TFolder: FakeTFolder,
    TFile: FakeTFile,
    FileSystemAdapter: FakeFileSystemAdapter,
  };
}
