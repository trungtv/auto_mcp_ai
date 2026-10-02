import {
  cancelLoginSession,
  closeBrowserReplay,
  closeBrowserSession,
  completeLoginSession,
  exploreAndCapture,
  hasLoginSession,
  startLoginSession,
} from "@auto-mcp/browser-auth";
import { normalizeCandidates } from "@auto-mcp/explorer";
import { mergeTools, upgradeTools } from "@auto-mcp/mcp-generator";
import {
  AuthExpiredError,
  assertToolUrlAllowed,
  buildMcpEntry,
  createSiteReplay,
  defaultCursorMcpPath,
  mergeCursorMcpConfig,
} from "@auto-mcp/mcp-runtime";
import {
  getCapability,
  listCapabilitiesForSite,
  listKnownFormats,
  listSeedCapabilities,
  resolveAdapter,
} from "@auto-mcp/site-adapters";
import {
  CapabilityDefSchema,
  CAPABILITY_FORMAT_EXAMPLES,
  CreateSiteInputSchema,
  ToolDefSchema,
  type CapabilityDef,
  type ToolDef,
} from "@auto-mcp/shared";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import {
  browserToolsForSite,
  requireAuth,
  requireSite,
  resolveSiteId,
  setActiveSiteId,
  siteSummary,
  type ControlContext,
  runtimeCliPath,
} from "./context.js";
import {
  approveCandidatesOp,
  compileEndpointsOp,
  listCapabilityGraphOp,
  listEndpointIrOp,
  listObservedActionsOp,
  persistCapture,
  renameEndpointIrOp,
  testEndpointIrOp,
  validateCapabilityDef,
  type SiteOpsContext,
} from "./site-ops.js";
import { nextAfterRegister } from "./workflow.js";

function ops(ctx: ControlContext): SiteOpsContext {
  return {
    registry: ctx.registry,
    vault: ctx.vault,
    dataDir: ctx.dataDir,
    masterKey: ctx.masterKey,
    runtimeEntry: runtimeCliPath(ctx),
  };
}

export type McpToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

const siteIdProp = {
  siteId: {
    type: "string",
    description: "Site id. Optional if set_active_site was called.",
  },
};

const siteSummaryOutput = {
  type: "object",
  properties: {
    site: { type: "object" },
    activeSiteId: { type: "string" },
  },
};

export const CONTROL_TOOLS: McpToolDef[] = [
  {
    name: "list_sites",
    title: "List MCP sites",
    description:
      "Liệt kê mọi website đang quản lý trong registry local (id, status, số tool/candidate).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        sites: { type: "array", items: { type: "object" } },
        activeSiteId: { type: ["string", "null"] },
      },
      required: ["sites"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_site",
    title: "Get site details",
    description:
      "Chi tiết một site: summary, candidates (tối đa 40), tools (name/method/url).",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        site: { type: "object" },
        candidates: { type: "array" },
        tools: { type: "array" },
      },
      required: ["site", "candidates", "tools"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_site",
    title: "Create site",
    description: "Tạo site mới từ base URL website (vd. https://your-domain.atlassian.net).",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          description: "Base URL, e.g. https://your-domain.atlassian.net",
        },
        name: { type: "string", description: "Display name (optional)" },
        explorePath: {
          type: "string",
          description: "Default path to explore, e.g. /#danh-sach-sinh-vien",
        },
      },
      required: ["baseUrl"],
      additionalProperties: false,
    },
    outputSchema: siteSummaryOutput,
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: "set_active_site",
    title: "Set active site",
    description:
      "Đặt siteId mặc định cho các tool tiếp theo khi bỏ qua tham số siteId.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "string", description: "Site id to make active" },
      },
      required: ["siteId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { activeSiteId: { type: "string" } },
      required: ["activeSiteId"],
    },
  },
  {
    name: "login_start",
    title: "Start login",
    description:
      "Mở Chromium headed để đăng nhập thủ công. Sau khi user xong, gọi login_confirm.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "login_status",
    title: "Login status",
    description: "Kiểm tra phiên login browser đang chờ confirm hay chưa.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "login_confirm",
    title: "Confirm login",
    description:
      "Capture cookies/session sau khi user đã đăng nhập trong browser headed.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
  },
  {
    name: "login_cancel",
    title: "Cancel login",
    description: "Hủy phiên login browser đang mở.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
  },
  {
    name: "browser_open",
    title: "Open browser",
    description: "Mở (hoặc reuse) browser headed với profile đã login của site.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_goto",
    title: "Navigate",
    description: "Điều hướng tới path tương đối hoặc URL tuyệt đối.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        path: { type: "string", description: "Path or absolute URL" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_click",
    title: "Click",
    description: "Click theo CSS selector, text hiển thị, hoặc ARIA role.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        selector: { type: "string" },
        text: { type: "string" },
        role: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_fill",
    title: "Fill input",
    description: "Điền input theo selector hoặc label; có thể nhấn Enter.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        selector: { type: "string" },
        label: { type: "string" },
        value: { type: "string" },
        pressEnter: { type: "boolean" },
      },
      required: ["value"],
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_wait",
    title: "Wait",
    description: "Chờ tối đa 30s cho SPA/network settle.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        ms: { type: "number", description: "Milliseconds to wait" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    title: "Page snapshot",
    description: "Lấy URL, title, và đoạn text ngắn của trang hiện tại.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        text: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "network_mark",
    title: "Mark network",
    description: "Reset marker capture mạng (API sau marker được coi là mới).",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
  },
  {
    name: "network_snapshot",
    title: "Network snapshot",
    description:
      "Thu XHR/fetch kể từ marker, normalize/redact, merge vào candidates.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        focus: { type: "string", description: "Optional explore focus label" },
      },
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "list_candidates",
    title: "List candidates",
    description: "Liệt kê API candidates đã tích lũy cho site.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        candidates: { type: "array", items: { type: "object" } },
      },
      required: ["candidates"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "note_focus",
    title: "Note explore focus",
    description: "Ghi chuỗi focus explore cho site.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        focus: { type: "string" },
      },
      required: ["focus"],
      additionalProperties: false,
    },
  },
  {
    name: "quick_scan",
    title: "Quick scan",
    description:
      "Explore thụ động: mở explorePath, settle, capture network vào candidates.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "approve_candidates",
    title: "Approve candidates",
    description:
      "Compile Endpoint IR (từ candidates) thành primitives. Không truyền ids = preview (chưa ghi). Truyền candidateIds hoặc confirmAll:true để ghi. Cùng engine với compile_endpoints.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        candidateIds: {
          type: "array",
          items: { type: "string" },
          description: "Subset of candidate ids to compile via IR.",
        },
        endpointIds: {
          type: "array",
          items: { type: "string" },
        },
        confirmAll: {
          type: "boolean",
          description:
            "Required true to compile ALL IR when ids omitted. Without it, returns preview only.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        approved: { type: "array", items: { type: "string" } },
        toolCount: { type: "number" },
        site: { type: "object" },
        preview: { type: "boolean" },
        willApproveCount: { type: "number" },
        willCreateToolNames: { type: "array", items: { type: "string" } },
        seedReadiness: { type: "object" },
        next: { type: "string" },
      },
      required: ["next"],
    },
  },
  {
    name: "list_observed_actions",
    title: "List observed actions",
    description: "Evidence UI+network đã ghi khi explore (ObservedAction).",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_endpoint_ir",
    title: "List endpoint IR",
    description:
      "Endpoint IR đã cluster (suggestedName, kind, params, compiled?). Nguồn sự thật — không invent endpoint.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "rename_endpoint_ir",
    title: "Rename endpoint IR",
    description: "Đặt suggestedName (snake_case) cho một IR. Không ghi pack file.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        endpointId: { type: "string" },
        suggestedName: { type: "string" },
      },
      required: ["endpointId", "suggestedName"],
      additionalProperties: false,
    },
  },
  {
    name: "compile_endpoints",
    title: "Compile endpoints",
    description:
      "Compile IR → primitive. Không confirm: preview tên IR + primitive sẽ tạo. confirmAll hoặc endpointIds để ghi (meta MCP: truyền ids = ghi).",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        endpointIds: { type: "array", items: { type: "string" } },
        candidateIds: { type: "array", items: { type: "string" } },
        confirmAll: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_capability_graph",
    title: "List capability graph",
    description:
      "Graph IR ↔ primitive ↔ capability (derive). Không invent edge.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "test_endpoint_ir",
    title: "Test endpoint IR",
    description:
      "Contract replay (+ mutation nếu mutate:true). Không confirm = preview. mutate:true chỉ JSON data_api có query ≥2 samples; GWT/frozen throw. Ghi lastContract/lastMutation khi confirm.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        endpointIds: { type: "array", items: { type: "string" } },
        mutate: { type: "boolean" },
        confirm: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_tools",
    title: "List tools",
    description:
      "Liệt kê tools của site kèm title, captureContext, annotations, có outputSchema hay chưa.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              method: { type: "string" },
              approved: { type: "boolean" },
              hasOutputSchema: { type: "boolean" },
              captureContext: { type: "object" },
              annotations: { type: "object" },
            },
          },
        },
      },
      required: ["siteId", "tools"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "upsert_tools",
    title: "Upsert tools",
    description:
      "Merge ToolDef JSON vào site (approved=true), luôn chạy upgradeSchemas trước khi lưu.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        tools: {
          type: "array",
          description: "Array of ToolDef JSON objects",
          items: { type: "object" },
        },
      },
      required: ["tools"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        upserted: { type: "array", items: { type: "string" } },
        toolCount: { type: "number" },
        site: { type: "object" },
      },
      required: ["upserted", "toolCount"],
    },
  },
  {
    name: "register_site_mcp",
    title: "Register site MCP",
    description:
      "Ghi entry MCP per-site vào ~/.cursor/mcp.json. Site MCP tools/list = business capabilities (adapter seeds + stored), không phải raw primitives. Gọi list_capabilities trước; nếu rỗng thì approve thêm seed primitives.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        mcpPath: { type: "string" },
        key: { type: "string" },
        message: { type: "string" },
        warning: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } },
      },
      required: ["ok", "mcpPath", "key"],
    },
  },
  {
    name: "list_capabilities",
    title: "List business capabilities",
    description:
      "Liệt kê business capabilities (MCP tools agent gọi), khác list_tools (primitives). Trả adapterId, seeds từ site-adapter, stored defs trong DB, và effective merged list. Capability ≠ primitive — primitive phải approve trước rồi mới bind.",
    inputSchema: {
      type: "object",
      properties: { ...siteIdProp },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        adapterId: { type: "string" },
        supportsArgMutation: { type: "object" },
        seeds: { type: "array" },
        stored: { type: "array" },
        effective: { type: "array" },
      },
      required: ["siteId", "adapterId", "seeds", "stored", "effective"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "upsert_capability",
    title: "Upsert business capability",
    description:
      "Tạo/cập nhật declarative capability trên site registry (DB). bind.kind=primitive (1:1 hoặc 1:N qua endpointIrIds) hoặc pipeline (≤5 steps, fail-fast). format = pack formatter id. Cùng name với seed → ghi đè; enabled:false → ẩn seed.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        name: { type: "string", description: "Capability name (MCP tool name)" },
        title: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        annotations: { type: "object" },
        enabled: {
          type: "boolean",
          description: "false = hide this name (including adapter seed)",
        },
        bind: {
          type: "object",
          description:
            "primitive: { kind, primitive, endpointIrId?, endpointIrIds?, argMutations?, defaults?, format? } | pipeline: { kind, steps[{primitive,args,format?}], format? }",
          properties: {
            kind: { type: "string", enum: ["primitive", "pipeline"] },
            primitive: { type: "string" },
            endpointIrId: {
              type: "string",
              description:
                "Single compiled IR id; compiledPrimitive must equal bind.primitive",
            },
            endpointIrIds: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string" },
              description:
                "1:N IR implementations; runtime picks lastContract.ok newest. bind.primitive must be one of the compiled names.",
            },
            steps: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  primitive: { type: "string" },
                  args: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description:
                      "Templates e.g. {{input.issueKey}} or {{steps.0.issue.key}}",
                  },
                  format: { type: "string" },
                  argMutations: {
                    type: "object",
                    properties: {
                      semester: { type: "boolean" },
                      classId: { type: "boolean" },
                      projectType: { type: "boolean" },
                    },
                  },
                  defaults: {
                    type: "object",
                    properties: {
                      semester: { type: "string" },
                      classId: { type: "string" },
                      projectType: {
                        type: "string",
                        enum: ["others", "final", "masters", "phds"],
                      },
                    },
                  },
                },
                required: ["primitive"],
              },
            },
            argMutations: {
              type: "object",
              properties: {
                semester: { type: "boolean" },
                classId: { type: "boolean" },
                projectType: { type: "boolean" },
              },
            },
            defaults: {
              type: "object",
              properties: {
                semester: { type: "string" },
                classId: { type: "string" },
                projectType: {
                  type: "string",
                  enum: ["others", "final", "masters", "phds"],
                },
              },
            },
            format: {
              type: "string",
              description: `Pack formatter id (examples: ${CAPABILITY_FORMAT_EXAMPLES.join(", ")}; live: ${listKnownFormats().join(", ") || "none"})`,
            },
          },
          required: ["kind"],
        },
      },
      required: ["name", "description", "bind"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        capability: { type: "object" },
        storedCount: { type: "number" },
        effective: { type: "array" },
        next: { type: "string" },
      },
      required: ["capability", "storedCount", "effective"],
    },
  },
  {
    name: "remove_capability",
    title: "Remove stored capability",
    description:
      "Xóa capability def trong DB theo name. Chỉ ảnh hưởng bản ghi stored — seed adapter vẫn còn trừ khi trước đó đã upsert enabled:false.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        removed: { type: "boolean" },
        name: { type: "string" },
        storedCount: { type: "number" },
        effective: { type: "array" },
      },
      required: ["removed", "name", "storedCount", "effective"],
    },
  },
  {
    name: "try_capability",
    title: "Try business capability",
    description:
      "Chạy một business capability một lần (cần auth vault). Dùng để smoke-test sau upsert_capability.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdProp,
        name: { type: "string", description: "Capability name" },
        args: {
          type: "object",
          description: "Args theo inputSchema của capability",
          additionalProperties: true,
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        isError: { type: "boolean" },
        text: { type: "string" },
        structuredContent: { type: "object" },
      },
    },
  },
];

const BROWSER_TOOL_NAMES = new Set([
  "browser_open",
  "browser_goto",
  "browser_click",
  "browser_fill",
  "browser_wait",
  "browser_snapshot",
  "network_mark",
  "network_snapshot",
  "list_candidates",
  "note_focus",
]);

export type ControlToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown): ControlToolResult {
  const structuredContent =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { value: data };
  const text =
    typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2).slice(0, 8_000);
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

function fail(message: string): ControlToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function callControlTool(
  ctx: ControlContext,
  name: string,
  rawArgs: Record<string, unknown> | undefined,
): Promise<ControlToolResult> {
  const args = rawArgs ?? {};
  try {
    if (name === "list_sites") {
      const sites = ctx.registry.list().map((s) => siteSummary(s, ctx.vault.has(s.id)));
      return ok({ sites, activeSiteId: ctx.activeSiteId });
    }

    if (name === "create_site") {
      const input = CreateSiteInputSchema.parse(args);
      const placeholder = `${ctx.dataDir}/profiles/_pending`;
      mkdirSync(placeholder, { recursive: true });
      const site = ctx.registry.create(input, placeholder);
      const profileDir = ctx.registry.profileDirFor(ctx.dataDir, site.id, site.baseUrl);
      mkdirSync(profileDir, { recursive: true });
      const updated = ctx.registry.update(site.id, { profileDir });
      setActiveSiteId(ctx, updated.id);
      return ok({
        site: siteSummary(updated, false),
        activeSiteId: ctx.activeSiteId,
        next: "Call login_start, log in in the browser, then login_confirm.",
      });
    }

    if (name === "set_active_site") {
      const siteId = z.string().min(1).parse(args.siteId);
      requireSite(ctx, siteId);
      setActiveSiteId(ctx, siteId);
      return ok({ activeSiteId: siteId });
    }

    if (name === "get_site") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      return ok({
        site: siteSummary(site, ctx.vault.has(site.id)),
        candidates: site.candidates.slice(0, 40).map((c) => ({
          id: c.id,
          method: c.method,
          url: c.url,
          status: c.status,
        })),
        tools: site.tools.map((t) => ({
          name: t.name,
          title: t.title,
          approved: t.approved,
          method: t.method,
          url: t.url,
          captureContext: t.captureContext,
        })),
      });
    }

    if (name === "login_start") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      await closeBrowserReplay(site.id);
      await closeBrowserSession(site.id);
      await startLoginSession({
        siteId: site.id,
        baseUrl: site.baseUrl,
        profileDir: site.profileDir,
      });
      return ok({
        ok: true,
        awaitingConfirm: true,
        message:
          "Browser opened. Log in manually, then call login_confirm (tell the user to finish login first).",
      });
    }

    if (name === "login_status") {
      const siteId = resolveSiteId(ctx, args);
      requireSite(ctx, siteId);
      return ok({
        siteId,
        awaitingConfirm: hasLoginSession(siteId),
        hasAuth: ctx.vault.has(siteId),
      });
    }

    if (name === "login_confirm") {
      const siteId = resolveSiteId(ctx, args);
      requireSite(ctx, siteId);
      const snapshot = await completeLoginSession(siteId);
      ctx.vault.set(siteId, snapshot);
      const updated = ctx.registry.update(siteId, {
        status: "ready",
        lastAuthAt: snapshot.capturedAt,
      });
      return ok({
        site: siteSummary(updated, true),
        message: "Session saved. You can explore with browser_* / network_* tools.",
      });
    }

    if (name === "login_cancel") {
      const siteId = resolveSiteId(ctx, args);
      requireSite(ctx, siteId);
      await cancelLoginSession(siteId);
      return ok({ ok: true, awaitingConfirm: false });
    }

    if (BROWSER_TOOL_NAMES.has(name)) {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      requireAuth(ctx, siteId);
      const tools = browserToolsForSite(ctx, site);
      const tool = tools[name];
      if (!tool) return fail(`Unknown browser tool: ${name}`);
      const result = await tool.execute(
        args as Parameters<typeof tool.execute>[0],
        {},
      );
      if (typeof result === "string") {
        try {
          return ok(JSON.parse(result));
        } catch {
          return ok(result);
        }
      }
      return ok(result);
    }

    if (name === "quick_scan") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      requireAuth(ctx, siteId);
      await cancelLoginSession(site.id);
      await closeBrowserReplay(site.id);
      await closeBrowserSession(site.id);
      const { round } = ctx.registry.startExploreRound(
        site.id,
        `quick-scan ${site.explorePath}`,
      );
      const result = await exploreAndCapture({
        baseUrl: site.baseUrl,
        explorePath: site.explorePath,
        profileDir: site.profileDir,
      });
      ctx.vault.set(site.id, result.authSnapshot);
      const normalized = normalizeCandidates(result.candidates, site.baseUrl);
      const { site: updated, added } = ctx.registry.mergeSiteCandidates(
        site.id,
        normalized,
        {
          exploreRound: round.id,
          focus: `quick-scan ${site.explorePath}`,
        },
      );
      const pageUrl = new URL(site.explorePath, site.baseUrl).toString();
      persistCapture(
        { registry: ctx.registry },
        site.id,
        normalized,
        { pageUrl, gesture: "goto" },
        round.id,
      );
      return ok({
        site: siteSummary(updated, true),
        candidateCount: ctx.registry.get(site.id)?.candidates.length ?? updated.candidates.length,
        added: added.length,
        newApis: added.slice(0, 40).map((c) => ({
          id: c.id,
          method: c.method,
          url: c.url,
          status: c.status,
        })),
      });
    }

    if (name === "list_observed_actions") {
      const siteId = resolveSiteId(ctx, args);
      return ok(listObservedActionsOp({ registry: ctx.registry }, siteId));
    }

    if (name === "list_endpoint_ir") {
      const siteId = resolveSiteId(ctx, args);
      return ok(listEndpointIrOp({ registry: ctx.registry }, siteId));
    }

    if (name === "rename_endpoint_ir") {
      const siteId = resolveSiteId(ctx, args);
      const endpointId = z.string().min(1).parse(args.endpointId);
      const suggestedName = z.string().min(1).parse(args.suggestedName);
      return ok(
        renameEndpointIrOp({ registry: ctx.registry }, siteId, {
          endpointId,
          suggestedName,
        }),
      );
    }

    if (name === "compile_endpoints" || name === "approve_candidates") {
      const siteId = resolveSiteId(ctx, args);
      const candidateIds = Array.isArray(args.candidateIds)
        ? args.candidateIds.filter((x): x is string => typeof x === "string")
        : undefined;
      const endpointIds = Array.isArray(args.endpointIds)
        ? args.endpointIds.filter((x): x is string => typeof x === "string")
        : undefined;
      const confirmAll = args.confirmAll === true;
      const hasIds = Boolean(
        (candidateIds && candidateIds.length > 0) ||
          (endpointIds && endpointIds.length > 0),
      );
      const result =
        name === "compile_endpoints"
          ? compileEndpointsOp(ops(ctx), siteId, {
              endpointIds,
              candidateIds,
              confirmAll,
              confirm: hasIds || confirmAll,
            })
          : approveCandidatesOp(ops(ctx), siteId, {
              candidateIds,
              endpointIds,
              confirmAll,
              confirm: hasIds || confirmAll,
            });
      const site = requireSite(ctx, siteId);
      return ok({
        ...result,
        site: siteSummary(site, ctx.vault.has(site.id)),
      });
    }

    if (name === "list_capability_graph") {
      const siteId = resolveSiteId(ctx, args);
      return ok(listCapabilityGraphOp({ registry: ctx.registry }, siteId));
    }

    if (name === "test_endpoint_ir") {
      const siteId = resolveSiteId(ctx, args);
      requireAuth(ctx, siteId);
      const endpointIds = Array.isArray(args.endpointIds)
        ? args.endpointIds.filter((x): x is string => typeof x === "string")
        : undefined;
      return ok(
        await testEndpointIrOp(ops(ctx), siteId, {
          endpointIds,
          mutate: args.mutate === true,
          confirm: args.confirm === true,
        }),
      );
    }

    if (name === "list_tools") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      return ok({
        siteId,
        tools: site.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          method: t.method,
          url: t.url,
          approved: t.approved,
          hasOutputSchema: Boolean(
            t.outputSchema && Object.keys(t.outputSchema).length > 0,
          ),
          captureContext: t.captureContext,
          annotations: t.annotations,
        })),
      });
    }

    if (name === "upsert_tools") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      const parsed = upgradeTools(
        z.array(ToolDefSchema).parse(args.tools) as ToolDef[],
      );
      if (parsed.length === 0) throw new Error("tools array is empty");
      for (const tool of parsed) {
        assertToolUrlAllowed(tool.url, site.baseUrl);
      }
      const tools = mergeTools(
        site.tools,
        parsed.map((t) => ({ ...t, approved: true })),
      );
      const updated = ctx.registry.update(site.id, { tools });
      return ok({
        site: siteSummary(updated, ctx.vault.has(site.id)),
        upserted: parsed.map((t) => t.name),
        toolCount: updated.tools.filter((t) => t.approved).length,
      });
    }

    if (name === "register_site_mcp") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      if (site.tools.filter((t) => t.approved).length === 0) {
        throw new Error("Approve at least one tool before registering");
      }
      const entry = buildMcpEntry(site, {
        runtimeEntry: runtimeCliPath(ctx),
        dataDir: ctx.dataDir,
        masterKey: ctx.masterKey,
      });
      const mcpPath = defaultCursorMcpPath();
      mergeCursorMcpConfig(mcpPath, site.cursorMcpKey, entry);
      const after = nextAfterRegister({
        site,
        mcpKey: site.cursorMcpKey,
      });
      return ok({
        ok: true,
        mcpPath,
        key: site.cursorMcpKey,
        message: after.message,
        ...(after.warning ? { warning: after.warning } : {}),
        capabilities: after.capabilities,
      });
    }

    if (name === "list_capabilities") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      const adapter = resolveAdapter(site);
      const primitives = upgradeTools(site.tools.filter((t) => t.approved));
      const seeds = listSeedCapabilities({ site, primitives });
      const effective = listCapabilitiesForSite({ site, primitives });
      return ok({
        siteId,
        adapterId: adapter.id,
        supportsArgMutation: adapter.supportsArgMutation ?? {},
        seeds: seeds.map(capSummary),
        stored: site.capabilities ?? [],
        effective: effective.map(capSummary),
      });
    }

    if (name === "upsert_capability") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      const adapter = resolveAdapter(site);
      const def = parseCapabilityUpsert(args);
      validateCapabilityDef(site, adapter, def);
      const formatWarning = capabilityFormatWarning(adapter, def);
      const existing = site.capabilities ?? [];
      const next = [...existing.filter((c) => c.name !== def.name), def];
      const updated = ctx.registry.update(site.id, { capabilities: next });
      const primitives = upgradeTools(updated.tools.filter((t) => t.approved));
      const effective = listCapabilitiesForSite({
        site: updated,
        primitives,
      });
      return ok({
        capability: def,
        storedCount: next.length,
        effective: effective.map(capSummary),
        warning: formatWarning,
        next: formatWarning
          ? `${formatWarning} Reload the site MCP server in Cursor to pick up the new tool.`
          : "Reload the site MCP server in Cursor to pick up the new tool.",
      });
    }

    if (name === "remove_capability") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      const capName = String(args.name ?? "").trim();
      if (!capName) throw new Error("name is required");
      const existing = site.capabilities ?? [];
      const next = existing.filter((c) => c.name !== capName);
      const removed = next.length !== existing.length;
      const updated = ctx.registry.update(site.id, { capabilities: next });
      const primitives = upgradeTools(updated.tools.filter((t) => t.approved));
      const effective = listCapabilitiesForSite({
        site: updated,
        primitives,
      });
      return ok({
        removed,
        name: capName,
        storedCount: next.length,
        effective: effective.map(capSummary),
      });
    }

    if (name === "try_capability") {
      const siteId = resolveSiteId(ctx, args);
      const site = requireSite(ctx, siteId);
      requireAuth(ctx, siteId);
      const auth = ctx.vault.get(siteId);
      if (!auth) throw new Error("No auth session in vault");
      const capName = String(args.name ?? "").trim();
      if (!capName) throw new Error("name is required");
      const capArgs =
        args.args && typeof args.args === "object" && !Array.isArray(args.args)
          ? (args.args as Record<string, unknown>)
          : {};
      const primitives = upgradeTools(site.tools.filter((t) => t.approved));
      const cap = getCapability({ site, primitives }, capName);
      if (!cap) throw new Error(`Unknown capability: ${capName}`);
      try {
        const result = await cap.execute(
          {
            site,
            auth,
            primitives,
            replay: createSiteReplay({
              site,
              onAuth: (snap) => ctx.vault.set(siteId, snap),
            }),
          },
          capArgs,
        );
        return {
          content: result.content,
          structuredContent: {
            isError: Boolean(result.isError),
            text: result.content[0]?.text,
            ...(result.structuredContent ?? {}),
          },
          ...(result.isError ? { isError: true } : {}),
        };
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          return fail(err.message);
        }
        throw err;
      }
    }

    return fail(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(message);
  }
}

function capSummary(cap: {
  name: string;
  title?: string;
  description: string;
  supportsMutation?: boolean;
  bind?: CapabilityDef["bind"];
  inputSchema: Record<string, unknown>;
}) {
  return {
    name: cap.name,
    title: cap.title,
    description: cap.description,
    supportsMutation: Boolean(cap.supportsMutation),
    bind: cap.bind,
    inputSchema: cap.inputSchema,
  };
}

function parseCapabilityUpsert(args: Record<string, unknown>): CapabilityDef {
  const raw = {
    name: args.name,
    title: args.title,
    description: args.description,
    inputSchema: args.inputSchema,
    outputSchema: args.outputSchema,
    annotations: args.annotations,
    enabled: args.enabled,
    bind: args.bind,
    updatedAt: new Date().toISOString(),
  };
  return CapabilityDefSchema.parse(raw);
}

function capabilityFormatWarning(
  adapter: ReturnType<typeof resolveAdapter>,
  def: CapabilityDef,
): string | undefined {
  if (def.enabled === false) return undefined;
  const usesDomainFormats = (adapter.knownFormats?.length ?? 0) > 0;
  if (!usesDomainFormats) {
    return undefined;
  }
  if (def.bind.kind === "pipeline") {
    if (def.bind.format || def.bind.steps.some((s) => s.format)) return undefined;
    return `Pipeline \`${def.name}\` has no format on bind/steps — domain output may be thin.`;
  }
  if (def.bind.format) return undefined;
  return `Capability \`${def.name}\` has no bind.format — domain output may be missing; set a pack format id.`;
}
