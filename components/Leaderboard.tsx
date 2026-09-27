"use client";

import { useEffect, useState } from "react";
import { shortNpub } from "@/lib/nostr/utils";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";

interface ScoreEntry {
  pubkey: string;
  npub: string;
  score: number;
  distance: number;
  year?: number;
  created_at: number;
  eventId: string;
  profile?: {
    name?: string;
    display_name?: string;
    picture?: string;
  };
  displayName?: string;
}

interface LeaderboardProps {
  refreshKey?: number;
  currentUserPubkey?: string | null;
  currentUserName?: string | null;
  currentUserPicture?: string | null;
  personalBest?: number;
}

type Tab = "global" | "following";

function yearFromScore(score: number): number {
  return 2008 + Math.floor(Math.max(0, score) / 1000);
}

export default function Leaderboard({
  refreshKey = 0,
  currentUserPubkey,
  currentUserName,
  currentUserPicture,
  personalBest,
}: LeaderboardProps) {
  const [tab, setTab] = useState<Tab>("global");
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (tab === "following" && !currentUserPubkey) {
      setEntries([]);
      setError("Login with Nostr to see people you follow");
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams({ tab });
    if (currentUserPubkey) qs.set("pubkey", currentUserPubkey);

    fetch(`/api/leaderboard?${qs.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error && !Array.isArray(data.entries)) {
          setError(data.error);
          setEntries([]);
          return;
        }
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch(() => {
        if (!cancelled) setError("Signal interrupted");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, tab, currentUserPubkey]);

  return (
    <div className="alien-panel rounded-xl overflow-hidden">
      <div className="px-3 pt-3 border-b border-alien-border">
        <div className="flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={() => setTab("global")}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono tracking-[0.14em] uppercase ${
              tab === "global"
                ? "bg-alien-cyan/15 text-alien-cyan"
                : "text-alien-muted hover:text-white"
            }`}
          >
            Global Rank
          </button>
          <button
            type="button"
            onClick={() => setTab("following")}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono tracking-[0.14em] uppercase ${
              tab === "following"
                ? "bg-alien-cyan/15 text-alien-cyan"
                : "text-alien-muted hover:text-white"
            }`}
          >
            Following
          </button>
          {personalBest !== undefined && personalBest > 0 && (
            <span className="ml-auto text-[10px] text-alien-muted font-mono">
              BEST <span className="text-alien-green">{personalBest}</span>
            </span>
          )}
        </div>
      </div>

      <div className="max-h-[380px] overflow-y-auto">
        {loading && (
          <div className="p-6 text-center text-alien-muted text-xs font-mono animate-pulse">
            SCANNING RELAYS...
          </div>
        )}
        {error && (
          <div className="p-6 text-center text-red-400/80 text-xs font-mono">{error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="p-6 text-center text-alien-muted text-xs font-mono">
            {tab === "following" ? "NO FOLLOWED PLAYERS YET" : "NO SIGNALS YET"}
          </div>
        )}

        <ul className="divide-y divide-alien-border/50">
          {entries.map((e, i) => {
            const isMe =
              !!currentUserPubkey &&
              e.pubkey.toLowerCase() === currentUserPubkey.toLowerCase();
            const name =
              (isMe && currentUserName) ||
              e.displayName ||
              e.profile?.display_name ||
              e.profile?.name ||
              null;
            const picture = safeHttpsImageUrl(
              (isMe && currentUserPicture) || e.profile?.picture
            );
            const year = e.year || yearFromScore(e.score);

            return (
              <li
                key={e.eventId + e.pubkey}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                  isMe ? "bg-alien-cyan/5" : "hover:bg-white/[0.02]"
                }`}
              >
                <span
                  className={`w-5 text-center font-mono text-xs shrink-0 ${
                    i === 0
                      ? "text-alien-cyan"
                      : i === 1
                      ? "text-white/70"
                      : "text-alien-muted/70"
                  }`}
                >
                  {i + 1}
                </span>

                <div className="w-8 h-8 rounded-md overflow-hidden bg-alien-panel border border-alien-border shrink-0 flex items-center justify-center">
                  {picture ? (
                    <img
                      src={picture}
                      alt={name || "avatar"}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-alien-cyan/70">
                      {(name || "H").charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-white truncate leading-tight">
                    {name || shortNpub(e.npub, 10)}
                    {isMe && (
                      <span className="ml-1.5 text-[9px] text-alien-cyan font-mono">
                        YOU
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-alien-muted font-mono truncate mt-0.5">
                    {e.score.toLocaleString()} PIPS / {year}
                  </p>
                </div>

                <span className="font-mono font-semibold text-alien-cyan tabular-nums shrink-0 text-sm text-right">
                  {e.score.toLocaleString()}
                  <span className="block text-[9px] text-alien-muted font-normal">
                    {year}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
