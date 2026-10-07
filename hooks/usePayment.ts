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

export function usePayment() {
  const [hasPaid, setHasPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalPaidSats, setTotalPaidSats] = useState(0);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [rankedToken, setRankedToken] = useState<string | null>(null);
  const [rankedSeed, setRankedSeed] = useState<number | null>(null);
  const [statsReady, setStatsReady] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pubkeyRef = useRef<string | null>(null);
  const signerRef = useRef<AuthSigner | undefined>(undefined);

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

  const cancelPayment = useCallback(() => {
    stopPoll();
    setInvoice(null);
    setPaying(false);
  }, [stopPoll]);

  const consumePayment = useCallback(() => {
    setHasPaid(false);
    setRankedToken(null);
    setRankedSeed(null);
    setInvoice(null);
    setGamesPlayed((n) => n + 1);
  }, []);

  const claim = useCallback(async (inv: InvoiceData, pubkey: string) => {
    const invoiceId = inv.invoiceId || inv.payment_hash;
    if (!inv.claimSecret) {
      setError("Missing claim secret. Create a new invoice.");
      return false;
    }
    let authEvent;
    try {
      authEvent = await signRankedAuth({
        pubkey,
        scope: "credit",
        invoiceId,
        signEvent: signerRef.current,
      });
    } catch (err: any) {
      setError(err?.message || "Sign the Nostr challenge to claim ranked credit.");
      return false;
    }
    const result = await claimRankedCredit({
      invoiceId,
      pubkey,
      claimSecret: inv.claimSecret,
      authEvent,
    });
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setRankedToken(result.token);
    setRankedSeed(typeof result.seed === "number" ? result.seed : null);
    setHasPaid(true);
    setTotalPaidSats((s) => s + ENTRY_FEE_SATS);
    setInvoice(null);
    setPaying(false);
    return true;
  }, []);

  const payToPlay = useCallback(async (pubkey?: string, signEvent?: AuthSigner) => {
    if (hasPaid) return { success: true };
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

    setInvoice(created.invoice);
    stopPoll();

    pollRef.current = setInterval(async () => {
      const paid = await checkPayment(created.invoice!.payment_hash);
      if (!paid) return;
      stopPoll();
      const currentPk = pubkeyRef.current;
      if (!currentPk) {
        setError("Login to Nostr before claiming ranked credit.");
        setPaying(false);
        return;
      }
      await claim(created.invoice!, currentPk);
    }, 2500);

    return created;
  }, [hasPaid, claim, stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  return {
    hasPaid,
    paying,
    invoice,
    error,
    totalPaidSats,
    gamesPlayed,
    entryFee: ENTRY_FEE_SATS,
    rankedToken,
    rankedSeed,
    setPubkey: (pk: string | null) => {
      pubkeyRef.current = pk;
    },
    payToPlay,
    consumePayment,
    cancelPayment,
  };
}
