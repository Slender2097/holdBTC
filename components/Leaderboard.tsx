"use client";

import { useEffect, useState } from "react";
import { shortNpub } from "@/lib/nostr/utils";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";

interface ScoreEntry {
  pubkey: string;
  npub: string;
  score: number;
  distance: number;
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
  personalBest?: number;
}

export default function Leaderboard({
  refreshKey = 0,
  currentUserPubkey,
  personalBest,
}: LeaderboardProps) {
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/leaderboard", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setEntries(Array.isArray(data.entries) ? data.entries : []);
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
  }, [refreshKey]);

  return (
    <div className="alien-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-alien-border flex items-center justify-between">
        <h2 className="font-mono text-xs tracking-[0.2em] text-alien-cyan uppercase">
          Global Rank
        </h2>
        {personalBest !== undefined && personalBest > 0 && (
          <span className="text-[10px] text-alien-muted font-mono">
            BEST <span className="text-alien-green">{personalBest}</span>
          </span>
        )}
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
            NO SIGNALS YET
          </div>
        )}

        <ul className="divide-y divide-alien-border/50">
          {entries.map((e, i) => {
            const isMe = currentUserPubkey && e.pubkey === currentUserPubkey;
            const name =
              e.displayName ||
              e.profile?.display_name ||
              e.profile?.name ||
              null;
            const picture = safeHttpsImageUrl(e.profile?.picture);

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
                      : i === 2
                      ? "text-alien-muted"
                      : "text-alien-muted/50"
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
                      onError={(ev) => {
                        (ev.target as HTMLImageElement).style.display = "none";
                      }}
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
                  {name && (
                    <p className="text-[10px] text-alien-muted font-mono truncate mt-0.5">
                      {shortNpub(e.npub, 8)}
                    </p>
                  )}
                </div>

                <span className="font-mono font-semibold text-alien-cyan tabular-nums shrink-0 text-sm">
                  {e.score.toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
