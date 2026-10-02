import { mkdirSync } from "node:fs";
import {
  chromium,
  type BrowserContext,
  type Cookie,
  type Page,
  type Request,
  type Response,
} from "playwright";
import {
  candidateKey,
  type ApiCandidate,
  type AuthSnapshot,
  type ObservedUi,
  type UiGesture,
} from "@auto-mcp/shared";
import {
  buildApiCandidate,
  extractReplayHeaders,
  isApiRequest,
  sampleRequestBody,
  sampleResponseBody,
} from "./api-capture.js";
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

type Captured = {
  at: number;
  candidate: ApiCandidate;
};

/**
 * Long-lived Playwright session for chat-driven explore.
 * One session per siteId; must not overlap login session on same profileDir.
 */
export class BrowserSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authByOrigin: AuthHeadersByOrigin = {};
  private captures: Captured[] = [];
  private markerMs = Date.now();
  private lastGesture: {
    gesture: UiGesture;
    targetText?: string;
    pageUrl: string;
    at: number;
  } | null = null;

  constructor(
    private readonly opts: {
      baseUrl: string;
      profileDir: string;
      siteId: string;
    },
  ) {}

  get isOpen(): boolean {
    return this.context != null && (this.context.pages().length ?? 0) > 0;
  }

  get url(): string {
    return this.page?.url() ?? "";
  }

  async open(auth?: AuthSnapshot | null): Promise<void> {
    if (this.context) return;
    mkdirSync(this.opts.profileDir, { recursive: true });
    acquireProfileLock({
      profileDir: this.opts.profileDir,
      siteId: this.opts.siteId,
      kind: "explore",
    });
    this.authByOrigin = { ...(auth?.authHeadersByOrigin ?? {}) };
    this.captures = [];
    this.markerMs = Date.now();
    this.context = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
    });
    if (auth?.cookies?.length) {
      await this.context.addCookies(
        auth.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
      );
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.on("request", (req: Request) => {
      recordAuthHeaders(this.authByOrigin, req.url(), req.headers());
    });
    this.page.on("response", (response: Response) => {
      void this.recordResponse(response);
    });
  }

  private async recordResponse(response: Response): Promise<void> {
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
      this.captures.push({ at: Date.now(), candidate });
      if (this.captures.length > 500) {
        this.captures = this.captures.slice(-400);
      }
    } catch {
      /* ignore */
    }
  }

  private ensurePage(): Page {
    if (!this.page || !this.context) {
      throw new Error("Browser session is not open. Call browser_open first.");
    }
    return this.page;
  }

  async goto(pathOrUrl: string): Promise<{ url: string }> {
    const page = this.ensurePage();
    const target = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : new URL(pathOrUrl, this.opts.baseUrl).toString();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (pathOrUrl.includes("#") || target.includes("#")) {
      const hash = pathOrUrl.includes("#")
        ? pathOrUrl.slice(pathOrUrl.indexOf("#"))
        : new URL(target).hash;
      if (hash) {
        await page.evaluate((h) => {
          if (window.location.hash !== h) window.location.hash = h;
        }, hash);
        await page.waitForTimeout(1500);
      }
    }
    this.lastGesture = {
      gesture: "goto",
      pageUrl: page.url(),
      at: Date.now(),
    };
    return { url: page.url() };
  }

  async click(opts: {
    selector?: string;
    text?: string;
    role?: string;
  }): Promise<{ ok: true; url: string }> {
    const page = this.ensurePage();
    if (opts.selector) {
      await page.click(opts.selector, { timeout: 15000 });
    } else if (opts.text) {
      await page.getByText(opts.text, { exact: false }).first().click({ timeout: 15000 });
    } else if (opts.role) {
      await page
        .getByRole(opts.role as Parameters<Page["getByRole"]>[0])
        .first()
        .click({ timeout: 15000 });
    } else {
      throw new Error("click requires selector, text, or role");
    }
    await page.waitForTimeout(800);
    this.lastGesture = {
      gesture: "click",
      targetText: opts.text ?? opts.selector ?? opts.role,
      pageUrl: page.url(),
      at: Date.now(),
    };
    return { ok: true, url: page.url() };
  }

  async fill(opts: {
    selector?: string;
    label?: string;
    value: string;
    pressEnter?: boolean;
  }): Promise<{ ok: true }> {
    const page = this.ensurePage();
    const locator = opts.selector
      ? page.locator(opts.selector).first()
      : opts.label
        ? page.getByLabel(opts.label, { exact: false }).first()
        : page.locator("input:visible, textarea:visible").first();
    await locator.fill(opts.value, { timeout: 15000 });
    if (opts.pressEnter) await locator.press("Enter");
    await page.waitForTimeout(1000);
    this.lastGesture = {
      gesture: "fill",
      targetText: opts.label ?? opts.selector,
      pageUrl: page.url(),
      at: Date.now(),
    };
    return { ok: true };
  }

  async wait(ms: number): Promise<{ ok: true }> {
    const page = this.ensurePage();
    await page.waitForTimeout(Math.min(Math.max(ms, 0), 30000));
    return { ok: true };
  }

  async snapshot(): Promise<{
    url: string;
    title: string;
    textSample: string;
  }> {
    const page = this.ensurePage();
    const title = await page.title();
    const textSample = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 2500),
    );
    return { url: page.url(), title, textSample };
  }

  lastUiEvidence(): ObservedUi | undefined {
    const pageUrl = this.page?.url() || this.lastGesture?.pageUrl;
    if (!pageUrl && !this.lastGesture) return undefined;
    return {
      pageUrl: pageUrl || this.lastGesture?.pageUrl || "",
      gesture: this.lastGesture?.gesture ?? "unknown",
      ...(this.lastGesture?.targetText
        ? { targetText: this.lastGesture.targetText }
        : {}),
    };
  }

  networkSinceMarker(): ApiCandidate[] {
    const since = this.markerMs;
    const byKey = new Map<string, ApiCandidate>();
    for (const c of this.captures) {
      if (c.at < since) continue;
      byKey.set(candidateKey(c.candidate), c.candidate);
    }
    return [...byKey.values()];
  }

  markNetwork(): { markedAt: string } {
    this.markerMs = Date.now();
    return { markedAt: new Date(this.markerMs).toISOString() };
  }

  async authSnapshot(): Promise<AuthSnapshot> {
    if (!this.context) throw new Error("Browser session is not open");
    const origin = new URL(this.opts.baseUrl).origin;
    const fields = snapshotAuthFields(this.authByOrigin, origin);
    return {
      cookies: (await this.context.cookies()).map(cookieToSnapshot),
      ...fields,
      capturedAt: new Date().toISOString(),
      origin,
    };
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined);
    this.context = null;
    this.page = null;
    this.captures = [];
    releaseProfileLock(this.opts.profileDir);
  }
}

const sessions = new Map<string, BrowserSession>();

export function getBrowserSession(siteId: string): BrowserSession | null {
  return sessions.get(siteId) ?? null;
}

export async function ensureBrowserSession(opts: {
  siteId: string;
  baseUrl: string;
  profileDir: string;
  auth?: AuthSnapshot | null;
}): Promise<BrowserSession> {
  let s = sessions.get(opts.siteId);
  if (s?.isOpen) return s;
  if (s) await s.close();
  s = new BrowserSession({
    baseUrl: opts.baseUrl,
    profileDir: opts.profileDir,
    siteId: opts.siteId,
  });
  await s.open(opts.auth);
  sessions.set(opts.siteId, s);
  return s;
}

export async function closeBrowserSession(siteId: string): Promise<void> {
  const s = sessions.get(siteId);
  if (!s) return;
  await s.close();
  sessions.delete(siteId);
}
