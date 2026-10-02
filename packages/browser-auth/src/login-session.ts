import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Cookie, type Page, type Request } from "playwright";
import type { AuthSnapshot } from "@auto-mcp/shared";
import {
  recordAuthHeaders,
  snapshotAuthFields,
  type AuthHeadersByOrigin,
} from "./auth-origin.js";
import { acquireProfileLock, releaseProfileLock } from "./profile-lock.js";

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

export class LoginSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authByOrigin: AuthHeadersByOrigin = {};
  private readonly baseUrl: string;
  private readonly profileDir: string;
  private readonly siteId: string;

  constructor(opts: { baseUrl: string; profileDir: string; siteId: string }) {
    this.baseUrl = opts.baseUrl;
    this.profileDir = opts.profileDir;
    this.siteId = opts.siteId;
  }

  get isOpen(): boolean {
    return this.context != null && this.context.pages().length > 0;
  }

  async start(): Promise<void> {
    if (this.context) {
      await this.cancel();
    }
    mkdirSync(this.profileDir, { recursive: true });
    acquireProfileLock({
      profileDir: this.profileDir,
      siteId: this.siteId,
      kind: "login",
    });
    this.authByOrigin = {};
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.on("request", (req: Request) => {
      recordAuthHeaders(this.authByOrigin, req.url(), req.headers());
    });
    await this.page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });
  }

  async capture(): Promise<AuthSnapshot> {
    if (!this.context || !this.isOpen) {
      throw new Error("Không có phiên đăng nhập đang mở. Bấm Đăng nhập trước.");
    }
    const origin = new URL(this.baseUrl).origin;
    const fields = snapshotAuthFields(this.authByOrigin, origin);
    const snapshot: AuthSnapshot = {
      cookies: (await this.context.cookies()).map(cookieToSnapshot),
      ...fields,
      capturedAt: new Date().toISOString(),
      origin,
    };
    await this.context.close();
    this.context = null;
    this.page = null;
    releaseProfileLock(this.profileDir);
    return snapshot;
  }

  async cancel(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.page = null;
    this.authByOrigin = {};
    releaseProfileLock(this.profileDir);
  }
}

/** In-memory active login sessions keyed by site id. */
const activeSessions = new Map<string, LoginSession>();

export async function startLoginSession(opts: {
  siteId: string;
  baseUrl: string;
  profileDir: string;
}): Promise<void> {
  const existing = activeSessions.get(opts.siteId);
  if (existing) await existing.cancel();
  // Caller must close explore/replay sessions on the same profile first.
  const session = new LoginSession({
    baseUrl: opts.baseUrl,
    profileDir: opts.profileDir,
    siteId: opts.siteId,
  });
  await session.start();
  activeSessions.set(opts.siteId, session);
}

export function hasLoginSession(siteId: string): boolean {
  const s = activeSessions.get(siteId);
  return Boolean(s?.isOpen);
}

export async function completeLoginSession(siteId: string): Promise<AuthSnapshot> {
  const session = activeSessions.get(siteId);
  if (!session) {
    throw new Error("Không có phiên đăng nhập đang mở. Bấm Đăng nhập trước.");
  }
  try {
    return await session.capture();
  } finally {
    activeSessions.delete(siteId);
  }
}

export async function cancelLoginSession(siteId: string): Promise<void> {
  const session = activeSessions.get(siteId);
  if (!session) return;
  await session.cancel();
  activeSessions.delete(siteId);
}
