import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  cancelLoginSession,
  closeBrowserReplay,
  closeBrowserSession,
  ensureBrowserSession,
  type BrowserSession,
} from "@auto-mcp/browser-auth";
import {
  buildBrowserCustomTools,
  type SiteInventorySnapshot,
} from "@auto-mcp/cursor-discover";
import { Registry } from "@auto-mcp/registry";
import type { ApiCandidate, McpSite } from "@auto-mcp/shared";
import {
  listCapabilitiesForSite,
  listSeedCapabilities,
  resolveAdapter,
} from "@auto-mcp/site-adapters";
import { Vault } from "@auto-mcp/vault";
import { ROOT_DIR } from "./paths.js";
import {
  approveCandidatesOp,
  compileEndpointsOp,
  listCapabilityGraphOp,
  listEndpointIrOp,
  persistCapture,
  registerSiteMcpOp,
  renameEndpointIrOp,
  testEndpointIrOp,
  tryCapabilityOp,
  upsertCapabilityOp,
} from "./site-ops.js";
import { loadActiveSiteId, saveActiveSiteId } from "./workflow.js";
import {
  adapterIdToPack,
  applyPackPatch,
  listPackFiles,
  readPackFile,
  runPackTests,
  writePackFile,
} from "@auto-mcp/cursor-discover";

export interface ControlContext {
  dataDir: string;
  masterKey: string;
  rootDir: string;
  registry: Registry;
  vault: Vault;
  activeSiteId: string | null;
}

export function createControlContext(opts: {
  dataDir: string;
  masterKey: string;
}): ControlContext {
  mkdirSync(opts.dataDir, { recursive: true });
  return {
    dataDir: opts.dataDir,
    masterKey: opts.masterKey,
    rootDir: ROOT_DIR,
    registry: new Registry(opts.dataDir),
    vault: new Vault(opts.dataDir, opts.masterKey),
    activeSiteId: loadActiveSiteId(opts.dataDir),
  };
}

export function setActiveSiteId(ctx: ControlContext, siteId: string | null): void {
  ctx.activeSiteId = siteId;
  saveActiveSiteId(ctx.dataDir, siteId);
}

export function siteSummary(site: McpSite, hasAuth: boolean) {
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    explorePath: site.explorePath,
    status: site.status,
    cursorMcpKey: site.cursorMcpKey,
    hasAuth,
    candidateCount: site.candidates.length,
    toolCount: site.tools.filter((t) => t.approved).length,
    exploreFocus: site.exploreFocus,
    lastAuthAt: site.lastAuthAt,
    lastExploreAt: site.lastExploreAt,
  };
}

export function resolveSiteId(
  ctx: ControlContext,
  args: Record<string, unknown>,
): string {
  const fromArgs = typeof args.siteId === "string" ? args.siteId.trim() : "";
  const id = fromArgs || ctx.activeSiteId;
  if (!id) {
    throw new Error(
      "Missing siteId. Pass siteId or call set_active_site first.",
    );
  }
  return id;
}

export function requireSite(ctx: ControlContext, siteId: string): McpSite {
  const site = ctx.registry.get(siteId);
  if (!site) throw new Error(`Unknown site id: ${siteId}`);
  return site;
}

export function requireAuth(ctx: ControlContext, siteId: string): void {
  if (!ctx.vault.has(siteId)) {
    throw new Error(
      "No auth session. Call login_start, log in in the browser, then login_confirm.",
    );
  }
}

export async function getSession(
  ctx: ControlContext,
  site: McpSite,
): Promise<BrowserSession> {
  requireAuth(ctx, site.id);
  await cancelLoginSession(site.id);
  await closeBrowserReplay(site.id);
  return ensureBrowserSession({
    siteId: site.id,
    baseUrl: site.baseUrl,
    profileDir: site.profileDir,
    auth: ctx.vault.get(site.id),
  });
}

export function browserToolsForSite(ctx: ControlContext, site: McpSite) {
  const inventoryOf = (s: McpSite): SiteInventorySnapshot => {
    const adapter = resolveAdapter(s);
    const primitives = s.tools.filter((t) => t.approved !== false);
    const seeds = listSeedCapabilities({ site: s, primitives });
    const effective = listCapabilitiesForSite({ site: s, primitives });
    return {
      adapterId: adapter.id,
      primitives: s.tools.map((t) => ({
        name: t.name,
        title: t.title,
        method: t.method,
        url: t.url,
        approved: t.approved,
        rpcMethod: t.captureContext?.rpcMethod,
      })),
      capabilities: effective.map((c) => ({
        name: c.name,
        title: c.title,
        description: c.description,
        bind: c.bind,
      })),
      storedCapabilityNames: (s.capabilities ?? []).map((c) => c.name),
      seedCapabilityNames: seeds.map((c) => c.name),
    };
  };

  return buildBrowserCustomTools({
    baseUrl: site.baseUrl,
    getSession: () => getSession(ctx, site),
    onCandidates: async (candidates, nextFocus, ui) => {
      if (nextFocus) {
        ctx.registry.update(site.id, { exploreFocus: nextFocus });
      }
      const session = await getSession(ctx, site);
      const snap = await session.authSnapshot();
      ctx.vault.set(site.id, snap);
      const { site: updated, added } = ctx.registry.mergeSiteCandidates(
        site.id,
        candidates,
        {
          focus: nextFocus ?? ctx.registry.get(site.id)?.exploreFocus ?? undefined,
        },
      );
      persistCapture({ registry: ctx.registry }, site.id, candidates, ui);
      return { added, total: updated.candidates.length };
    },
    listCandidates: () => ctx.registry.get(site.id)?.candidates ?? ([] as ApiCandidate[]),
    listObservedActions: () =>
      ctx.registry.get(site.id)?.observedActions ?? [],
    listEndpointIr: () => {
      listEndpointIrOp({ registry: ctx.registry }, site.id);
      return ctx.registry.get(site.id)?.endpointIr ?? [];
    },
    renameEndpointIr: async (args) =>
      renameEndpointIrOp({ registry: ctx.registry }, site.id, args),
    compileEndpoints: async (args) =>
      compileEndpointsOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    listCapabilityGraph: () =>
      listCapabilityGraphOp({ registry: ctx.registry }, site.id),
    testEndpointIr: async (args) =>
      testEndpointIrOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    listSiteTools: () => {
      const current = ctx.registry.get(site.id);
      return (current?.tools ?? []).map((t) => ({
        name: t.name,
        title: t.title,
        method: t.method,
        url: t.url,
        approved: t.approved,
        rpcMethod: t.captureContext?.rpcMethod,
      }));
    },
    getSiteInventory: () => inventoryOf(ctx.registry.get(site.id) ?? site),
    setFocus: (f) => {
      ctx.registry.update(site.id, { exploreFocus: f });
    },
    getFocus: () => ctx.registry.get(site.id)?.exploreFocus ?? null,
    approveCandidates: async (args) =>
      approveCandidatesOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    upsertCapability: async (args) =>
      upsertCapabilityOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    tryCapability: async (args) =>
      tryCapabilityOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    registerSiteMcp: async (args) =>
      registerSiteMcpOp(
        {
          registry: ctx.registry,
          vault: ctx.vault,
          dataDir: ctx.dataDir,
          masterKey: ctx.masterKey,
          runtimeEntry: runtimeCliPath(ctx),
        },
        site.id,
        args,
      ),
    defaultPack: () =>
      adapterIdToPack(resolveAdapter(ctx.registry.get(site.id) ?? site).id),
    listPackFiles: async ({ pack }) => {
      const current = ctx.registry.get(site.id) ?? site;
      const name =
        pack?.trim() ||
        adapterIdToPack(resolveAdapter(current).id) ||
        (() => {
          throw new Error("Pass pack explicitly for this site");
        })();
      return {
        pack: name,
        files: listPackFiles({ repoRoot: ctx.rootDir, pack: name }),
        root: `packages/site-adapters/src/${name}/`,
      };
    },
    readPackFile: async ({ pack, relativePath }) => {
      const current = ctx.registry.get(site.id) ?? site;
      const name =
        pack?.trim() ||
        adapterIdToPack(resolveAdapter(current).id) ||
        (() => {
          throw new Error("Pass pack explicitly for this site");
        })();
      return {
        pack: name,
        ...readPackFile({
          repoRoot: ctx.rootDir,
          pack: name,
          relativePath,
        }),
      };
    },
    writePackFile: async ({ pack, relativePath, content, confirm, overwrite }) => {
      const current = ctx.registry.get(site.id) ?? site;
      const name =
        pack?.trim() ||
        adapterIdToPack(resolveAdapter(current).id) ||
        (() => {
          throw new Error("Pass pack explicitly for this site");
        })();
      if (confirm !== true) {
        return {
          preview: true,
          refused: true,
          pack: name,
          relativePath,
          overwrite: overwrite === true,
          next: "Pass confirm:true after user agrees. Prefer apply_pack_patch for edits; overwrite:true for full rewrite. Tests run after write.",
        };
      }
      const written = writePackFile({
        repoRoot: ctx.rootDir,
        pack: name,
        relativePath,
        content,
        overwrite: overwrite === true,
      });
      const tests = await runPackTests({ repoRoot: ctx.rootDir, pack: name });
      return {
        preview: false,
        written,
        tests: {
          ok: tests.ok,
          exitCode: tests.exitCode,
          command: tests.command,
          stdout: tests.stdout.slice(-6000),
          stderr: tests.stderr.slice(-4000),
        },
        next: tests.ok
          ? "Pack tests passed."
          : "Pack tests FAILED — fix with apply_pack_patch (confirm:true).",
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
      const current = ctx.registry.get(site.id) ?? site;
      const name =
        pack?.trim() ||
        adapterIdToPack(resolveAdapter(current).id) ||
        (() => {
          throw new Error("Pass pack explicitly for this site");
        })();
      if (confirm !== true) {
        return {
          preview: true,
          refused: true,
          pack: name,
          relativePath,
          oldStringLength: oldString.length,
          newStringLength: newString.length,
          replaceAll: replaceAll === true,
          next: "Pass confirm:true after user agrees. Tests run after patch.",
        };
      }
      const patched = applyPackPatch({
        repoRoot: ctx.rootDir,
        pack: name,
        relativePath,
        oldString,
        newString,
        replaceAll: replaceAll === true,
      });
      const tests = await runPackTests({ repoRoot: ctx.rootDir, pack: name });
      return {
        preview: false,
        patched,
        tests: {
          ok: tests.ok,
          exitCode: tests.exitCode,
          command: tests.command,
          stdout: tests.stdout.slice(-6000),
          stderr: tests.stderr.slice(-4000),
        },
        next: tests.ok
          ? "Pack tests passed."
          : "Pack tests FAILED — fix with another apply_pack_patch (confirm:true).",
      };
    },
    runPackTests: async ({ pack }) => {
      const current = ctx.registry.get(site.id) ?? site;
      const name =
        pack?.trim() ||
        adapterIdToPack(resolveAdapter(current).id) ||
        (() => {
          throw new Error("Pass pack explicitly for this site");
        })();
      const tests = await runPackTests({ repoRoot: ctx.rootDir, pack: name });
      return {
        pack: name,
        ok: tests.ok,
        exitCode: tests.exitCode,
        command: tests.command,
        stdout: tests.stdout.slice(-8000),
        stderr: tests.stderr.slice(-4000),
      };
    },
  });
}

export function runtimeCliPath(ctx: ControlContext): string {
  return resolve(ctx.rootDir, "packages/mcp-runtime/dist/cli.js");
}

export function controlCliPath(ctx: ControlContext): string {
  return resolve(ctx.rootDir, "packages/mcp-control/dist/cli.js");
}
