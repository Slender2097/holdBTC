"use client";

import { useEffect, useState } from "react";
import { CashuMark } from "@/components/CashuButton";
import { useCashuWallet } from "@/hooks/useCashuWallet";
import { CASHU_MAX_FUND_SATS, CASHU_MIN_FUND_SATS } from "@/lib/cashu/constants";
import type { AuthSigner } from "@/lib/nostr/browserAuth";

interface CashuWalletPanelProps {
  onClose: () => void;
  pubkey: string | null;
  signEvent?: AuthSigner;
  /** A ranked run (either payment path) is already waiting to be played. */
  rankedReady: boolean;
  /** Called once the server's swap succeeded: start the ranked run like Lightning does. */
  onRankedReady: (token: string, seed: number, sats: number) => void;
}

/**
 * The in-game Cashu wallet: balance, one Add sats field, one Play button, one error line.
 * Loaded on demand (next/dynamic in app/page.tsx), so cashu-ts is not in the page bundle.
 */
export default function CashuWalletPanel({
  onClose,
  pubkey,
  signEvent,
  rankedReady,
  onRankedReady,
}: CashuWalletPanelProps) {
  const w = useCashuWallet();
  // Starts empty: the user types what to add (a run is 500 plus the mint's fee, if any).
  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invoice = w.quote?.request ?? null;
  useEffect(() => {
    setQr(null);
    if (!invoice) return;
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(invoice, { width: 220, margin: 2 });
        if (!cancelled) setQr(url);
      } catch {
        /* the copy button still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const copy = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const amountNum = Number(amount);
  const amountOk = Number.isSafeInteger(amountNum) && amountNum >= CASHU_MIN_FUND_SATS && amountNum <= CASHU_MAX_FUND_SATS;
  const ready = w.status === "ready";

  // The real cost: 500 to the server + the mint's input fee for the proofs picked.
  const retry = w.pendingPlay;
  const feeSats = retry ? retry.feeSats : w.playQuote?.feeSats ?? null;
  const canPlay = ready && !rankedReady && !w.busy && (!!retry || !!w.playQuote);

  const handlePlay = async () => {
    const res = await w.play(pubkey, signEvent);
    if (res) onRankedReady(res.token, res.seed, w.priceSats);
  };

  // Only real numbers: the total once the proofs (and so the fee) are known.
  let costLine = "";
  if (retry) costLine = `Payment waiting to confirm. Tap Play to finish it (${w.priceSats + retry.feeSats} sats).`;
  else if (feeSats) costLine = `Total ${w.priceSats + feeSats} sats`;
  else if (ready && !w.playQuote && w.balance > 0 && !rankedReady) costLine = "Not enough sats.";

  const errorLine =
    w.error ||
    (rankedReady ? "A ranked run is already ready. Play it first." : null) ||
    (w.status === "disabled" ? "Cashu is not available right now." : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cashu wallet"
        className="w-full max-w-sm max-h-full overflow-y-auto overscroll-contain rounded-xl p-5 relative bg-alien-deep border-2 border-alien-orange shadow-[0_0_20px_rgba(247,147,26,0.3)]"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 max-lg:w-10 max-lg:h-10 flex items-center justify-center text-alien-orange/70 hover:text-alien-orange transition text-lg leading-none"
        >
          ×
        </button>

        {/* Balance */}
        <div className="mb-4 pr-10">
          <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-alien-orange uppercase">
            <CashuMark className="w-5 h-5 shrink-0" /> Cashu wallet
          </p>
          <p className="mt-1 font-mono text-3xl font-bold text-white" aria-live="polite">
            {w.status === "loading" && w.balance === 0 ? "…" : w.balance.toLocaleString()}
            <span className="ml-1.5 text-base font-semibold text-alien-muted">sats</span>
            {w.notice && <span className="ml-2 text-sm text-alien-green">{w.notice}</span>}
          </p>
        </div>

        {/* Fund */}
        {invoice ? (
          <div className="mb-4 rounded-lg border border-alien-orange/40 p-3 text-center">
            <div className="mx-auto mb-2 w-fit rounded-md bg-white p-2">
              {qr ? (
                <img src={qr} alt="Lightning invoice" width={180} height={180} className="max-lg:w-[min(52vw,200px,34svh)] max-lg:h-auto" />
              ) : (
                <div className="w-[180px] h-[180px] max-lg:w-[min(52vw,200px,34svh)] max-lg:h-auto max-lg:aspect-square" />
              )}
            </div>
            <p className="mb-2 flex items-center justify-center gap-2 text-xs font-mono text-alien-orange">
              <span className="w-1.5 h-1.5 rounded-full bg-alien-orange animate-pulse" />
              Pay {w.quote?.amount.toLocaleString()} sats
            </p>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="flex-1 py-2.5 rounded-lg text-xs font-mono border border-alien-orange/50 text-alien-orange hover:bg-alien-orange/10"
              >
                {copied ? "COPIED" : "COPY INVOICE"}
              </button>
              <a
                href={`lightning:${invoice}`}
                className="lg:hidden flex-1 py-2.5 rounded-lg text-xs font-mono border border-alien-orange/50 text-alien-orange hover:bg-alien-orange/10 text-center"
              >
                OPEN WALLET
              </a>
              <button
                onClick={() => {
                  w.cancelQuote();
                  setAmount("");
                }}
                className="px-3 py-2.5 rounded-lg text-xs font-mono text-alien-orange/70 hover:text-alien-orange"
              >
                BACK
              </button>
            </div>
          </div>
        ) : (
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amountOk && ready && !w.busy) {
                // Once the invoice is up, the field is empty for next time.
                w.fund(amountNum).then((ok) => ok && setAmount(""));
              }
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={CASHU_MIN_FUND_SATS}
              max={CASHU_MAX_FUND_SATS}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              aria-label="Amount in sats"
              placeholder="sats"
              className="min-w-0 flex-1 rounded-lg bg-alien-void border border-alien-orange/40 px-3 py-2.5 font-mono text-white placeholder:text-alien-muted/60 focus:outline-none focus:border-alien-orange"
            />
            <button
              type="submit"
              disabled={!amountOk || !ready || !!w.busy}
              className="shrink-0 rounded-lg border-2 border-alien-orange bg-alien-orange/15 px-4 py-2 text-sm font-bold text-alien-orange hover:bg-alien-orange/25 active:bg-alien-orange/35 disabled:bg-transparent disabled:border-alien-orange/60 disabled:text-alien-orange/60"
            >
              {w.busy === "fund" ? "…" : "Add sats"}
            </button>
          </form>
        )}

        {/* Play */}
        <button
          onClick={handlePlay}
          disabled={!canPlay}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-alien-orange bg-alien-orange/15 py-3 text-base font-bold tracking-wide text-alien-orange shadow-[0_0_12px_rgba(247,147,26,0.3)] hover:bg-alien-orange/25 active:bg-alien-orange/35 active:scale-[0.99] disabled:bg-transparent disabled:border-alien-orange/60 disabled:text-alien-orange/60 disabled:shadow-none disabled:cursor-not-allowed transition"
        >
          {w.busy === "play" ? "Paying…" : `Play ranked — ${w.priceSats} sats`}
        </button>
        {costLine && <p className="mt-2 text-center text-[11px] font-mono text-alien-muted">{costLine}</p>}

        {/* One line of errors */}
        <p className="mt-2 min-h-[1rem] text-center text-xs font-mono text-red-400" role="status">
          {errorLine}
          {w.status === "offline" && (
            <button onClick={w.retryConnect} className="ml-2 underline text-alien-orange">
              Retry
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
