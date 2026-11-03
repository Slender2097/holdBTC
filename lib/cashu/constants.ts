/**
 * Cashu ranked entry: shared by the browser wallet and the server.
 * The Lightning path keeps its own price (ENTRY_FEE_SATS = 1000) in lib/payments/lightning.ts.
 */

/** What the server keeps for one ranked run paid with ecash. Mint input fees are on top. */
export const CASHU_ENTRY_FEE_SATS = 500;

/** Ranked runs paid with ecash use this prefix in place of a Strike invoice id. */
export const CASHU_RUN_PREFIX = "cashu_";

/** Hard caps on what one redeem request may carry. */
export const CASHU_MAX_INPUTS = 64;
export const CASHU_MAX_CHANGE_OUTPUTS = 64;
export const CASHU_MAX_TOKEN_CHARS = 32_000;

/** Fund field limits (the mint may enforce tighter ones). */
export const CASHU_MIN_FUND_SATS = 1;
export const CASHU_MAX_FUND_SATS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One set of input proofs, one id. The browser and the server derive it the same way,
 * so the browser can sign a Nostr auth for it before it sends the token, and a retry of
 * the same token always lands on the same server record (same ranked token and seed).
 * Matches isSafeInvoiceId: "cashu_" + 40 hex chars.
 */
export async function cashuRunId(secrets: string[]): Promise<string> {
  const material = Array.from(new Set(secrets)).sort().join("\n");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`holdbtc-cashu-run:${material}`)
  );
  return `${CASHU_RUN_PREFIX}${toHex(digest).slice(0, 40)}`;
}

export function isCashuRunId(id: string): boolean {
  return /^cashu_[0-9a-f]{40}$/.test(id);
}
