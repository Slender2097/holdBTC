"use client";

/**
 * Saved remote signer (NIP-46) connection, and its error messages. No
 * nostr-tools here, so the page can check for a saved session without
 * loading the NIP-46 code.
 *
 * The user's private key never reaches this browser. What is kept in
 * localStorage is the connection only: a throwaway client key this site made
 * for the session (the bunker approved that key, so a reload needs it to
 * talk to the same signer again), the bunker pubkey, its relays and the
 * connect secret.
 */

const REMOTE_KEY = "holdbtc_nip46";

export interface SavedRemote {
  v: 1;
  /** Hex secret of the throwaway client key (not the user's key). */
  clientSk: string;
  bunkerPubkey: string;
  relays: string[];
  secret: string | null;
  /** The account the signer signs as; null while the login has not finished. */
  userPubkey: string | null;
}

export class RemoteSignerError extends Error {
  readonly reason: "timeout" | "denied" | "cancelled" | "invalid" | "failed";
  constructor(reason: RemoteSignerError["reason"], message: string) {
    super(message);
    this.name = "RemoteSignerError";
    this.reason = reason;
  }
}

export function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const u = new URL(value);
    return u.protocol === "wss:" || u.protocol === "ws:";
  } catch {
    return false;
  }
}

/** Turns what a bunker sends back on failure into a message for the player. */
export function remoteErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof RemoteSignerError) return err.message;
  const msg = String((err as any)?.message || err || "");
  if (/reject|denied|declin|not allowed|unauthori|permission/i.test(msg)) {
    return "The request was denied in your signer app.";
  }
  if (/subscription closed before connection|connection failed|no relays/i.test(msg)) {
    return "Could not reach the signer relays. Check your connection and try again.";
  }
  return msg ? `${fallback}: ${msg}` : fallback;
}

export function saveRemote(saved: SavedRemote) {
  try {
    localStorage.setItem(REMOTE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

export function loadRemote(): SavedRemote | null {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (
      d?.v === 1 &&
      isHex64(d.clientSk) &&
      isHex64(d.bunkerPubkey) &&
      (d.userPubkey === null || isHex64(d.userPubkey)) &&
      Array.isArray(d.relays) &&
      d.relays.length > 0 &&
      d.relays.every(isRelayUrl) &&
      (d.secret === null || typeof d.secret === "string")
    ) {
      return d as SavedRemote;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearRemote() {
  try {
    localStorage.removeItem(REMOTE_KEY);
  } catch {
    /* ignore */
  }
}
