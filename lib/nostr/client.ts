"use client";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import { shareNoteContent, shareNoteTags } from "./shareNote";
import { shortNpub, toNpub } from "./utils";

export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

function buildNoteTemplate(score: number, distance: number): EventTemplate {
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: shareNoteTags(),
    content: shareNoteContent(score),
  };
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

/** Signs the share note in the browser. The server publishes it to relays. */
export async function publishNote(params: {
  sk?: Uint8Array | null;
  score: number;
  distance: number;
}): Promise<Event | null> {
  const { sk, score, distance } = params;
  const template = buildNoteTemplate(score, distance);
  const signed = await signTemplate(template, sk);
  if (!signed) return null;

  const res = await fetch("/api/share-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: signed }),
  });
  if (!res.ok) {
    let message = "Share failed";
    try {
      message = (await res.json()).error || message;
    } catch {
      message = res.status === 404 ? "Share route is missing" : message;
    }
    throw new Error(message);
  }
  return signed;
}

/** The logged-in user's profile, read from relays by /api/profile. */
export async function fetchOwnProfile(pubkey: string): Promise<NostrProfile | null> {
  const res = await fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.profile && typeof data.profile === "object" ? (data.profile as NostrProfile) : null;
}

export type Nip07FailureReason = "unavailable" | "cancelled";

export class Nip07Error extends Error {
  readonly reason: Nip07FailureReason;
  constructor(reason: Nip07FailureReason, message: string) {
    super(message);
    this.name = "Nip07Error";
    this.reason = reason;
  }
}

export type Nip07LoginResult =
  | { status: "ok"; pubkey: string }
  | { status: "missing" }
  | { status: "cancelled" }
  | { status: "locked" };

const EXTENSION_LOCKED = /until the next reload/i;

export async function requestNip07PublicKey(): Promise<Nip07LoginResult> {
  if (typeof window === "undefined") return { status: "missing" };
  const nostr = (window as any).nostr;
  if (!nostr?.getPublicKey) return { status: "missing" };
  try {
    const pubkey = await nostr.getPublicKey();
    return pubkey ? { status: "ok", pubkey } : { status: "cancelled" };
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (EXTENSION_LOCKED.test(msg)) return { status: "locked" };
    console.warn("Nostr extension: login not approved", msg);
    return { status: "cancelled" };
  }
}

export async function getNip07PublicKey(): Promise<string | null> {
  const result = await requestNip07PublicKey();
  return result.status === "ok" ? result.pubkey : null;
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