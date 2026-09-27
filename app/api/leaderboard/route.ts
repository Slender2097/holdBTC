import { NextRequest, NextResponse } from "next/server";
import { fetchAttestedScores } from "@/lib/nostr/sitePublish";
import { nip19 } from "nostr-tools";
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
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

async function fetchProfiles(pubkeys: string[]) {
  const result = new Map<
    string,
    { name?: string; display_name?: string; picture?: string }
  >();
  if (pubkeys.length === 0) return result;

  const pool = getProfilePool();
  const filter: Filter = { kinds: [0], authors: pubkeys };
  try {
    const events = await Promise.race([
      pool.querySync(PROFILE_RELAYS, filter),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 6000)),
    ]);

    const newest = new Map<string, Event>();
    for (const ev of events) {
      const prev = newest.get(ev.pubkey);
      if (!prev || ev.created_at > prev.created_at) newest.set(ev.pubkey, ev);
    }

    for (const [pk, ev] of newest) {
      try {
        const meta = JSON.parse(ev.content);
        result.set(pk.toLowerCase(), {
          name: meta.name || undefined,
          display_name: meta.display_name || undefined,
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

let cached:
  | { at: number; entries: unknown[] }
  | null = null;

export async function GET(req: NextRequest) {
  const limit = rateLimit(`board:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ entries: [], error: "Slow down" }, { status: 429 });
  }

  if (cached && Date.now() - cached.at < 45_000) {
    return NextResponse.json({ entries: cached.entries });
  }

  try {
    const scores = await fetchAttestedScores(50);
    const profiles = await fetchProfiles(scores.map((s) => s.pubkey));

    const entries = scores.map((s) => {
      const profile = profiles.get(s.pubkey);
      return {
        pubkey: s.pubkey,
        npub: toNpub(s.pubkey),
        score: s.score,
        distance: s.distance,
        created_at: s.created_at,
        eventId: s.eventId,
        profile: profile || undefined,
        displayName: profile?.display_name || profile?.name || undefined,
      };
    });

    cached = { at: Date.now(), entries };
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("leaderboard failed:", err);
    return NextResponse.json({ entries: [], error: "Leaderboard unavailable" }, { status: 502 });
  }
}
