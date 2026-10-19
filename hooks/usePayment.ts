"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENTRY_FEE_SATS,
  checkPayment,
  claimRankedCredit,
  createInvoice,
  type InvoiceData,
} from "@/lib/payments/lightning";
import { signRankedAuth, type AuthSigner } from "@/lib/nostr/browserAuth";

// The open ranked invoice, kept until ranked-credit returns a token, the player cancels
// an unpaid invoice, or the claim is rejected for good. A reload or a failed claim then
// never loses a payment. The claim secret is bound to the pubkey that made the invoice.
const INVOICE_KEY = "holdbtc_pending_invoice";
const POLL_MS = 2500;
const CLAIM_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

type SavedInvoice = { invoice: InvoiceData; pubkey: string };

function loadInvoice(): SavedInvoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(INVOICE_KEY) || "null");
    const inv = saved?.invoice;
    if (
      typeof saved?.pubkey === "string" &&
      typeof inv?.payment_hash === "string" &&
      typeof inv?.payment_request === "string" &&
      typeof inv?.claimSecret === "string"
    ) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveInvoice(saved: SavedInvoice | null) {
  try {
    if (saved) localStorage.setItem(INVOICE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(INVOICE_KEY);
  } catch {
    /* ignore */
  }
}

export function usePayment() {
  const [hasPaid, setHasPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [invoicePaid, setInvoicePaid] = useState(false);
  const [invoiceHidden, setInvoiceHidden] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimRetryable, setClaimRetryable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPaidSats, setTotalPaidSats] = useState(0);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [rankedToken, setRankedToken] = useState<string | null>(null);
  const [rankedSeed, setRankedSeed] = useState<number | null>(null);
  const [statsReady, setStatsReady] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pubkeyRef = useRef<string | null>(null);
  const signerRef = useRef<AuthSigner | undefined>(undefined);
  const rankedTokenRef = useRef<string | null>(null);
  const savedRef = useRef<SavedInvoice | null>(null);
  const paidRef = useRef(false);
  // A poll tick or claim is in flight; at most one claim runs at a time
  const busyRef = useRef(false);
  // Earliest time the poll may claim again; Infinity waits for a login or a Retry click
  const retryAtRef = useRef(0);
  const failuresRef = useRef(0);

  useEffect(() => {
    try {
      setGamesPlayed(parseInt(localStorage.getItem("holdbtc_games") || "0", 10) || 0);
      setTotalPaidSats(parseInt(localStorage.getItem("holdbtc_sats") || "0", 10) || 0);
    } catch {
      /* ignore */
    }
    setStatsReady(true);
  }, []);

  useEffect(() => {
    if (!statsReady) return;
    try {
      localStorage.setItem("holdbtc_games", String(gamesPlayed));
      localStorage.setItem("holdbtc_sats", String(totalPaidSats));
    } catch {
      /* ignore */
    }
  }, [statsReady, gamesPlayed, totalPaidSats]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Forget the open invoice: claimed, cancelled while unpaid, or rejected for good. */
  const clearInvoice = useCallback(() => {
    stopPoll();
    savedRef.current = null;
    saveInvoice(null);
    paidRef.current = false;
    retryAtRef.current = 0;
    failuresRef.current = 0;
    setInvoice(null);
    setInvoicePaid(false);
    setInvoiceHidden(false);
    setClaiming(false);
    setClaimRetryable(false);
    setPaying(false);
  }, [stopPoll]);

  /** The ranked run is over: further games are free play, but the token is kept for submit/retry. */
  const endRankedRun = useCallback(() => {
    setHasPaid(false);
    setInvoice(null);
    setGamesPlayed((n) => n + 1);
  }, []);

  /** Call only after submit-score returned an eventId for this token. */
  const consumePayment = useCallback((token: string) => {
    // A newer paid run may have replaced the token while this one was retrying.
    if (rankedTokenRef.current !== token) return;
    rankedTokenRef.current = null;
    setRankedToken(null);
    setRankedSeed(null);
  }, []);

  const claim = useCallback(async (saved: SavedInvoice) => {
    const pk = pubkeyRef.current;
    if (pk !== saved.pubkey) {
      // The claim secret only works for the account that made the invoice
      retryAtRef.current = Infinity;
      setClaimRetryable(false);
      setError(
        pk
          ? "Log in with the Nostr account that paid to claim your ranked run."
          : "Log in to Nostr to claim your ranked run."
      );
      return;
    }
    const invoiceId = saved.invoice.invoiceId || saved.invoice.payment_hash;
    setClaiming(true);
    setError(null);
    let result: Awaited<ReturnType<typeof claimRankedCredit>>;
    let signFailed = false;
    try {
      const authEvent = await signRankedAuth({
        pubkey: pk,
        scope: "credit",
        invoiceId,
        signEvent: signerRef.current,
      });
      result = await claimRankedCredit({
        invoiceId,
        pubkey: pk,
        claimSecret: saved.invoice.claimSecret!,
        authEvent,
      });
    } catch (err: any) {
      signFailed = true;
      result = {
        error: err?.message || "Sign the Nostr challenge to claim ranked credit.",
        retryable: true,
      };
    }
    // Cancelled, replaced or already claimed meanwhile: this response changes nothing
    if (savedRef.current !== saved) return;

    if ("token" in result) {
      clearInvoice();
      setError(null);
      rankedTokenRef.current = result.token;
      setRankedToken(result.token);
      setRankedSeed(typeof result.seed === "number" ? result.seed : null);
      setHasPaid(true);
      setTotalPaidSats((s) => s + ENTRY_FEE_SATS);
      return;
    }
    if (!result.retryable) {
      clearInvoice();
      setError(result.error);
      return;
    }
    // Keep the invoice and the poll. Signing again would pop the extension, so a
    // signing failure waits for the player; server and network errors back off.
    const delay = CLAIM_RETRY_MS[Math.min(failuresRef.current, CLAIM_RETRY_MS.length - 1)];
    failuresRef.current += 1;
    retryAtRef.current = signFailed ? Infinity : Date.now() + delay;
    setClaiming(false);
    setClaimRetryable(true);
    setError(result.error);
  }, [clearInvoice]);

  const tick = useCallback(async () => {
    const saved = savedRef.current;
    if (!saved || busyRef.current || Date.now() < retryAtRef.current) return;
    busyRef.current = true;
    try {
      if (!paidRef.current) {
        const paid = await checkPayment(saved.invoice.payment_hash);
        if (!paid || savedRef.current !== saved) return;
        paidRef.current = true;
        setInvoicePaid(true);
      }
      await claim(saved);
    } finally {
      busyRef.current = false;
    }
  }, [claim]);

  const startPoll = useCallback((saved: SavedInvoice) => {
    stopPoll();
    savedRef.current = saved;
    paidRef.current = false;
    retryAtRef.current = 0;
    failuresRef.current = 0;
    setInvoice(saved.invoice);
    setInvoicePaid(false);
    setInvoiceHidden(false);
    setClaiming(false);
    setClaimRetryable(false);
    pollRef.current = setInterval(tick, POLL_MS);
    tick();
  }, [stopPoll, tick]);

  // After a reload, reopen the modal for an invoice that was never claimed
  useEffect(() => {
    const saved = loadInvoice();
    if (saved) startPoll(saved);
  }, [startPoll]);

  /** Retry claim button: claim now, skipping any backoff. */
  const retryClaim = useCallback(() => {
    if (!savedRef.current) return;
    retryAtRef.current = 0;
    tick();
  }, [tick]);

  /** Keep the hook in step with the Nostr login; a paid claim waiting on it resumes. */
  const setSigner = useCallback((pk: string | null, signEvent?: AuthSigner) => {
    pubkeyRef.current = pk;
    signerRef.current = signEvent;
    if (savedRef.current && paidRef.current && retryAtRef.current === Infinity) {
      retryAtRef.current = 0;
      tick();
    }
  }, [tick]);

  const cancelPayment = useCallback(async () => {
    const saved = savedRef.current;
    if (!saved) return;
    setInvoiceHidden(true);
    // Paid but not claimed: closing only hides the modal, the claim keeps going
    if (paidRef.current) return;
    // One last look, so closing right after paying does not drop the payment
    const paid = await checkPayment(saved.invoice.payment_hash);
    if (savedRef.current !== saved) return;
    if (paid || paidRef.current) {
      paidRef.current = true;
      setInvoicePaid(true);
      setInvoiceHidden(false);
      retryClaim();
      return;
    }
    clearInvoice();
  }, [clearInvoice, retryClaim]);

  const payToPlay = useCallback(async (pubkey?: string, signEvent?: AuthSigner) => {
    if (hasPaid) return { success: true };
    if (savedRef.current) {
      setInvoiceHidden(false);
      return { success: false, method: "none" as const, error: "An invoice is already open" };
    }
    if (pubkey) pubkeyRef.current = pubkey;
    if (signEvent) signerRef.current = signEvent;
    const pk = pubkeyRef.current;
    if (!pk) {
      setError("Login to Nostr before paying.");
      return { success: false, method: "none" as const, error: "Not logged in" };
    }

    setError(null);
    setPaying(true);

    let authEvent;
    try {
      authEvent = await signRankedAuth({
        pubkey: pk,
        scope: "invoice",
        signEvent: signerRef.current,
      });
    } catch (err: any) {
      setPaying(false);
      setError(err?.message || "Use a Nostr extension to pay for ranked entry.");
      return { success: false, method: "none" as const, error: err?.message };
    }

    const created = await createInvoice(pk, authEvent);
    if (!created.invoice) {
      setPaying(false);
      setError(created.error || "Failed to create invoice");
      return created;
    }
    if (!created.invoice.claimSecret) {
      setPaying(false);
      setError("Missing claim secret. Create a new invoice.");
      return created;
    }

    const saved = { invoice: created.invoice, pubkey: pk };
    saveInvoice(saved);
    startPoll(saved);
    return created;
  }, [hasPaid, startPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  return {
    hasPaid,
    paying,
    invoice,
    invoicePaid,
    invoiceHidden,
    claiming,
    claimRetryable,
    error,
    totalPaidSats,
    gamesPlayed,
    entryFee: ENTRY_FEE_SATS,
    rankedToken,
    rankedSeed,
    setSigner,
    payToPlay,
    retryClaim,
    endRankedRun,
    consumePayment,
    cancelPayment,
  };
}
