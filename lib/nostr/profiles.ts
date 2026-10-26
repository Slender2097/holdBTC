import "server-only";
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";

export const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://profiles.nostr1.com",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

export interface ServerProfile {
  name?: string;
  display_name?: string;
  picture?: string;
}

let profilePool: SimplePool | null = null;
export function getProfilePool(): SimplePool {
  if (!profilePool) profilePool = new SimplePool();
  return profilePool;
}

/** Newest kind 0 per pubkey. Picture is https only. Keys are lowercase hex. */
export async function fetchProfiles(pubkeys: string[]): Promise<Map<string, ServerProfile>> {
  const result = new Map<string, ServerProfile>();
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
