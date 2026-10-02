import { candidateKey, type ApiCandidate } from "@auto-mcp/shared";

const PII_KEY = /mssv|studentid|student_id|email|phone|sdt|hoten|ho_ten|fullname|cmnd|cccd|diachi|address/i;

function redactValue(key: string, value: unknown): unknown {
  if (PII_KEY.test(key) && (typeof value === "string" || typeof value === "number")) {
    return "[REDACTED]";
  }
  return value;
}

export function redactDeep(input: unknown, depth = 0): unknown {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) {
    return input.slice(0, 5).map((v) => redactDeep(v, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactDeep(redactValue(k, v), depth + 1);
    }
    return out;
  }
  if (typeof input === "string" && input.length > 500) {
    // Keep GWT-RPC payloads intact for replay (strong name + args).
    if (/^\d+\|\d+\|/.test(input)) return input;
    return `${input.slice(0, 500)}…`;
  }
  return input;
}

export function normalizeCandidates(raw: ApiCandidate[], baseOrigin: string): ApiCandidate[] {
  const origin = new URL(baseOrigin).origin;
  const filtered = raw.filter((c) => {
    try {
      const u = new URL(c.url);
      if (u.origin !== origin) return false;
      if (
        /google-analytics\.com|googletagmanager\.com|facebook\.com|doubleclick\.net|vbeecore\.com/i.test(
          u.hostname,
        )
      ) {
        return false;
      }
      if (c.status !== undefined && c.status >= 400) return false;
      return true;
    } catch {
      return false;
    }
  });

  return filtered.map((c) => ({
    ...c,
    requestBodySample: redactDeep(c.requestBodySample),
    responseBodySample: redactDeep(c.responseBodySample),
  }));
}

export function candidateSummaryForPrompt(candidates: ApiCandidate[]): string {
  return candidates
    .slice(0, 40)
    .map((c, i) => {
      const path = (() => {
        try {
          const u = new URL(c.url);
          return `${u.pathname}${u.search}`;
        } catch {
          return c.url;
        }
      })();
      return [
        `### Candidate ${i + 1} (id=${c.id})`,
        `- ${c.method} ${path}`,
        `- status: ${c.status ?? "n/a"}`,
        `- requestBody: ${JSON.stringify(c.requestBodySample ?? null)}`,
        `- responseSample: ${JSON.stringify(c.responseBodySample ?? null)}`,
      ].join("\n");
    })
    .join("\n\n");
}

/** Merge by METHOD + origin+pathname; newer sample wins, keep discovery metadata. */
export function mergeCandidates(
  existing: ApiCandidate[],
  incoming: ApiCandidate[],
  meta?: { exploreRound?: number },
): { merged: ApiCandidate[]; added: ApiCandidate[] } {
  const map = new Map<string, ApiCandidate>();
  for (const c of existing) map.set(candidateKey(c), c);
  const added: ApiCandidate[] = [];
  const now = new Date().toISOString();
  for (const raw of incoming) {
    const next: ApiCandidate = {
      ...raw,
      discoveredAt: raw.discoveredAt ?? now,
      exploreRound: meta?.exploreRound ?? raw.exploreRound,
    };
    const key = candidateKey(next);
    if (!map.has(key)) added.push(next);
    map.set(key, next);
  }
  return { merged: [...map.values()], added };
}
