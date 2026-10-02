import type { SDKCustomTool } from "@cursor/sdk";
import type {
  ApiCandidate,
  EndpointIr,
  ObservedAction,
  ObservedUi,
} from "@auto-mcp/shared";
import { normalizeCandidates } from "@auto-mcp/explorer";
import type { BrowserSession } from "@auto-mcp/browser-auth";
import { analyzeCoverage } from "./coverage.js";

export type SiteToolInventoryItem = {
  name: string;
  method?: string;
  url?: string;
  approved?: boolean;
  title?: string;
  rpcMethod?: string;
};

export type SiteCapabilityInventoryItem = {
  name: string;
  title?: string;
  description?: string;
  bind?: unknown;
};

export type SiteInventorySnapshot = {
  adapterId: string;
  primitives: SiteToolInventoryItem[];
  capabilities: SiteCapabilityInventoryItem[];
  storedCapabilityNames: string[];
  seedCapabilityNames: string[];
};

export type PublishToolResult = Record<string, unknown>;

export interface BrowserToolCallbacks {
  getSession: () => Promise<BrowserSession>;
  onCandidates: (
    candidates: ApiCandidate[],
    focus?: string,
    ui?: ObservedUi,
  ) => Promise<{
    added: ApiCandidate[];
    total: number;
  }>;
  listCandidates: () => ApiCandidate[];
  listObservedActions: () => ObservedAction[];
  listEndpointIr: () => EndpointIr[];
  renameEndpointIr: (args: {
    endpointId: string;
    suggestedName: string;
  }) => Promise<PublishToolResult>;
  compileEndpoints: (args: {
    endpointIds?: string[];
    candidateIds?: string[];
    confirmAll?: boolean;
    confirm?: boolean;
  }) => Promise<PublishToolResult>;
  listCapabilityGraph: () => Promise<PublishToolResult> | PublishToolResult;
  testEndpointIr: (args: {
    endpointIds?: string[];
    mutate?: boolean;
    confirm?: boolean;
  }) => Promise<PublishToolResult>;
  listSiteTools: () => SiteToolInventoryItem[];
  getSiteInventory: () => SiteInventorySnapshot;
  setFocus: (focus: string) => void;
  getFocus: () => string | null;
  baseUrl: string;
  /** Approve candidates → primitives via IR compile. Without confirm: preview only. */
  approveCandidates: (args: {
    candidateIds?: string[];
    endpointIds?: string[];
    confirmAll?: boolean;
    confirm?: boolean;
  }) => Promise<PublishToolResult>;
  upsertCapability: (args: Record<string, unknown>) => Promise<PublishToolResult>;
  tryCapability: (args: {
    name: string;
    args?: Record<string, unknown>;
  }) => Promise<PublishToolResult>;
  registerSiteMcp: (args: { confirm?: boolean }) => Promise<PublishToolResult>;
  /** Default pack folder for this site (e.g. jira), or null if generic. */
  defaultPack: () => string | null;
  listPackFiles: (args: { pack?: string }) => Promise<PublishToolResult>;
  readPackFile: (args: {
    pack?: string;
    relativePath: string;
  }) => Promise<PublishToolResult>;
  /**
   * Create a new pack file (or overwrite with overwrite:true).
   * Prefer applyPackPatch for edits to existing files.
   * Requires confirm:true; always runs pack tests afterward.
   */
  writePackFile: (args: {
    pack?: string;
    relativePath: string;
    content: string;
    confirm?: boolean;
    overwrite?: boolean;
  }) => Promise<PublishToolResult>;
  /**
   * Exact search-replace in an existing pack file.
   * Requires confirm:true; always runs pack tests afterward.
   */
  applyPackPatch: (args: {
    pack?: string;
    relativePath: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    confirm?: boolean;
  }) => Promise<PublishToolResult>;
  runPackTests: (args: { pack?: string }) => Promise<PublishToolResult>;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true";
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length ? out : undefined;
}

export function buildBrowserCustomTools(
  cb: BrowserToolCallbacks,
): Record<string, SDKCustomTool> {
  return {
    browser_open: {
      description: "Open (or reuse) the headed browser with the site's logged-in profile.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const s = await cb.getSession();
        return JSON.stringify({ ok: true, url: s.url || cb.baseUrl });
      },
    },
    browser_goto: {
      description: "Navigate to a path or absolute URL (e.g. /#danh-sach-sinh-vien).",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async (args) => {
        const s = await cb.getSession();
        const path = asString(args.path);
        const r = await s.goto(path || "/");
        await s.wait(2000);
        return JSON.stringify(r);
      },
    },
    browser_click: {
      description: "Click by CSS selector, visible text, or ARIA role.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          role: { type: "string" },
        },
      },
      execute: async (args) => {
        const s = await cb.getSession();
        return JSON.stringify(
          await s.click({
            selector: asString(args.selector) || undefined,
            text: asString(args.text) || undefined,
            role: asString(args.role) || undefined,
          }),
        );
      },
    },
    browser_fill: {
      description: "Fill an input by selector or label; optionally press Enter.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          pressEnter: { type: "boolean" },
        },
        required: ["value"],
      },
      execute: async (args) => {
        const s = await cb.getSession();
        return JSON.stringify(
          await s.fill({
            selector: asString(args.selector) || undefined,
            label: asString(args.label) || undefined,
            value: asString(args.value),
            pressEnter: asBool(args.pressEnter),
          }),
        );
      },
    },
    browser_wait: {
      description: "Wait up to 30s for SPA/network activity.",
      inputSchema: {
        type: "object",
        properties: { ms: { type: "number" } },
      },
      execute: async (args) => {
        const s = await cb.getSession();
        return JSON.stringify(await s.wait(asNumber(args.ms, 3000)));
      },
    },
    browser_snapshot: {
      description: "Get current URL, title, and a short text sample of the page.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const s = await cb.getSession();
        return JSON.stringify(await s.snapshot());
      },
    },
    network_mark: {
      description: "Reset the network capture marker (APIs after this are 'new').",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const s = await cb.getSession();
        return JSON.stringify(s.markNetwork());
      },
    },
    network_snapshot: {
      description:
        "Collect XHR/fetch APIs since the last marker, normalize/redact, and merge into the site candidate list.",
      inputSchema: {
        type: "object",
        properties: { focus: { type: "string" } },
      },
      execute: async (args) => {
        const s = await cb.getSession();
        const focus = asString(args.focus) || cb.getFocus() || undefined;
        if (focus) cb.setFocus(focus);
        const raw = s.networkSinceMarker();
        const normalized = normalizeCandidates(raw, cb.baseUrl);
        const ui = s.lastUiEvidence();
        const { added, total } = await cb.onCandidates(normalized, focus, ui);
        return JSON.stringify({
          captured: normalized.length,
          added: added.length,
          total,
          lastUi: ui,
          newApis: added.map((c) => ({
            id: c.id,
            method: c.method,
            url: c.url,
            status: c.status,
          })),
        });
      },
    },
    list_candidates: {
      description:
        "List accumulated API candidates discovered so far for this site (raw explore captures — not yet MCP tools).",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const list = cb.listCandidates();
        return JSON.stringify({
          total: list.length,
          candidates: list.slice(0, 80).map((c) => ({
            id: c.id,
            method: c.method,
            url: c.url,
            status: c.status,
          })),
        });
      },
    },
    list_site_tools: {
      description:
        "List primitives already saved on this site (approved HTTP tools in registry). Use this — do NOT ask the user to paste tool names, and do NOT look for a workbook file.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const tools = cb.listSiteTools();
        return JSON.stringify({
          total: tools.length,
          approved: tools.filter((t) => t.approved !== false).length,
          tools,
        });
      },
    },
    list_site_capabilities: {
      description:
        "List business MCP capabilities already available for this site (adapter seeds + stored binds). These are what the per-site MCP exposes.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const inv = cb.getSiteInventory();
        return JSON.stringify(inv);
      },
    },
    analyze_coverage: {
      description:
        "Compare endpoint IR vs approved primitives vs capabilities (falls back to raw candidates if IR empty). Returns covered / candidateOnly / capabilityWithoutRecentCandidate. Call this for gap analysis — never ask the user to paste tool names.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const inv = cb.getSiteInventory();
        const analysis = analyzeCoverage({
          candidates: cb.listCandidates(),
          primitives: cb.listSiteTools(),
          capabilities: inv.capabilities,
          endpointIr: cb.listEndpointIr(),
        });
        return JSON.stringify(analysis);
      },
    },
    list_observed_actions: {
      description:
        "List ObservedAction evidence (UI gesture + network sketch) recorded during explore.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const actions = cb.listObservedActions();
        return JSON.stringify({
          total: actions.length,
          actions: actions.slice(-80).map((a) => ({
            id: a.id,
            candidateId: a.candidateId,
            observedAt: a.observedAt,
            gesture: a.ui?.gesture,
            pageUrl: a.ui?.pageUrl,
            targetText: a.ui?.targetText,
            method: a.network.method,
            url: a.network.url,
            status: a.network.status,
            queryKeys: a.requestSketch.queryKeys,
            rpcMethod: a.responseSketch.rpcMethod,
          })),
        });
      },
    },
    list_endpoint_ir: {
      description:
        "List clustered Endpoint IR (normalized APIs). Use this after capture — do not invent endpoints. Suggest semantic names then compile_endpoints confirm:true.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const ir = cb.listEndpointIr();
        return JSON.stringify({
          total: ir.length,
          endpoints: ir.map((e) => ({
            id: e.id,
            key: e.key,
            suggestedName: e.suggestedName,
            kind: e.kind,
            method: e.method,
            urlTemplate: e.urlTemplate,
            params: e.params.map((p) => p.name),
            compiledPrimitive: e.compiledPrimitive,
            lastContractOk: e.lastContract?.ok,
            lastMutationOk: e.lastMutation?.ok,
          })),
        });
      },
    },
    rename_endpoint_ir: {
      description:
        "Set suggestedName on an Endpoint IR (snake_case). Does not write pack files. Call before compile_endpoints.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string" },
          suggestedName: { type: "string" },
        },
        required: ["endpointId", "suggestedName"],
      },
      execute: async (args) =>
        JSON.stringify(
          await cb.renameEndpointIr({
            endpointId: asString(args.endpointId),
            suggestedName: asString(args.suggestedName),
          }),
        ),
    },
    compile_endpoints: {
      description:
        "Compile Endpoint IR into approved primitives. Without confirm:true returns preview (IR names + primitives that would be created). With confirm:true + endpointIds (or confirmAll:true) writes tools. Same engine as approve_candidates. Never compile without user confirm.",
      inputSchema: {
        type: "object",
        properties: {
          endpointIds: { type: "array", items: { type: "string" } },
          candidateIds: { type: "array", items: { type: "string" } },
          confirmAll: { type: "boolean" },
          confirm: {
            type: "boolean",
            description: "Must be true to write; otherwise preview only",
          },
        },
      },
      execute: async (args) => {
        const result = await cb.compileEndpoints({
          endpointIds: asStringArray(args.endpointIds),
          candidateIds: asStringArray(args.candidateIds),
          confirmAll: asBool(args.confirmAll),
          confirm: asBool(args.confirm),
        });
        return JSON.stringify(result);
      },
    },
    list_capability_graph: {
      description:
        "Derived graph: Endpoint IR ↔ compiled primitive ↔ capability. Do not invent edges.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => JSON.stringify(await cb.listCapabilityGraph()),
    },
    test_endpoint_ir: {
      description:
        "Replay contract (and optional query mutation) against compiled IR. Without confirm:true = preview only. mutate:true requires data_api JSON with a query param that has ≥2 samples — frozen/GWT throws. Persist lastContract/lastMutation only with confirm:true.",
      inputSchema: {
        type: "object",
        properties: {
          endpointIds: { type: "array", items: { type: "string" } },
          mutate: { type: "boolean" },
          confirm: { type: "boolean" },
        },
      },
      execute: async (args) =>
        JSON.stringify(
          await cb.testEndpointIr({
            endpointIds: asStringArray(args.endpointIds),
            mutate: asBool(args.mutate),
            confirm: asBool(args.confirm),
          }),
        ),
    },
    approve_candidates: {
      description:
        "Compile IR for the given candidateIds into site primitives (same engine as compile_endpoints). Without confirm:true returns preview IR names only. With confirm:true + candidateIds (or confirmAll:true) writes to registry. Do not invent endpoints; skip kind=other.",
      inputSchema: {
        type: "object",
        properties: {
          candidateIds: { type: "array", items: { type: "string" } },
          confirmAll: { type: "boolean" },
          confirm: {
            type: "boolean",
            description: "Must be true to write; otherwise preview only",
          },
        },
      },
      execute: async (args) => {
        const result = await cb.approveCandidates({
          candidateIds: asStringArray(args.candidateIds),
          confirmAll: asBool(args.confirmAll),
          confirm: asBool(args.confirm),
        });
        return JSON.stringify(result);
      },
    },
    upsert_capability: {
      description:
        "Create/update a business capability bind (primitive or pipeline). Requires confirm:true to write. Optional bind.endpointIrId / bind.endpointIrIds (1:N); each IR must be compiled; runtime picks lastContract.ok newest. Set bind.format when the site pack supports it; omit format for raw replay.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          annotations: { type: "object" },
          enabled: { type: "boolean" },
          bind: { type: "object" },
          confirm: { type: "boolean" },
        },
        required: ["name", "description", "bind"],
      },
      execute: async (args) => {
        const result = await cb.upsertCapability(args as Record<string, unknown>);
        return JSON.stringify(result);
      },
    },
    try_capability: {
      description:
        "Smoke-test a business capability once (uses vault auth). Pass capability name and args.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          args: { type: "object" },
        },
        required: ["name"],
      },
      execute: async (args) => {
        const name = asString(args.name);
        const capArgs =
          args.args && typeof args.args === "object" && !Array.isArray(args.args)
            ? (args.args as Record<string, unknown>)
            : {};
        const result = await cb.tryCapability({ name, args: capArgs });
        return JSON.stringify(result);
      },
    },
    register_site_mcp: {
      description:
        "Write this site's MCP entry into ~/.cursor/mcp.json. Requires confirm:true. User must reload the MCP server key in Cursor afterward.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean" },
        },
      },
      execute: async (args) => {
        const result = await cb.registerSiteMcp({ confirm: asBool(args.confirm) });
        return JSON.stringify(result);
      },
    },
    list_pack_files: {
      description:
        "List files in auto_mcp_ai_sample_packs/packages/site-adapter-<pack>/src/ (demo: jira).",
      inputSchema: {
        type: "object",
        properties: { pack: { type: "string" } },
      },
      execute: async (args) =>
        JSON.stringify(await cb.listPackFiles({ pack: asString(args.pack) || undefined })),
    },
    read_pack_file: {
      description:
        "Read a file inside packages/site-adapters/src/<pack>/<relativePath>. Cannot escape the pack directory.",
      inputSchema: {
        type: "object",
        properties: {
          pack: { type: "string" },
          relativePath: { type: "string" },
        },
        required: ["relativePath"],
      },
      execute: async (args) =>
        JSON.stringify(
          await cb.readPackFile({
            pack: asString(args.pack) || undefined,
            relativePath: asString(args.relativePath),
          }),
        ),
    },
    write_pack_file: {
      description:
        "Create a NEW file under packages/site-adapters/src/<pack>/ (or full rewrite with overwrite:true). Prefer apply_pack_patch for edits. Requires confirm:true. Runs pack tests after write. Does NOT edit registry.ts.",
      inputSchema: {
        type: "object",
        properties: {
          pack: { type: "string" },
          relativePath: { type: "string" },
          content: { type: "string" },
          confirm: { type: "boolean" },
          overwrite: { type: "boolean" },
        },
        required: ["relativePath", "content"],
      },
      execute: async (args) =>
        JSON.stringify(
          await cb.writePackFile({
            pack: asString(args.pack) || undefined,
            relativePath: asString(args.relativePath),
            content: asString(args.content),
            confirm: asBool(args.confirm),
            overwrite: asBool(args.overwrite),
          }),
        ),
    },
    apply_pack_patch: {
      description:
        "Exact search-replace in an existing pack file (oldString → newString). oldString must match once unless replaceAll:true. Requires confirm:true. Runs pack tests after patch.",
      inputSchema: {
        type: "object",
        properties: {
          pack: { type: "string" },
          relativePath: { type: "string" },
          oldString: { type: "string" },
          newString: { type: "string" },
          replaceAll: { type: "boolean" },
          confirm: { type: "boolean" },
        },
        required: ["relativePath", "oldString", "newString"],
      },
      execute: async (args) =>
        JSON.stringify(
          await cb.applyPackPatch({
            pack: asString(args.pack) || undefined,
            relativePath: asString(args.relativePath),
            oldString: asString(args.oldString),
            newString: asString(args.newString),
            replaceAll: asBool(args.replaceAll),
            confirm: asBool(args.confirm),
          }),
        ),
    },
    run_pack_tests: {
      description:
        "Build site-adapters and run node:test for this pack (dist/<pack>/**/*.test.js).",
      inputSchema: {
        type: "object",
        properties: { pack: { type: "string" } },
      },
      execute: async (args) =>
        JSON.stringify(await cb.runPackTests({ pack: asString(args.pack) || undefined })),
    },
    note_focus: {
      description: "Record the user's explore focus for this session.",
      inputSchema: {
        type: "object",
        properties: { focus: { type: "string" } },
        required: ["focus"],
      },
      execute: async (args) => {
        const focus = asString(args.focus);
        cb.setFocus(focus);
        return JSON.stringify({ ok: true, focus });
      },
    },
  };
}
