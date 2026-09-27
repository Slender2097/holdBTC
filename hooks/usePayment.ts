"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENTRY_FEE_SATS,
  checkPayment,
  claimRankedCredit,
  createInvoice,
  type InvoiceData,
} from "@/lib/payments/lightning";

export function usePayment() {
  const [hasPaid, setHasPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalPaidSats, setTotalPaidSats] = useState(0);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [rankedToken, setRankedToken] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pubkeyRef = useRef<string | null>(null);

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
    setInvoice(null);
    setGamesPlayed((n) => n + 1);
  }, []);

  const claim = useCallback(async (inv: InvoiceData, pubkey: string) => {
    const invoiceId = inv.invoiceId || inv.payment_hash;
    if (!inv.claimSecret) {
      setError("Missing claim secret. Create a new invoice.");
      return false;
    }
    const result = await claimRankedCredit({
      invoiceId,
      pubkey,
      claimSecret: inv.claimSecret,
    });
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setRankedToken(result.token);
    setHasPaid(true);
    setTotalPaidSats((s) => s + ENTRY_FEE_SATS);
    setInvoice(null);
    setPaying(false);
    return true;
  }, []);

  const payToPlay = useCallback(async (pubkey?: string) => {
    if (hasPaid) return { success: true };
    if (pubkey) pubkeyRef.current = pubkey;

    setError(null);
    setPaying(true);
    const created = await createInvoice(pubkeyRef.current || pubkey);
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
      const pk = pubkeyRef.current;
      if (!pk) {
        setError("Login to Nostr before claiming ranked credit.");
        setPaying(false);
        return;
      }
      await claim(created.invoice!, pk);
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
    setPubkey: (pk: string | null) => {
      pubkeyRef.current = pk;
    },
    payToPlay,
    consumePayment,
    cancelPayment,
  };
}
