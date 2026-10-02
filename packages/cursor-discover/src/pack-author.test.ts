import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPackPatch,
  assertPackName,
  listPackFiles,
  readPackFile,
  resolvePackFile,
  writePackFile,
} from "./pack-author.js";

describe("pack-author sandbox", () => {
  it("rejects path escape", () => {
    assert.throws(
      () =>
        resolvePackFile({
          repoRoot: "/repo",
          pack: "jira",
          relativePath: "../registry.ts",
        }),
      /\.\./,
    );
  });

  it("rejects invalid pack names", () => {
    assert.throws(() => assertPackName("../x"), /Invalid pack/);
    assert.throws(() => assertPackName("A"), /Invalid pack/);
  });

  it("reads and writes only inside pack root", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-author-"));
    const packDir = join(root, "packages", "site-adapter-jira", "src");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "note.txt"), "hello", "utf8");
    const read = readPackFile({
      repoRoot: root,
      pack: "jira",
      relativePath: "note.txt",
    });
    assert.equal(read.content, "hello");
    writePackFile({
      repoRoot: root,
      pack: "jira",
      relativePath: "formatters.ts",
      content: "export const x = 1;\n",
    });
    const files = listPackFiles({ repoRoot: root, pack: "jira" });
    assert.ok(files.includes("formatters.ts"));
    assert.ok(files.includes("note.txt"));
  });

  it("refuses overwrite without overwrite:true", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-author-"));
    const packDir = join(root, "packages", "site-adapter-jira", "src");
    mkdirSync(packDir, { recursive: true });
    writePackFile({
      repoRoot: root,
      pack: "jira",
      relativePath: "a.ts",
      content: "one\n",
    });
    assert.throws(
      () =>
        writePackFile({
          repoRoot: root,
          pack: "jira",
          relativePath: "a.ts",
          content: "two\n",
        }),
      /already exists/,
    );
    writePackFile({
      repoRoot: root,
      pack: "jira",
      relativePath: "a.ts",
      content: "two\n",
      overwrite: true,
    });
    assert.equal(
      readFileSync(join(packDir, "a.ts"), "utf8"),
      "two\n",
    );
  });

  it("applyPackPatch replaces unique oldString", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-author-"));
    const packDir = join(root, "packages", "site-adapter-jira", "src");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, "fmt.ts"),
      "const a = 1;\nconst b = 2;\n",
      "utf8",
    );
    const r = applyPackPatch({
      repoRoot: root,
      pack: "jira",
      relativePath: "fmt.ts",
      oldString: "const b = 2;",
      newString: "const b = 3;",
    });
    assert.equal(r.replacements, 1);
    assert.equal(
      readFileSync(join(packDir, "fmt.ts"), "utf8"),
      "const a = 1;\nconst b = 3;\n",
    );
  });

  it("applyPackPatch refuses ambiguous match without replaceAll", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-author-"));
    const packDir = join(root, "packages", "site-adapter-jira", "src");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "fmt.ts"), "xx\nxx\n", "utf8");
    assert.throws(
      () =>
        applyPackPatch({
          repoRoot: root,
          pack: "jira",
          relativePath: "fmt.ts",
          oldString: "xx",
          newString: "yy",
        }),
      /matched 2 times/,
    );
    const r = applyPackPatch({
      repoRoot: root,
      pack: "jira",
      relativePath: "fmt.ts",
      oldString: "xx",
      newString: "yy",
      replaceAll: true,
    });
    assert.equal(r.replacements, 2);
    assert.equal(readFileSync(join(packDir, "fmt.ts"), "utf8"), "yy\nyy\n");
  });

  it("applyPackPatch refuses missing oldString", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-author-"));
    const packDir = join(root, "packages", "site-adapter-jira", "src");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "fmt.ts"), "hello\n", "utf8");
    assert.throws(
      () =>
        applyPackPatch({
          repoRoot: root,
          pack: "jira",
          relativePath: "fmt.ts",
          oldString: "missing",
          newString: "x",
        }),
      /not found/,
    );
  });
});
