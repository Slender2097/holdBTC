"use client";

import { useCallback, useEffect, useState } from "react";
import GameCanvas from "@/components/GameCanvas";
import Leaderboard from "@/components/Leaderboard";
import NostrLogin from "@/components/NostrLogin";
import PaymentButton from "@/components/PaymentButton";
import PaymentModal from "@/components/PaymentModal";
import GameOverModal from "@/components/GameOverModal";
import { useNostr } from "@/hooks/useNostr";
import { usePayment } from "@/hooks/usePayment";

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
  const [scorePublished, setScorePublished] = useState(false);
  const [notePublished, setNotePublished] = useState(false);
  const [notePublishing, setNotePublishing] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [rankedWarning, setRankedWarning] = useState<string | null>(null);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  useEffect(() => {
    if (nostr.isLoggedIn) setRankedWarning(null);
  }, [nostr.isLoggedIn]);

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
    payment.setPubkey(nostr.user.pubkey);
    await payment.payToPlay(nostr.user.pubkey);
  }, [payment, nostr.isLoggedIn, nostr.user?.pubkey]);

  const handleGameOver = useCallback(
    (score: number, distance: number) => {
      // Capture whether this run was ranked BEFORE consuming credit
      const ranked = payment.hasPaid;
      const token = payment.rankedToken;

      if (ranked) {
        payment.consumePayment();
      }

      setWasRanked(ranked);
      setLastScore(score);
      setLastDistance(distance);
      setShowGameOver(true);
      setScorePublished(false);
      setNotePublished(false);
      setNoteError(null);

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
      if (ranked && token && score > 0) {
        fetch("/api/submit-score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            score,
            distance,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.eventId) {
              setScorePublished(true);
              setTimeout(() => setLeaderboardKey((k) => k + 1), 2000);
            } else {
              console.error("Attested score rejected:", data.error);
            }
          })
          .catch((e) => console.error("Auto score publish failed:", e));
      }
    },
    [personalBest, payment, nostr]
  );

  const handlePlayAgain = useCallback(() => {
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-alien-border/80 bg-alien-deep/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-alien-panel border border-alien-cyan/30 flex items-center justify-center shadow-glow">
              <span className="text-alien-cyan font-bold text-sm tracking-tight">HB</span>
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-widest leading-none text-white">
                HOLD<span className="text-alien-cyan">BTC</span>
              </h1>
              <p className="text-[10px] text-alien-muted tracking-[0.2em] uppercase mt-0.5">
                holdbtc.io
              </p>
            </div>
          </div>

          <NostrLogin
            user={nostr.user}
            loading={nostr.loading}
            error={nostr.error}
            onLoginNip07={nostr.loginWithNip07}
            onLoginNsec={nostr.loginWithNsec}
            onLogout={nostr.logout}
          />
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PaymentButton
              hasPaid={payment.hasPaid}
              paying={payment.paying || !!payment.invoice}
              onPay={handlePayClick}
            />
            <div className="flex items-center gap-4 text-xs text-alien-muted font-mono">
              <span>
                GAMES <span className="text-white/80">{payment.gamesPlayed}</span>
              </span>
              <span title="Local counter only">
                LOCAL SATS <span className="text-alien-cyan">{payment.totalPaidSats}</span>
              </span>
              {personalBest > 0 && (
                <span>
                  BEST <span className="text-alien-green">{personalBest}</span>
                </span>
              )}
            </div>
          </div>

          {rankedWarning && (
            <p className="text-sm text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg px-3 py-2 font-mono">
              {rankedWarning}
            </p>
          )}

          {payment.error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-500/20 rounded-lg px-3 py-2 font-mono">
              {payment.error}
            </p>
          )}

          <div
            className={
              payment.hasPaid
                ? "ranked-game-frame aspect-[4/3] max-h-[70vh] w-full"
                : "relative rounded-xl overflow-hidden border border-alien-border shadow-glow bg-alien-void aspect-[4/3] max-h-[70vh] w-full"
            }
          >
            <div className={payment.hasPaid ? "ranked-game-inner" : "h-full w-full"}>
              <GameCanvas
                key={gameKey}
                enabled={true}
                highScore={personalBest}
                onGameOver={handleGameOver}
              />
            </div>
          </div>

          <p className="text-center text-[11px] text-alien-muted tracking-wide">
            FREE TO PLAY — PAY 1000 SATS ONLY FOR GLOBAL RANK ENTRY
          </p>
        </div>

        <aside className="w-full lg:w-80 shrink-0 space-y-4">
          <Leaderboard
            refreshKey={leaderboardKey}
            currentUserPubkey={nostr.user?.pubkey}
            personalBest={personalBest}
          />

          <div className="alien-panel rounded-xl p-4 text-sm text-alien-muted space-y-3">
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
          </div>
        </aside>
      </main>

      <footer className="border-t border-alien-border/60 py-4 text-center text-[10px] text-alien-muted tracking-[0.25em] uppercase">
        HOLD BTC — ALIEN TECHNOLOGY — holdbtc.io
      </footer>

      {payment.invoice && !payment.hasPaid && (
        <PaymentModal
          invoice={payment.invoice}
          onClose={payment.cancelPayment}
        />
      )}

      {showGameOver && lastScore !== null && (
        <GameOverModal
          score={lastScore}
          distance={lastDistance}
          isPersonalBest={isPersonalBest}
          wasRanked={wasRanked}
          scorePublished={scorePublished}
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
