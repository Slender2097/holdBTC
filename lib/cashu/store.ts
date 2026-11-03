import "server-only";
import fs from "fs";
import path from "path";

/**
 * Store for the Cashu ranked entry, on the same Upstash Redis / Vercel KV as
 * lib/security/invoiceStore.ts (same env vars). Kept separate so the Lightning
 * store is not touched.
 *
 * Keys (cashu:<runId> is the id from lib/cashu/constants.ts cashuRunId):
 *   cashu:lock:<runId>     short lock while one request talks to the mint (SET NX EX)
 *   cashu:pending:<runId>  the exact swap request, written before the mint is called
 *   cashu:done:<runId>     the result: ranked token, seed, change signatures (write once)
 *   cashu:vault:<runId>    the server's proofs, AES-256-GCM sealed (write once)
 *   cashu:vault:index      list of runIds with a vault entry (RPUSH)
 *   cashu:admin:fail:*     failed /admin/cashu logins in the current window (INCR, EX)
 *
 * Without Redis config, `next dev` uses a JSON file in ./data (gitignored) so a
 * local test survives a dev-server restart and scripts/cashu-vault-export.mjs can
 * read it. On Vercel or in production a missing config throws.
 */

function restConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "Cashu store is not configured: set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN"
    );
  }
  return null;
}

// ---- dev fallback: one JSON file, read-modify-write in a single process ----

type DevEntry = { v: string | string[]; exp?: number };
const DEV_FILE = path.join(process.cwd(), "data", "cashu-dev-store.json");
let devCache: Record<string, DevEntry> | null = null;

function devLoad(): Record<string, DevEntry> {
  if (devCache) return devCache;
  try {
    devCache = JSON.parse(fs.readFileSync(DEV_FILE, "utf8")) as Record<string, DevEntry>;
  } catch {
    devCache = {};
  }
  return devCache;
}

function devSave() {
  fs.mkdirSync(path.dirname(DEV_FILE), { recursive: true });
  fs.writeFileSync(DEV_FILE, JSON.stringify(devCache, null, 1));
}

function devLive(key: string): DevEntry | null {
  const db = devLoad();
  const e = db[key];
  if (!e) return null;
  if (e.exp && e.exp <= Date.now()) {
    delete db[key];
    return null;
  }
  return e;
}

function devCommand(command: string[]): unknown {
  const [op, key, value, ...opts] = command;
  const db = devLoad();
  switch (op) {
    case "GET": {
      const e = devLive(key);
      return typeof e?.v === "string" ? e.v : null;
    }
    case "SET": {
      const nx = opts.includes("NX");
      const exIdx = opts.indexOf("EX");
      if (nx && devLive(key)) return null;
      db[key] = { v: value, exp: exIdx >= 0 ? Date.now() + Number(opts[exIdx + 1]) * 1000 : undefined };
      devSave();
      return "OK";
    }
    case "DEL": {
      const had = key in db;
      delete db[key];
      devSave();
      return had ? 1 : 0;
    }
    case "RPUSH": {
      const e = devLive(key);
      const list = Array.isArray(e?.v) ? e!.v : [];
      list.push(value);
      db[key] = { v: list };
      devSave();
      return list.length;
    }
    case "LRANGE": {
      const e = devLive(key);
      return Array.isArray(e?.v) ? e!.v : [];
    }
    case "INCR": {
      const e = devLive(key);
      const n = (typeof e?.v === "string" ? Number(e.v) || 0 : 0) + 1;
      db[key] = { v: String(n), exp: e?.exp };
      devSave();
      return n;
    }
    case "EXPIRE": {
      const e = devLive(key);
      if (!e) return 0;
      e.exp = Date.now() + Number(value) * 1000;
      devSave();
      return 1;
    }
  }
  throw new Error(`Unsupported dev store command: ${op}`);
}

async function redis(command: string[]): Promise<unknown> {
  const cfg = restConfig();
  if (!cfg) return devCommand(command);
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || data.error) {
    throw new Error(`Cashu store error (${res.status}): ${data.error || "unknown"}`);
  }
  return data.result ?? null;
}

export async function storeGet(key: string): Promise<string | null> {
  const raw = await redis(["GET", key]);
  return typeof raw === "string" ? raw : null;
}

export async function storeGetJson<T>(key: string): Promise<T | null> {
  const raw = await storeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** SET NX (optionally with a TTL). True only for the first writer. */
export async function storeSetNx(key: string, value: string, ttlSec?: number): Promise<boolean> {
  const cmd = ["SET", key, value, "NX"];
  if (ttlSec) cmd.push("EX", String(ttlSec));
  return (await redis(cmd)) === "OK";
}

export async function storeDel(key: string): Promise<void> {
  await redis(["DEL", key]);
}

export async function storePush(key: string, value: string): Promise<void> {
  await redis(["RPUSH", key, value]);
}

/** Whole list (LRANGE 0 -1). */
export async function storeList(key: string): Promise<string[]> {
  const raw = await redis(["LRANGE", key, "0", "-1"]);
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Counter for a fixed window: the first hit sets a TTL of `windowSec`, later hits only
 * count. Returns the count after this hit.
 */
export async function storeIncrWindow(key: string, windowSec: number): Promise<number> {
  await redis(["SET", key, "0", "NX", "EX", String(windowSec)]);
  const n = Number(await redis(["INCR", key]));
  // The window expired between SET and INCR: give the new key its TTL.
  if (n === 1) await redis(["EXPIRE", key, String(windowSec)]);
  return n;
}
