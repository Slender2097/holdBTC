import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const SECRET = () => {
  const s = process.env.RANKED_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error("RANKED_TOKEN_SECRET is missing or too short");
  }
  return s;
};

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64url");
}

function hmac(data: string): string {
  return createHmac("sha256", SECRET()).update(data).digest("base64url");
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function makeClaimSecret(invoiceId: string): string {
  return hmac(`claim:${invoiceId}`);
}

export function verifyClaimSecret(invoiceId: string, secret: string): boolean {
  if (!invoiceId || !secret) return false;
  return safeEq(secret, makeClaimSecret(invoiceId));
}

export interface RankedPayload {
  pubkey: string;
  invoiceId: string;
  iat: number;
  exp: number;
  nonce: string;
}

export function issueRankedToken(pubkey: string, invoiceId: string, ttlSec = 2 * 60 * 60): string {
  const payload: RankedPayload = {
    pubkey: pubkey.toLowerCase(),
    invoiceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    nonce: randomBytes(8).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(`token:${body}`)}`;
}

export function verifyRankedToken(token: string): RankedPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEq(sig, hmac(`token:${body}`))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RankedPayload;
    if (!payload.pubkey || !payload.invoiceId) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    payload.pubkey = payload.pubkey.toLowerCase();
    return payload;
  } catch {
    return null;
  }
}

export function isHexPubkey(pk: string): boolean {
  return /^[0-9a-f]{64}$/i.test(pk);
}

export const MAX_RANKED_SCORE = 5_000_000;
export const ENTRY_FEE_SATS = 1000;
