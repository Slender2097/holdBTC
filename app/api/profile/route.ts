import { NextRequest, NextResponse } from "next/server";
import { fetchProfiles, type ServerProfile } from "@/lib/nostr/profiles";
import { publicName } from "@/lib/security/blockList";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { isHexPubkey } from "@/lib/security/rankedToken";

const HIT_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

const cache = new Map<string, { at: number; profile: ServerProfile | null }>();
const inflight = new Map<string, Promise<ServerProfile | null>>();

function readCache(pubkey: string) {
  const hit = cache.get(pubkey);
  if (!hit) return undefined;
  const ttl = hit.profile ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - hit.at < ttl) return hit.profile;
  cache.delete(pubkey);
  return undefined;
}

function writeCache(pubkey: string, profile: ServerProfile | null) {
  cache.delete(pubkey);
  cache.set(pubkey, { at: Date.now(), profile });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function loadProfile(pubkey: string): Promise<ServerProfile | null> {
  const pending = inflight.get(pubkey);
  if (pending) return pending;
  const run = (async () => {
    const found = (await fetchProfiles([pubkey])).get(pubkey);
    const profile: ServerProfile | null = found
      ? {
          name: publicName(found.name),
          display_name: publicName(found.display_name),
          picture: found.picture,
        }
      : null;
    writeCache(pubkey, profile);
    return profile;
  })();
  inflight.set(pubkey, run);
  try {
    return await run;
  } finally {
    inflight.delete(pubkey);
  }
}

/** Kind 0 name and picture for one pubkey, read from relays by the server. */
export async function GET(req: NextRequest) {
  const limit = rateLimit(`profile:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ profile: null, error: "Slow down" }, { status: 429 });
  }

  const pubkey = String(req.nextUrl.searchParams.get("pubkey") || "").trim().toLowerCase();
  if (!isHexPubkey(pubkey)) {
    return NextResponse.json({ profile: null, error: "Invalid pubkey" }, { status: 400 });
  }

  const cached = readCache(pubkey);
  const profile = cached !== undefined ? cached : await loadProfile(pubkey);
  return NextResponse.json(
    { profile },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
