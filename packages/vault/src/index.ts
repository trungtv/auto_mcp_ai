import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuthSnapshot } from "@auto-mcp/shared";

const ALGO = "aes-256-gcm";

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

/**
 * Encrypted auth vault shared by control-plane, meta MCP, and site MCP.
 * Reloads from disk when another process updates vault.enc (mtime), so
 * dashboard login_confirm is visible to a long-lived MCP without restart.
 */
export class Vault {
  private readonly filePath: string;
  private readonly key: Buffer;
  private data: Record<string, AuthSnapshot> = {};
  /** mtimeMs of last successful load/persist; null if file missing. */
  private loadedMtimeMs: number | null = null;

  constructor(dataDir: string, masterKey: string) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error("AUTO_MCP_MASTER_KEY must be at least 16 characters");
    }
    this.filePath = join(dataDir, "vault.enc");
    this.key = deriveKey(masterKey);
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.loadFromDisk();
  }

  private currentMtimeMs(): number | null {
    if (!existsSync(this.filePath)) return null;
    return statSync(this.filePath).mtimeMs;
  }

  /** Pull disk into memory when another writer changed vault.enc. */
  private syncFromDisk(): void {
    const mtime = this.currentMtimeMs();
    if (mtime === this.loadedMtimeMs) return;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) {
      this.data = {};
      this.loadedMtimeMs = null;
      return;
    }
    const raw = readFileSync(this.filePath);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    this.data = JSON.parse(plaintext.toString("utf8")) as Record<string, AuthSnapshot>;
    this.loadedMtimeMs = statSync(this.filePath).mtimeMs;
  }

  private persist(): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(this.data), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.filePath, Buffer.concat([iv, tag, ciphertext]));
    this.loadedMtimeMs = statSync(this.filePath).mtimeMs;
  }

  get(siteId: string): AuthSnapshot | null {
    this.syncFromDisk();
    return this.data[siteId] ?? null;
  }

  set(siteId: string, snapshot: AuthSnapshot): void {
    // Merge against latest disk so we don't clobber another process's writes.
    this.syncFromDisk();
    this.data[siteId] = snapshot;
    this.persist();
  }

  delete(siteId: string): void {
    this.syncFromDisk();
    delete this.data[siteId];
    this.persist();
  }

  has(siteId: string): boolean {
    this.syncFromDisk();
    return siteId in this.data;
  }
}
