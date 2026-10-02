import { mkdirSync } from "node:fs";
import {
  chromium,
  type APIResponse,
  type BrowserContext,
  type Cookie,
  type Page,
  type Request,
} from "playwright";
import type { AuthSnapshot } from "@auto-mcp/shared";
import {
  recordAuthHeaders,
  snapshotAuthFields,
  type AuthHeadersByOrigin,
} from "./auth-origin.js";
import { getBrowserSession } from "./browser-session.js";
import { hasLoginSession } from "./login-session.js";
import { acquireProfileLock, releaseProfileLock } from "./profile-lock.js";

const IDLE_MS = 5 * 60 * 1000;
const SETTLE_MS = 4000;

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

export type BrowserFetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
};

/**
 * Headless persistent-context replay for OIDC/SPA sites.
 * Warm-up navigates baseUrl so the SPA refreshes Bearer tokens.
 */
export class BrowserReplaySession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authByOrigin: AuthHeadersByOrigin = {};
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private warmed = false;

  constructor(
    private readonly opts: {
      siteId: string;
      baseUrl: string;
      profileDir: string;
    },
  ) {}

  get isOpen(): boolean {
    return this.context != null && (this.context.pages().length ?? 0) > 0;
  }

  get hasWarmed(): boolean {
    return this.warmed;
  }

  async ensureOpen(): Promise<void> {
    if (this.context) {
      this.bumpIdle();
      return;
    }
    if (hasLoginSession(this.opts.siteId)) {
      throw new Error(
        "Profile đang dùng bởi login — hoàn tất hoặc hủy đăng nhập trước.",
      );
    }
    const explore = getBrowserSession(this.opts.siteId);
    if (explore?.isOpen) {
      throw new Error(
        "Profile đang dùng bởi explore — đóng chat/explore browser trước khi replay.",
      );
    }
    mkdirSync(this.opts.profileDir, { recursive: true });
    acquireProfileLock({
      profileDir: this.opts.profileDir,
      siteId: this.opts.siteId,
      kind: "replay",
    });
    this.authByOrigin = {};
    this.context = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.on("request", (req: Request) => {
      recordAuthHeaders(this.authByOrigin, req.url(), req.headers());
    });
    this.bumpIdle();
  }

  async warmUp(): Promise<AuthSnapshot> {
    await this.ensureOpen();
    const page = this.page;
    const context = this.context;
    if (!page || !context) {
      throw new Error("Browser replay context failed to open");
    }
    await page.goto(this.opts.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(SETTLE_MS);
    this.warmed = true;
    this.bumpIdle();
    return this.authSnapshot();
  }

  async authSnapshot(): Promise<AuthSnapshot> {
    if (!this.context) throw new Error("Browser replay is not open");
    const origin = new URL(this.opts.baseUrl).origin;
    const fields = snapshotAuthFields(this.authByOrigin, origin);
    return {
      cookies: (await this.context.cookies()).map(cookieToSnapshot),
      ...fields,
      capturedAt: new Date().toISOString(),
      origin,
    };
  }

  async fetch(
    url: string,
    init: BrowserFetchInit,
  ): Promise<{ status: number; bodyText: string; location: string }> {
    await this.ensureOpen();
    const context = this.context;
    if (!context) throw new Error("Browser replay is not open");
    try {
      const res: APIResponse = await context.request.fetch(url, {
        method: init.method,
        headers: init.headers,
        data: init.body,
        maxRedirects: 0,
        timeout: 60000,
        failOnStatusCode: false,
      });
      const location = res.headers()["location"] ?? "";
      const bodyText = await res.text();
      this.bumpIdle();
      return { status: res.status(), bodyText, location };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/redirect|401|403|login|sso/i.test(message)) {
        return { status: 401, bodyText: message, location: "" };
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.context) await this.context.close().catch(() => undefined);
    this.context = null;
    this.page = null;
    this.authByOrigin = {};
    this.warmed = false;
    releaseProfileLock(this.opts.profileDir);
  }

  private bumpIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close().then(() => {
        replaySessions.delete(this.opts.siteId);
      });
    }, IDLE_MS);
    if (typeof this.idleTimer.unref === "function") this.idleTimer.unref();
  }
}

const replaySessions = new Map<string, BrowserReplaySession>();

export async function ensureBrowserReplay(opts: {
  siteId: string;
  baseUrl: string;
  profileDir: string;
}): Promise<BrowserReplaySession> {
  let s = replaySessions.get(opts.siteId);
  if (s?.isOpen) return s;
  if (s) await s.close();
  s = new BrowserReplaySession(opts);
  replaySessions.set(opts.siteId, s);
  await s.ensureOpen();
  return s;
}

export async function closeBrowserReplay(siteId: string): Promise<void> {
  const s = replaySessions.get(siteId);
  if (!s) return;
  await s.close();
  replaySessions.delete(siteId);
}
