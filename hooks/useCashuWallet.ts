"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Wallet } from "@cashu/cashu-ts";
import {
  abandonPlay,
  connectWallet,
  createFundQuote,
  describeError,
  fetchCashuConfig,
  finishPlay,
  preparePlay,
  quotePlay,
  sendPlay,
  settleQuote,
  type PlayQuote,
} from "@/lib/cashu/clientWallet";
import { loadPlays, loadProofs, loadQuotes, type PlayRow, type ProofRow, type QuoteRow } from "@/lib/cashu/db";
import { CASHU_ENTRY_FEE_SATS } from "@/lib/cashu/constants";
import { signRankedAuth, type AuthSigner } from "@/lib/nostr/browserAuth";

const POLL_MS = 3000;

/**
 * The invoice the player is paying right now: the one made by the last Add sats.
 * Module level, so it survives closing and reopening the panel, not a page reload.
 * BACK, paying it, or its expiry clears it. Any other saved invoice is never shown;
 * it is only checked in the background.
 */
let activeQuoteId: string | null = null;

export type CashuStatus = "loading" | "ready" | "disabled" | "offline";

/**
 * The in-game Cashu wallet. Mounted only while the wallet panel is open, so
 * cashu-ts and IndexedDB stay off the page until the player taps 50% OFF.
 */
export function useCashuWallet() {
  const [status, setStatus] = useState<CashuStatus>("loading");
  const [mintUrl, setMintUrl] = useState<string | null>(null);
  const [priceSats, setPriceSats] = useState(CASHU_ENTRY_FEE_SATS);
  const [proofs, setProofs] = useState<ProofRow[]>([]);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  // The one invoice on screen, if any (see activeQuoteId).
  const [shownId, setShownId] = useState<string | null>(() => activeQuoteId);
  const [pendingPlay, setPendingPlay] = useState<PlayRow | null>(null);
  const [busy, setBusy] = useState<"fund" | "play" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const walletRef = useRef<Wallet | null>(null);
  const mintRef = useRef<string | null>(null);
  const pollBusy = useRef(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const url = mintRef.current;
    if (!url) return;
    const [p, q, plays] = await Promise.all([loadProofs(url), loadQuotes(url), loadPlays(url)]);
    if (!alive.current) return;
    setProofs(p);
    setQuotes(q.sort((a, b) => b.createdAt - a.createdAt));
    // The invoice on screen was paid (minted) or expired: back to the amount field.
    if (activeQuoteId && !q.some((row) => row.quote === activeQuoteId)) {
      activeQuoteId = null;
      setShownId(null);
    }
    setPendingPlay(plays.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null);
  }, []);

  const connect = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const cfg = await fetchCashuConfig();
      setPriceSats(cfg.priceSats || CASHU_ENTRY_FEE_SATS);
      if (!cfg.enabled || !cfg.mintUrl) {
        setStatus("disabled");
        return;
      }
      mintRef.current = cfg.mintUrl;
      setMintUrl(cfg.mintUrl);
      await reload();
      walletRef.current = await connectWallet(cfg.mintUrl);
      if (alive.current) setStatus("ready");
    } catch (err) {
      console.error("cashu: connect failed", err);
      if (!alive.current) return;
      // Stored balance still shows; funding and play wait for the mint.
      setStatus("offline");
      setError("Mint is down. Try again.");
    }
  }, [reload]);

  useEffect(() => {
    alive.current = true;
    connect();
    return () => {
      alive.current = false;
    };
  }, [connect]);

  const quote = useMemo(() => (shownId ? quotes.find((q) => q.quote === shownId) ?? null : null), [quotes, shownId]);

  // Open invoices (shown or not, from this visit or an earlier one): check them
  // until paid, then mint. Expired ones are dropped.
  const hasQuotes = quotes.length > 0;
  useEffect(() => {
    if (status !== "ready" || !hasQuotes) return;
    const tick = async () => {
      const wallet = walletRef.current;
      const url = mintRef.current;
      if (!wallet || !url || pollBusy.current) return;
      pollBusy.current = true;
      try {
        let changed = false;
        for (const row of await loadQuotes(url)) {
          try {
            const res = await settleQuote(wallet, row);
            if (res.state === "minted") {
              changed = true;
              if (alive.current) {
                setNotice(`+${res.sats} sats`);
                setError(null);
              }
            } else if (res.state === "expired") {
              changed = true;
            }
          } catch (err) {
            console.warn("cashu: quote check failed", err);
          }
        }
        if (changed) await reload();
      } finally {
        pollBusy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [status, hasQuotes, reload]);

  const balance = useMemo(() => proofs.reduce((s, p) => s + p.amount, 0), [proofs]);

  // One selection per proof set, so the cost shown is the cost paid.
  const playQuote: PlayQuote | null = useMemo(() => {
    const wallet = walletRef.current;
    if (status !== "ready" || !wallet || pendingPlay) return null;
    // walletRef is set before status becomes "ready", so status covers it.
    return quotePlay(wallet, proofs, priceSats);
  }, [status, proofs, priceSats, pendingPlay]);

  /** Makes a funding invoice and shows it. Resolves true once it is on screen. */
  const fund = useCallback(async (amount: number): Promise<boolean> => {
    const wallet = walletRef.current;
    const url = mintRef.current;
    if (!wallet || !url) return false;
    setBusy("fund");
    setError(null);
    setNotice(null);
    try {
      const row = await createFundQuote(wallet, url, amount);
      setQuotes((qs) => [row, ...qs]);
      activeQuoteId = row.quote;
      if (alive.current) setShownId(row.quote);
      return true;
    } catch (err) {
      const msg = (err as Error)?.message || "";
      setError(/^Enter /.test(msg) ? msg + "." : describeError(err).line);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * BACK: leave the invoice screen for the amount field. Only the screen changes:
   * the quote stays in IndexedDB and is still checked, so if it gets paid later the
   * balance updates (now, or the next time the wallet opens). No older invoice is
   * shown in its place.
   */
  const cancelQuote = useCallback(() => {
    activeQuoteId = null;
    setShownId(null);
  }, []);

  /**
   * Pays one ranked run. Resolves with the ranked token and seed only after the
   * server's swap succeeded; otherwise sets the one-line error and resolves null.
   */
  const play = useCallback(
    async (pubkey: string | null, signEvent?: AuthSigner): Promise<{ token: string; seed: number } | null> => {
      const wallet = walletRef.current;
      const url = mintRef.current;
      if (!wallet || !url) return null;
      if (!pubkey) {
        setError("Log in with Nostr to play ranked.");
        return null;
      }
      setBusy("play");
      setError(null);
      setNotice(null);
      try {
        let row = pendingPlay;
        if (row && row.pubkey !== pubkey.toLowerCase()) {
          setError("Log in with the Nostr account that started this payment.");
          return null;
        }
        if (!row) {
          if (!playQuote) {
            setError("Not enough sats.");
            return null;
          }
          row = await preparePlay(wallet, url, pubkey.toLowerCase(), playQuote);
          setPendingPlay(row);
        }

        let authEvent;
        try {
          authEvent = await signRankedAuth({ pubkey, scope: "credit", invoiceId: row.runId, signEvent });
        } catch {
          setError("Approve the Nostr signature to play.");
          return null;
        }

        const reply = await sendPlay(row, authEvent);
        if (reply.ok) {
          await finishPlay(wallet, row, reply.change);
          await reload();
          return { token: reply.token, seed: reply.seed };
        }

        // Drop the pending play only when the server is sure nothing was spent for it.
        if (!reply.retryable && ABANDON_CODES.has(reply.code)) {
          await abandonPlay(wallet, row, reply.code === "spent" || reply.code === "other_account");
          await reload();
        }
        setError(lineFor(reply.code, reply.error));
        return null;
      } catch (err) {
        console.error("cashu: play failed", err);
        setError(describeError(err).line);
        return null;
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [pendingPlay, playQuote, reload]
  );

  return {
    status,
    mintUrl,
    priceSats,
    balance,
    quote,
    pendingPlay,
    playQuote,
    busy,
    error,
    notice,
    fund,
    cancelQuote,
    play,
    retryConnect: connect,
  };
}

const ABANDON_CODES = new Set(["not_enough", "wrong_mint", "bad_request", "mint_rejected", "spent", "other_account"]);

function lineFor(code: string, fallback: string): string {
  switch (code) {
    case "not_enough":
      return "Not enough sats.";
    case "spent":
      return "Those sats were already spent.";
    case "mint_down":
      return "Mint is down. Try again.";
    case "network":
      return "Connection lost. Try again.";
    case "in_progress":
    case "store_down":
    case "rate_limited":
      return "Try again in a moment.";
    case "other_account":
      return "These sats were used by another account.";
    case "auth":
      return "Approve the Nostr signature to play.";
    case "login":
      return "Log in with Nostr to play ranked.";
    case "banned":
      return "This account cannot play ranked.";
    case "disabled":
      return "Cashu is not available right now.";
    default:
      return fallback && fallback.length < 80 ? fallback : "Something went wrong. Try again.";
  }
}
