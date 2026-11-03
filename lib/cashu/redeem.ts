import "server-only";
import {
  Amount,
  OutputData,
  Wallet,
  getTokenMetadata,
  isMintOperationError,
  setGlobalRequestOptions,
  sumProofs,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import { cashuMintUrl, isAllowedMint } from "@/lib/cashu/config";
import {
  CASHU_ENTRY_FEE_SATS,
  CASHU_MAX_CHANGE_OUTPUTS,
  CASHU_MAX_INPUTS,
  CASHU_MAX_TOKEN_CHARS,
  cashuRunId,
} from "@/lib/cashu/constants";
import { storeDel, storeGetJson, storePush, storeSetNx } from "@/lib/cashu/store";
import { sealProofs, serverSeedForRun, type StoredProof } from "@/lib/cashu/vault";
import { issueRankedToken, verifyRankedToken } from "@/lib/security/rankedToken";

/**
 * Cashu ranked entry, server side.
 *
 * The client sends an encoded token (its proofs from the allowlisted mint) plus blinded
 * outputs for its own change. The server builds one NUT-03 swap:
 *
 *   inputs  = the client's proofs                       (sum = total)
 *   outputs = server outputs for CASHU_ENTRY_FEE_SATS   (deterministic, server seed)
 *           + the client's change outputs               (sum = total - inputFee - 500)
 *
 * The mint signing that swap is the payment: the client's proofs are spent and the
 * server now holds fresh proofs for 500 sats. NUT-07 checkstate is never used as proof
 * of payment. The change goes back as blind signatures only the client can unblind, so
 * the server never holds the extra sats.
 *
 * One set of input proofs = one runId = one ranked run. A retry of a swap that already
 * succeeded returns the stored ranked token, seed and change signatures; it never mints
 * a second run.
 */

// Mint calls fail fast, and never follow a redirect off the allowlisted host.
setGlobalRequestOptions({ requestTimeout: 15_000, redirect: "error" });

const LOCK_TTL_SEC = 45;

type WireOutput = { amount: number; B_: string; id: string };
type WireSignature = { amount: number; C_: string; id: string; dleq?: { s: string; e: string } };

type PendingRecord = {
  pubkey: string;
  outputs: WireOutput[]; // server outputs first, then the client's change outputs
  serverCount: number;
  serverKeysetId: string;
  totalSats: number;
  feeSats: number;
  createdAt: number;
};

export type DoneRecord = {
  pubkey: string;
  runId: string;
  token: string;
  seed: number;
  change: WireSignature[];
  totalSats: number;
  feeSats: number;
  createdAt: number;
};

export type RedeemResult =
  | { ok: true; runId: string; token: string; seed: number; change: WireSignature[]; feeSats: number; replay: boolean }
  | { ok: false; status: number; code: RedeemErrorCode; error: string; retryable: boolean };

export type RedeemErrorCode =
  | "bad_request"
  | "auth"
  | "wrong_mint"
  | "not_enough"
  | "spent"
  | "in_progress"
  | "other_account"
  | "mint_down"
  | "mint_rejected"
  | "store_down";

const fail = (
  status: number,
  code: RedeemErrorCode,
  error: string,
  retryable: boolean
): RedeemResult => ({ ok: false, status, code, error, retryable });

// ---- mint wallet (allowlisted mint only) ----

let cachedWallet: { wallet: Wallet; at: number; url: string } | null = null;
const WALLET_TTL_MS = 5 * 60_000;

export async function mintWallet(): Promise<Wallet> {
  const url = cashuMintUrl();
  if (!url) throw new Error("CASHU_MINT_URL is not set");
  if (cachedWallet && cachedWallet.url === url && Date.now() - cachedWallet.at < WALLET_TTL_MS) {
    return cachedWallet.wallet;
  }
  const wallet = new Wallet(url, { unit: "sat" });
  await wallet.loadMint();
  cachedWallet = { wallet, at: Date.now(), url };
  return wallet;
}

// ---- helpers ----

const toWireOutput = (o: SerializedBlindedMessage): WireOutput => ({
  amount: Number(Amount.from(o.amount).toBigInt()),
  B_: o.B_,
  id: o.id,
});
const fromWireOutput = (o: WireOutput): SerializedBlindedMessage => ({
  amount: Amount.from(o.amount),
  B_: o.B_,
  id: o.id,
});
const toWireSig = (s: SerializedBlindedSignature): WireSignature => ({
  amount: Number(Amount.from(s.amount).toBigInt()),
  C_: s.C_,
  id: s.id,
  ...(s.dleq ? { dleq: { s: s.dleq.s, e: s.dleq.e } } : {}),
});
const fromWireSig = (s: WireSignature): SerializedBlindedSignature => ({
  amount: Amount.from(s.amount),
  C_: s.C_,
  id: s.id,
  ...(s.dleq ? { dleq: s.dleq } : {}),
});

function parseClientOutputs(raw: unknown, wallet: Wallet): WireOutput[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return "Invalid change outputs";
  if (raw.length > CASHU_MAX_CHANGE_OUTPUTS) return "Too many change outputs";
  const out: WireOutput[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    const amount = Number((o as WireOutput)?.amount);
    const B_ = String((o as WireOutput)?.B_ || "");
    const id = String((o as WireOutput)?.id || "");
    if (!Number.isSafeInteger(amount) || amount <= 0) return "Invalid change amount";
    if (!/^0[23][0-9a-f]{64}$/.test(B_)) return "Invalid change output";
    if (seen.has(B_)) return "Duplicate change output";
    seen.add(B_);
    let ks;
    try {
      ks = wallet.keyChain.getKeyset(id);
    } catch {
      return "Unknown keyset for change";
    }
    if (ks.unit !== "sat" || !ks.isActive || !ks.keys[amount]) return "Invalid keyset for change";
    out.push({ amount, B_, id: ks.id });
  }
  return out;
}

function serverOutputData(runId: string, keysetId: string, wallet: Wallet): OutputData[] {
  const keyset = wallet.keyChain.getKeyset(keysetId);
  return OutputData.createDeterministicData(CASHU_ENTRY_FEE_SATS, serverSeedForRun(runId), 0, keyset);
}

function isSpentError(err: unknown): boolean {
  if (!isMintOperationError(err)) return false;
  return err.code === 11001 || /already spent|spent/i.test(err.message);
}

/** The mint answered with a protocol error (4xx-type): not worth an automatic retry. */
function isMintRejection(err: unknown): boolean {
  return isMintOperationError(err);
}

async function restoreSignatures(wallet: Wallet, outputs: WireOutput[]): Promise<SerializedBlindedSignature[] | null> {
  const res = await wallet.mint.restore({ outputs: outputs.map(fromWireOutput) });
  const byB = new Map<string, SerializedBlindedSignature>();
  res.outputs.forEach((o, i) => {
    if (res.signatures[i]) byB.set(o.B_, res.signatures[i]);
  });
  const sigs = outputs.map((o) => byB.get(o.B_));
  if (sigs.some((s) => !s)) return null;
  return sigs as SerializedBlindedSignature[];
}

// ---- main ----

export async function redeemCashuEntry(params: {
  encodedToken: string;
  changeOutputs: unknown;
  pubkey: string;
  /** Called with the runId before anything is spent; return an error string to refuse. */
  authorize: (runId: string) => string | null;
}): Promise<RedeemResult> {
  const encoded = String(params.encodedToken || "").trim();
  if (!encoded || encoded.length > CASHU_MAX_TOKEN_CHARS) return fail(400, "bad_request", "Invalid token", false);

  // 1. Hard mint allowlist, checked before any network call.
  let meta;
  try {
    meta = getTokenMetadata(encoded);
  } catch {
    return fail(400, "bad_request", "Invalid token", false);
  }
  if (!isAllowedMint(meta.mint)) return fail(400, "wrong_mint", "This mint is not accepted", false);
  if ((meta.unit || "sat") !== "sat") return fail(400, "wrong_mint", "Only sat tokens are accepted", false);

  let wallet: Wallet;
  try {
    wallet = await mintWallet();
  } catch (err) {
    console.error("cashu: mint load failed:", err);
    return fail(502, "mint_down", "Mint is down", true);
  }

  let proofs: Proof[];
  try {
    proofs = wallet.decodeToken(encoded).proofs;
  } catch {
    return fail(400, "bad_request", "Invalid token", false);
  }
  if (proofs.length === 0 || proofs.length > CASHU_MAX_INPUTS) return fail(400, "bad_request", "Invalid token", false);
  const secrets = proofs.map((p) => p.secret);
  if (new Set(secrets).size !== secrets.length) return fail(400, "bad_request", "Duplicate proofs", false);

  const runId = await cashuRunId(secrets);
  const authError = params.authorize(runId);
  if (authError) return fail(401, "auth", authError, true);
  const pubkey = params.pubkey.toLowerCase();

  // 2. Already done: same token, same seed, same change. Never a second run.
  let done: DoneRecord | null;
  try {
    done = await storeGetJson<DoneRecord>(`cashu:done:${runId}`);
  } catch (err) {
    console.error("cashu: store read failed:", err);
    return fail(503, "store_down", "Try again", true);
  }
  if (done) {
    if (done.pubkey !== pubkey) return fail(409, "other_account", "This ecash was used by another account", false);
    return { ok: true, runId, token: done.token, seed: done.seed, change: done.change, feeSats: done.feeSats, replay: true };
  }

  // 3. One request at a time per run.
  const lockKey = `cashu:lock:${runId}`;
  let locked = false;
  try {
    locked = await storeSetNx(lockKey, String(Date.now()), LOCK_TTL_SEC);
  } catch (err) {
    console.error("cashu: lock failed:", err);
    return fail(503, "store_down", "Try again", true);
  }
  if (!locked) return fail(409, "in_progress", "Payment is already being processed. Try again in a moment.", true);

  try {
    return await swapLocked({ wallet, proofs, runId, pubkey, changeOutputs: params.changeOutputs });
  } finally {
    await storeDel(lockKey).catch(() => undefined);
  }
}

async function swapLocked(args: {
  wallet: Wallet;
  proofs: Proof[];
  runId: string;
  pubkey: string;
  changeOutputs: unknown;
}): Promise<RedeemResult> {
  const { wallet, proofs, runId, pubkey } = args;
  const pendingKey = `cashu:pending:${runId}`;

  // Re-check under the lock: a parallel request may have finished meanwhile.
  const done = await storeGetJson<DoneRecord>(`cashu:done:${runId}`);
  if (done) {
    if (done.pubkey !== pubkey) return fail(409, "other_account", "This ecash was used by another account", false);
    return { ok: true, runId, token: done.token, seed: done.seed, change: done.change, feeSats: done.feeSats, replay: true };
  }

  let pending = await storeGetJson<PendingRecord>(pendingKey);
  const isRetry = pending !== null;
  if (pending && pending.pubkey !== pubkey) {
    return fail(409, "other_account", "This ecash is being used by another account", false);
  }

  if (!pending) {
    // 4. Price it. NUT-02 input fees come out of the client's proofs, never out of the 500.
    let feeSats: number;
    let totalSats: number;
    try {
      feeSats = Number(wallet.getFeesForProofs(proofs).toBigInt());
      totalSats = Number(sumProofs(proofs).toBigInt());
    } catch {
      return fail(400, "bad_request", "Unknown keyset in token", false);
    }
    const changeSats = totalSats - feeSats - CASHU_ENTRY_FEE_SATS;
    if (changeSats < 0) {
      return fail(402, "not_enough", `Need ${CASHU_ENTRY_FEE_SATS + feeSats} sats including the mint fee`, false);
    }

    const client = parseClientOutputs(args.changeOutputs, wallet);
    if (typeof client === "string") return fail(400, "bad_request", client, false);
    const clientSum = client.reduce((s, o) => s + o.amount, 0);
    if (clientSum !== changeSats) {
      return fail(400, "bad_request", `Change outputs must total ${changeSats} sats`, false);
    }

    const serverKeysetId = wallet.keysetId;
    const serverOutputs = serverOutputData(runId, serverKeysetId, wallet).map((o) => toWireOutput(o.blindedMessage));
    if (serverOutputs.some((s) => client.some((c) => c.B_ === s.B_))) {
      return fail(400, "bad_request", "Invalid change output", false);
    }

    pending = {
      pubkey,
      outputs: [...serverOutputs, ...client],
      serverCount: serverOutputs.length,
      serverKeysetId,
      totalSats,
      feeSats,
      createdAt: Date.now(),
    };
    // Written before the mint is called, so a crash after the mint signs can be recovered.
    if (!(await storeSetNx(pendingKey, JSON.stringify(pending)))) {
      return fail(409, "in_progress", "Payment is already being processed. Try again in a moment.", true);
    }
  }

  // 5. The swap. This is the payment.
  let signatures: SerializedBlindedSignature[] | null = null;
  try {
    const res = await wallet.mint.swap({ inputs: proofs, outputs: pending.outputs.map(fromWireOutput) });
    signatures = res.signatures;
  } catch (err) {
    if (isRetry || !isMintRejection(err) || isSpentError(err)) {
      // A retry, or the reply may have been lost: if the mint signed our outputs before,
      // restore gives the same signatures back (NUT-09).
      try {
        signatures = await restoreSignatures(wallet, pending.outputs);
      } catch (restoreErr) {
        console.error("cashu: restore failed:", restoreErr);
      }
    }
    if (!signatures) {
      if (isSpentError(err)) {
        // Spent somewhere else, never by this run. Nothing was paid here.
        await storeDel(pendingKey).catch(() => undefined);
        return fail(409, "spent", "Those sats were already spent", false);
      }
      if (isMintRejection(err)) {
        console.error("cashu: mint rejected swap:", err);
        await storeDel(pendingKey).catch(() => undefined);
        return fail(400, "mint_rejected", "The mint rejected this payment", false);
      }
      console.error("cashu: swap failed:", err);
      return fail(502, "mint_down", "Mint is down", true);
    }
  }

  if (!signatures || signatures.length !== pending.outputs.length) {
    console.error("cashu: mint returned", signatures?.length, "signatures for", pending.outputs.length, "outputs");
    return fail(502, "mint_down", "Mint is down", true);
  }

  // 6. Keep the server's part, sealed. Unblinding also checks the mint's signatures.
  const serverData = serverOutputData(runId, pending.serverKeysetId, wallet);
  const keyset = wallet.keyChain.getKeyset(pending.serverKeysetId);
  let serverProofs: StoredProof[];
  try {
    serverProofs = serverData.map((od, i) => {
      const p = od.toProof(signatures![i], keyset);
      return { id: p.id, amount: Number(Amount.from(p.amount).toBigInt()), secret: p.secret, C: p.C };
    });
  } catch (err) {
    console.error("cashu: could not unblind server proofs:", err);
    return fail(502, "mint_down", "Mint is down", true);
  }
  const kept = serverProofs.reduce((s, p) => s + p.amount, 0);
  if (kept !== CASHU_ENTRY_FEE_SATS) {
    console.error("cashu: server proofs total", kept);
    return fail(502, "mint_down", "Mint is down", true);
  }

  try {
    if (await storeSetNx(`cashu:vault:${runId}`, sealProofs(serverProofs, runId))) {
      await storePush("cashu:vault:index", runId);
    }
  } catch (err) {
    // Recoverable: the pending record stays, a retry restores and writes again.
    console.error("cashu: vault write failed:", err);
    return fail(503, "store_down", "Payment received. Tap Play again to start your run.", true);
  }

  // 7. Unlock exactly one ranked run, through the existing token and replay path.
  const token = issueRankedToken(pubkey, runId);
  const seed = verifyRankedToken(token)?.seed;
  if (seed == null) return fail(500, "store_down", "Try again", true);

  const record: DoneRecord = {
    pubkey,
    runId,
    token,
    seed,
    change: signatures.slice(pending.serverCount).map(toWireSig),
    totalSats: pending.totalSats,
    feeSats: pending.feeSats,
    createdAt: Date.now(),
  };
  try {
    if (!(await storeSetNx(`cashu:done:${runId}`, JSON.stringify(record)))) {
      const first = await storeGetJson<DoneRecord>(`cashu:done:${runId}`);
      if (first && first.pubkey === pubkey) {
        return { ok: true, runId, token: first.token, seed: first.seed, change: first.change, feeSats: first.feeSats, replay: true };
      }
      return fail(409, "other_account", "This ecash was used by another account", false);
    }
  } catch (err) {
    console.error("cashu: done write failed:", err);
    return fail(503, "store_down", "Payment received. Tap Play again to start your run.", true);
  }
  await storeDel(pendingKey).catch(() => undefined);

  return { ok: true, runId, token, seed, change: record.change, feeSats: record.feeSats, replay: false };
}
