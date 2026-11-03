import "server-only";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { storeDel, storeGet, storeIncrWindow } from "@/lib/cashu/store";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

/**
 * Login for /admin/cashu (operator only, not linked from the game).
 *
 *   CASHU_ADMIN_USER      admin user name
 *   CASHU_ADMIN_PASSWORD  admin password, at least 12 characters. Must not be
 *                         CASHU_VAULT_KEY, RANKED_TOKEN_SECRET or a Nostr key.
 *
 * The session is a signed cookie (HMAC-SHA256). The signing key is derived from the
 * user and password with scrypt, so changing CASHU_ADMIN_PASSWORD logs every session
 * out, and the key shares nothing with CASHU_VAULT_KEY or any Nostr key.
 *
 * Failed logins are counted in the Cashu store (same Redis), so the limit holds across
 * serverless instances: per IP and for all IPs together. A locked-out request is refused
 * before the password is even compared.
 */

export const ADMIN_COOKIE_PATH = "/admin/cashu";
export const ADMIN_SESSION_TTL_SEC = 8 * 60 * 60;

const isProd = process.env.NODE_ENV === "production";
export const ADMIN_COOKIE_NAME = isProd ? "__Secure-holdbtc-cashu-admin" : "holdbtc-cashu-admin";

const FAIL_WINDOW_SEC = 15 * 60;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_ALL = 30;
const MIN_PASSWORD_LENGTH = 12;

type AdminCreds = { user: string; password: string };

export type AdminConfig = { ok: true; creds: AdminCreds } | { ok: false; reason: string };

export function adminConfig(): AdminConfig {
  const user = (process.env.CASHU_ADMIN_USER || "").trim();
  const password = process.env.CASHU_ADMIN_PASSWORD || "";
  if (!user || !password) {
    return { ok: false, reason: "Admin login is not set up. Set CASHU_ADMIN_USER and CASHU_ADMIN_PASSWORD." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `CASHU_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const p = password.trim();
  const secrets = [process.env.CASHU_VAULT_KEY, process.env.RANKED_TOKEN_SECRET, process.env.HOLD_BTC_NSEC]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  if (secrets.includes(p) || /^nsec1/i.test(p)) {
    return {
      ok: false,
      reason: "CASHU_ADMIN_PASSWORD must be its own secret, not CASHU_VAULT_KEY, RANKED_TOKEN_SECRET or a Nostr key.",
    };
  }
  return { ok: true, creds: { user, password } };
}

// ---- session cookie ----

let keyCache: { id: string; key: Buffer } | null = null;

function sessionKey(creds: AdminCreds): Buffer {
  const id = createHash("sha256").update(`${creds.user}\0${creds.password}`).digest("hex");
  if (keyCache?.id === id) return keyCache.key;
  // scrypt: a stolen cookie does not make guessing the password cheap.
  const key = scryptSync(creds.password, `holdbtc-cashu-admin-session:${creds.user}`, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  keyCache = { id, key };
  return key;
}

const sign = (body: string, key: Buffer) => createHmac("sha256", key).update(`cashu-admin:${body}`).digest("base64url");

function safeEq(a: string | Buffer, b: string | Buffer): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSession(): string | null {
  const cfg = adminConfig();
  if (!cfg.ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ u: cfg.creds.user, iat: now, exp: now + ADMIN_SESSION_TTL_SEC, n: randomBytes(8).toString("hex") })
  ).toString("base64url");
  return `v1.${body}.${sign(body, sessionKey(cfg.creds))}`;
}

export function verifySession(cookie: string | undefined | null): boolean {
  if (!cookie || cookie.length > 1024) return false;
  const cfg = adminConfig();
  if (!cfg.ok) return false;
  const [v, body, sig, extra] = cookie.split(".");
  if (v !== "v1" || !body || !sig || extra !== undefined) return false;
  if (!safeEq(sig, sign(body, sessionKey(cfg.creds)))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: string; exp?: number };
    return payload.u === cfg.creds.user && typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAge = ADMIN_SESSION_TTL_SEC) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: ADMIN_COOKIE_PATH,
    maxAge,
  };
}

// ---- request checks ----

/** Production must be HTTPS (localhost excepted, for `next start` on your own machine). */
export function isHttpsOk(req: Request): boolean {
  if (!isProd) return true;
  const url = new URL(req.url);
  // The host the browser used (req.url can carry the server's own bind address).
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host).split(",")[0].trim();
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return true;
  const proto = (req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0].trim();
  return proto === "https";
}

/** POSTs must come from this site's own page (on top of the sameSite=lax cookie). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---- login with rate limit ----

export type LoginResult =
  | { ok: true }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfterSec?: number };

const failKeyIp = (ip: string) => `cashu:admin:fail:ip:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
const FAIL_KEY_ALL = "cashu:admin:fail:all";

async function failCount(key: string): Promise<number> {
  return Number((await storeGet(key)) || 0) || 0;
}

export async function attemptLogin(req: Request, user: string, password: string): Promise<LoginResult> {
  const cfg = adminConfig();
  if (!cfg.ok) return { ok: false, status: 503, error: cfg.reason };

  const ip = clientIp(req);
  // First layer, in memory: every attempt counts, right or wrong.
  const burst = rateLimit(`cashu-admin-login:${ip}`, 10, FAIL_WINDOW_SEC * 1000);
  if (!burst.ok) {
    return { ok: false, status: 429, error: "Too many attempts. Try again later.", retryAfterSec: burst.retryAfterSec };
  }

  // Second layer, in the store: failed attempts per IP and for everyone together.
  let storeOk = true;
  try {
    const [ipFails, allFails] = await Promise.all([failCount(failKeyIp(ip)), failCount(FAIL_KEY_ALL)]);
    if (ipFails >= MAX_FAILS_PER_IP || allFails >= MAX_FAILS_ALL) {
      return { ok: false, status: 429, error: "Too many failed attempts. Try again later.", retryAfterSec: FAIL_WINDOW_SEC };
    }
  } catch (err) {
    console.error("cashu admin: login counter read failed:", err);
    storeOk = false;
    // Without the store, keep only a tight in-memory limit.
    const strict = rateLimit(`cashu-admin-login-strict:${ip}`, 3, FAIL_WINDOW_SEC * 1000);
    if (!strict.ok) {
      return { ok: false, status: 429, error: "Too many attempts. Try again later.", retryAfterSec: strict.retryAfterSec };
    }
  }

  // Compare both, always, in constant time.
  const userOk = safeEq(String(user || ""), cfg.creds.user);
  const passOk = safeEq(String(password || ""), cfg.creds.password);
  if (userOk && passOk) {
    if (storeOk) await storeDel(failKeyIp(ip)).catch(() => undefined);
    return { ok: true };
  }

  if (storeOk) {
    await Promise.all([
      storeIncrWindow(failKeyIp(ip), FAIL_WINDOW_SEC),
      storeIncrWindow(FAIL_KEY_ALL, FAIL_WINDOW_SEC),
    ]).catch((err) => console.error("cashu admin: login counter write failed:", err));
  }
  console.warn(`cashu admin: failed login from ${ip}`);
  // Slow down guessing a little more.
  await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 200)));
  return { ok: false, status: 401, error: "Wrong user name or password." };
}
