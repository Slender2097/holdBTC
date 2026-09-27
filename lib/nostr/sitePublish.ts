import "server-only";
import {
  SimplePool,
  finalizeEvent,
  getPublicKey,
  nip19,
  type Event,
  type EventTemplate,
  type Filter,
} from "nostr-tools";
import { ENTRY_FEE_SATS } from "@/lib/security/rankedToken";

export const GAME_KIND = 33333;
export const GAME_TAG = "holdbtc";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.snort.social",
];

function siteSecret(): Uint8Array {
  const raw = process.env.HOLD_BTC_NSEC;
  if (!raw) throw new Error("HOLD_BTC_NSEC is not set");

  if (raw.startsWith("nsec")) {
    const decoded = nip19.decode(raw);
    if (decoded.type !== "nsec") throw new Error("Invalid HOLD_BTC_NSEC");
    return decoded.data as Uint8Array;
  }

  const hex = raw.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Invalid HOLD_BTC_NSEC hex");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function getSitePubkey(): string {
  return getPublicKey(siteSecret());
}

let pool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

export async function findScoreByInvoice(invoiceId: string): Promise<Event | null> {
  const author = getSitePubkey();
  const p = getPool();
  const filter: Filter = {
    kinds: [GAME_KIND],
    authors: [author],
    "#d": [invoiceId],
    limit: 5,
  };

  const events = await Promise.race([
    p.querySync(DEFAULT_RELAYS, filter),
    new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 7000)),
  ]);

  return events[0] || null;
}

export async function publishAttestedScore(params: {
  playerPubkey: string;
  score: number;
  distance: number;
  invoiceId: string;
}): Promise<Event> {
  const sk = siteSecret();
  const template: EventTemplate = {
    kind: GAME_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", GAME_TAG],
      ["d", params.invoiceId],
      ["p", params.playerPubkey.toLowerCase()],
      ["score", String(params.score)],
      ["distance", String(Math.floor(params.distance))],
      ["paid", String(ENTRY_FEE_SATS)],
      ["client", "holdbtc"],
    ],
    content: `Hold BTC attested score: ${params.score} pips`,
  };

  const event = finalizeEvent(template, sk);
  const p = getPool();
  let acks = 0;

  await Promise.all(
    DEFAULT_RELAYS.map(async (url) => {
      try {
        await p.ensureRelay(url);
        const pub = p.publish([url], event);
        const list = Array.isArray(pub) ? pub : [pub];
        await Promise.race([
          Promise.any(list.map((x: Promise<unknown>) => x)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
        acks += 1;
      } catch (err) {
        console.warn("Relay publish failed:", url, err);
      }
    })
  );

  if (acks === 0) {
    throw new Error("No relay accepted the attested score");
  }

  return event;
}

export async function fetchAttestedScores(limit = 50): Promise<
  Array<{
    pubkey: string;
    score: number;
    distance: number;
    created_at: number;
    eventId: string;
    invoiceId: string;
  }>
> {
  const author = getSitePubkey();
  const p = getPool();
  const filter: Filter = {
    kinds: [GAME_KIND],
    authors: [author],
    "#t": [GAME_TAG],
    limit: 300,
  };

  const events = await Promise.race([
    p.querySync(DEFAULT_RELAYS, filter),
    new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 8000)),
  ]);

  const latestByInvoice = new Map<string, Event>();
  for (const ev of events) {
    const invoiceId = ev.tags.find((t) => t[0] === "d")?.[1] || ev.id;
    const prev = latestByInvoice.get(invoiceId);
    if (!prev || ev.created_at > prev.created_at) latestByInvoice.set(invoiceId, ev);
  }

  const best = new Map<
    string,
    {
      pubkey: string;
      score: number;
      distance: number;
      created_at: number;
      eventId: string;
      invoiceId: string;
    }
  >();

  for (const ev of latestByInvoice.values()) {
    const player = ev.tags.find((t) => t[0] === "p")?.[1];
    const score = parseInt(ev.tags.find((t) => t[0] === "score")?.[1] || "", 10);
    const distance = parseInt(ev.tags.find((t) => t[0] === "distance")?.[1] || String(score), 10);
    const invoiceId = ev.tags.find((t) => t[0] === "d")?.[1] || ev.id;
    if (!player || !score || Number.isNaN(score)) continue;

    const pk = player.toLowerCase();
    const existing = best.get(pk);
    if (!existing || score > existing.score) {
      best.set(pk, {
        pubkey: pk,
        score,
        distance,
        created_at: ev.created_at,
        eventId: ev.id,
        invoiceId,
      });
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
