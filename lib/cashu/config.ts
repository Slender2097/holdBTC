import "server-only";
import { normalizeMintUrl } from "@cashu/cashu-ts";

/**
 * Server config for the Cashu ranked entry.
 *
 *   CASHU_MINT_URL   the one mint the server accepts ecash from (hard allowlist).
 *                    The browser is told this URL; it never gets to name one.
 *   CASHU_VAULT_KEY  32 random bytes, as 64 hex chars or base64. Encrypts the proofs
 *                    the server receives (AES-256-GCM) and derives the server's
 *                    NUT-13 output secrets, so a lost mint reply can be restored.
 *                    Generate with: openssl rand -hex 32
 *
 * Without both, the Cashu button reports "not available" and the redeem route refuses.
 */

export function cashuMintUrl(): string | null {
  const raw = (process.env.CASHU_MINT_URL || "").trim();
  if (!raw) return null;
  try {
    const url = normalizeMintUrl(raw);
    // Plain http only for a mint on this machine (local test mint).
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" && !(protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname))) {
      console.error("CASHU_MINT_URL must be https (http is allowed only for localhost)");
      return null;
    }
    return url;
  } catch {
    console.error("CASHU_MINT_URL is not a valid mint URL");
    return null;
  }
}

/** True only when `url` is exactly the allowlisted mint (after the same normalization). */
export function isAllowedMint(url: string): boolean {
  const allowed = cashuMintUrl();
  if (!allowed) return false;
  try {
    return normalizeMintUrl(url) === allowed;
  } catch {
    return false;
  }
}

export function cashuVaultKey(): Buffer | null {
  const raw = (process.env.CASHU_VAULT_KEY || "").trim();
  if (!raw) return null;
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error("CASHU_VAULT_KEY must be 32 bytes (64 hex chars or base64)");
    return null;
  }
  return key;
}

export function cashuConfigured(): boolean {
  return cashuMintUrl() !== null && cashuVaultKey() !== null;
}
