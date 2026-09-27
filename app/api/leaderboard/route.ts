import { NextResponse } from "next/server";
import { fetchAttestedScores } from "@/lib/nostr/sitePublish";
import { nip19 } from "nostr-tools";
import { SimplePool, type Event, type Filter } from "nostr-tools";

const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

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

  const pool = new SimplePool();
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
          picture: meta.picture || undefined,
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

export async function GET() {
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

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("leaderboard failed:", err);
    return NextResponse.json({ entries: [], error: "Leaderboard unavailable" }, { status: 502 });
  }
}
