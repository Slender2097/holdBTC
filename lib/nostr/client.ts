"use client";

import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import {
  DEFAULT_RELAYS,
  GAME_KIND,
  GAME_TAG,
  GAME_TAGS,
  SCORE_EVENT_CONTENT_PREFIX,
} from "./constants";
import { shortNpub, toNpub } from "./utils";

export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

export interface ScoreEntry {
  pubkey: string;
  npub: string;
  score: number;
  distance: number;
  created_at: number;
  eventId: string;
  profile?: NostrProfile;
  displayName?: string;
}

const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  "wss://profiles.nostr1.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr.wine",
];

let pool: SimplePool | null = null;

function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

function buildScoreTemplate(score: number, distance: number): EventTemplate {
  return {
    kind: GAME_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", GAME_TAG],
      ["score", String(score)],
      ["distance", String(Math.floor(distance))],
      ["client", "holdbtc"],
      ["d", `holdbtc-score-${Date.now()}`],
    ],
    content: `${SCORE_EVENT_CONTENT_PREFIX} ${score} pips`,
  };
}

function buildNoteTemplate(score: number, distance: number): EventTemplate {
  const year = 2008 + Math.floor(Math.max(0, score) / 1000);
  const text =
    `Year ${year} on Hold BTC — ${score.toLocaleString("en-US")} pips.\n` +
    `Ranked run, replay-checked by the server before it counted.\n` +
    `https://holdbtc.io`;

  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", "holdbtc"], ["client", "holdbtc"]],
    content: text,
  };
}

async function publishToRelays(event: Event, relays: string[]): Promise<string[]> {
  const p = getPool();
  const accepted: string[] = [];

  await Promise.all(
    relays.map(async (url) => {
      try {
        await p.ensureRelay(url);
        const pub = p.publish([url], event);
        const list = Array.isArray(pub) ? pub : [pub];
        await Promise.race([
          Promise.any(list.map((x: Promise<unknown>) => x)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 5000)
          ),
        ]);
        accepted.push(url);
      } catch (err) {
        console.warn("Relay publish failed:", url, err);
      }
    })
  );

  return accepted;
}

async function signTemplate(
  template: EventTemplate,
  sk?: Uint8Array | null
): Promise<Event | null> {
  // If a private key was provided (nsec login), ALWAYS use it.
  // Do not fall back to the browser extension (different account).
  if (sk) {
    try {
      return finalizeEvent(template, sk);
    } catch (err) {
      console.error("Local sign failed:", err);
      return null;
    }
  }

  // No sk → extension login (NIP-07)
  if (typeof window !== "undefined" && (window as any).nostr?.signEvent) {
    try {
      const signed = await (window as any).nostr.signEvent(template);
      if (signed) return signed;
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (/reject|denied|cancel/i.test(msg)) {
        console.warn("Nostr extension: user rejected signing");
      } else {
        console.error("NIP-07 sign failed:", err);
      }
    }
  }

  return null;
}

export async function publishScore(params: {
  sk?: Uint8Array | null;
  score: number;
  distance: number;
  relays?: string[];
}): Promise<Event | null> {
  const { sk, score, distance, relays = DEFAULT_RELAYS } = params;
  const template = buildScoreTemplate(score, distance);
  const signed = await signTemplate(template, sk);
  if (!signed) return null;

  const accepted = await publishToRelays(signed, relays);
  console.log("Score event", signed.id, "accepted by", accepted);
  return signed;
}

export async function publishNote(params: {
  sk?: Uint8Array | null;
  score: number;
  distance: number;
  relays?: string[];
}): Promise<Event | null> {
  const { sk, score, distance, relays = DEFAULT_RELAYS } = params;
  const template = buildNoteTemplate(score, distance);
  const signed = await signTemplate(template, sk);
  if (!signed) return null;

  const accepted = await publishToRelays(signed, relays);
  console.log("Note event", signed.id, "accepted by", accepted);
  return signed;
}

export async function fetchProfiles(
  pubkeys: string[]
): Promise<Map<string, NostrProfile>> {
  const result = new Map<string, NostrProfile>();
  if (pubkeys.length === 0) return result;

  const p = getPool();
  try {
    const events = await Promise.race([
      p.querySync(PROFILE_RELAYS, { kinds: [0], authors: pubkeys }),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 6000)),
    ]);

    const newest = new Map<string, Event>();
    for (const ev of events) {
      const existing = newest.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        newest.set(ev.pubkey, ev);
      }
    }

    for (const [pubkey, ev] of newest) {
      try {
        const meta = JSON.parse(ev.content);
        if (meta && typeof meta === "object") {
          result.set(pubkey, {
            name: meta.name || undefined,
            display_name: meta.display_name || undefined,
            picture: meta.picture || undefined,
            about: meta.about || undefined,
            nip05: meta.nip05 || undefined,
          });
        }
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error("Failed to fetch profiles:", err);
  }

  return result;
}

export async function fetchLeaderboard(limit = 40): Promise<ScoreEntry[]> {
  const p = getPool();

  try {
    // Query each tag separately (querySync expects a single Filter)
    const eventArrays = await Promise.all(
      GAME_TAGS.map((t) =>
        Promise.race([
          p.querySync(DEFAULT_RELAYS, {
            kinds: [GAME_KIND],
            "#t": [t],
            limit: 150,
          }),
          new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 8000)),
        ])
      )
    );
    const events = eventArrays.flat();

    const best = new Map<string, ScoreEntry>();

    for (const ev of events) {
      const scoreTag = ev.tags.find((t) => t[0] === "score");
      const distTag = ev.tags.find((t) => t[0] === "distance");
      const score = scoreTag ? parseInt(scoreTag[1], 10) : 0;
      const distance = distTag ? parseInt(distTag[1], 10) : score;
      if (!score || isNaN(score)) continue;

      const existing = best.get(ev.pubkey);
      if (!existing || score > existing.score) {
        best.set(ev.pubkey, {
          pubkey: ev.pubkey,
          npub: toNpub(ev.pubkey),
          score,
          distance,
          created_at: ev.created_at,
          eventId: ev.id,
        });
      }
    }

    let list = Array.from(best.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (list.length > 0) {
      const profiles = await fetchProfiles(list.map((e) => e.pubkey));
      for (const entry of list) {
        const profile = profiles.get(entry.pubkey);
        if (profile) {
          entry.profile = profile;
          entry.displayName =
            profile.display_name || profile.name || undefined;
        }
      }
    }

    return list;
  } catch (err) {
    console.error("Leaderboard fetch error:", err);
    return [];
  }
}

export async function getNip07PublicKey(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const nostr = (window as any).nostr;
  if (!nostr?.getPublicKey) return null;
  try {
    return await nostr.getPublicKey();
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (/reject|denied|cancel/i.test(msg)) {
      console.warn("Nostr extension: user rejected login");
    }
    return null;
  }
}

export async function publishScoreSmart(params: {
  score: number;
  distance: number;
  sk?: Uint8Array | null;
  relays?: string[];
}): Promise<Event | null> {
  return publishScore(params);
}

export function createEphemeralKey(): {
  sk: Uint8Array;
  pk: string;
  npub: string;
} {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { sk, pk, npub: toNpub(pk) };
}

export { shortNpub, toNpub };