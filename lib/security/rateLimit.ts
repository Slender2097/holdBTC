type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const HARD_CAP = 4000;
let calls = 0;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size > HARD_CAP) {
    const extra = buckets.size - HARD_CAP;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      removed += 1;
      if (removed >= extra) break;
    }
  }
}

export function rateLimit(key: string, max: number, windowMs: number): {
  ok: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  calls += 1;
  if (calls % 25 === 0 || buckets.size > 1500) sweep(now);

  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  if (current.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
}

/** Only the IP Vercel sets. Other IP headers can come from the client, so they are ignored. */
export function clientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  return vercel?.split(",")[0].trim() || "unknown";
}
