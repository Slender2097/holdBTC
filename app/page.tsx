"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GameCanvas from "@/components/GameCanvas";
import Leaderboard from "@/components/Leaderboard";
import Header from "@/components/Header";
import PaymentButton from "@/components/PaymentButton";
import PaymentModal from "@/components/PaymentModal";
import GameOverModal from "@/components/GameOverModal";
import { preloadStartStill } from "@/components/year/YearStill";
import { useNostr } from "@/hooks/useNostr";
import { usePayment } from "@/hooks/usePayment";

type RunLog = { flaps: number[]; frames: number; width: number; height: number };
type PendingRun = { token: string; log: RunLog; score: number; distance: number };
type SubmitResult = { eventId: string } | { error: string; retryable: boolean };

// Finished ranked runs not yet on the board. Survives refreshes; cleared on an eventId
// or a final rejection. Holds nothing the server trusts: it re-verifies token and replay.
const PENDING_KEY = "holdbtc_pending_ranked";
const AUTO_RETRY_MS = [2000, 6000];

function loadPending(): PendingRun[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && typeof r.token === "string" && r.log) : [];
  } catch {
    return [];
  }
}

function savePending(list: PendingRun[]) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function addPending(run: PendingRun) {
  savePending([...loadPending().filter((r) => r.token !== run.token), run]);
}

function removePending(token: string) {
  savePending(loadPending().filter((r) => r.token !== token));
}

async function postRun(run: PendingRun): Promise<SubmitResult> {
  try {
    const res = await fetch("/api/submit-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: run.token,
        flaps: run.log.flaps,
        frames: run.log.frames,
        width: run.log.width,
        height: run.log.height,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.eventId) return { eventId: data.eventId };
    return {
      error: data.error || `Score submit failed (HTTP ${res.status})`,
      retryable: data.retryable === true || res.status >= 500 || res.status === 429,
    };
  } catch {
    return { error: "Network error while submitting your score.", retryable: true };
  }
}

export default function HomePage() {
  const nostr = useNostr();
  const payment = usePayment();

  const [gameKey, setGameKey] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastDistance, setLastDistance] = useState(0);
  const [showGameOver, setShowGameOver] = useState(false);
  const [personalBest, setPersonalBest] = useState(0);
  const [isPersonalBest, setIsPersonalBest] = useState(false);
  const [wasRanked, setWasRanked] = useState(false);
  const rankedModalRef = useRef(false);
  const [scorePublished, setScorePublished] = useState(false);
  const [notePublished, setNotePublished] = useState(false);
  const [notePublishing, setNotePublishing] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [rankedWarning, setRankedWarning] = useState<string | null>(null);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitRetryable, setSubmitRetryable] = useState(false);
  // The ranked run shown in the Game Over modal, kept until the server confirms an eventId
  const pendingSubmitRef = useRef<PendingRun | null>(null);
  const resumedRef = useRef(false);
  // Phone only (below lg): leaderboard and protocol open as a bottom sheet
  const [sheet, setSheet] = useState<"board" | "protocol" | null>(null);
  const [runActive, setRunActive] = useState(false);

  // body.game-active locks scroll and touch gestures below lg (globals.css)
  useEffect(() => {
    document.body.classList.toggle("game-active", runActive);
    return () => document.body.classList.remove("game-active");
  }, [runActive]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  // Pay modal open: start loading the first year still so it is decoded when
  // the paid run mounts.
  const invoiceOpen = payment.invoice != null && !payment.hasPaid;
  useEffect(() => {
    if (invoiceOpen) preloadStartStill();
  }, [invoiceOpen]);

  const handleRunStart = useCallback(() => {
    // Phone: the page may have been scrolled; show the whole board for the run.
    // body is the scroll container (html and body both set overflow-x).
    if (window.matchMedia("not all and (min-width: 1024px)").matches) {
      document.body.scrollTo(0, 0);
      window.scrollTo(0, 0);
    }
    setRunActive(true);
  }, []);

  useEffect(() => {
    if (nostr.isLoggedIn) setRankedWarning(null);
  }, [nostr.isLoggedIn]);

  // A saved ranked invoice claims with the account that paid, once it is logged in
  const { setSigner } = payment;
  const userPubkey = nostr.user?.pubkey ?? null;
  useEffect(() => {
    setSigner(userPubkey, userPubkey ? nostr.signEvent : undefined);
  }, [setSigner, userPubkey, nostr.signEvent]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("holdbtc_best");
      if (stored) setPersonalBest(parseInt(stored, 10) || 0);
    } catch {
      /* ignore */
    }
  }, []);

  const handlePayClick = useCallback(async () => {
    if (!nostr.isLoggedIn || !nostr.user?.pubkey) {
      setRankedWarning(
        "Login to your Nostr account to proceed with payment and rank your score."
      );
      return;
    }
    setRankedWarning(null);
    await payment.payToPlay(nostr.user.pubkey, nostr.signEvent);
  }, [payment, nostr.isLoggedIn, nostr.user?.pubkey, nostr.signEvent]);

  const submitRanked = useCallback(async () => {
    const run = pendingSubmitRef.current;
    if (!run) return;
    setSubmitting(true);
    setSubmitError(null);
    let result = await postRun(run);
    // Ride out short blips before asking the player to retry
    for (const ms of AUTO_RETRY_MS) {
      if ("eventId" in result || !result.retryable) break;
      await new Promise((r) => setTimeout(r, ms));
      result = await postRun(run);
    }
    if ("eventId" in result || !result.retryable) removePending(run.token);
    if ("eventId" in result) payment.consumePayment(run.token);

    // The player may have moved on to another run; only update the modal for this one
    if (pendingSubmitRef.current !== run) return;
    setSubmitting(false);
    if ("eventId" in result) {
      pendingSubmitRef.current = null;
      setScorePublished(true);
      setTimeout(() => setLeaderboardKey((k) => k + 1), 2000);
    } else {
      console.error("Attested score rejected:", result.error);
      setSubmitError(result.error);
      setSubmitRetryable(result.retryable);
    }
  }, [payment]);

  // After a refresh, reopen the Game Over modal for a ranked run that never reached the board
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const pending = loadPending();
    const latest = pending[pending.length - 1];
    if (!latest) return;
    // Older leftovers (rare) are re-posted quietly
    for (const run of pending.slice(0, -1)) {
      postRun(run).then((r) => {
        if ("eventId" in r || !r.retryable) removePending(run.token);
      });
    }
    rankedModalRef.current = true;
    setWasRanked(true);
    setLastScore(latest.score);
    setLastDistance(latest.distance);
    setShowGameOver(true);
    pendingSubmitRef.current = latest;
    submitRanked();
  }, [submitRanked]);

  const handleGameOver = useCallback(
    (score: number, distance: number, log?: RunLog) => {
      setRunActive(false);
      // Capture whether this run was ranked BEFORE ending the ranked run
      const ranked = payment.hasPaid;
      const token = payment.rankedToken;
      if (rankedModalRef.current && !ranked) return;

      if (ranked) {
        rankedModalRef.current = true;
        // Token stays in the payment hook until submit-score returns an eventId
        payment.endRankedRun();
      }

      setWasRanked(ranked);
      setLastScore(score);
      setLastDistance(distance);
      setShowGameOver(true);
      setScorePublished(false);
      setNotePublished(false);
      setNoteError(null);
      setSubmitError(null);
      setSubmitRetryable(false);

      const isBest = score > personalBest;
      setIsPersonalBest(isBest);
      if (isBest) {
        setPersonalBest(score);
        try {
          localStorage.setItem("holdbtc_best", String(score));
        } catch {
          /* ignore */
        }
      }

      // Only server-attested ranked scores go to Global Rank
      if (ranked && token && score > 0 && log?.flaps?.length) {
        const run = { token, log, score, distance };
        addPending(run);
        pendingSubmitRef.current = run;
        submitRanked();
      }
    },
    [personalBest, payment, submitRanked]
  );

  const handlePlayAgain = useCallback(() => {
    rankedModalRef.current = false;
    setRunActive(false);
    setShowGameOver(false);
    setLastScore(null);
    setWasRanked(false);
    setScorePublished(false);
    setNotePublished(false);
    setNoteError(null);
    setGameKey((k) => k + 1);
  }, []);

  const handleShareNote = useCallback(async () => {
    if (lastScore === null || !nostr.isLoggedIn || notePublishing || notePublished) {
      return;
    }

    setNotePublishing(true);
    setNoteError(null);

    try {
      const ev = await nostr.publishNote(lastScore, lastDistance);
      if (ev) {
        setNotePublished(true);
      } else {
        setNoteError(
          "Share failed. Approve the extension popup, or login again."
        );
      }
    } catch (e: any) {
      console.error(e);
      setNoteError(e?.message || "Share failed");
    } finally {
      setNotePublishing(false);
    }
  }, [lastScore, lastDistance, nostr, notePublishing, notePublished]);

  return (
    <div className="phone-shell min-h-screen flex flex-col">
      <Header
        user={nostr.user}
        loading={nostr.loading}
        error={nostr.error}
        onLoginNip07={nostr.loginWithNip07}
        onCancelNip07={nostr.cancelNip07}
        onLoginNsec={nostr.loginWithNsec}
        onLogout={nostr.logout}
      />

      <main className="phone-main flex-1 max-w-5xl w-full mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6 max-lg:min-h-0 max-lg:p-0 max-lg:gap-0">
        <div className="flex-1 flex flex-col gap-4 min-w-0 max-lg:min-h-0 max-lg:gap-0">
          <div className="phone-bar flex flex-wrap items-center justify-between gap-3 max-lg:flex-nowrap max-lg:gap-2 max-lg:px-3 max-lg:py-2 max-lg:border-b max-lg:border-alien-border/60 max-lg:bg-alien-deep/90">
            <PaymentButton
              hasPaid={payment.hasPaid}
              paying={payment.paying || !!payment.invoice}
              onPay={handlePayClick}
            />
            <div className="flex items-center gap-4 text-xs text-alien-muted font-mono max-lg:gap-2 max-lg:text-[10px] max-lg:ml-auto max-lg:shrink-0">
              <span className="max-sm:hidden">
                GAMES <span className="text-white/80">{payment.gamesPlayed}</span>
              </span>
              <span title="Local counter only" className="max-sm:hidden">
                LOCAL SATS <span className="text-alien-cyan">{payment.totalPaidSats}</span>
              </span>
              {personalBest > 0 && (
                <span className="max-lg:hidden">
                  BEST <span className="text-alien-green">{personalBest}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setSheet("board")}
                aria-label="Open leaderboard"
                className="phone-cta lg:hidden h-12 min-w-[4.5rem] px-3 max-[359px]:min-w-0 max-[359px]:px-2.5 rounded-xl border-2 border-alien-cyan bg-alien-cyan/20 text-white font-bold active:bg-alien-cyan/35 flex flex-col items-center justify-center leading-none shadow-[0_0_12px_rgba(0,240,255,0.35)]"
              >
                <span className="text-sm tracking-[0.18em] max-[359px]:text-xs max-[359px]:tracking-[0.12em]">RANK</span>
                {personalBest > 0 && (
                  <span className="mt-1 text-[10px] font-medium tracking-normal text-alien-green max-[359px]:text-[9px]">
                    BEST {personalBest}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSheet("protocol")}
                aria-label="How it works"
                className="phone-cta lg:hidden h-12 w-11 max-[359px]:w-10 rounded-xl border-2 border-alien-border bg-alien-panel text-base font-bold text-white active:bg-white/10"
              >
                ?
              </button>
            </div>
          </div>

          {rankedWarning && (
            <p className="text-sm text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg px-3 py-2 font-mono max-lg:mx-3 max-lg:mt-2 max-lg:text-xs max-lg:py-1.5">
              {rankedWarning}
            </p>
          )}

          {payment.error && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-400 bg-red-950/40 border border-red-500/20 rounded-lg px-3 py-2 font-mono max-lg:mx-3 max-lg:mt-2 max-lg:text-xs max-lg:py-1.5">
              <span>{payment.error}</span>
              {payment.invoiceHidden && payment.claimRetryable && (
                <button
                  onClick={payment.retryClaim}
                  disabled={payment.claiming}
                  className="px-3 py-1 max-lg:py-2 rounded-md text-xs tracking-wide bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-white disabled:opacity-50 transition"
                >
                  {payment.claiming ? "CLAIMING..." : "RETRY CLAIM"}
                </button>
              )}
            </div>
          )}

          <div className="relative isolate rounded-xl overflow-hidden border border-alien-border shadow-glow bg-alien-void aspect-[4/3] w-full max-h-[58vh] sm:max-h-[62vh] lg:max-h-[70vh] max-lg:flex-1 max-lg:min-h-0 max-lg:!max-h-none max-lg:aspect-auto max-lg:rounded-none max-lg:border-0 max-lg:shadow-none">
            <div className="h-full w-full">
              <GameCanvas
                key={`${gameKey}-${payment.hasPaid ? payment.rankedSeed ?? "r" : "free"}`}
                enabled={true}
                highScore={personalBest}
                rankedSeed={payment.hasPaid ? payment.rankedSeed : null}
                onGameOver={handleGameOver}
                onRunStart={handleRunStart}
              />
            </div>
          </div>

          <p className="text-center text-[11px] text-alien-muted tracking-wide max-lg:hidden">
            FREE TO PLAY — PAY 1000 SATS ONLY FOR GLOBAL RANK ENTRY
          </p>
        </div>

        <aside
          className={`w-full lg:w-80 shrink-0 space-y-4 ${
            sheet
              ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:flex max-lg:flex-col max-lg:gap-3 max-lg:space-y-0 max-lg:max-h-[85svh] max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:rounded-t-2xl max-lg:border-t max-lg:border-alien-border max-lg:bg-alien-deep max-lg:p-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
              : "max-lg:hidden"
          }`}
          role={sheet ? "dialog" : undefined}
          aria-modal={sheet ? true : undefined}
        >
          <div className={sheet === "protocol" ? "max-lg:hidden" : undefined}>
          <Leaderboard
            refreshKey={leaderboardKey}
            currentUserPubkey={nostr.user?.pubkey}
            currentUserName={
              nostr.user?.displayName ||
              nostr.user?.profile?.display_name ||
              nostr.user?.profile?.name ||
              null
            }
            currentUserPicture={nostr.user?.profile?.picture || null}
            personalBest={personalBest}
          />
          </div>

          <div className={`alien-panel rounded-xl p-4 text-sm text-alien-muted space-y-3 ${sheet === "board" ? "max-lg:hidden" : ""}`}>
            <p className="font-medium text-alien-cyan tracking-widest text-xs uppercase">
              Protocol
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
              <li>Play free anytime</li>
              <li>Connect Nostr to appear on the board</li>
              <li>Pay 1000 sats for one ranked run</li>
              <li>Ranked score goes to Global Rank</li>
              <li>Share as Nostr post (optional)</li>
            </ol>
            <div className="lg:hidden space-y-2 pt-1 text-[10px] tracking-[0.16em]">
              <p>FREE TO PLAY — PAY 1000 SATS ONLY FOR GLOBAL RANK ENTRY</p>
              <p>
                <a href="/terms" className="text-alien-cyan/80">TERMS</a>
                <span className="mx-2">/</span>
                <a href="/privacy" className="text-alien-cyan/80">PRIVACY</a>
                <span className="mx-2">/</span>
                <a href="https://github.com/Slender2097/holdBTC" target="_blank" rel="noreferrer" className="text-alien-cyan/80">GITHUB</a>
              </p>
            </div>
          </div>

          {/* Last so space-y on desktop is unchanged; order-first on the phone sheet */}
          <div className="lg:hidden order-first flex items-center justify-between">
            <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-alien-cyan">
              {sheet === "protocol" ? "Protocol" : "Global Rank"}
            </p>
            <button
              type="button"
              onClick={() => setSheet(null)}
              aria-label="Close"
              className="h-9 w-9 rounded-md bg-white/5 text-alien-muted text-sm"
            >
              X
            </button>
          </div>
        </aside>
      </main>

      {sheet && (
        <div
          className="lg:hidden fixed inset-0 z-[45] bg-black/60"
          onClick={() => setSheet(null)}
          aria-hidden
        />
      )}

      <footer className="border-t border-alien-border/60 py-4 px-4">
        <div className="max-w-5xl mx-auto flex items-end justify-between gap-4">
          <a
            href="https://github.com/Slender2097/holdBTC"
            target="_blank"
            rel="noreferrer"
            aria-label="Hold BTC on GitHub"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white"
          >
            <svg viewBox="0 0 98 96" className="w-7 h-7 fill-current" aria-hidden="true">
              <path fillRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" />
            </svg>
            <span className="text-[10px] font-mono tracking-[0.16em]">GITHUB</span>
          </a>
          <div className="text-center text-[10px] text-alien-muted tracking-[0.25em] uppercase">
            HOLD BTC — ALIEN TECHNOLOGY — holdbtc.io
            <span className="block mt-2 tracking-[0.18em]">
              <a href="/terms" className="text-alien-cyan/80 hover:text-alien-cyan">Terms</a>
              <span className="mx-2">/</span>
              <a href="/privacy" className="text-alien-cyan/80 hover:text-alien-cyan">Privacy</a>
            </span>
          </div>
          <span className="w-5" aria-hidden="true" />
        </div>
      </footer>

      {payment.invoice && !payment.hasPaid && !payment.invoiceHidden && (
        <PaymentModal
          invoice={payment.invoice}
          onClose={payment.cancelPayment}
          paid={payment.invoicePaid}
          claiming={payment.claiming}
          claimError={payment.error}
          onRetryClaim={payment.claimRetryable ? payment.retryClaim : undefined}
        />
      )}

      {showGameOver && lastScore !== null && (
        <GameOverModal
          score={lastScore}
          distance={lastDistance}
          isPersonalBest={isPersonalBest}
          wasRanked={wasRanked}
          scorePublished={scorePublished}
          submitError={submitError}
          submitting={submitting}
          onRetrySubmit={submitRetryable ? submitRanked : undefined}
          notePublished={notePublished}
          notePublishing={notePublishing}
          noteError={noteError}
          onPlayAgain={handlePlayAgain}
          onShareNote={handleShareNote}
          canShare={nostr.isLoggedIn}
        />
      )}
    </div>
  );
}
