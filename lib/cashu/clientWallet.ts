"use client";

import {
  Amount,
  NetworkError,
  OutputData,
  Wallet,
  getEncodedToken,
  isMintOperationError,
  normalizeProofAmounts,
  type Proof,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import {
  CASHU_MAX_FUND_SATS,
  CASHU_MIN_FUND_SATS,
  cashuRunId,
} from "@/lib/cashu/constants";
import {
  addMintedProofs,
  deleteQuote,
  dropPlay,
  putPlay,
  putQuote,
  settlePlay,
  type PlayRow,
  type ProofRow,
  type QuoteRow,
  type SerializedOutput,
} from "@/lib/cashu/db";

/**
 * Browser side of the Cashu wallet. The browser holds the ecash; the server only
 * ever sees a token when the player pays for a ranked run.
 */

export type CashuConfig = { enabled: boolean; mintUrl?: string; priceSats: number };

export async function fetchCashuConfig(): Promise<CashuConfig> {
  const res = await fetch("/api/cashu/config", { cache: "no-store" });
  if (!res.ok) throw new Error("config");
  return (await res.json()) as CashuConfig;
}

export async function connectWallet(mintUrl: string): Promise<Wallet> {
  const wallet = new Wallet(mintUrl, { unit: "sat" });
  await wallet.loadMint();
  return wallet;
}

// ---- conversions ----

const num = (a: unknown) => Number(Amount.from(a as number).toBigInt());

function toRow(p: Proof, mintUrl: string): ProofRow {
  return {
    secret: p.secret,
    mintUrl,
    id: p.id,
    amount: num(p.amount),
    C: p.C,
    ...(p.dleq ? { dleq: { s: p.dleq.s, e: p.dleq.e, ...(p.dleq.r ? { r: p.dleq.r } : {}) } } : {}),
  };
}

function toProofs(rows: ProofRow[]): Proof[] {
  return normalizeProofAmounts(
    rows.map((r) => ({ id: r.id, amount: r.amount, secret: r.secret, C: r.C, ...(r.dleq ? { dleq: r.dleq } : {}) }))
  );
}

const serialize = (o: OutputData): SerializedOutput => OutputData.serialize(o) as SerializedOutput;
const deserialize = (s: SerializedOutput): OutputData => OutputData.deserialize(s as never) as OutputData;

/** Unblind signatures for saved outputs. Signatures can come back in any order (restore). */
function unblind(wallet: Wallet, outputs: SerializedOutput[], sigs: SerializedBlindedSignature[], mintUrl: string): ProofRow[] {
  return outputs.map((s, i) => {
    const od = deserialize(s);
    const sig = sigs[i];
    const keyset = wallet.keyChain.getKeyset(sig.id);
    return toRow(od.toProof(sig, keyset), mintUrl);
  });
}

async function restore(wallet: Wallet, outputs: SerializedOutput[]): Promise<SerializedBlindedSignature[] | null> {
  const res = await wallet.mint.restore({ outputs: outputs.map((o) => deserialize(o).blindedMessage) });
  const byB = new Map<string, SerializedBlindedSignature>();
  res.outputs.forEach((o, i) => res.signatures[i] && byB.set(o.B_, res.signatures[i]));
  const sigs = outputs.map((o) => byB.get(o.blindedMessage.B_));
  return sigs.every(Boolean) ? (sigs as SerializedBlindedSignature[]) : null;
}

// ---- errors, one line each ----

export type WalletError = { line: string; retryable: boolean };

export function describeError(err: unknown): WalletError {
  if (err instanceof NetworkError || err instanceof TypeError) {
    return { line: "Mint is down. Try again.", retryable: true };
  }
  if (isMintOperationError(err)) {
    if (err.code === 11001 || /spent/i.test(err.message)) {
      return { line: "Those sats were already spent.", retryable: false };
    }
    return { line: "The mint said no. Try again.", retryable: true };
  }
  const msg = (err as Error)?.message || "";
  if (/timeout|timed out|fetch|network/i.test(msg)) return { line: "Mint is down. Try again.", retryable: true };
  return { line: "Something went wrong. Try again.", retryable: true };
}

// ---- fund (NUT-04) ----

export async function createFundQuote(wallet: Wallet, mintUrl: string, amount: number): Promise<QuoteRow> {
  if (!Number.isSafeInteger(amount) || amount < CASHU_MIN_FUND_SATS || amount > CASHU_MAX_FUND_SATS) {
    throw new Error(`Enter ${CASHU_MIN_FUND_SATS} to ${CASHU_MAX_FUND_SATS} sats`);
  }
  const q = await wallet.createMintQuoteBolt11(amount);
  const row: QuoteRow = {
    quote: q.quote,
    mintUrl,
    amount,
    request: q.request,
    createdAt: Date.now(),
    expiry: typeof q.expiry === "number" ? q.expiry : null,
  };
  await putQuote(row);
  return row;
}

/**
 * Checks one quote and mints it once paid. The blinded outputs are saved before the
 * mint call, so a reply lost to a reload or a dropped connection is restored next time.
 */
export async function settleQuote(
  wallet: Wallet,
  row: QuoteRow
): Promise<{ state: "unpaid" | "expired" | "minted"; sats?: number }> {
  const q = await wallet.checkMintQuoteBolt11(row.quote);
  const state = String(q.state);

  if (state === "UNPAID") {
    const exp = row.expiry ?? (typeof q.expiry === "number" ? q.expiry : null);
    if (exp && exp * 1000 < Date.now()) {
      await deleteQuote(row.quote);
      return { state: "expired" };
    }
    return { state: "unpaid" };
  }

  if (state === "ISSUED") {
    // Minted before but the reply was lost: get the signatures back.
    const sigs = row.outputs ? await restore(wallet, row.outputs).catch(() => null) : null;
    if (!sigs) {
      await deleteQuote(row.quote);
      return { state: "expired" };
    }
    const proofs = unblind(wallet, row.outputs!, sigs, row.mintUrl);
    await addMintedProofs(row.quote, proofs);
    return { state: "minted", sats: row.amount };
  }

  // PAID: mint now, with outputs saved first.
  let outputs = row.outputs;
  if (!outputs) {
    outputs = OutputData.createRandomData(row.amount, wallet.getKeyset()).map(serialize);
    await putQuote({ ...row, outputs });
  }
  let sigs: SerializedBlindedSignature[] | null = null;
  try {
    const res = await wallet.mint.mintBolt11({
      quote: row.quote,
      outputs: outputs.map((o) => deserialize(o).blindedMessage),
    });
    sigs = res.signatures;
  } catch (err) {
    sigs = await restore(wallet, outputs).catch(() => null);
    if (!sigs) throw err;
  }
  const proofs = unblind(wallet, outputs, sigs, row.mintUrl);
  await addMintedProofs(row.quote, proofs);
  return { state: "minted", sats: row.amount };
}

// ---- play ----

export type PlayQuote = {
  send: ProofRow[];
  totalSats: number;
  feeSats: number;
  changeSats: number;
  /** What the player actually pays: the entry price plus the mint's input fee (NUT-02). */
  costSats: number;
};

/**
 * Picks the proofs for one ranked run. The server keeps exactly `priceSats`; the mint's
 * input fee for these proofs is on top; anything over comes back as change.
 */
export function quotePlay(wallet: Wallet, rows: ProofRow[], priceSats: number): PlayQuote | null {
  if (!rows.length) return null;
  const balance = rows.reduce((s, r) => s + r.amount, 0);
  if (balance < priceSats) return null;
  let sendProofs: Proof[];
  try {
    sendProofs = wallet.selectProofsToSend(toProofs(rows), priceSats, true).send;
  } catch {
    return null;
  }
  if (!sendProofs.length) return null;
  const totalSats = sendProofs.reduce((s, p) => s + num(p.amount), 0);
  const feeSats = num(wallet.getFeesForProofs(sendProofs));
  const changeSats = totalSats - feeSats - priceSats;
  if (changeSats < 0) return null;
  const bySecret = new Map(rows.map((r) => [r.secret, r]));
  return {
    send: sendProofs.map((p) => bySecret.get(p.secret)!),
    totalSats,
    feeSats,
    changeSats,
    costSats: priceSats + feeSats,
  };
}

/** Builds the token and the change outputs, and saves them before anything is sent. */
export async function preparePlay(
  wallet: Wallet,
  mintUrl: string,
  pubkey: string,
  quote: PlayQuote
): Promise<PlayRow> {
  const send = toProofs(quote.send);
  const changeOutputs =
    quote.changeSats > 0 ? OutputData.createRandomData(quote.changeSats, wallet.getKeyset()).map(serialize) : [];
  const row: PlayRow = {
    runId: await cashuRunId(send.map((p) => p.secret)),
    mintUrl,
    pubkey,
    token: getEncodedToken({ mint: mintUrl, unit: "sat", proofs: send }),
    inputSecrets: send.map((p) => p.secret),
    totalSats: quote.totalSats,
    feeSats: quote.feeSats,
    changeOutputs,
    createdAt: Date.now(),
  };
  await putPlay(row);
  return row;
}

export type RedeemReply =
  | { ok: true; token: string; seed: number; change: SerializedBlindedSignature[]; replay: boolean }
  | { ok: false; code: string; error: string; retryable: boolean };

export async function sendPlay(row: PlayRow, authEvent: unknown): Promise<RedeemReply> {
  try {
    const res = await fetch("/api/cashu/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: row.token,
        outputs: row.changeOutputs.map((o) => ({
          amount: Number(o.blindedMessage.amount),
          B_: o.blindedMessage.B_,
          id: o.blindedMessage.id,
        })),
        pubkey: row.pubkey,
        authEvent,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && typeof data.token === "string") {
      return { ok: true, token: data.token, seed: data.seed, change: data.change || [], replay: !!data.replay };
    }
    return {
      ok: false,
      code: data.code || `http_${res.status}`,
      error: data.error || `HTTP ${res.status}`,
      retryable: data.retryable === true || res.status >= 500 || res.status === 429,
    };
  } catch {
    return { ok: false, code: "network", error: "Network error", retryable: true };
  }
}

/** Server confirmed: now, and only now, the spent inputs leave IndexedDB. */
export async function finishPlay(wallet: Wallet, row: PlayRow, change: SerializedBlindedSignature[]): Promise<void> {
  let changeRows: ProofRow[] = [];
  if (row.changeOutputs.length && change.length === row.changeOutputs.length) {
    try {
      const sigs = change.map((s) => ({ ...s, amount: Amount.from(s.amount as unknown as number) }));
      changeRows = unblind(wallet, row.changeOutputs, sigs, row.mintUrl);
    } catch (err) {
      console.error("cashu: change could not be unblinded", err);
    }
  }
  await settlePlay(row.runId, row.inputSecrets, changeRows);
}

/** The server refused for good. Keep the proofs, unless the mint says they are spent. */
export async function abandonPlay(wallet: Wallet, row: PlayRow, checkSpent: boolean): Promise<void> {
  let spent: string[] = [];
  if (checkSpent) {
    try {
      const states = await wallet.checkProofsStates(row.inputSecrets.map((secret) => ({ secret })));
      spent = row.inputSecrets.filter((_, i) => String(states[i]?.state) === "SPENT");
    } catch {
      /* keep them; the next play finds out */
    }
  }
  await dropPlay(row.runId, spent);
}
