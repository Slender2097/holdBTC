import "server-only";

/**
 * One-payment-one-run store, backed by Upstash Redis / Vercel KV (REST API, SET NX).
 *
 * Env (either pair):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL + KV_REST_API_TOKEN   (Vercel KV / Upstash integration)
 *
 * Without them, `next dev` falls back to an in-process Map. On Vercel or in a
 * production build, a missing config throws so a deploy never silently runs
 * without a durable store. A single-process self-hosted `next start` can opt
 * into the in-process Map with INVOICE_STORE=memory.
 */

export type CreditRecord = {
  pubkey: string;
  token: string;
  seed: number | null;
  issuedAt: number;
};

export type SubmitRecord = {
  pubkey: string;
  score: number;
  distance: number;
  eventId: string | null;
  submittedAt: number;
};

const CREDIT_TTL_SEC = 30 * 24 * 60 * 60;

function restConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  if (process.env.INVOICE_STORE === "memory" && !process.env.VERCEL) return null;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "Invoice store is not configured: set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN"
    );
  }
  return null;
}

// Dev-only fallback. Not shared between instances.
const memory = new Map<string, string>();

async function redis(command: (string | number)[]): Promise<unknown> {
  const cfg = restConfig();
  if (!cfg) {
    const [op, key, value, ...opts] = command.map(String);
    if (op === "GET") return memory.get(key) ?? null;
    if (op === "SET") {
      if (opts.includes("NX") && memory.has(key)) return null;
      if (opts.includes("XX") && !memory.has(key)) return null;
      memory.set(key, value);
      return "OK";
    }
    throw new Error(`Unsupported dev store command: ${op}`);
  }
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command.map(String)),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || data.error) {
    throw new Error(`Invoice store error (${res.status}): ${data.error || "unknown"}`);
  }
  return data.result ?? null;
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redis(["GET", key]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** SET key value NX [EX ttl]. Returns true only for the first writer. */
async function setNx(key: string, value: unknown, ttlSec?: number): Promise<boolean> {
  const cmd: (string | number)[] = ["SET", key, JSON.stringify(value), "NX"];
  if (ttlSec) cmd.push("EX", ttlSec);
  return (await redis(cmd)) === "OK";
}

const creditKey = (invoiceId: string) => `credit:${invoiceId}`;
const submitKey = (invoiceId: string) => `submit:${invoiceId}`;

export function getCredit(invoiceId: string): Promise<CreditRecord | null> {
  return getJson<CreditRecord>(creditKey(invoiceId));
}

/**
 * Stores the ranked credit for an invoice once. If another credit already exists,
 * returns it instead (the caller decides whether the pubkey may reuse it).
 */
export async function claimCredit(
  invoiceId: string,
  record: Omit<CreditRecord, "issuedAt">
): Promise<{ created: true; record: CreditRecord } | { created: false; record: CreditRecord | null }> {
  const full: CreditRecord = { ...record, pubkey: record.pubkey.toLowerCase(), issuedAt: Date.now() };
  if (await setNx(creditKey(invoiceId), full, CREDIT_TTL_SEC)) {
    return { created: true, record: full };
  }
  return { created: false, record: await getCredit(invoiceId) };
}

/**
 * Reserves the one submit for an invoice. If one already exists, returns it so the
 * caller can answer idempotently or re-publish the stored score.
 */
export async function reserveSubmit(
  invoiceId: string,
  record: Omit<SubmitRecord, "eventId" | "submittedAt">
): Promise<{ created: true; record: SubmitRecord } | { created: false; record: SubmitRecord | null }> {
  const full: SubmitRecord = {
    ...record,
    pubkey: record.pubkey.toLowerCase(),
    eventId: null,
    submittedAt: Date.now(),
  };
  if (await setNx(submitKey(invoiceId), full, CREDIT_TTL_SEC)) {
    return { created: true, record: full };
  }
  return { created: false, record: await getJson<SubmitRecord>(submitKey(invoiceId)) };
}

/** Writes the published eventId back onto an existing submit record. */
export async function markSubmitPublished(
  invoiceId: string,
  record: SubmitRecord,
  eventId: string
): Promise<void> {
  await redis(["SET", submitKey(invoiceId), JSON.stringify({ ...record, eventId }), "XX", "EX", CREDIT_TTL_SEC]);
}
