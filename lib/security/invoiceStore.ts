import "server-only";

/**
 * One-payment-one-run store, backed by Upstash Redis / Vercel KV (REST API).
 * Uses only GET and SET NX, so it needs no Lua/EVAL support.
 *
 * Env (either pair):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL + KV_REST_API_TOKEN   (Vercel KV / Upstash integration)
 *
 * Without them, `next dev` falls back to an in-process Map. On Vercel or in a
 * production build, a missing config throws so a deploy never silently runs
 * without a durable store.
 *
 * Keys (no TTL, never rewritten):
 *   submit:<invoiceId>        the one verified run for that invoice
 *   submit:<invoiceId>:event  the eventId it was published as
 */

export type SubmitRecord = {
  pubkey: string;
  score: number;
  distance: number;
  submittedAt: number;
};

function restConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "Invoice store is not configured: set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN"
    );
  }
  return null;
}

// Dev-only fallback. Not shared between instances.
const memory = new Map<string, string>();

async function redis(command: string[]): Promise<unknown> {
  const cfg = restConfig();
  if (!cfg) {
    const [op, key, value, ...opts] = command;
    if (op === "GET") return memory.get(key) ?? null;
    if (op === "SET" && opts.length === 1 && opts[0] === "NX") {
      if (memory.has(key)) return null;
      memory.set(key, value);
      return "OK";
    }
    throw new Error(`Unsupported dev store command: ${command.join(" ")}`);
  }
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || data.error) {
    throw new Error(`Invoice store error (${res.status}): ${data.error || "unknown"}`);
  }
  return data.result ?? null;
}

/** SET key value NX. Returns true only for the first writer. */
async function setNx(key: string, value: string): Promise<boolean> {
  return (await redis(["SET", key, value, "NX"])) === "OK";
}

async function getString(key: string): Promise<string | null> {
  const raw = await redis(["GET", key]);
  return typeof raw === "string" ? raw : null;
}

async function getRecord(invoiceId: string): Promise<SubmitRecord | null> {
  const raw = await getString(submitKey(invoiceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubmitRecord;
  } catch {
    return null;
  }
}

const submitKey = (invoiceId: string) => `submit:${invoiceId}`;
const eventKey = (invoiceId: string) => `submit:${invoiceId}:event`;

/**
 * Reserves the one submit for an invoice. If one already exists, returns it (and its
 * eventId, if published) so the caller can answer idempotently or re-publish the stored score.
 */
export async function reserveSubmit(
  invoiceId: string,
  record: Omit<SubmitRecord, "submittedAt">
): Promise<{ record: SubmitRecord | null; eventId: string | null }> {
  const full: SubmitRecord = { ...record, pubkey: record.pubkey.toLowerCase(), submittedAt: Date.now() };
  if (await setNx(submitKey(invoiceId), JSON.stringify(full))) {
    return { record: full, eventId: null };
  }
  return { record: await getRecord(invoiceId), eventId: await getString(eventKey(invoiceId)) };
}

/**
 * Writes the published eventId once. Refuses if the submit record belongs to another
 * pubkey or an eventId is already stored. The record is write-once, so the pubkey check
 * cannot go stale before the SET NX.
 */
export async function markSubmitPublished(invoiceId: string, pubkey: string, eventId: string): Promise<boolean> {
  const record = await getRecord(invoiceId);
  if (!record || record.pubkey !== pubkey.toLowerCase()) return false;
  return setNx(eventKey(invoiceId), eventId);
}
