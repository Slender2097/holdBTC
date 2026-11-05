"use client";

/**
 * Remote signer login (NIP-46, "Nostr Connect"), for Primal, nsec.app,
 * Amber and other bunkers. All protocol work is nostr-tools' BunkerSigner.
 * The page loads this module only when a remote login starts or resumes.
 * The user's private key never reaches this browser (see remoteSession.ts).
 */

import { generateSecretKey, getPublicKey, type Event, type EventTemplate } from "nostr-tools";
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  type BunkerPointer,
} from "nostr-tools/nip46";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  RemoteSignerError,
  isHex64,
  isRelayUrl,
  remoteErrorMessage,
  type SavedRemote,
} from "./remoteSession";

/** Relays the nostrconnect:// link asks the signer to answer on. */
export const NIP46_RELAYS = [
  "wss://relay.primal.net",
  "wss://relay.nsec.app",
  "wss://relay.damus.io",
];

/** Kinds Hold BTC asks the signer to sign: ranked auth (22242) and the share note (1). */
const PERMS = ["get_public_key", "sign_event:22242", "sign_event:1"];

export const CONNECT_TIMEOUT_MS = 120_000;
const PUBKEY_TIMEOUT_MS = 30_000;
const SIGN_TIMEOUT_MS = 90_000;

export interface RemoteSession {
  signer: BunkerSigner;
  saved: SavedRemote;
}

export interface ConnectRequest {
  uri: string;
  clientSk: Uint8Array;
}

// One pool for every remote session in this tab. Reconnect keeps the
// subscription alive when a phone drops the socket while the app is in the
// background.
let sharedPool: SimplePool | null = null;
function pool(): SimplePool {
  if (!sharedPool) sharedPool = new SimplePool({ enableReconnect: true, enablePing: true });
  return sharedPool;
}

function clientMetadata() {
  const url = typeof window !== "undefined" ? window.location.origin : "https://holdbtc.io";
  return { name: "Hold BTC", url, image: `${url}/icon.png` };
}

function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function abortError(): RemoteSignerError {
  return new RemoteSignerError("cancelled", "Remote login cancelled");
}

/** Races a promise against a timeout and an optional abort signal. */
function guard<T>(
  work: Promise<T>,
  ms: number,
  timeoutMessage: string,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(
      () => reject(new RemoteSignerError("timeout", timeoutMessage)),
      ms
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

/** A fresh nostrconnect:// link for the signer app to scan or open. */
export function createConnectRequest(): ConnectRequest {
  const clientSk = generateSecretKey();
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSk),
    relays: NIP46_RELAYS,
    secret: randomSecret(),
    perms: PERMS,
    ...clientMetadata(),
  });
  return { uri, clientSk };
}

async function finish(
  signer: BunkerSigner,
  clientSk: Uint8Array,
  signal?: AbortSignal
): Promise<RemoteSession> {
  const userPubkey = await guard(
    signer.getPublicKey(),
    PUBKEY_TIMEOUT_MS,
    "The signer connected but did not send your public key. Try again.",
    signal
  );
  if (!isHex64(userPubkey)) {
    throw new RemoteSignerError("invalid", "The signer sent an invalid public key.");
  }
  const bp = signer.bp;
  return {
    signer,
    saved: {
      v: 1,
      clientSk: bytesToHex(clientSk),
      bunkerPubkey: bp.pubkey,
      relays: bp.relays.slice(),
      secret: bp.secret,
      userPubkey: userPubkey.toLowerCase(),
    },
  };
}

/**
 * Waits for the signer app to answer a nostrconnect:// link, then asks for
 * the user's pubkey. Rejects on timeout, cancel, or a denied request.
 */
export async function waitForConnect(
  req: ConnectRequest,
  signal: AbortSignal,
  onauth?: (url: string) => void
): Promise<RemoteSession> {
  const stop = new AbortController();
  const relay = () => stop.abort();
  signal.addEventListener("abort", relay, { once: true });
  let signer: BunkerSigner | null = null;
  try {
    signer = await guard(
      BunkerSigner.fromURI(req.clientSk, req.uri, { pool: pool(), onauth }, stop.signal),
      CONNECT_TIMEOUT_MS,
      "No answer from the signer app. Try again.",
      signal
    );
    return await finish(signer, req.clientSk, signal);
  } catch (err) {
    stop.abort();
    signer?.close().catch(() => {});
    throw err;
  } finally {
    signal.removeEventListener("abort", relay);
  }
}

/** Connects with a bunker:// link (or name@domain NIP-05) the user pasted. */
export async function connectBunker(
  input: string,
  signal: AbortSignal,
  onauth?: (url: string) => void
): Promise<RemoteSession> {
  const trimmed = input.trim();
  const bp = await guard(
    parseBunkerInput(trimmed),
    15_000,
    "Could not read that bunker link.",
    signal
  );
  if (!bp || !isHex64(bp.pubkey) || !bp.relays.some(isRelayUrl)) {
    throw new RemoteSignerError("invalid", "That is not a bunker:// link.");
  }
  const pointer: BunkerPointer = {
    pubkey: bp.pubkey,
    relays: bp.relays.filter(isRelayUrl),
    secret: bp.secret,
  };
  const clientSk = generateSecretKey();
  const signer = BunkerSigner.fromBunker(clientSk, pointer, { pool: pool(), onauth });
  try {
    await guard(
      signer.connect(clientMetadata()),
      CONNECT_TIMEOUT_MS,
      "No answer from the signer app. Try again.",
      signal
    );
    return await finish(signer, clientSk, signal);
  } catch (err) {
    signer.close().catch(() => {});
    throw err;
  }
}

/** Reopens a saved session after a reload. Sends nothing until the first signature. */
export function resumeRemote(saved: SavedRemote, onauth?: (url: string) => void): BunkerSigner {
  return BunkerSigner.fromBunker(
    hexToBytes(saved.clientSk),
    { pubkey: saved.bunkerPubkey, relays: saved.relays, secret: saved.secret },
    { pool: pool(), onauth }
  );
}

/** Signs with the remote signer and checks the event is from the logged-in account. */
export async function remoteSign(
  signer: BunkerSigner,
  template: EventTemplate,
  expectedPubkey: string
): Promise<Event> {
  let signed: Event;
  try {
    signed = await guard(
      signer.signEvent(template),
      SIGN_TIMEOUT_MS,
      "Your signer app did not answer. Open it, approve the request, and try again."
    );
  } catch (err) {
    throw new Error(remoteErrorMessage(err, "Remote signing failed"));
  }
  if (signed.pubkey.toLowerCase() !== expectedPubkey.toLowerCase()) {
    throw new Error("Signed key does not match the logged-in Nostr user");
  }
  return signed;
}
