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
  saveRemote,
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
// Phones: the player is in the signer app, and the browser may sleep.
const PUBKEY_TIMEOUT_PHONE_MS = 60_000;
const SIGN_TIMEOUT_MS = 90_000;

export interface RemoteSession {
  signer: BunkerSigner;
  saved: SavedRemote & { userPubkey: string };
}

export interface ConnectRequest {
  uri: string;
  clientSk: Uint8Array;
}

// One pool for every remote session in this tab. Reconnect keeps the
// subscription alive when a phone drops the socket while the app is in the
// background.
//
// No idle close. In a browser, nostr-tools' ping is a short REQ, and closing it
// lowers the relay's count of open work without having raised it. So after the
// first ping (29 s) the signer's own subscription counts as idle, and the
// default 20 s idle timer closed every signer relay 49 s after it connected:
// an approval that took longer than that was never heard.
const NO_IDLE_CLOSE_MS = 24 * 60 * 60 * 1000;
let sharedPool: SimplePool | null = null;
function pool(): SimplePool {
  if (!sharedPool) {
    sharedPool = new SimplePool({ enableReconnect: true, enablePing: true });
    sharedPool.idleTimeout = NO_IDLE_CLOSE_MS;
  }
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

function pubkeyWindowMs(): number {
  try {
    return window.matchMedia("(pointer: coarse)").matches
      ? PUBKEY_TIMEOUT_PHONE_MS
      : PUBKEY_TIMEOUT_MS;
  } catch {
    return PUBKEY_TIMEOUT_MS;
  }
}

/**
 * Asks the signer for the user's pubkey, always with the same client key.
 *
 * On a phone the page sleeps while the player approves in Primal, and the
 * relay socket can drop with the reply in it. So: if the first ask fails or
 * times out, ask once more with a new window; and the first time the page
 * comes back to the foreground, open fresh relay sockets and ask again.
 */
function askPubkey(signer: BunkerSigner, signal?: AbortSignal): Promise<string> {
  const windowMs = pubkeyWindowMs();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let retried = false;
    let askedOnReturn = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastError: unknown = null;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      signal?.removeEventListener("abort", onAbort);
    };
    const failed = (n: number, err: unknown) => {
      if (settled || n !== attempt) return; // an older ask; a newer one is in flight
      lastError = err;
      if (!retried) {
        retried = true;
        ask();
        return;
      }
      cleanup();
      reject(
        lastError instanceof RemoteSignerError
          ? lastError
          : new Error(remoteErrorMessage(lastError, "Your signer did not send your public key"))
      );
    };
    const ask = () => {
      const n = ++attempt;
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          failed(
            n,
            new RemoteSignerError(
              "timeout",
              "Your signer approved Hold BTC but did not send your public key."
            )
          ),
        windowMs
      );
      signer.sendRequest("get_public_key", []).then(
        (pubkey) => {
          if (settled) return;
          cleanup();
          resolve(pubkey);
        },
        (err) => failed(n, err)
      );
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || askedOnReturn || settled) return;
      askedOnReturn = true;
      // A socket can die silently in the background. Closing it ends the
      // signer's subscription, and the next request opens a new one.
      try {
        pool().close(signer.bp.relays);
      } catch {
        /* ask anyway */
      }
      ask();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    ask();
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
  // The signer approved this client key. Keep the connection now, so a
  // failed pubkey step can be resumed with the same key instead of a new one.
  saveRemote(toSaved(signer, clientSk, null));
  const userPubkey = await askPubkey(signer, signal);
  if (!isHex64(userPubkey)) {
    throw new RemoteSignerError("invalid", "The signer sent an invalid public key.");
  }
  const pubkey = userPubkey.toLowerCase();
  return { signer, saved: { ...toSaved(signer, clientSk, pubkey), userPubkey: pubkey } };
}

function toSaved(
  signer: BunkerSigner,
  clientSk: Uint8Array,
  userPubkey: string | null
): SavedRemote {
  const bp = signer.bp;
  return {
    v: 1,
    clientSk: bytesToHex(clientSk),
    bunkerPubkey: bp.pubkey,
    relays: bp.relays.slice(),
    secret: bp.secret,
    userPubkey,
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

/**
 * Finishes a saved connection whose login did not complete: same client key
 * and bunker, so the signer needs no new approval. Asks for the pubkey again.
 */
export async function resumePending(
  saved: SavedRemote,
  signal: AbortSignal,
  onauth?: (url: string) => void
): Promise<RemoteSession> {
  const signer = resumeRemote(saved, onauth);
  try {
    return await finish(signer, hexToBytes(saved.clientSk), signal);
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

/**
 * Sends sign_event and waits for the answer.
 *
 * On a phone the player approves in the signer app while this page sleeps.
 * If the relay socket died meanwhile, the answer is lost: NIP-46 messages are
 * ephemeral, so no relay sends it again. So each time the page comes back to
 * the foreground with no answer yet, open fresh relay sockets and send the
 * same request again. The first answer wins; each ask gets the full window.
 */
function askSign(signer: BunkerSigner, template: EventTemplate): Promise<Event> {
  return new Promise<Event>((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      done();
    };
    const ask = () => {
      const n = ++attempt;
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          settle(() =>
            reject(
              new RemoteSignerError(
                "timeout",
                "Your signer app did not answer. Open it, approve the request, and try again."
              )
            )
          ),
        SIGN_TIMEOUT_MS
      );
      signer.signEvent(template).then(
        (signed) => settle(() => resolve(signed)),
        // A reply from the signer (a denial) ends it, whichever ask it answers.
        // A send that failed counts only for the newest ask.
        (err) => {
          if (n === attempt || typeof err === "string") settle(() => reject(err));
        }
      );
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || settled) return;
      // Same as the pubkey step: closing the sockets ends the signer's
      // subscription, and the next request opens a new one.
      try {
        pool().close(signer.bp.relays);
      } catch {
        /* ask anyway */
      }
      ask();
    };

    document.addEventListener("visibilitychange", onVisible);
    ask();
  });
}

/** Signs with the remote signer and checks the event is from the logged-in account. */
export async function remoteSign(
  signer: BunkerSigner,
  template: EventTemplate,
  expectedPubkey: string
): Promise<Event> {
  let signed: Event;
  try {
    signed = await askSign(signer, template);
  } catch (err) {
    throw new Error(remoteErrorMessage(err, "Remote signing failed"));
  }
  if (signed.pubkey.toLowerCase() !== expectedPubkey.toLowerCase()) {
    throw new Error("Signed key does not match the logged-in Nostr user");
  }
  return signed;
}
