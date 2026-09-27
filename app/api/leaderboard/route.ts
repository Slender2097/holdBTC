import { NextRequest, NextResponse } from "next/server";
import { fetchAttestedScores } from "@/lib/nostr/sitePublish";
import { nip19 } from "nostr-tools";
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { isHexPubkey } from "@/lib/security/rankedToken";

const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://profiles.nostr1.com",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

let profilePool: SimplePool | null = null;
function getProfilePool(): SimplePool {
  if (!profilePool) profilePool = new SimplePool();
  return profilePool;
}

function toNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

function yearFromScore(score: number): number {
  return 2008 + Math.floor(Math.max(0, score) / 1000);
}

async function fetchProfiles(pubkeys: string[]) {
  const result = new Map<
    string,
    { name?: string; display_name?: string; picture?: string }
  >();
  if (pubkeys.length === 0) return result;

  const authors = [...new Set(pubkeys.map((p) => p.toLowerCase()))];
  const pool = getProfilePool();
  const filter: Filter = { kinds: [0], authors };
  try {
    const events = await Promise.race([
      pool.querySync(PROFILE_RELAYS, filter),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 8000)),
    ]);

    const newest = new Map<string, Event>();
    for (const ev of events) {
      const pk = ev.pubkey.toLowerCase();
      const prev = newest.get(pk);
      if (!prev || ev.created_at > prev.created_at) newest.set(pk, ev);
    }

    for (const [pk, ev] of newest) {
      try {
        const meta = JSON.parse(ev.content);
        result.set(pk, {
          name: meta.name || undefined,
          display_name: meta.display_name || meta.displayName || undefined,
          picture: safeHttpsImageUrl(meta.picture) || undefined,
        });
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error("profile fetch failed:", err);
  }

  return result;
}

async function fetchFollows(pubkey: string): Promise<Set<string>> {
  const out = new Set<string>();
  const pool = getProfilePool();
  const filter: Filter = { kinds: [3], authors: [pubkey.toLowerCase()], limit: 1 };
  try {
    const events = await Promise.race([
      pool.querySync(PROFILE_RELAYS, filter),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 7000)),
    ]);
    const ev = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!ev) return out;
    for (const tag of ev.tags) {
      if (tag[0] === "p" && tag[1] && isHexPubkey(tag[1])) {
        out.add(tag[1].toLowerCase());
      }
    }
  } catch (err) {
    console.error("follow list fetch failed:", err);
  }
  return out;
}

const cache = new Map<string, { at: number; entries: unknown[] }>();

export async function GET(req: NextRequest) {
  const limit = rateLimit(`board:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ entries: [], error: "Slow down" }, { status: 429 });
  }

  const tab = req.nextUrl.searchParams.get("tab") === "following" ? "following" : "global";
  const viewer = String(req.nextUrl.searchParams.get("pubkey") || "").trim().toLowerCase();
  const cacheKey = tab === "following" && isHexPubkey(viewer) ? `f:${viewer}` : "g";

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 45_000) {
    return NextResponse.json({ entries: hit.entries, tab });
  }

  try {
    let scores = await fetchAttestedScores(50);

    if (tab === "following") {
      if (!isHexPubkey(viewer)) {
        return NextResponse.json({ entries: [], tab, error: "Login to see followings" }, { status: 401 });
      }
      const follows = await fetchFollows(viewer);
      follows.add(viewer);
      scores = scores.filter((s) => follows.has(s.pubkey.toLowerCase()));
    }

    const profiles = await fetchProfiles(scores.map((s) => s.pubkey));

    const entries = scores.map((s) => {
      const pk = s.pubkey.toLowerCase();
      const profile = profiles.get(pk);
      return {
        pubkey: pk,
        npub: toNpub(pk),
        score: s.score,
        distance: s.distance,
        year: yearFromScore(s.score),
        created_at: s.created_at,
        eventId: s.eventId,
        profile: profile || undefined,
        displayName: profile?.display_name || profile?.name || undefined,
      };
    });

    cache.set(cacheKey, { at: Date.now(), entries });
    return NextResponse.json({ entries, tab });
  } catch (err) {
    console.error("leaderboard failed:", err);
    return NextResponse.json({ entries: [], error: "Leaderboard unavailable" }, { status: 502 });
  }
}
