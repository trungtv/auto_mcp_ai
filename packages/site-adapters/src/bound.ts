import {
  GWT_BODY_LIMIT,
  ProjectTypeSchema,
  boundEndpointIrIds,
  outputSchemaFromResponseKeys,
  selectContractedEndpoint,
  type CapabilityBindDefaults,
  type CapabilityDef,
  type CapabilityPipelineStep,
  type CaptureContext,
  type EndpointIr,
  type ProjectType,
} from "@auto-mcp/shared";
import type {
  AdapterContext,
  ArgMutations,
  Capability,
  CapabilityResult,
  MutateArgs,
  SiteAdapter,
} from "./types.js";
import { findPrimitive, packSupportsFormat } from "./types.js";
import { resolveArgTemplates } from "./pipeline.js";

export const BUSINESS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: { type: "number" },
    ok: { type: "boolean" },
    capability: { type: "string" },
    semester: { type: "string" },
    classId: { type: "string" },
    projectType: { type: "string" },
    mutated: { type: "boolean" },
    captureContext: { type: "object" },
    byteLength: { type: "number" },
    count: { type: "number" },
    students: { type: "array" },
    projects: { type: "array" },
    classes: { type: "array" },
    loggedIn: { type: "boolean" },
    identity: { type: "object" },
    rawBody: { type: "string" },
    parseError: { type: "string" },
  },
  required: ["status", "ok", "capability"],
};

export function outputSchemaForFormat(
  format?: string,
  adapter?: SiteAdapter,
): Record<string, unknown> {
  if (format && adapter?.outputSchemaForFormat) {
    try {
      return adapter.outputSchemaForFormat(format);
    } catch {
      return BUSINESS_OUTPUT_SCHEMA;
    }
  }
  return BUSINESS_OUTPUT_SCHEMA;
}

function bodyText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

function isOk(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (typeof body === "string" && body.trimStart().startsWith("//EX")) return false;
  return true;
}

function parseProjectType(v: unknown): ProjectType | undefined {
  const r = ProjectTypeSchema.safeParse(v);
  return r.success ? r.data : undefined;
}

/** Merge bind.defaults under agent args (agent wins on conflict). */
export function mergeCapabilityArgs(
  defaults: CapabilityBindDefaults | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(defaults?.semester !== undefined
      ? { semester: defaults.semester }
      : {}),
    ...(defaults?.classId !== undefined ? { classId: defaults.classId } : {}),
    ...(defaults?.projectType !== undefined
      ? { projectType: defaults.projectType }
      : {}),
    ...args,
  };
}

export async function runBoundPrimitive(
  ctx: AdapterContext,
  opts: {
    capability: string;
    primitiveName: string;
    args: Record<string, unknown>;
    argMutations?: ArgMutations;
    defaults?: CapabilityBindDefaults;
    format?: string;
    adapter: SiteAdapter;
  },
): Promise<CapabilityResult> {
  const tool = findPrimitive(ctx.primitives, opts.primitiveName);
  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: `Missing primitive tool \`${opts.primitiveName}\`. Explore + approve it first.`,
        },
      ],
      isError: true,
    };
  }

  if (opts.format && !packSupportsFormat(opts.adapter, opts.format)) {
    return {
      content: [
        {
          type: "text",
          text: `Adapter \`${opts.adapter.id}\` does not support format \`${opts.format}\`. Register the site pack or fix bind.format.`,
        },
      ],
      isError: true,
    };
  }

  const capture = (tool.captureContext ?? {}) as CaptureContext;
  let merged = mergeCapabilityArgs(opts.defaults, opts.args);

  if (opts.format && opts.adapter.applyArgs) {
    try {
      merged = opts.adapter.applyArgs(opts.format, merged);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  // Apply inputSchema defaults for missing path/query-bound args (e.g. hotelId: "").
  const schemaProps = (
    tool.inputSchema as { properties?: Record<string, { default?: unknown }> }
  )?.properties;
  if (schemaProps) {
    for (const [argName, binding] of Object.entries(tool.argBindings ?? {})) {
      if (merged[argName] !== undefined) continue;
      if (binding.in !== "path" && binding.in !== "query") continue;
      const def = schemaProps[argName]?.default;
      if (def !== undefined) merged[argName] = def;
    }
  }

  const allowSemester = Boolean(opts.argMutations?.semester);
  const allowClassId = Boolean(opts.argMutations?.classId);
  const allowProjectType = Boolean(opts.argMutations?.projectType);

  const semesterForMutate =
    allowSemester && typeof merged.semester === "string"
      ? merged.semester
      : opts.defaults?.semester;
  const classIdForMutate =
    allowClassId && typeof merged.classId === "string"
      ? merged.classId
      : opts.defaults?.classId;
  const projectTypeForMutate = allowProjectType
    ? parseProjectType(merged.projectType)
    : opts.defaults?.projectType;

  const mutateArgs: MutateArgs = {
    semester: semesterForMutate,
    classId: classIdForMutate,
    projectType: projectTypeForMutate,
  };

  const wantsMutation =
    (mutateArgs.semester !== undefined &&
      mutateArgs.semester !== capture.semester) ||
    (mutateArgs.classId !== undefined &&
      mutateArgs.classId !== capture.classId) ||
    (mutateArgs.projectType !== undefined &&
      mutateArgs.projectType !== capture.projectType);

  let play = tool;
  let mutated = false;

  if (wantsMutation) {
    const supports = opts.adapter.supportsArgMutation ?? {};
    if (
      (mutateArgs.semester !== undefined &&
        mutateArgs.semester !== capture.semester &&
        !supports.semester) ||
      (mutateArgs.classId !== undefined &&
        mutateArgs.classId !== capture.classId &&
        !supports.classId) ||
      (mutateArgs.projectType !== undefined &&
        mutateArgs.projectType !== capture.projectType &&
        !supports.projectType)
    ) {
      return {
        content: [
          {
            type: "text",
            text: `Adapter \`${opts.adapter.id}\` does not support requested arg mutation.`,
          },
        ],
        isError: true,
      };
    }
    if (!opts.adapter.mutateAndSign) {
      return {
        content: [
          {
            type: "text",
            text: `Adapter \`${opts.adapter.id}\` has no mutateAndSign hook.`,
          },
        ],
        isError: true,
      };
    }
    try {
      play = opts.adapter.mutateAndSign(tool, mutateArgs);
      mutated = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `mutateAndSign failed: ${message}` }],
        isError: true,
      };
    }
  }

  const replayArgs: Record<string, unknown> = { ...merged };
  delete replayArgs.includeRaw;

  const result = await ctx.replay(play, replayArgs, ctx.auth);
  const raw = bodyText(result.body);
  const ok = isOk(result.status, result.body);
  const effectiveSemester = mutateArgs.semester ?? capture.semester;
  const effectiveClassId = mutateArgs.classId ?? capture.classId;
  const effectiveProjectType = mutateArgs.projectType ?? capture.projectType;
  const includeRaw = merged.includeRaw === true;

  const meta = {
    capability: opts.capability,
    status: result.status,
    ok,
    mutated,
    semester: effectiveSemester,
    classId: effectiveClassId,
    projectType: effectiveProjectType,
    captureContext: {
      ...capture,
      semester: effectiveSemester,
      classId: effectiveClassId,
      projectType: effectiveProjectType,
      frozen: !mutated && capture.frozen,
    },
    byteLength: raw.length,
  };

  if (opts.format && opts.adapter.formatCapability) {
    return opts.adapter.formatCapability({
      format: opts.format,
      body: result.body,
      meta,
      includeRaw,
      args: merged,
      site: ctx.site,
    });
  }

  const summary = [
    `${opts.capability} · HTTP ${result.status}${ok ? " · ok" : " · not ok"}`,
    effectiveSemester ? `semester=${effectiveSemester}` : null,
    effectiveClassId ? `classId=${effectiveClassId}` : null,
    effectiveProjectType ? `projectType=${effectiveProjectType}` : null,
    mutated ? "mutated+signed" : "replay-capture",
    `${raw.length} bytes`,
    "no bind.format — set format for domain output",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      ...meta,
      ...(includeRaw
        ? {
            rawBody:
              raw.length > GWT_BODY_LIMIT
                ? raw.slice(0, GWT_BODY_LIMIT)
                : raw,
            rawTruncated: raw.length > GWT_BODY_LIMIT,
          }
        : {}),
    },
    ...(ok ? {} : { isError: true }),
  };
}

function stepFailed(result: CapabilityResult): boolean {
  if (result.isError) return true;
  const sc = result.structuredContent;
  if (sc && sc.ok === false) return true;
  return false;
}

function textOf(result: CapabilityResult): string {
  const part = result.content.find((c) => c.type === "text");
  return part && "text" in part ? part.text : "";
}

export async function runPipeline(
  ctx: AdapterContext,
  opts: {
    capability: string;
    steps: CapabilityPipelineStep[];
    format?: string;
    args: Record<string, unknown>;
    adapter: SiteAdapter;
  },
): Promise<CapabilityResult> {
  if (opts.steps.length === 0) {
    return {
      content: [{ type: "text", text: "Pipeline has no steps" }],
      isError: true,
    };
  }
  if (opts.steps.length > 5) {
    return {
      content: [{ type: "text", text: "Pipeline exceeds max 5 steps" }],
      isError: true,
    };
  }

  const stepMetas: Record<string, unknown>[] = [];
  const texts: string[] = [];
  let last: CapabilityResult | undefined;

  for (let i = 0; i < opts.steps.length; i++) {
    const step = opts.steps[i]!;
    let resolved: Record<string, unknown>;
    try {
      resolved = resolveArgTemplates(step.args ?? {}, {
        input: opts.args,
        steps: stepMetas,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Pipeline \`${opts.capability}\` failed at step ${i} (${step.primitive}): ${message}`,
          },
        ],
        structuredContent: {
          ok: false,
          capability: opts.capability,
          failedStep: i,
          steps: stepMetas,
        },
        isError: true,
      };
    }

    const merged: Record<string, unknown> = {
      ...(typeof opts.args.confirm === "boolean"
        ? { confirm: opts.args.confirm }
        : {}),
      ...(typeof opts.args.includeRaw === "boolean"
        ? { includeRaw: opts.args.includeRaw }
        : {}),
      ...resolved,
    };

    const isLast = i === opts.steps.length - 1;
    const format = step.format ?? (isLast ? opts.format : undefined);

    const result = await runBoundPrimitive(ctx, {
      capability: `${opts.capability}[${i}]`,
      primitiveName: step.primitive,
      args: merged,
      argMutations: step.argMutations as ArgMutations | undefined,
      defaults: step.defaults as CapabilityBindDefaults | undefined,
      format,
      adapter: opts.adapter,
    });

    const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
    stepMetas.push({
      index: i,
      primitive: step.primitive,
      format,
      ok: sc.ok,
      status: sc.status,
      ...sc,
    });
    texts.push(`### Step ${i}: ${step.primitive}\n${textOf(result)}`);
    last = result;

    if (stepFailed(result)) {
      return {
        content: [
          {
            type: "text",
            text: [
              `Pipeline \`${opts.capability}\` failed at step ${i} (${step.primitive})`,
              textOf(result),
            ].join("\n\n"),
          },
        ],
        structuredContent: {
          ok: false,
          capability: opts.capability,
          failedStep: i,
          steps: stepMetas,
        },
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: [
          `${opts.capability} · pipeline ok · ${opts.steps.length} step(s)`,
          "",
          ...texts,
        ].join("\n"),
      },
    ],
    structuredContent: {
      ...(last?.structuredContent ?? {}),
      ok: true,
      capability: opts.capability,
      pipeline: true,
      steps: stepMetas,
    },
  };
}

function inferredCapabilityOutputSchema(
  def: CapabilityDef,
  adapter: SiteAdapter,
  catalog: EndpointIr[],
): Record<string, unknown> {
  if (def.outputSchema && Object.keys(def.outputSchema).length > 0) {
    return def.outputSchema as Record<string, unknown>;
  }
  const format = def.bind.format;
  if (format) return outputSchemaForFormat(format, adapter);
  const ids = boundEndpointIrIds(def.bind);
  if (ids.length > 0) {
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const keys = new Set<string>();
    for (const id of ids) {
      for (const k of byId.get(id)?.responseKeys ?? []) keys.add(k);
    }
    const inferred = outputSchemaFromResponseKeys([...keys]);
    if (inferred) return inferred;
  }
  return outputSchemaForFormat(format, adapter);
}

export function defToCapability(
  def: CapabilityDef,
  adapter: SiteAdapter,
  catalog: EndpointIr[] = [],
): Capability | null {
  if (def.enabled === false) return null;

  if (def.bind.kind === "pipeline") {
    const steps = def.bind.steps;
    const format = def.bind.format;
    return {
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: (def.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>,
      outputSchema: inferredCapabilityOutputSchema(def, adapter, catalog),
      annotations: def.annotations,
      supportsMutation: false,
      bind: def.bind,
      execute: (ctx, args) =>
        runPipeline(ctx, {
          capability: def.name,
          steps,
          format,
          args,
          adapter,
        }),
    };
  }

  if (def.bind.kind !== "primitive") return null;

  const mutations = def.bind.argMutations ?? {};
  const defaults = def.bind.defaults;
  const format = def.bind.format;
  const primitiveName = def.bind.primitive;
  const supportsMutation = Boolean(
    (mutations.semester && adapter.supportsArgMutation?.semester) ||
      (mutations.classId && adapter.supportsArgMutation?.classId) ||
      ((mutations.projectType || defaults?.projectType) &&
        adapter.supportsArgMutation?.projectType),
  );

  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: (def.inputSchema ?? {
      type: "object",
      properties: {},
    }) as Record<string, unknown>,
    outputSchema: inferredCapabilityOutputSchema(def, adapter, catalog),
    annotations: def.annotations,
    supportsMutation,
    bind: def.bind,
    execute: async (ctx, args) => {
      const ids = boundEndpointIrIds(def.bind);
      let name = primitiveName;
      if (ids.length > 0) {
        const selected = selectContractedEndpoint(
          ctx.site.endpointIr ?? [],
          ids,
        );
        name = selected.compiledPrimitive!;
      }
      return runBoundPrimitive(ctx, {
        capability: def.name,
        primitiveName: name,
        args,
        argMutations: mutations,
        defaults,
        format,
        adapter,
      });
    },
  };
}

export function defsToCapabilities(
  defs: CapabilityDef[],
  adapter: SiteAdapter,
  catalog: EndpointIr[] = [],
): Capability[] {
  const out: Capability[] = [];
  for (const def of defs) {
    const cap = defToCapability(def, adapter, catalog);
    if (cap) out.push(cap);
  }
  return out;
}

/**
 * Merge adapter seeds with stored DB defs.
 * - DB entry with same name overrides seed (or disables seed when enabled=false)
 * - DB-only names are appended
 */
export function mergeCapabilities(
  seeds: Capability[],
  stored: CapabilityDef[],
  adapter: SiteAdapter,
  catalog: EndpointIr[] = [],
): Capability[] {
  const byName = new Map<string, Capability>();
  for (const s of seeds) byName.set(s.name, s);

  for (const def of stored) {
    if (def.enabled === false) {
      byName.delete(def.name);
      continue;
    }
    const cap = defToCapability(def, adapter, catalog);
    if (cap) byName.set(def.name, cap);
  }

  return [...byName.values()];
}

/** Re-export helper used by pack mutateAndSign implementations. */
export { withRequestOverrides } from "./types.js";
