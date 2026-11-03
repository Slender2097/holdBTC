"use client";

/**
 * Browser storage for the Cashu wallet: IndexedDB, one database, three stores.
 *
 *   proofs  the player's ecash, one row per proof (key: secret)
 *   quotes  open NUT-04 mint quotes, with the blinded outputs saved before minting
 *   plays   a ranked payment sent to the server but not yet confirmed
 *
 * Every row carries mintUrl; only rows for the allowlisted mint are used.
 * Amounts are plain numbers here (cashu-ts Amount objects do not survive IndexedDB).
 */

export type ProofRow = {
  secret: string;
  mintUrl: string;
  id: string;
  amount: number;
  C: string;
  dleq?: { s: string; e: string; r?: string };
};

export type SerializedOutput = {
  blindedMessage: { amount: string; B_: string; id: string };
  blindingFactor: string;
  secret: string;
  ephemeralE?: string;
};

export type QuoteRow = {
  quote: string;
  mintUrl: string;
  amount: number;
  request: string;
  createdAt: number;
  expiry?: number | null;
  /** Saved before the mint call, so a lost reply can be restored (NUT-09). */
  outputs?: SerializedOutput[];
};

export type PlayRow = {
  runId: string;
  mintUrl: string;
  pubkey: string;
  token: string;
  inputSecrets: string[];
  totalSats: number;
  feeSats: number;
  changeOutputs: SerializedOutput[];
  createdAt: number;
};

const DB_NAME = "holdbtc-cashu";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("proofs")) db.createObjectStore("proofs", { keyPath: "secret" });
      if (!db.objectStoreNames.contains("quotes")) db.createObjectStore("quotes", { keyPath: "quote" });
      if (!db.objectStoreNames.contains("plays")) db.createObjectStore("plays", { keyPath: "runId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("IndexedDB unavailable"));
    };
  });
  return dbPromise;
}

type StoreName = "proofs" | "quotes" | "plays";

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

async function getAll<T extends { mintUrl: string }>(store: StoreName, mintUrl: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]).filter((r) => r.mintUrl === mintUrl));
    req.onerror = () => reject(req.error);
  });
}

export const loadProofs = (mintUrl: string) => getAll<ProofRow>("proofs", mintUrl);
export const loadQuotes = (mintUrl: string) => getAll<QuoteRow>("quotes", mintUrl);
export const loadPlays = (mintUrl: string) => getAll<PlayRow>("plays", mintUrl);

export async function putQuote(row: QuoteRow): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("quotes", "readwrite");
  tx.objectStore("quotes").put(row);
  await done(tx);
}

export async function deleteQuote(quote: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("quotes", "readwrite");
  tx.objectStore("quotes").delete(quote);
  await done(tx);
}

/** Minted: add the proofs and drop the quote in one transaction. */
export async function addMintedProofs(quote: string, proofs: ProofRow[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["proofs", "quotes"], "readwrite");
  const ps = tx.objectStore("proofs");
  for (const p of proofs) ps.put(p);
  tx.objectStore("quotes").delete(quote);
  await done(tx);
}

/** Saved before the token is sent. The input proofs stay in "proofs" until the server confirms. */
export async function putPlay(row: PlayRow): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("plays", "readwrite");
  tx.objectStore("plays").put(row);
  await done(tx);
}

/**
 * Server confirmed the swap: remove the spent inputs, add the change, drop the
 * pending play. One transaction, so a crash leaves either the old state or the new.
 */
export async function settlePlay(runId: string, spentSecrets: string[], change: ProofRow[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["proofs", "plays"], "readwrite");
  const ps = tx.objectStore("proofs");
  for (const s of spentSecrets) ps.delete(s);
  for (const p of change) ps.put(p);
  tx.objectStore("plays").delete(runId);
  await done(tx);
}

/** The play failed for good: drop it, and drop any inputs the mint says are spent. */
export async function dropPlay(runId: string, spentSecrets: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["proofs", "plays"], "readwrite");
  const ps = tx.objectStore("proofs");
  for (const s of spentSecrets) ps.delete(s);
  tx.objectStore("plays").delete(runId);
  await done(tx);
}
