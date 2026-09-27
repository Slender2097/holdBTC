import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.RANKED_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error("RANKED_TOKEN_SECRET missing");
  return s;
}

function hmac(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export type ChallengeScope = "invoice" | "credit";

const BUCKET_SEC = 180;

export function issueChallenge(params: {
  pubkey: string;
  scope: ChallengeScope;
  invoiceId?: string;
}): { challenge: string; exp: number } {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / BUCKET_SEC);
  const exp = (bucket + 1) * BUCKET_SEC + BUCKET_SEC;
  const pk = params.pubkey.toLowerCase();
  const invoicePart = params.scope === "credit" ? `:${params.invoiceId || ""}` : "";
  const material = `${pk}:${params.scope}${invoicePart}:${bucket}`;
  return { challenge: hmac(`chal:${material}`), exp };
}

export function verifyScopedChallenge(params: {
  challenge: string;
  pubkey: string;
  scope: ChallengeScope;
  invoiceId?: string;
}): boolean {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / BUCKET_SEC);
  const pk = params.pubkey.toLowerCase();
  const invoicePart = params.scope === "credit" ? `:${params.invoiceId || ""}` : "";
  for (const b of [bucket, bucket - 1]) {
    const material = `${pk}:${params.scope}${invoicePart}:${b}`;
    const expected = hmac(`chal:${material}`);
    const a = Buffer.from(params.challenge);
    const bbuf = Buffer.from(expected);
    if (a.length === bbuf.length && timingSafeEqual(a, bbuf)) return true;
  }
  return false;
}
