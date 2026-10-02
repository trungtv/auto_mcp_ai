import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Cookie, type Request } from "playwright";
import { candidateKey, type ApiCandidate, type AuthSnapshot } from "@auto-mcp/shared";
import {
  buildApiCandidate,
  extractReplayHeaders,
  isApiRequest,
  sampleRequestBody,
  sampleResponseBody,
} from "./api-capture.js";
import { recordAuthHeaders, snapshotAuthFields } from "./auth-origin.js";
import { acquireProfileLock, releaseProfileLock } from "./profile-lock.js";

export {
  buildApiCandidate,
  extractAuthHeaders,
  extractReplayHeaders,
  isApiRequest,
  sampleRequestBody,
  sampleResponseBody,
} from "./api-capture.js";

export {
  LoginSession,
  startLoginSession,
  completeLoginSession,
  cancelLoginSession,
  hasLoginSession,
} from "./login-session.js";

export {
  BrowserSession,
  getBrowserSession,
  ensureBrowserSession,
  closeBrowserSession,
} from "./browser-session.js";

export {
  BrowserReplaySession,
  ensureBrowserReplay,
  closeBrowserReplay,
} from "./browser-replay.js";

export {
  authHeadersForOrigin,
  recordAuthHeaders,
  snapshotAuthFields,
  stripAuthorization,
} from "./auth-origin.js";

export interface LoginOptions {
  baseUrl: string;
  profileDir: string;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}

export interface ExploreOptions {
  baseUrl: string;
  explorePath: string;
  profileDir: string;
  settleMs?: number;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}

function cookieToSnapshot(c: Cookie): AuthSnapshot["cookies"][number] {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite:
      c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None"
        ? c.sameSite
        : undefined,
  };
}

async function openContext(profileDir: string): Promise<BrowserContext> {
  mkdirSync(profileDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });
}

export interface ExploreResult {
  candidates: ApiCandidate[];
  authSnapshot: AuthSnapshot;
}

export async function exploreAndCapture(options: ExploreOptions): Promise<ExploreResult> {
  const settleMs = options.settleMs ?? 8000;
  options.onStatus?.("Opening authenticated browser for explore…");
  acquireProfileLock({
    profileDir: options.profileDir,
    siteId: options.profileDir,
    kind: "explore",
  });
  let context: BrowserContext | null = null;
  try {
  context = await openContext(options.profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  const authByOrigin: Record<string, Record<string, string>> = {};
  const seen = new Map<string, ApiCandidate>();

  page.on("request", (req: Request) => {
    recordAuthHeaders(authByOrigin, req.url(), req.headers());
  });

  page.on("response", async (response) => {
    try {
      const req = response.request();
      const url = response.url();
      const resourceType = req.resourceType();
      if (!isApiRequest(url, resourceType)) return;
      const method = req.method().toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return;

      const ct = response.headers()["content-type"] ?? "";
      const responseBodySample = await sampleResponseBody({
        contentType: ct,
        text: () => response.text(),
        json: () => response.json(),
      });

      const candidate = buildApiCandidate({
        method,
        url,
        status: response.status(),
        requestHeaders: extractReplayHeaders(req.headers()),
        requestBodySample: sampleRequestBody(
          req.postData(),
          req.postDataBuffer(),
        ),
        responseBodySample,
        contentType: ct,
        resourceHint: resourceType,
      });
      seen.set(candidateKey(candidate), candidate);
    } catch {
      /* ignore response parse errors */
    }
  });

  const target = new URL(options.explorePath, options.baseUrl).toString();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 60000 });
  options.onStatus?.(`Settling on ${target} to capture XHR/fetch…`);
  await page.waitForTimeout(settleMs);

  if (options.explorePath.includes("#")) {
    await page.evaluate((hash) => {
      const h = hash.includes("#") ? hash.slice(hash.indexOf("#")) : hash;
      if (window.location.hash !== h) window.location.hash = h;
    }, options.explorePath);
    await page.waitForTimeout(settleMs / 2);
  }

  const origin = new URL(options.baseUrl).origin;
  const fields = snapshotAuthFields(authByOrigin, origin);
  const authSnapshot: AuthSnapshot = {
    cookies: (await context.cookies()).map(cookieToSnapshot),
    ...fields,
    capturedAt: new Date().toISOString(),
    origin,
  };

  await context.close();
  context = null;
  options.onStatus?.(`Captured ${seen.size} API candidates.`);
  return { candidates: [...seen.values()], authSnapshot };
  } finally {
    if (context) await context.close().catch(() => undefined);
    releaseProfileLock(options.profileDir);
  }
}
