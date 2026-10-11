import {
  cancelLoginSession,
  closeBrowserReplay,
  closeBrowserSession,
  ensureBrowserSession,
  exploreAndCapture,
} from "@auto-mcp/browser-auth";
import { normalizeCandidates } from "@auto-mcp/explorer";
import type { ApiCandidate, McpSite } from "@auto-mcp/shared";
import type { Registry } from "@auto-mcp/registry";
import type { Vault } from "@auto-mcp/vault";
import { persistCapture } from "./site-ops.js";

export type QuickScanContext = {
  registry: Registry;
  vault: Vault;
};

export type QuickScanResult = {
  site: McpSite;
  candidateCount: number;
  added: ApiCandidate[];
  reuseSession: boolean;
};

export async function quickScanOp(
  ctx: QuickScanContext,
  site: McpSite,
  opts: { reuseSession?: boolean; settleMs?: number } = {},
): Promise<QuickScanResult> {
  const reuseSession = opts.reuseSession !== false;
  const settleMs = opts.settleMs ?? 8000;
  const auth = ctx.vault.get(site.id);
  if (!auth) {
    throw new Error(
      "No auth session. Call login_start, log in in the browser, then login_confirm.",
    );
  }

  await cancelLoginSession(site.id);
  await closeBrowserReplay(site.id);

  const { round } = ctx.registry.startExploreRound(
    site.id,
    `quick-scan ${site.explorePath}`,
  );
  const focus = `quick-scan ${site.explorePath}`;
  const pageUrl = new URL(site.explorePath, site.baseUrl).toString();

  if (reuseSession) {
    const session = await ensureBrowserSession({
      siteId: site.id,
      baseUrl: site.baseUrl,
      profileDir: site.profileDir,
      auth,
    });
    session.markNetwork();
    await session.goto(site.explorePath);
    await session.wait(settleMs);
    const raw = session.networkSinceMarker();
    const normalized = normalizeCandidates(raw, site.baseUrl);
    const snap = await session.authSnapshot();
    ctx.vault.set(site.id, snap);
    const { site: updated, added } = ctx.registry.mergeSiteCandidates(
      site.id,
      normalized,
      { exploreRound: round.id, focus },
    );
    const ui = session.lastUiEvidence() ?? { pageUrl, gesture: "goto" as const };
    const withIr = persistCapture(
      { registry: ctx.registry },
      site.id,
      normalized,
      ui,
      round.id,
    );
    return {
      site: withIr,
      candidateCount: withIr.candidates.length,
      added,
      reuseSession: true,
    };
  }

  await closeBrowserSession(site.id);
  const result = await exploreAndCapture({
    siteId: site.id,
    baseUrl: site.baseUrl,
    explorePath: site.explorePath,
    profileDir: site.profileDir,
    auth,
    settleMs,
  });
  ctx.vault.set(site.id, result.authSnapshot);
  const normalized = normalizeCandidates(result.candidates, site.baseUrl);
  const { site: updated, added } = ctx.registry.mergeSiteCandidates(
    site.id,
    normalized,
    { exploreRound: round.id, focus },
  );
  const withIr = persistCapture(
    { registry: ctx.registry },
    site.id,
    normalized,
    { pageUrl, gesture: "goto" },
    round.id,
  );
  return {
    site: withIr,
    candidateCount: withIr.candidates.length,
    added,
    reuseSession: false,
  };
}
