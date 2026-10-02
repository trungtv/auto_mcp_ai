/**
 * Resolve step arg templates.
 * - `{{input.issueKey}}` → capability args
 * - `{{steps.0.issue.key}}` → prior step structuredContent
 * - bare string → literal
 */
export function resolveArgTemplates(
  templates: Record<string, string>,
  scope: { input: Record<string, unknown>; steps: Record<string, unknown>[] },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(templates)) {
    const trimmed = raw.trim();
    const m = /^\{\{\s*(.+?)\s*\}\}$/.exec(trimmed);
    if (!m) {
      out[key] = raw;
      continue;
    }
    const path = m[1]!;
    const value = getPath(scope, path);
    if (value === undefined) {
      throw new Error(
        `Pipeline template {{${path}}} resolved to undefined (arg \`${key}\`)`,
      );
    }
    out[key] = value;
  }
  return out;
}

function getPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
