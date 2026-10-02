import {
  closeBrowserReplay,
  ensureBrowserReplay,
} from "@auto-mcp/browser-auth";
import type { AuthSnapshot, McpSite } from "@auto-mcp/shared";
import type { ReplayFn } from "@auto-mcp/site-adapters";
import {
  AuthExpiredError,
  isAuthExpiredStatus,
  parseReplayBody,
  prepareReplay,
  replayTool,
} from "./replay.js";

export function createSiteReplay(opts: {
  site: McpSite;
  onAuth?: (snap: AuthSnapshot) => void;
}): ReplayFn {
  const site = opts.site;
  if (site.replayMode !== "browser") {
    return (tool, args, auth) =>
      replayTool(tool, args, auth, { allowedOrigin: site.baseUrl });
  }

  return async (tool, args, auth) => {
    const session = await ensureBrowserReplay({
      siteId: site.id,
      baseUrl: site.baseUrl,
      profileDir: site.profileDir,
    });
    let snap = auth;
    if (!session.hasWarmed) {
      snap = await session.warmUp();
      opts.onAuth?.(snap);
    }

    const runOnce = async (fresh: AuthSnapshot) => {
      const prepared = prepareReplay(tool, args, fresh, {
        allowedOrigin: site.baseUrl,
        stripToolAuthorization: true,
        omitCookieHeader: true,
      });
      return session.fetch(prepared.url.toString(), {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
      });
    };

    let res = await runOnce(snap);
    if (isAuthExpiredStatus(res.status, res.location)) {
      snap = await session.warmUp();
      opts.onAuth?.(snap);
      res = await runOnce(snap);
    }
    if (isAuthExpiredStatus(res.status, res.location)) {
      throw new AuthExpiredError(`HTTP ${res.status} — session likely expired`);
    }
    return { status: res.status, body: parseReplayBody(res.bodyText) };
  };
}

export { closeBrowserReplay };
