import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSnapshot, ToolDef } from "@auto-mcp/shared";
import {
  assertToolUrlAllowed,
  isAuthExpiredStatus,
  normalizeHeaders,
  prepareReplay,
  replayTool,
  ReplayUrlError,
} from "./replay.js";

describe("assertToolUrlAllowed", () => {
  const origin = "https://example.atlassian.net";

  it("allows same origin", () => {
    assert.doesNotThrow(() =>
      assertToolUrlAllowed(`${origin}/rest/api/3/issue/ABC-1`, origin),
    );
  });

  it("rejects cross-origin", () => {
    assert.throws(
      () => assertToolUrlAllowed("https://evil.example/x", origin),
      (err: unknown) => err instanceof ReplayUrlError,
    );
  });

  it("rejects credentials in URL", () => {
    assert.throws(
      () =>
        assertToolUrlAllowed(
          "https://user:pass@example.atlassian.net/x",
          origin,
        ),
      (err: unknown) => err instanceof ReplayUrlError,
    );
  });

  it("rejects non-http(s)", () => {
    assert.throws(
      () => assertToolUrlAllowed("file:///etc/passwd", origin),
      (err: unknown) => err instanceof ReplayUrlError,
    );
  });
});

describe("replayTool path bindings", () => {
  it("substitutes {param} before URL encoding braces", async () => {
    const origin = "https://example.test";
    const tool: ToolDef = {
      name: "path_demo",
      description: "demo",
      method: "GET",
      url: `${origin}/api/filter/{partnerId}/{hotelId}/{fromMonth}/{fromYear}/{toMonth}/{toYear}`,
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      annotations: {},
      captureContext: {},
      argBindings: {
        partnerId: { in: "path", key: "partnerId" },
        hotelId: { in: "path", key: "hotelId" },
        fromMonth: { in: "path", key: "fromMonth" },
        fromYear: { in: "path", key: "fromYear" },
        toMonth: { in: "path", key: "toMonth" },
        toYear: { in: "path", key: "toYear" },
      },
      headers: {},
      approved: true,
    };
    const auth: AuthSnapshot = {
      origin,
      capturedAt: new Date().toISOString(),
      cookies: [],
      authHeaders: {},
      authHeadersByOrigin: {},
    };

    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await replayTool(
        tool,
        {
          partnerId: "126",
          hotelId: "",
          fromMonth: "8",
          fromYear: "2026",
          toMonth: "8",
          toYear: "2026",
        },
        auth,
        { allowedOrigin: origin },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(seen.length, 1);
    assert.equal(
      seen[0],
      "https://example.test/api/filter/126//8/2026/8/2026",
    );
  });
});

describe("prepareReplay auth headers", () => {
  const origin = "https://app.example";
  const tool: ToolDef = {
    name: "list",
    description: "demo",
    method: "GET",
    url: `${origin}/api/x`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    annotations: {},
    captureContext: {},
    argBindings: {},
    headers: { Authorization: "Bearer baked" },
    approved: true,
  };

  it("uses origin-matched vault Bearer and can strip baked Authorization", () => {
    const auth: AuthSnapshot = {
      origin,
      capturedAt: new Date().toISOString(),
      cookies: [],
      authHeaders: { authorization: "Bearer stale" },
      authHeadersByOrigin: {
        [origin]: { authorization: "Bearer fresh" },
      },
    };
    const prepared = prepareReplay(tool, {}, auth, {
      allowedOrigin: origin,
      stripToolAuthorization: true,
      omitCookieHeader: true,
    });
    assert.equal(prepared.headers.authorization, "Bearer fresh");
    assert.equal(prepared.headers.Authorization, undefined);
    assert.equal(prepared.headers.Cookie, undefined);
  });
});

describe("normalizeHeaders", () => {
  it("collapses Content-Type / content-type duplicates", () => {
    const out = normalizeHeaders({
      Accept: "*/*",
      accept: "application/json",
      "content-type": "application/json",
      "Content-Type": "application/json",
    });
    const keys = Object.keys(out).map((k) => k.toLowerCase());
    assert.equal(keys.filter((k) => k === "content-type").length, 1);
    assert.equal(keys.filter((k) => k === "accept").length, 1);
  });
});

describe("isAuthExpiredStatus", () => {
  it("treats 401/403 and login redirects as expired", () => {
    assert.equal(isAuthExpiredStatus(401), true);
    assert.equal(isAuthExpiredStatus(403), true);
    assert.equal(isAuthExpiredStatus(302, "https://idp/login"), true);
    assert.equal(isAuthExpiredStatus(200), false);
  });
});
