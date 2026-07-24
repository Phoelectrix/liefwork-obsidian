import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir; // obsidian-plugin/test
describe("root release files mirror the plugin's", () => {
  test("manifest.json", () => {
    const plugin = JSON.parse(readFileSync(join(here, "../manifest.json"), "utf8"));
    const root = JSON.parse(readFileSync(join(here, "../../manifest.json"), "utf8"));
    expect(root).toEqual(plugin);
  });
  test("versions.json", () => {
    const plugin = JSON.parse(readFileSync(join(here, "../versions.json"), "utf8"));
    const root = JSON.parse(readFileSync(join(here, "../../versions.json"), "utf8"));
    expect(root).toEqual(plugin);
  });
});
