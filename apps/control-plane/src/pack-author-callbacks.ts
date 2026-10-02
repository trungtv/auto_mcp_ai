import type { BrowserToolCallbacks, PublishToolResult } from "@auto-mcp/cursor-discover";
import {
  adapterIdToPack,
  applyPackPatch,
  listPackFiles,
  readPackFile,
  runPackTests,
  writePackFile,
} from "@auto-mcp/cursor-discover";
import { resolveAdapter } from "@auto-mcp/site-adapters";
import type { McpSite } from "@auto-mcp/shared";

function resolvePackName(
  site: McpSite,
  packArg: string | undefined,
): string {
  if (packArg && packArg.trim()) return packArg.trim();
  const fromAdapter = adapterIdToPack(resolveAdapter(site).id);
  if (fromAdapter) return fromAdapter;
  throw new Error(
    "No default pack for this site. Pass pack explicitly (e.g. pack:\"mysite\").",
  );
}

function testsPayload(tests: Awaited<ReturnType<typeof runPackTests>>) {
  return {
    ok: tests.ok,
    exitCode: tests.exitCode,
    command: tests.command,
    stdout: tests.stdout.slice(-6000),
    stderr: tests.stderr.slice(-4000),
  };
}

/** Pack authoring callbacks scoped to packages/site-adapters/src/<pack>/. */
export function packAuthorCallbacksForSite(opts: {
  repoRoot: string;
  getSite: () => McpSite;
}): Pick<
  BrowserToolCallbacks,
  | "defaultPack"
  | "listPackFiles"
  | "readPackFile"
  | "writePackFile"
  | "applyPackPatch"
  | "runPackTests"
> {
  const { repoRoot, getSite } = opts;
  return {
    defaultPack: () => adapterIdToPack(resolveAdapter(getSite()).id),
    listPackFiles: async ({ pack }) => {
      const name = resolvePackName(getSite(), pack);
      const files = listPackFiles({ repoRoot, pack: name });
      return { pack: name, files, root: `packages/site-adapters/src/${name}/` };
    },
    readPackFile: async ({ pack, relativePath }) => {
      const name = resolvePackName(getSite(), pack);
      const file = readPackFile({
        repoRoot,
        pack: name,
        relativePath,
      });
      return { pack: name, ...file };
    },
    writePackFile: async ({ pack, relativePath, content, confirm, overwrite }) => {
      const name = resolvePackName(getSite(), pack);
      if (confirm !== true) {
        return {
          preview: true,
          refused: true,
          pack: name,
          relativePath,
          bytes: Buffer.byteLength(content),
          overwrite: overwrite === true,
          next: "Pass confirm:true after the user agrees. Prefer apply_pack_patch for edits; use write_pack_file for new files or overwrite:true for full rewrite. Tests run after write.",
        } satisfies PublishToolResult;
      }
      const written = writePackFile({
        repoRoot,
        pack: name,
        relativePath,
        content,
        overwrite: overwrite === true,
      });
      const tests = await runPackTests({ repoRoot, pack: name });
      return {
        preview: false,
        written,
        tests: testsPayload(tests),
        next: tests.ok
          ? "Pack tests passed. If this is a new pack, add it to ADAPTERS in packages/site-adapters/src/registry.ts (outside agent write scope)."
          : "Pack tests FAILED. Fix with apply_pack_patch (confirm:true) or another write.",
      };
    },
    applyPackPatch: async ({
      pack,
      relativePath,
      oldString,
      newString,
      replaceAll,
      confirm,
    }) => {
      const name = resolvePackName(getSite(), pack);
      if (confirm !== true) {
        return {
          preview: true,
          refused: true,
          pack: name,
          relativePath,
          oldStringLength: oldString.length,
          newStringLength: newString.length,
          replaceAll: replaceAll === true,
          next: "Pass confirm:true after the user agrees to this search-replace. Tests will run automatically after patch.",
        } satisfies PublishToolResult;
      }
      const patched = applyPackPatch({
        repoRoot,
        pack: name,
        relativePath,
        oldString,
        newString,
        replaceAll: replaceAll === true,
      });
      const tests = await runPackTests({ repoRoot, pack: name });
      return {
        preview: false,
        patched,
        tests: testsPayload(tests),
        next: tests.ok
          ? "Pack tests passed."
          : "Pack tests FAILED. Fix with another apply_pack_patch (confirm:true).",
      };
    },
    runPackTests: async ({ pack }) => {
      const name = resolvePackName(getSite(), pack);
      const tests = await runPackTests({ repoRoot, pack: name });
      return {
        pack: name,
        ok: tests.ok,
        exitCode: tests.exitCode,
        command: tests.command,
        stdout: tests.stdout.slice(-8000),
        stderr: tests.stderr.slice(-4000),
      };
    },
  };
}
